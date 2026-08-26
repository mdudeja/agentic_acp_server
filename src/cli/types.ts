export interface CLIResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
  /** Parsed JSON output when the command produces JSON. */
  data?: unknown
}

export interface StatsOptions {
  days?: number
}

export interface CLIProvider {
  deleteSession(sessionId: string): Promise<CLIResult>
  exportSession(sessionId: string, outputPath: string): Promise<CLIResult>
  importSession(filePath: string): Promise<CLIResult>
  listSessions(format?: string): Promise<CLIResult>
  stats(options?: StatsOptions): Promise<CLIResult>
  init(): Promise<CLIResult>
}
