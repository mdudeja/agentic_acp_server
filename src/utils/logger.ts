import type { LogNotificationParams } from 'src/comms/ICommsInterface'
import { getNow } from './datetime'

// Log levels
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARNING = 2,
  ERROR = 3,
}

// Get environment configuration
const APP_MODE = process.env.APP_MODE || 'rpc'
const LOG_TRAFFIC = process.env.LOG_TRAFFIC === 'true'
const CURRENT_LOG_LEVEL = parseLogLevel(process.env.LOG_LEVEL)

const log_types = ['log', 'error', 'warn', 'info'] as const
export type LogType = (typeof log_types)[number]

/**
 * Parse log level from environment variable
 */
function parseLogLevel(level: string | undefined): LogLevel {
  if (!level) return LogLevel.INFO // default level

  switch (level.toUpperCase()) {
    case 'DEBUG':
      return LogLevel.DEBUG
    case 'INFO':
      return LogLevel.INFO
    case 'WARNING':
    case 'WARN':
      return LogLevel.WARNING
    case 'ERROR':
      return LogLevel.ERROR
    default:
      return LogLevel.INFO
  }
}

/**
 * Check if a message should be logged based on the current log level
 */
function shouldLog(messageLevel: LogLevel): boolean {
  return messageLevel >= CURRENT_LOG_LEVEL
}

/**
 * Format log message with timestamp and level
 */
function formatMessage(
  level: string,
  message: string,
  ...args: unknown[]
): string {
  const now = getNow()
  const argString =
    args.length > 0
      ? ' ' +
        args
          .map((arg) => {
            if (typeof arg === 'object') {
              if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}\n${arg.stack}`
              }
              try {
                return JSON.stringify(arg, null, 2)
              } catch {
                return String(arg)
              }
            }
            return String(arg)
          })
          .join(' ')
      : ''

  return `[Agentic] [${now}] [${level}] ${message}${argString}`
}

/**
 * Output the log message based on APP_MODE
 */
function output(formattedMessage: string, log_type: LogType): void {
  if (APP_MODE === 'server') {
    switch (log_type) {
      case 'log':
        console.log(formattedMessage)
        break
      case 'error':
        console.error(formattedMessage)
        break
      case 'warn':
        console.warn(formattedMessage)
        break
      case 'info':
        console.info(formattedMessage)
        break
    }
    return
  }

  const logNotificationParams: LogNotificationParams = {
    method: 'agentic/log',
    data: {
      level:
        log_type === 'error' ? 'error' : log_type === 'warn' ? 'warn' : 'info',
      message: formattedMessage,
    },
  }

  process.stdout.write(
    JSON.stringify({
      jsonrpc: '2.0',
      ...logNotificationParams,
    }) + '\n',
  )
}

/**
 * General log function (INFO level)
 */
export function log(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.INFO)) {
    const formatted = formatMessage('INFO', message, ...args)
    output(formatted, 'log')
  }
}

/**
 * Log error messages
 */
export function logError(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.ERROR)) {
    const formatted = formatMessage('ERROR', message, ...args)
    output(formatted, 'error')
  }
}

/**
 * Log warning messages
 */
export function logWarning(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.WARNING)) {
    const formatted = formatMessage('WARNING', message, ...args)
    output(formatted, 'warn')
  }
}

/**
 * Log info messages
 */
export function logInfo(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.INFO)) {
    const formatted = formatMessage('INFO', message, ...args)
    output(formatted, 'info')
  }
}

/**
 * Log debug messages
 */
export function logDebug(message: string, ...args: unknown[]): void {
  if (shouldLog(LogLevel.DEBUG)) {
    const formatted = formatMessage('DEBUG', message, ...args)
    output(formatted, 'log')
  }
}

/**
 * Log traffic information (only if LOG_TRAFFIC is enabled)
 */
export function logTraffic(
  direction: 'send' | 'receive',
  message: unknown,
  ...args: unknown[]
): void {
  if (!LOG_TRAFFIC) {
    return
  }

  if (shouldLog(LogLevel.DEBUG)) {
    const arrow =
      direction === 'send' ? '>>> CLIENT → AGENT' : '<<< AGENT → CLIENT'
    const formatted = formatMessage('TRAFFIC', `${arrow} ${message}`, ...args)
    output(formatted, 'info')
  }
}
