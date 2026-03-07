# Agentic Server

A JSON-RPC 2.0 middleware server that bridges editor/IDE plugins with AI coding agents via the [Agent Client Protocol (ACP)](https://github.com/anthropics/agent-client-protocol). The server manages the full lifecycle of AI agent subprocesses -- spawning, connecting, session management, terminal delegation, permission handling, and streaming updates back to the editor.

## Architecture

```
Editor / IDE Plugin
    |
    | JSON-RPC 2.0 (stdin/stdout or WebSocket)
    v
AgenticServer
    |-- CommsInterface (Readline or WebSocket transport)
    |-- ASMStateManager (in-memory state)
    |-- AgentManager (spawn, connect, kill agents)
    |-- SessionManager (create, load, fork, resume sessions)
    |-- AgenticDB (SQLite persistence via Drizzle ORM)
    |
    | Spawns AI agent as subprocess
    | Connects via ACP SDK over ndJSON/stdio
    v
AI Agent (copilot, opencode, gemini)
```

The server acts as a mediator: the plugin sends commands over JSON-RPC, and the server translates them into ACP operations against a spawned AI agent subprocess. Responses and streaming updates (tool calls, message chunks, usage stats) flow back to the plugin as notifications.

### Key Design Decisions

- **Event-driven managers** -- `AgentManager` and `SessionManager` are typed `EventEmitter` subclasses. All lifecycle transitions emit events that the server listens to for forwarding to the plugin.
- **TypeBox as single source of truth** -- All RPC schemas are defined once as TypeBox objects, which generate TypeScript types (compile-time), runtime validators (`Check()`), and the OpenRPC specification.
- **Transport-agnostic** -- The `ICommsInterface` abstraction lets the same server core run over stdin/stdout (for editor subprocess integration) or WebSocket (for development or web-based clients).
- **Agent persistence** -- Agents are stored in SQLite. The same provider + working directory pair reuses the existing agent record, including remembered model preferences.

## Stack

| Component        | Technology                                                         |
| ---------------- | ------------------------------------------------------------------ |
| Runtime          | [Bun](https://bun.sh)                                             |
| Language         | TypeScript (ESNext, strict)                                       |
| Schema           | [TypeBox](https://github.com/sinclairzx81/typebox) 1.x            |
| Database         | SQLite via `bun:sqlite`                                            |
| ORM              | [Drizzle ORM](https://orm.drizzle.team/) (SQLite dialect)          |
| ACP SDK          | [`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk) |
| IDs              | [`cuid2`](https://github.com/paralleldrive/cuid2)                 |
| Date/Time        | [`temporal-polyfill`](https://github.com/nicolo-ribaudo/temporal-polyfill) |

> **Note:** This project uses Bun-specific APIs (`bun:sqlite`, `Bun.serve`, `Bun.spawn`, `Bun.file`) and is not portable to Node.js.

## Supported AI Providers

| Provider   | CLI Command | Args                     |
| ---------- | ----------- | ------------------------ |
| `copilot`  | `copilot`   | `['--acp']`              |
| `opencode` | `opencode`  | `['acp']`                |
| `gemini`   | `gemini`    | `['--experimental-acp']` |

Each provider's CLI must be installed and available on `$PATH`. The server spawns the CLI as a subprocess and communicates via ndJSON over stdio.

## Setup

```sh
# Install dependencies
bun install

# Run database migrations
bun drizzle-kit migrate
```

## Running

### RPC Mode (default)

Designed for editor plugins that spawn the server as a subprocess and communicate over stdin/stdout.

```sh
bun run start
# or directly:
bun run --env-file .env index.ts
```

### HTTP / WebSocket Mode

For development or web-based clients. Exposes a WebSocket endpoint and auto-generated API docs.

```sh
bun run start:http
# or directly:
bun run --env-file .env.http index.ts --http --port=3777
```

Available HTTP endpoints:

| Endpoint         | Description                        |
| ---------------- | ---------------------------------- |
| `/ws`            | WebSocket (JSON-RPC 2.0)           |
| `/openrpc.json`  | OpenRPC 1.2.6 specification        |
| `/docs`          | Auto-generated interactive API docs |

## Configuration

Environment variables (set in `.env` / `.env.http` or via the shell):

| Variable             | Description                          | Default                                    |
| -------------------- | ------------------------------------ | ------------------------------------------ |
| `APP_MODE`           | `rpc` or `server`                    | `rpc`                                      |
| `HTTP_PORT`          | Port for WebSocket/HTTP mode         | `3777`                                     |
| `EDITOR_NAME`        | Host editor name                     | `Neovim`                                   |
| `LOG_LEVEL`          | `debug`, `info`, `warn`, `error`     | `info`                                     |
| `LOG_TRAFFIC`        | Log all ndJSON ACP traffic           | `false`                                    |
| `DB_FILE_URL`        | Path to SQLite database file         | `~/.local/share/nvim/agentic/agentic.db`   |
| `DB_MIGRATIONS_DIR`  | Path to Drizzle migration files      | `./drizzle_migrations`                     |
| `OPENRPC_SCHEMA_PATH`| Path to generated OpenRPC spec       | `src/openrpc/openrpc.json`                 |

## Scripts

| Command               | Description                                   |
| --------------------- | --------------------------------------------- |
| `bun run start`       | Start in RPC mode                             |
| `bun run start:http`  | Start in HTTP/WebSocket mode (with hot reload)|
| `bun run lint`        | Type-check (`tsc --noEmit`)                   |
| `bun run build`       | Generate OpenRPC spec + bundle & minify       |
| `bun run gen:openrpc` | Regenerate `openrpc.json` from TypeBox schemas|
| `bun test`            | Run tests                                     |

## Project Structure

```
index.ts                          Entry point (mode detection, bootstrap)
main.ts                           AgenticServer class (core orchestrator)
src/
  acp/
    Client.ts                     ACP client implementation (acp.Client interface)
    handlers/
      FileSystemHandler.ts        File read/write operations for the agent
      PermissionHandler.ts        Permission request handling (auto/deny/ask)
      TerminalHandler.ts          Terminal lifecycle (create, output, kill, release)
      SessionUpdateHandler.ts     Dispatches session update events
  comms/
    ICommsInterface.ts            Transport abstraction + exported types
    ReadlineCommsInterface.ts     stdin/stdout transport (RPC mode)
    WebsocketCommsInterface.ts    WebSocket + HTTP transport (server mode)
  data/
    events.ts                     Agent and session event type definitions
    providers.ts                  Supported AI provider configurations
  database/
    AgenticDB.ts                  SQLite database singleton (Drizzle + bun:sqlite)
    validation.ts                 Drizzle-TypeBox validation schemas
    schemas/
      agents.schema.ts            agents table definition
      sessions.schema.ts          sessions table definition
      common.schema.ts            Shared columns, enums
  ingester/
    index.ts                      EditorContext -> ACP ContentBlock[] conversion
  managers/
    BaseManager.ts                Typed EventEmitter base class
    AgentManager.ts               Agent lifecycle management
    SessionManager.ts             Session lifecycle management
  openrpc/
    schemas.ts                    TypeBox schemas (single source of truth)
    spec.ts                       OpenRPC specification object
    types.ts                      OpenRPC 1.2.6 TypeScript types
    openrpc.json                  Generated OpenRPC JSON spec
  state/
    IASMState.ts                  State types and interface
    index.ts                      In-memory state manager
  utils/
    logger.ts                     Level-based, mode-aware logging
    helpers.ts                    Error helpers, stream utilities
    shell.ts                      Shell spawning (Unix shell detection)
    paths.ts                      Path resolution (~ expansion)
    datetime.ts                   Temporal API date/time utilities
    renderopenrpcdocs.ts          HTML renderer for OpenRPC docs
```

---

## Plugin Developer Guide

This section covers what you need to know to build an editor or IDE plugin that uses the Agentic Server as its backend.

### Transport

The server supports two transports. Pick the one that fits your plugin model:

**stdin/stdout (RPC mode)** -- Spawn the server as a child process. Send JSON-RPC messages as newline-delimited strings to its stdin. Read responses and notifications from its stdout. This is the typical approach for editor plugins (e.g., Neovim via `jobstart()` / `vim.fn.jobstart`).

```sh
bun run --env-file .env index.ts
```

**WebSocket (server mode)** -- Connect to `ws://localhost:<port>/ws`. Useful during development or if your editor has better WebSocket support.

```sh
bun run --env-file .env.http index.ts --http --port=3777
```

### Message Format

All messages follow JSON-RPC 2.0. The payload is wrapped in an envelope:

**Client -> Server:**
```json
{
  "jsonrpc": "2.0",
  "data": {
    "method": "client/init",
    "params": {
      "provider": "copilot",
      "cwd": "/home/user/my-project"
    }
  }
}
```

**Server -> Client (response):**
```json
{
  "jsonrpc": "2.0",
  "type": "response",
  "method": "client/init",
  "id": "req_001",
  "result": { "success": true, "agentId": "cm9abc123def456" }
}
```

**Server -> Client (notification):**
```json
{
  "jsonrpc": "2.0",
  "type": "notification",
  "method": "agentic/session_update",
  "data": { "sessionId": "sess_abc", "updateType": "agent_message_chunk", "update": { ... } }
}
```

Use the `type` field to distinguish responses from notifications. All `client/*` methods produce an `agentic/respond` response. Notifications (`agentic/*`) are fire-and-forget from the server's perspective.

### Correlation IDs

Most `client/*` methods accept an optional `requestId` param. If provided, the server echoes it back as `id` in the `agentic/respond` message. This lets you correlate async responses when multiple requests are in flight.

### Lifecycle

A typical session follows this sequence:

1. **Initialize** -- Send `client/init` with a provider and working directory. The server spawns the agent subprocess and connects via ACP. Wait for the `agentic/respond` with `{ success: true, agentId }`.

2. **Create session** -- Send `client/new_session`. The server creates an ACP session with the agent. Wait for `{ success: true, sessionId }`.

3. **Send prompts** -- Send `client/ask` with a `prompt` string and optional `contexts` array. The server forwards the prompt to the agent.

4. **Handle streaming updates** -- Listen for `agentic/session_update` notifications. The `updateType` field tells you what kind of update it is:
   - `agent_message_chunk` -- incremental text from the agent
   - `agent_thought_chunk` -- agent reasoning/thinking text
   - `tool_call` -- agent is invoking a tool
   - `tool_call_update` -- progress update on a running tool call
   - `usage_update` -- token usage statistics
   - `plan` -- agent's execution plan
   - `available_commands_update` -- commands the agent can execute
   - `config_option_update` -- session configuration changed
   - `current_mode_update` -- agent mode changed

5. **Handle questions** -- The server may send `agentic/question` when the agent needs user input (e.g., permission to write a file). Display it to the user and reply with `client/answer`, matching the `questionId`.

6. **Handle terminal requests** -- The server may send `agentic/terminal` requesting your plugin to create a terminal, capture output, wait for exit, kill, or release it. Your plugin performs the action and replies with `client/terminal`, matching the `requestId`.

7. **Session management** -- Use `client/load_session`, `client/fork_session`, `client/rename_session`, `client/delete_session`, `client/archive_session`, `client/resume_session`, `client/list_sessions` as needed.

8. **Dispose** -- Send `client/dispose` when done. The server kills the agent subprocess and cleans up.

### Client -> Server Methods

| Method                        | Required Params            | Description                                 |
| ----------------------------- | -------------------------- | ------------------------------------------- |
| `client/init`                 | `provider`, `cwd`          | Initialize agent for workspace              |
| `client/new_session`          | --                         | Create a new session                        |
| `client/ask`                  | `prompt`                   | Send a prompt (with optional `contexts`)    |
| `client/answer`               | `questionId`, `answer`     | Reply to an `agentic/question`              |
| `client/terminal`             | `requestId`, `response`    | Reply to an `agentic/terminal`              |
| `client/dispose`              | --                         | Kill agent and clean up                     |
| `client/load_session`         | `sessionId`                | Load an existing session                    |
| `client/rename_session`       | `sessionId`, `newName`     | Rename a session                            |
| `client/delete_session`       | `sessionId`                | Delete a session                            |
| `client/archive_session`      | `sessionId`, `archive`     | Archive or unarchive a session              |
| `client/fork_session`         | `sessionId`                | Fork the current session                    |
| `client/resume_session`       | `sessionId`                | Resume a suspended session                  |
| `client/switch_session_mode`  | `sessionId`                | Switch session mode                         |
| `client/switch_model`         | `sessionId`, `model`       | Switch AI model                             |
| `client/list_sessions`        | --                         | List all sessions                           |

### Server -> Client Notifications

| Method                   | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `agentic/respond`        | Response to any `client/*` method                 |
| `agentic/log`            | Log output (level: `info`, `warn`, `error`)       |
| `agentic/question`       | Agent needs user input (correlate via `questionId`)|
| `agentic/terminal`       | Agent needs a terminal operation in the editor     |
| `agentic/session_update` | Streaming updates (chunks, tool calls, usage, etc.)|

### EditorContext

When sending `client/ask`, you can attach rich context from the editor via the `contexts` array. Each context object has:

```typescript
{
  type: 'selection' | 'file' | 'workspace' | 'keymaps' | 'diagnostics' | 'image' | 'audio' | 'link',
  text: string,
  metadata?: {
    mimetype?: string,
    name?: string,
    title?: string,
    description?: string,
    data?: string,       // base64-encoded binary data
    uri?: string,
    size?: number
  },
  annotations?: {
    audience?: ('user' | 'assistant')[],
    priority?: number,   // 0 to 1
    lastModified?: string
  }
}
```

The server converts these into ACP `ContentBlock` objects before sending to the agent. Use `selection` for highlighted code, `file` for full file contents, `diagnostics` for LSP diagnostics, `image`/`audio` for binary attachments (provide base64 in `metadata.data` or a file path in `metadata.uri`).

### Terminal Operations

When the agent needs to run shell commands, the server sends `agentic/terminal` notifications. Your plugin must handle these and respond with `client/terminal`:

| Operation    | What the plugin should do                          | Response params                                    |
| ------------ | -------------------------------------------------- | -------------------------------------------------- |
| `create`     | Create a terminal, run the command                 | `{ request: "create", params: { terminalId, jobId? } }` |
| `get_output` | Return current stdout/stderr of a terminal         | `{ request: "get_output", params: { stdout, stderr, exitStatus?, truncated? } }` |
| `wait_exit`  | Wait for terminal to finish, return exit status    | `{ request: "wait_exit", params: { exitStatus } }`     |
| `kill`       | Send signal to terminal process                    | `{ request: "kill", params: { success } }`              |
| `release`    | Release terminal resources                         | `{ request: "release", params: { success } }`           |

### Permission Handling

The server supports three permission modes per agent (stored in the database):

- **`allow`** -- automatically grants all agent permission requests
- **`deny`** -- automatically denies all agent permission requests
- **`ask`** (default) -- forwards permission requests to the plugin as `agentic/question` notifications

When mode is `ask`, your plugin receives a question and must present it to the user, then send back the answer via `client/answer`.

### API Specification

The full API is described in an [OpenRPC 1.2.6](https://open-rpc.org/) specification. You can access it:

- As a JSON file: `src/openrpc/openrpc.json`
- Via HTTP (server mode): `GET /openrpc.json`
- As rendered docs (server mode): `GET /docs`

To regenerate the spec after modifying schemas:

```sh
bun run gen:openrpc
```

### Adding a New RPC Method

If you're extending the server:

1. Define the params schema in `src/openrpc/schemas.ts` using TypeBox
2. Add it to the `ASMPayloadDataSchema` union
3. Export the `Static<>` type alias
4. Add the method entry to `src/openrpc/spec.ts`
5. Handle the method in `main.ts` `_process_payload` switch
6. Run `bun run gen:openrpc`

## License

See [LICENSE](LICENSE) for details.
