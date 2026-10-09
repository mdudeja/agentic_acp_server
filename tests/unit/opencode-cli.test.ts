import { describe, test, expect, spyOn, afterEach, mock } from 'bun:test'
import { OpenCodeCLI } from '../../src/cli/OpenCodeCLI'
import { CopilotCLI } from '../../src/cli/CopilotCLI'
import * as shell from '../../src/utils/shell'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('CLI.OpenCodeCLI', () => {
  afterEach(() => {
    mock.restore()
  })

  test('calls exec with correctly formatted deleteSession command', async () => {
    const cli = new OpenCodeCLI('/test/cwd')

    const execSpy = spyOn(cli as any, 'exec').mockResolvedValue({
      success: true,
      stdout: 'deleted',
    })

    const res = await cli.deleteSession('sess-1')
    expect(execSpy).toHaveBeenCalledWith(['session', 'delete', 'sess-1'])
    expect(res.success).toBe(true)
  })

  test('exportSession runs `export <id>` and writes stdout to the output path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-export-'))
    try {
      const cli = new OpenCodeCLI(dir)
      const execSpy = spyOn(cli as any, 'exec').mockResolvedValue({
        success: true,
        stdout: '{"session":"sess-1"}',
        stderr: '',
        exitCode: 0,
      })

      const res = await cli.exportSession('sess-1', 'out/sess.json')

      // No shell redirection tokens: they would be escaped into literals.
      expect(execSpy).toHaveBeenCalledWith(['export', 'sess-1'])
      expect(res.success).toBe(true)
      expect(await Bun.file(join(dir, 'out/sess.json')).text()).toBe(
        '{"session":"sess-1"}',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('exportSession does not write a file when the command fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-export-'))
    try {
      const cli = new OpenCodeCLI(dir)
      spyOn(cli as any, 'exec').mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'no such session',
        exitCode: 1,
      })

      const res = await cli.exportSession('missing', 'out/sess.json')

      expect(res.success).toBe(false)
      expect(await Bun.file(join(dir, 'out/sess.json')).exists()).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('calls exec with correctly formatted importSession command', async () => {
    const cli = new OpenCodeCLI()
    const execSpy = spyOn(cli as any, 'exec').mockResolvedValue({
      success: true,
      stdout: 'imported',
    })

    const res = await cli.importSession('/in/sess.json')
    expect(execSpy).toHaveBeenCalledWith(['import', '/in/sess.json'])
    expect(res.success).toBe(true)
  })

  test('calls exec with correctly formatted listSessions command (default format)', async () => {
    const cli = new OpenCodeCLI()
    const execSpy = spyOn(cli as any, 'exec').mockResolvedValue({
      success: true,
      stdout: '[]',
    })

    const res = await cli.listSessions()
    expect(execSpy).toHaveBeenCalledWith([
      'session',
      'list',
      '--format',
      'json',
    ])
    expect(res.success).toBe(true)
  })

  test('calls exec with correctly formatted listSessions command (custom format)', async () => {
    const cli = new OpenCodeCLI()
    const execSpy = spyOn(cli as any, 'exec').mockResolvedValue({
      success: true,
      stdout: '[]',
    })

    const res = await cli.listSessions('plain')
    expect(execSpy).toHaveBeenCalledWith([
      'session',
      'list',
      '--format',
      'plain',
    ])
    expect(res.success).toBe(true)
  })

  test('calls exec with correctly formatted stats command (default days)', async () => {
    const cli = new OpenCodeCLI()
    const execSpy = spyOn(cli as any, 'exec').mockResolvedValue({
      success: true,
      stdout: 'stats',
    })

    const res = await cli.stats()
    // Defaults to 7 days
    expect(execSpy).toHaveBeenCalledWith([
      'stats',
      '--models',
      '--days',
      '7',
      '--project',
      '',
    ])
    expect(res.success).toBe(true)
  })

  test('calls exec with correctly formatted stats command (custom option)', async () => {
    const cli = new OpenCodeCLI()
    const execSpy = spyOn(cli as any, 'exec').mockResolvedValue({
      success: true,
      stdout: 'stats',
    })

    const res = await cli.stats({ days: 30 })
    expect(execSpy).toHaveBeenCalledWith([
      'stats',
      '--models',
      '--days',
      '30',
      '--project',
      '',
    ])
    expect(res.success).toBe(true)
  })

  test('calls exec with correctly formatted init command', async () => {
    const cli = new OpenCodeCLI()
    const execSpy = spyOn(cli as any, 'exec').mockResolvedValue({
      success: true,
      stdout: 'init',
    })

    const res = await cli.init()
    expect(execSpy).toHaveBeenCalledWith(['run', '--command', '/init'])
    expect(res.success).toBe(true)
  })

  describe('BaseCLI integration via OpenCodeCLI', () => {
    test('exec handles successful shell command correctly', async () => {
      // Mock spawnShellCommand to return a successful fake subprocess
      const mockSubproc = {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"ok": true}\n'))
            controller.close()
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
        exited: Promise.resolve(0),
      }
      const spawnSpy = spyOn(shell, 'spawnShellCommand').mockReturnValue(
        mockSubproc as any,
      )

      const cli = new OpenCodeCLI()
      const result = await cli.init() // Triggers exec()

      expect(result.success).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('{"ok": true}')
      expect(result.data).toEqual({ ok: true }) // Should correctly parse JSON

      spawnSpy.mockRestore()
    })

    test('exec handles failed shell command correctly', async () => {
      const mockSubproc = {
        stdout: new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('Command failed mysteriously\n'),
            )
            controller.close()
          },
        }),
        exited: Promise.resolve(1),
      }
      const spawnSpy = spyOn(shell, 'spawnShellCommand').mockReturnValue(
        mockSubproc as any,
      )

      const cli = new OpenCodeCLI()
      const result = await cli.init() // Triggers exec()

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Command failed mysteriously')
      expect(result.data).toBeUndefined()

      spawnSpy.mockRestore()
    })

    test('exec handles subprocess with no stdio robustly', async () => {
      // Missing stdout/stderr
      const mockSubproc = {
        exited: Promise.resolve(-1),
      }
      const spawnSpy = spyOn(shell, 'spawnShellCommand').mockReturnValue(
        mockSubproc as any,
      )

      const cli = new OpenCodeCLI()
      const result = await cli.init() // Triggers exec()

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(-1)
      expect(result.stderr).toContain('Failed to execute command')

      spawnSpy.mockRestore()
    })
  })
})

describe('CLI.BaseCLI unsupported commands', () => {
  afterEach(() => {
    mock.restore()
  })

  test('an empty command template is unsupported and never executed', async () => {
    // Copilot defines no export command (`[]`); running it would start the
    // bare `copilot` binary.
    const cli = new CopilotCLI()
    const execSpy = spyOn(cli as any, 'exec')

    const res = await cli.exportSession('sess-1', '/tmp/out.json')

    expect(execSpy).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(res.stderr).toBe('exportSession is not supported by the copilot CLI')
  })
})
