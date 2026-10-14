import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildOnly = process.argv[2] === '--build-only'
if (process.argv.length > 3 || (process.argv[2] && !buildOnly)) throw new Error('Use --build-only or no arguments')
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid release commit')
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) {
  throw new Error('Commit the app changes before deploying')
}
const imageBase = 'asia-northeast1-docker.pkg.dev/gen-lang-client-0809048670/cloud-run-source-deploy/copicopi-api'
const image = `${imageBase}:git-${commit}`
const built = spawnSync('gcloud', [
  'builds', 'submit', '.', '--config', 'cloudbuild.yaml',
  '--project', 'gen-lang-client-0809048670', '--region', 'asia-northeast1',
  '--service-account', 'projects/gen-lang-client-0809048670/serviceAccounts/958638932518-compute@developer.gserviceaccount.com',
  '--gcs-source-staging-dir', 'gs://run-sources-gen-lang-client-0809048670-asia-northeast1/sources',
  '--substitutions', `_IMAGE=${image}`, '--suppress-logs', '--format=json', '--quiet',
], { cwd: root, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'],
  shell: process.platform === 'win32', windowsHide: true })
if (built.error) throw built.error
if (built.status !== 0) process.exit(built.status ?? 1)
const build = JSON.parse(built.stdout)
const digest = build.results?.images?.find(item => item.name === image)?.digest
if (build.status !== 'SUCCESS' || build.options?.workerRelease !== 'regular' || !/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) {
  throw new Error('Cloud Build did not return a successful regular build and image digest')
}
console.log(`Built ${imageBase}@${digest} with regular workers (build ${build.id})`)
if (buildOnly) process.exit(0)
const deployFormat = 'json(status.latestCreatedRevisionName,status.traffic)'
const deployed = spawnSync('gcloud', [
  'run', 'deploy', 'copicopi-api', '--image', `${imageBase}@${digest}`,
  '--project', 'gen-lang-client-0809048670', '--region', 'asia-northeast1', '--platform', 'managed',
  '--update-labels', `source-repository=copicopi-app,git-sha=${commit}`, '--quiet',
  // cmd.exe treats projection parentheses as shell syntax unless quoted.
  process.platform === 'win32' ? `--format="${deployFormat}"` : `--format=${deployFormat}`,
], { cwd: root, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'],
  shell: process.platform === 'win32', windowsHide: true })
if (deployed.error) throw deployed.error
if (deployed.status !== 0) process.exit(deployed.status ?? 1)
const service = JSON.parse(deployed.stdout)
const revision = service.status?.latestCreatedRevisionName
if (typeof revision !== 'string' || revision.length > 63
  || !/^copicopi-api-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(revision)) {
  throw new Error('Cloud Run did not return a valid created revision')
}
if (!Array.isArray(service.status?.traffic)) throw new Error('Cloud Run did not return traffic assignments')
const tags = new Set()
for (const target of service.status.traffic) {
  if (!target || typeof target !== 'object') throw new Error('Invalid Cloud Run traffic assignment')
  if (target.tag === undefined) continue
  if (typeof target.tag !== 'string' || target.tag.length > 63
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.tag)) {
    throw new Error('Invalid Cloud Run traffic tag')
  }
  tags.add(target.tag)
}
// A service can remain pinned to an old revision after a successful deployment.
// Move existing tag URLs too: zero-percent tagged revisions remain publicly reachable.
const promoted = spawnSync('gcloud', [
  'run', 'services', 'update-traffic', 'copicopi-api',
  '--project', 'gen-lang-client-0809048670', '--region', 'asia-northeast1',
  '--to-revisions', `${revision}=100`,
  ...(tags.size ? ['--update-tags', [...tags].map(tag => `${tag}=${revision}`).join(',')] : []),
  '--quiet',
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true })
if (promoted.error) throw promoted.error
process.exit(promoted.status ?? 1)
