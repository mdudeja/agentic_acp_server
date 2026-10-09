import type { McpServerManagerEvents } from 'src/data/events'
import { BaseManager } from './BaseManager'
import type { AgenticServer } from 'src/AgenticServer'
import type { McpServerConfig } from 'src/config/schemas'
import type { McpServer } from '@agentclientprotocol/sdk'
import { logWarning } from 'src/utils/logger'

/** `{ KEY: value }` → ACP's `[{ name: KEY, value }]`. */
function toPairs(
  record: Record<string, string> | undefined,
): Array<{ name: string; value: string }> {
  return Object.entries(record ?? {}).map(([name, value]) => ({ name, value }))
}

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

  /**
   * The configured servers in ACP `McpServer` form, ready for
   * `session/new` / `load` / `fork` / `resume`. Remote (http/sse) servers
   * are skipped unless the agent advertises support for that transport.
   */
  getMcpServers(): McpServer[] {
    const servers: McpServer[] = []

    for (const [name, config] of Object.entries(this.mcpServers)) {
      if ('url' in config) {
        if (
          !this.server_instance.hasCapability(`mcpCapabilities.${config.type}`)
        ) {
          logWarning(
            `Skipping MCP server "${name}": the agent does not support ${config.type} MCP servers`,
          )
          continue
        }

        servers.push({
          type: config.type,
          name,
          url: config.url,
          headers: toPairs(config.headers),
        })
        continue
      }

      servers.push({
        name,
        command: config.command,
        args: config.args,
        env: toPairs(config.env),
      })
    }

    return servers
  }

  dispose() {
    this.mcpServers = {}
    this.removeAllListeners()
  }
}
