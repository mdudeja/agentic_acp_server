# Agentic ACP Server

An **Agent Client Protocol (ACP) server** that connects a Neovim (or other
editor) plugin to headless AI coding agents. It spawns an agent CLI, talks to it
over ACP, and exposes a simple JSON-RPC interface that your editor plugin can
drive — prompting the agent, managing sessions, handling file/tool permissions,
and streaming real-time session updates back into the editor.

```
Your NVIM plugin  ⇄  Agentic ACP Server  ⇄  Agent CLI (copilot --acp / opencode acp / …)
```

---

## Table of contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the server](#running-the-server)
  - [RPC mode (stdio)](#rpc-mode-stdio)
  - [HTTP / WebSocket mode](#http--websocket-mode)
- [Connecting from your NVIM plugin](#connecting-from-your-nvim-plugin)
- [Client → server methods](#client--server-methods)
- [Server → client notifications](#server--client-notifications)
- [Supported agents](#supported-agents)
- [State & persistence](#state--persistence)
- [Project layout](#project-layout)
- [Development](#development)

---

## How it works

1. **You (the plugin) initialise the server** for a workspace with
   `client/init`, telling it which agent provider to use and the working
   directory.
2. **The server spawns the agent CLI** (e.g. `copilot --acp` or
   `opencode acp`) and speaks ACP with it over stdio.
3. **You create a session** with `client/new_session`, then send prompts with
   `client/ask`.
4. The agent may **request permission** for tool calls, **read/write files**,
   or **run terminal commands** in your editor. The server forwards these as
   notifications; you answer them and the server relays your decision back to
   the agent.
5. The agent streams output back — message chunks, tool calls, plans, usage —
   which the server pushes to your plugin as `agentic/session_update`
   notifications.

---

## Requirements

- **Bun** ≥ 1.x (the server is built for and runs on Bun).
- One or more ACP-capable agent CLIs installed and on your `PATH`:
  - [Copilot](https://github.com/features/copilot) (`copilot`)
  - [OpenCode](https://opencode.ai) (`opencode`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
- A Neovim plugin that implements the ASM JSON-RPC interface described below
  (this repo provides the server, not the plugin).

---

## Installation

Clone the repo and install dependencies:

```bash
bun install
```

Create local environment files for credentials / settings (all are gitignored):

```bash
# .env  → used by `bun run start` (RPC mode)
# .env.http → used by `bun run start:http` (HTTP/WS mode)
# .env.test → used by `bun test`
```

The accepted variables (see `index.ts`):

| Variable | Purpose | Default |
|----------|---------|---------|
| `ACP_EDITOR_NAME` | Editor name sent to the agent | — |
| `ACP_AGENTIC_DIR` | Config/state dir name inside the workspace | `.agentic` |
| `ACP_CONFIG_FILENAME` | Config file name inside `.agentic` | `agentic_acp_config.json` |
| `ACP_LOG_LEVEL` | `debug`/`info`/`warn`/`error`/`none` | `info` |
| `ACP_LOG_TRAFFIC` | Log raw ACP traffic | `false` |
| `ACP_APP_MODE` | `server` (HTTP) or `rpc` (stdio) | `rpc` |
| `ACP_HTTP_PORT` | HTTP/WS port | `3777` |
| `ACP_DB_FILE_URL` | SQLite DB file path | — |
| `ACP_DB_MIGRATIONS_DIR` | Drizzle migrations dir | `./drizzle_migrations` |
| `ACP_OPENRPC_SCHEMA_PATH` | Path to `openrpc.json` | `src/openrpc/openrpc.json` |

---

## Configuration

On first run the server creates a `.agentic/` directory in your workspace with a
default `agentic_acp_config.json`. Create this file yourself to override
settings. It is merged over defaults (missing fields fall back to defaults).

```jsonc
{
  "indexer": {
    "enabled": false,
    "commands": { "index": "agentic-indexer index" },
    "mcpServerConfig": { "agentic-indexer": { "command": "agentic-indexer", "args": ["serve"] } }
  },
  "mcpServers": {
    // optional extra MCP servers to expose to the agent
  },
  "hooks": {
    "projectInit": { "enabled": true, "runProviderInit": true },
    "sessionCleanup": { "enabled": false }
  },
  "sessions": {
    "memoryPath": ".agentic/sessions/"
  },
  "gitignore": true
}
```

- `sessions.memoryPath` — where exported session JSON files are written.
- `gitignore` — whether `.agentic/` should be added to `.gitignore`.

---

## Running the server

### RPC mode (stdio)

The server reads JSON-RPC messages from stdin and writes responses/notifications
to stdout. This is the default and is best for a plugin that spawns the server
as a child process.

```bash
bun run start
# or: bun --env-file=.env run index.ts
```

```bash
# full CLI
bun run index.ts --help
#  -s, --server    HTTP server mode
#  -p, --port      HTTP port
#  -r, --root      workspace root (default: cwd)
```

### HTTP / WebSocket mode

The server runs an HTTP server exposing a WebSocket endpoint, an OpenRPC spec,
and interactive docs. Useful for remote or debug setups.

```bash
bun run start:http   # watch + WS, reads .env.http
```

| Endpoint | Description |
|----------|-------------|
| `/ws` | WebSocket JSON-RPC endpoint |
| `/openrpc.json` | Machine-readable API spec |
| `/docs` | Interactive HTML docs |

---

## Connecting to your NVIM plugin

The message envelope is JSON-RPC 2.0:

**Client → server**

```json
{ "jsonrpc": "2.0", "data": { "method": "client/ask", "params": { "prompt": "…", "requestId": "…" } } }
```

**Server → client** — responses:

```json
{ "jsonrpc": "2.0", "type": "response", "method": "client/ask", "id": "…", "result": { "success": true } }
```

**Server → client** — notifications (no `id`):

```json
{ "jsonrpc": "2.0", "type": "notification", "method": "agentic/log", "data": { "level": "info", "message": "…" } }
```

> Every `client/*` request should include an optional `requestId` so you can
> correlate the response. OpenRPC: `bun run gen:openrpc` produces
> `src/openrpc/openrpc.json` (also served at `/openrpc.json` in HTTP mode).

A minimal happy path:

```
1.  client/init        { provider: "copilot", cwd: "/abs/path" }
    → response         { success: true, agentId: "…" }
2.  client/new_session { sessionName: "my session" }
    → response         { success: true, sessionId: "…" }
3.  client/ask         { prompt: "explain this file", contexts: [ … ] }
    → response         { success: true }
    … then streamed agentic/session_update notifications …
```

---

### Client → server methods

| Method | Purpose |
|--------|---------|
| `client/init` | Create/spawn the agent for a provider + workspace. **Must be called first.** |
| `client/new_session` | Create a new session (optionally named) |
| `client/ask` | Send a prompt (with optional editor `contexts`) |
| `client/answer` | Answer a pending question from the server |
| `client/terminal` | Send a terminal command result to the server |
| `client/load_session` | Load an existing session |
| `client/rename_session` | Rename a session |
| `client/delete_session` | Delete a session |
| `client/archive_session` | Archive / unarchive (`archive: true/false`, optional `export`) |
| `client/fork_session` | Fork a session |
| `client/resume_session` | Resume a suspended session |
| `client/switch_session_mode` | Switch agent mode (interactive prompt) |
| `client/switch_model` | Switch the model for a session |
| `client/list_sessions` | List sessions |
| `client/export_session` | Export a session to a file |
| `client/import_session` | Import a session from a file |
| `client/stats` | Agent usage stats (e.g. last N days) |
| `client/index` | Run the configured indexer |
| `client/dispose` | Shut down the server |

**`client/ask` contexts** describe editor selections you want the agent to see.
Each `context` has a `type` (`selection`, `file`, `workspace`, `keymaps`,
`diagnostics`, `image`, `audio`, `link`), `text`, and optional `metadata` +
`annotations`. Images/audio can be inlined as base64 `data`, or given as a
`uri` for the server to read and embed.

### Server → client notifications

| Notification | Purpose |
|--------------|---------|
| `agentic/log` | Log messages (`level`: info/warn/error) |
| `agentic/question` | The server asks you to choose (auth method, mode, model, permission…) |
| `agentic/terminal` | The agent wants a terminal created / read / killed in your editor |
| `agentic/session_update` | Live agent output: message chunks, tool calls, plans, usage, available commands, mode changes |

**Permissions:** when the agent wants to act, the server emits a
`agentic/question` (or asks via a pending question). Your plugin responds with
`client/answer` (or the question is resolved inline). If the agent's stored
permission rule is `allow`/`deny`, the server auto-answers instead of prompting.

**Terminals:** when the agent asks for a terminal, you get an
`agentic/terminal` notification describing what to run; you run it in a real
editor terminal and send the result back via `client/terminal`.

---

## Supported agents

| Provider | ACP command | CLI ops (import/export/stats) |
|----------|-------------|-------------------------------|
| `copilot` | `copilot --acp` | ✓ (some) |
| `codex` | `codex-acp` | ✓ (some) |
| `claude` | `claude-agent-acp` | ✓ (some) |
| `gemini` | `gemini --acp` | — |
| `echo` | `bun run tests/fixtures/echo-provider.ts` | ✓ (test only) |

You need to have the agent CLI installed and on your `PATH`. The server will spawn it with
`--acp` (or equivalent) and talk ACP over stdio. codex-acp ([@agentclientprotocol/codex-acp](https://github.com/agentclientprotocol/codex-acp)) and claude-agent-acp ([@agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)) are wrappers that implement ACP for Codex and Claude respectively. The echo provider is a test fixture that echoes back prompts and is useful for testing your plugin without a real agent.

---

## State & persistence

- **Agents** and **sessions** are stored in a local SQLite DB
  (`ACP_DB_FILE_URL`), managed with Drizzle ORM (`src/database/`). Migrations
  live in `drizzle_migrations/` and run automatically on startup.
- **In-memory runtime state** (`workspaceRoot`, `config`, active `agent`,
  active `session`, `connection`, `promptActive`, `availableCommands`) lives in
  `src/state/`.
- Exported sessions are written to `sessions.memoryPath`.

> Note: `client/init` is required before session methods — sessions belong to a
> specific agent+workspace.

---

## Project layout

```
index.ts                     Entry point / CLI parsing
src/
  AgenticServer.ts           Orchestrator, dispatch of client/* methods
  acp/
    Client.ts                ACP client (implements SDK Client)
    handlers/                Permission, FileSystem, Terminal, SessionUpdate
  cli/                       Provider CLI wrappers (import/export/stats)
  comms/                     Readline (RPC) & WebSocket comms interfaces
  config/                    Config schema, defaults, loader
  database/                  Drizzle schema + SQLite bootstrap
  data/                      Provider defs, typed event maps
  ingester/                  EditorContext → ACP ContentBlocks
  managers/                  Agent, Session, MCP Server, Indexer
  openrpc/                   TypeBox schemas + OpenRPC spec generation
  state/                     AppState (in-memory)
  utils/                     Logging, paths, shell, helpers
tests/                       End-to-end & unit tests + fixtures
scripts/                     Test setup, OpenRPC generation, debug
```

---

## Development

```bash
bun install            # install deps
bun run lint           # type-check (tsc --noEmit)
bun test               # run tests (uses .env.test)
bun run gen:openrpc    # regenerate openrpc.json from schemas
bun run build          # gen:openrpc + bundle
```

See `AGENTS.md` in the repo root for contributor/agent-oriented guidance.
