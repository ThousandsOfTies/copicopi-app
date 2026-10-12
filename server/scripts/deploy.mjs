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
const deployed = spawnSync('gcloud', [
  'run', 'deploy', 'copicopi-api', '--image', `${imageBase}@${digest}`,
  '--project', 'gen-lang-client-0809048670', '--region', 'asia-northeast1', '--platform', 'managed',
  '--update-labels', `source-repository=copicopi-app,git-sha=${commit}`, '--quiet',
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true })
if (deployed.error) throw deployed.error
process.exit(deployed.status ?? 1)
