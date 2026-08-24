import type { McpServerManagerEvents } from 'src/data/events'
import { BaseManager } from './BaseManager'
import type { AgenticServer } from 'src/AgenticServer'
import type { McpServerConfig } from 'src/config/schemas'

export class McpServerManager extends BaseManager<McpServerManagerEvents> {
  private mcpServers: { [key: string]: McpServerConfig } = {}

  constructor(private readonly server_instance: AgenticServer) {
    super()
  }

  init() {
    const config = this.server_instance.getState().config

    if (!config) {
      this.emit(
        'mcpservermanager.error',
        'App config not found. Cannot create McpServerManager.',
      )
      return
    }

    this.mcpServers = {
      ...config.mcpServers,
      ...(config.indexer.enabled ? config.indexer.mcpServerConfig : {}),
    }

    this.emit('mcpservermanager.started', 'Mcp Server Manager started')
  }

  getMcpServers() {
    const servers: { name: string; command: string; args: string[] }[] = []
    for (const [name, config] of Object.entries(this.mcpServers)) {
      servers.push({
        name,
        command: config.command,
        args: config.args,
      })
    }

    return servers
  }

  dispose() {
    this.mcpServers = {}
    this.removeAllListeners()
  }
}
