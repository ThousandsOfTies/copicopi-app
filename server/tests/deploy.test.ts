import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const deployScriptUrl = new URL('../scripts/deploy.mjs', import.meta.url).href
const script = readFileSync(new URL(deployScriptUrl), 'utf8')
  .replace(/^import .+ from .+\r?\n/gm, '')
  .replaceAll('import.meta.url', 'deployScriptUrl')
const revision = 'copicopi-api-00009-pjt'
const oldRevision = 'copicopi-api-00008-kur'
const commit = 'a'.repeat(40)
const digest = `sha256:${'b'.repeat(64)}`

interface Scenario {
  buildOnly?: boolean
  platform?: string
  buildStatus?: number | null
  deployStatus?: number | null
  promotionStatus?: number | null
  buildError?: Error
  deployError?: Error
  promotionError?: Error
  buildBody?: unknown
  deployBody?: unknown
  rawDeployOutput?: string
}

class ProcessExit extends Error {
  constructor(readonly status: number) { super('process.exit') }
}

/** Run the actual script with all subprocess calls replaced; never invoke gcloud or git. */
function runDeployment(scenario: Scenario = {}) {
  const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
  let exitCode: number | undefined
  let failure: string | undefined
  try {
    vm.runInNewContext(script, {
      deployScriptUrl, path, fileURLToPath,
      console: { log() {} },
      process: {
        argv: ['node', 'scripts/deploy.mjs', ...(scenario.buildOnly ? ['--build-only'] : [])],
        platform: scenario.platform ?? 'linux',
        exit: (status: number) => { throw new ProcessExit(status) },
      },
      execFileSync: (command: string, args: string[]) => {
        assert.equal(command, 'git')
        if (args[0] === 'rev-parse') return commit
        assert.deepEqual(Array.from(args), ['status', '--porcelain'])
        return ''
      },
      spawnSync: (command: string, args: string[], options: Record<string, unknown>) => {
        assert.equal(command, 'gcloud')
        calls.push({ command, args: Array.from(args), options })
        if (args[0] === 'builds') {
          const image = args[args.indexOf('--substitutions') + 1].slice('_IMAGE='.length)
          return { status: scenario.buildStatus === undefined ? 0 : scenario.buildStatus,
            error: scenario.buildError,
            stdout: JSON.stringify(scenario.buildBody ?? { status: 'SUCCESS', id: 'test-build',
              options: { workerRelease: 'regular' }, results: { images: [{ name: image, digest }] } }) }
        }
        if (args[1] === 'deploy') {
          return { status: scenario.deployStatus === undefined ? 0 : scenario.deployStatus,
            error: scenario.deployError,
            stdout: scenario.rawDeployOutput ?? JSON.stringify(scenario.deployBody ?? {
              status: { latestCreatedRevisionName: revision,
                traffic: [{ revisionName: oldRevision, percent: 100 }] },
            }) }
        }
        assert.deepEqual(Array.from(args).slice(0, 4), ['run', 'services', 'update-traffic', 'copicopi-api'])
        return { status: scenario.promotionStatus === undefined ? 0 : scenario.promotionStatus,
          error: scenario.promotionError }
      },
    })
  } catch (error) {
    if (error instanceof ProcessExit) exitCode = error.status
    else failure = String(error)
  }
  return { calls, exitCode, failure }
}

test('a successful deployment replaces an old traffic pin with the exact created revision', () => {
  for (const platform of ['linux', 'win32']) {
    const result = runDeployment({ platform })
    assert.equal(result.failure, undefined)
    assert.equal(result.exitCode, 0)
    assert.equal(result.calls.length, 3)
    const deploy = result.calls[1]
    assert.ok(deploy.args.includes(`--format=${platform === 'win32' ? '"' : ''}json(status.latestCreatedRevisionName,status.traffic)${platform === 'win32' ? '"' : ''}`))
    assert.equal(deploy.options.encoding, 'utf8')
    assert.equal(deploy.options.shell, platform === 'win32')
    assert.equal(deploy.options.windowsHide, true)
    assert.ok(deploy.args[deploy.args.indexOf('--image') + 1].endsWith(`@${digest}`))
    const promotion = result.calls[2].args
    assert.equal(promotion[promotion.indexOf('--to-revisions') + 1], `${revision}=100`)
    assert.ok(!promotion.includes('--to-latest'))
    assert.ok(!promotion.includes('--update-tags'))
  }
})

test('existing tag names, including zero-percent tags, all move to the exact new revision', () => {
  const result = runDeployment({ deployBody: { status: { latestCreatedRevisionName: revision, traffic: [
    { revisionName: oldRevision, percent: 100 },
    { tag: 'gemini38', revisionName: oldRevision, percent: 0 },
    { tag: 'preview-2', revisionName: 'copicopi-api-00007-old' },
  ] } } })
  assert.equal(result.failure, undefined)
  assert.equal(result.exitCode, 0)
  const args = result.calls[2].args
  assert.equal(args[args.indexOf('--update-tags') + 1], `gemini38=${revision},preview-2=${revision}`)
  assert.equal(args[args.indexOf('--to-revisions') + 1], `${revision}=100`)
  assert.ok(!args.includes('--set-tags'))
  assert.ok(!args.includes('--clear-tags'))
})

test('build-only finishes after a validated image without deploying or changing traffic', () => {
  const result = runDeployment({ buildOnly: true })
  assert.equal(result.failure, undefined)
  assert.equal(result.exitCode, 0)
  assert.equal(result.calls.length, 1)
})

test('failed builds and deploys never change traffic', () => {
  for (const [scenario, count, expectedExit] of [
    [{ buildStatus: 7 }, 1, 7],
    [{ buildStatus: null }, 1, 1],
    [{ deployStatus: 9 }, 2, 9],
    [{ deployStatus: null }, 2, 1],
  ] as const) {
    const result = runDeployment(scenario)
    assert.equal(result.failure, undefined)
    assert.equal(result.exitCode, expectedExit)
    assert.equal(result.calls.length, count)
  }
  for (const [scenario, count] of [
    [{ buildError: new Error('build spawn failed') }, 1],
    [{ deployError: new Error('deploy spawn failed') }, 2],
    [{ buildBody: { status: 'FAILURE' } }, 1],
  ] as const) {
    const result = runDeployment(scenario)
    assert.ok(result.failure)
    assert.equal(result.calls.length, count)
  }
})

test('missing, malformed, or unsafe created revision output never changes traffic', () => {
  for (const created of [undefined, '', oldRevision + '\n--to-latest', 'other-service-00009-pjt',
    'copicopi-api-00009;echo', `copicopi-api-${'x'.repeat(64)}`]) {
    const result = runDeployment({ deployBody: { status: { latestCreatedRevisionName: created, traffic: [] } } })
    assert.match(result.failure ?? '', /valid created revision/)
    assert.equal(result.calls.length, 2)
  }
  const malformed = runDeployment({ rawDeployOutput: 'not JSON' })
  assert.ok(malformed.failure)
  assert.equal(malformed.calls.length, 2)
})

test('missing traffic assignments and unsafe tags stop before any traffic change', () => {
  for (const traffic of [undefined, {}, [null], [{ tag: '' }], [{ tag: 'old,new' }],
    [{ tag: 'old=LATEST' }], [{ tag: 'old&echo' }], [{ tag: 'x'.repeat(64) }]]) {
    const result = runDeployment({ deployBody: { status: { latestCreatedRevisionName: revision, traffic } } })
    assert.ok(result.failure)
    assert.equal(result.calls.length, 2)
  }
})

test('a traffic promotion failure makes the complete deployment fail', () => {
  for (const [promotionStatus, expectedExit] of [[12, 12], [null, 1]] as const) {
    const result = runDeployment({ promotionStatus })
    assert.equal(result.failure, undefined)
    assert.equal(result.exitCode, expectedExit)
    assert.equal(result.calls.length, 3)
  }
  const result = runDeployment({ promotionError: new Error('promotion spawn failed') })
  assert.match(result.failure ?? '', /promotion spawn failed/)
  assert.equal(result.calls.length, 3)
})
