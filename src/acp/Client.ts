import * as acp from '@agentclientprotocol/sdk'
import type { FileSystemHandler } from 'src/acp/handlers/FileSystemHandler'
import type { PermissionHandler } from 'src/acp/handlers/PermissionHandler'
import type { TerminalHandler } from 'src/acp/handlers/TerminalHandler'
import type { SessionUpdateHandler } from 'src/acp/handlers/SessionUpdateHandler'

export class AcpClient implements acp.Client {
  private agent: acp.Agent | null = null

  constructor(
    private readonly fsHandler: FileSystemHandler,
    private readonly permissionHandler: PermissionHandler,
    private readonly terminalHandler: TerminalHandler,
    private readonly sessionUpdateHander: SessionUpdateHandler,
  ) {}

  setAgent(agent: acp.Agent) {
    this.agent = agent
  }

  getAgent(): acp.Agent | null {
    return this.agent
  }

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    return this.permissionHandler.requestPermission(params)
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    await this.sessionUpdateHander.handleUpdate(params.sessionId, params.update)
  }

  /* File system operations */

  async readTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    return this.fsHandler.readTextFile(params)
  }

  async writeTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    return this.fsHandler.writeTextFile(params)
  }

  /* Terminal operations */

  async createTerminal(
    params: acp.CreateTerminalRequest,
  ): Promise<acp.CreateTerminalResponse> {
    return this.terminalHandler.createTerminal(params)
  }

  async terminalOutput(
    params: acp.TerminalOutputRequest,
  ): Promise<acp.TerminalOutputResponse> {
    return this.terminalHandler.terminalOutput(params)
  }

  async waitForTerminalExit(
    params: acp.WaitForTerminalExitRequest,
  ): Promise<acp.WaitForTerminalExitResponse> {
    return this.terminalHandler.waitForTerminalExit(params)
  }

  async killTerminal(
    params: acp.KillTerminalCommandRequest,
  ): Promise<acp.KillTerminalCommandResponse> {
    return this.terminalHandler.killTerminal(params)
  }

  async releaseTerminal(
    params: acp.ReleaseTerminalRequest,
  ): Promise<acp.ReleaseTerminalResponse | void> {
    return this.terminalHandler.releaseTerminal(params)
  }
}
