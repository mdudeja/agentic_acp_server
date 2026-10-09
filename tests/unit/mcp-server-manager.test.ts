import { describe, expect, it, mock } from 'bun:test'
import { McpServerManager } from '../../src/managers/McpServerManager'
import type { AgenticServer } from '../../src/AgenticServer'

function makeManager(
  mcpServers: Record<string, unknown>,
  capabilities: Record<string, boolean> = {},
) {
  const server = {
    getState: () => ({
      config: { mcpServers, indexer: { enabled: false } },
    }),
    hasCapability: mock(
      (capability: string) => capabilities[capability] ?? false,
    ),
  } as unknown as AgenticServer
  const manager = new McpServerManager(server)
  manager.init()
  return manager
}

describe('McpServerManager', () => {
  it('maps stdio servers with their env to ACP form', () => {
    const manager = makeManager({
      local: { command: 'mcp-local', args: ['serve'], env: { TOKEN: 'abc' } },
    })

    expect(manager.getMcpServers()).toEqual([
      {
        name: 'local',
        command: 'mcp-local',
        args: ['serve'],
        env: [{ name: 'TOKEN', value: 'abc' }],
      },
    ])
  })

  it('includes remote servers only when the agent supports the transport', () => {
    const config = {
      remote: {
        type: 'http',
        url: 'https://mcp.example.com',
        headers: { Authorization: 'Bearer x' },
      },
      events: { type: 'sse', url: 'https://sse.example.com' },
    }

    expect(makeManager(config).getMcpServers()).toEqual([])

    expect(
      makeManager(config, { 'mcpCapabilities.http': true }).getMcpServers(),
    ).toEqual([
      {
        type: 'http',
        name: 'remote',
        url: 'https://mcp.example.com',
        headers: [{ name: 'Authorization', value: 'Bearer x' }],
      },
    ])
  })
})
