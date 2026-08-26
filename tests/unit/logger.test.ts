import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

/**
 * The logger module reads `process.env` at import time (module top-level), so
 * to test different log levels/modes we must set the env, import a fresh copy
 * via a unique query string (busts the module cache), then restore the env.
 */
async function importLogger(
  appMode: 'server' | 'rpc',
  logLevel: string,
  traffic: 'true' | 'false',
) {
  const prev = { ...process.env }
  process.env.ACP_APP_MODE = appMode
  process.env.ACP_LOG_LEVEL = logLevel
  process.env.ACP_LOG_TRAFFIC = traffic
  const mod = await import(
    '../../src/utils/logger?uniq=' + Math.random().toString(36).slice(2)
  )
  Object.assign(process.env, prev)
  return mod as typeof import('../../src/utils/logger')
}

describe('utils.logger', () => {
  const originalStdoutWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write
  let stdoutWrite: any
  let stderrWrite: any

  beforeEach(() => {
    stdoutWrite = mock()
    stderrWrite = mock()
    process.stdout.write = stdoutWrite as any
    process.stderr.write = stderrWrite as any
  })

  afterEach(() => {
    // Restore the real writes explicitly (mock.restore() only undoes spies,
    // not plain property assignments).
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    mock.restore()
  })

  test('logError writes a JSON-RPC agentic/log notification in rpc mode', async () => {
    const { logError } = await importLogger('rpc', 'error', 'false')
    logError('boom', new Error('kaboom'))
    const raw = stdoutWrite.mock.calls[0]?.[0] as string
    expect(raw).toContain('agentic/log')
    expect(raw).toContain('boom')
  })

  test('info-level logs are suppressed when log level is error', async () => {
    const { logInfo, logWarning, logDebug } = await importLogger(
      'rpc',
      'error',
      'false',
    )
    logInfo('info')
    logWarning('warn')
    logDebug('debug')
    expect(stdoutWrite.mock.calls.length).toBe(0)
  })

  test('logDebug is emitted when log level is debug', async () => {
    const { logDebug } = await importLogger('rpc', 'debug', 'false')
    logDebug('some-debug')
    const raw = stdoutWrite.mock.calls[0]?.[0] as string
    expect(raw).toContain('some-debug')
  })

  test('outputs to console in server mode', async () => {
    const { logInfo } = await importLogger('server', 'info', 'false')
    const orig = console.info
    const consoleSpy = mock()
    console.info = consoleSpy as any
    try {
      logInfo('hello-server')
      expect(consoleSpy).toHaveBeenCalled()
    } finally {
      console.info = orig
    }
  })

  test('logTraffic no-ops when traffic logging is disabled', async () => {
    const { logTraffic } = await importLogger('rpc', 'debug', 'false')
    logTraffic('send', 'frame')
    expect(stdoutWrite.mock.calls.length).toBe(0)
  })

  test('logTraffic writes when traffic logging is enabled and debug', async () => {
    const { logTraffic } = await importLogger('rpc', 'debug', 'true')
    logTraffic('send', 'frame')
    const raw = stdoutWrite.mock.calls[0]?.[0] as string
    expect(raw).toContain('CLIENT → AGENT')
  })

  test('formatMessage handles non-object args', async () => {
    const { logError } = await importLogger('rpc', 'error', 'false')
    logError('plain', 'text-arg')
    const raw = stdoutWrite.mock.calls[0]?.[0] as string
    expect(raw).toContain('text-arg')
  })
})
