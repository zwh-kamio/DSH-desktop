import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { BackendController, killProcessTree, parseReadyUrl, type SpawnFn } from '../src/backend.ts'

/** Minimal ChildProcess surface for driving the controller without forking. */
interface FakeChild extends EventEmitter {
  pid: number
  exitCode: number | null
  stdout: EventEmitter & { setEncoding(_: string): void }
  stderr: EventEmitter & { setEncoding(_: string): void }
  kill(signal?: string): boolean
}

function fakeStream(): EventEmitter & { setEncoding(_: string): void } {
  return Object.assign(new EventEmitter(), { setEncoding: () => {} })
}

function fakeChild(pid = 1234): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.pid = pid
  child.exitCode = null
  child.stdout = fakeStream()
  child.stderr = fakeStream()
  child.kill = () => true
  return child
}

function asChild(child: FakeChild): ChildProcess {
  return child as unknown as ChildProcess
}

describe('parseReadyUrl', () => {
  it('parses the authenticated loopback URL from the readiness line', () => {
    expect(parseReadyUrl('dsh web: http://127.0.0.1:3080/?token=abc')).toBe('http://127.0.0.1:3080/?token=abc')
  })

  it('ignores non-readiness lines', () => {
    expect(parseReadyUrl('some other output')).toBeUndefined()
    expect(parseReadyUrl('dsh web: opening the default browser; pass --no-open to disable')).toBeUndefined()
  })
})

describe('BackendController.start', () => {
  it('resolves the authenticated URL when the backend announces readiness', async () => {
    const child = fakeChild()
    const spawnFn: SpawnFn = () => asChild(child)
    const controller = new BackendController({
      command: 'node',
      args: ['bin.js', 'web', '--no-open', '--port', '0'],
      cwd: '.',
      spawn: spawnFn,
    })
    const ready = controller.start()
    child.stdout.emit('data', 'dsh web: http://127.0.0.1:4000/?token=xyz\n')
    await expect(ready).resolves.toBe('http://127.0.0.1:4000/?token=xyz')
    expect(controller.readyUrl).toBe('http://127.0.0.1:4000/?token=xyz')
  })

  it('rejects when the backend exits before readiness', async () => {
    const child = fakeChild()
    const spawnFn: SpawnFn = () => asChild(child)
    const controller = new BackendController({ command: 'node', args: ['bin.js'], cwd: '.', spawn: spawnFn })
    const ready = controller.start()
    child.emit('exit', 1)
    await expect(ready).rejects.toThrow(/exited before readiness/)
  })

  it('rejects when readiness does not arrive within the timeout', async () => {
    const child = fakeChild()
    const spawnFn: SpawnFn = () => asChild(child)
    const controller = new BackendController({
      command: 'node',
      args: ['bin.js'],
      cwd: '.',
      spawn: spawnFn,
      readyTimeoutMs: 5,
    })
    await expect(controller.start()).rejects.toThrow(/readiness within 5ms/)
  })
})

describe('BackendController.stop', () => {
  it('is a no-op when the backend is not running', async () => {
    const controller = new BackendController({ command: 'node', args: [], cwd: '.' })
    await expect(controller.stop()).resolves.toBeUndefined()
  })
})

describe('killProcessTree', () => {
  it('uses taskkill /T /F on Windows', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const child = fakeChild()
    const spawnFn: SpawnFn = (command, args) => {
      calls.push({ command, args })
      const killer = new EventEmitter()
      queueMicrotask(() => killer.emit('exit', 0))
      return killer as unknown as ChildProcess
    }
    await killProcessTree(asChild(child), 'win32', spawnFn)
    expect(calls).toEqual([{ command: 'taskkill', args: ['/pid', '1234', '/T', '/F'] }])
  })

  it('SIGTERMs the child on non-Windows platforms', async () => {
    vi.useFakeTimers()
    try {
      const child = fakeChild()
      const killed: string[] = []
      child.kill = (signal?: string) => {
        killed.push(signal ?? '')
        return true
      }
      const done = killProcessTree(asChild(child), 'linux')
      child.emit('exit', null)
      await done
      expect(killed).toEqual(['SIGTERM'])
    } finally {
      vi.useRealTimers()
    }
  })
})
