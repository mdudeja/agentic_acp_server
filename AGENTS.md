# AGENTS.md

Guidance for AI coding agents and human contributors working in this repository.

## Project overview

`agentic_acp_server` is an **ACP (Agent Client Protocol) server** written in
TypeScript and run on **Bun**. It drives headless CLI agents (Copilot, OpenCode,
Gemini, and a local Echo fixture) through the ACP wire protocol, and exposes a
higher-level JSON-RPC surface — called the **ASM** interface — that a Neovim
plugin (or any editor client) talks to for agent-assisted coding.

Think of it as three layers:

```
NVIM plugin  --(ASM JSON-RPC / stdio or WebSocket)-->  AgenticServer
                                                                 │  spawns / speaks ACP
                                                    CLI agent (copilot --acp, opencode acp, …)
```

The server does NOT itself talk to the editor UI. It runs the agent subprocess,
handles ACP client-side requests (permissions, FS, terminal) by forwarding them
back to the editor over ASM, and persists agents/sessions in a local SQLite DB.

## Non-negotiables

- **Runtime is Bun** (not Node). Code must stay Bun-compatible: use
  `Bun.file`, `Bun.write`, `Bun.serve`, `bun:sqlite`. Do not introduce Node-only
  stdio assumptions where Bun has its own primitives.
- **TypeScript strict.** `tsconfig.json` enables `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `verbatimModuleSyntax`, `allowImportingTsExtensions`. Keep it green.
- **Types and runtime schema share one source of truth** in
  `src/openrpc/schemas.ts` (TypeBox). When adding an ASM method, the schema there
  is authoritative for the type alias, runtime validation (`Check()`), and the
  generated OpenRPC spec. Do not hand-write a separate type elsewhere.
- **Path aliasing:** imports use `src/...` (bare path), resolved by
  `tsconfig.json` `paths` and Bun. Always import with `src/` prefix, never
  relative `../` deep chains.

## Commands

| Task | Command |
|------|---------|
| Run (RPC/stdio mode) | `bun run start` |
| Run (HTTP/WebSocket, watch) | `bun run start:http` |
| Type-check / lint | `bun run lint` (`bun tsc --noEmit`) |
| Tests | `bun test` |
| Regenerate OpenRPC spec | `bun run gen:openrpc` |
| Build | `bun run build` (gen:openrpc + `bun build --target=bun`) |

- Tests preload `scripts/test_setup.ts` (via `bunfig.toml`), which initialises the
  SQLite DB and cleans up `.agentic/` and the test DB files after the run.
- `.env*` files are gitignored. `start` reads `.env`, `start:http` reads
  `.env.http`, `test` reads `.env.test`. Create these locally; the `index.ts`
  `declare module 'bun'` block documents the accepted env vars.

## Architecture & flow

### Entry point

`index.ts` parses CLI flags (`--server/-s`, `--port/-p`, `--root/-r`, `--help/-h`),
constructs an `AgenticServer`, and calls `server.init(root)`. It also wires a
graceful `SIGINT` shutdown.

`src/AgenticServer.ts` is the orchestrator. It owns:
- `AppStateManager` (in-memory state),
- the `ICommsInterface` (Readline for RPC mode, WebSocket for server mode),
- `AgentManager`, `SessionManager`, `McpServerManager`, `IndexerManager`.

### The ASM request/response loop

1. **Incoming** messages arrive via the comms interface, get validated against
   `ASMPayloadSchema`, and are dispatched by `AgenticServer._process_payload()`
   (a big `switch` on `method`).
2. **Outgoing** responses use `commsInterface.respond(...)`; server-initiated
   events use `commsInterface.notify(...)` with `agentic/log`,
   `agentic/question`, `agentic/terminal`, or `agentic/session_update`.

### Lifecycle of an agent and session

```
client/init | client/switch_provider
  └─ AgenticServer._teardownAgent (on switch) → new AgentManager
       └─ AgentManager.init → load-or-create Agent row (DB)
            └─ spawn (provider subprocess) → connect (ACP client)
                 └─ on 'agent.connected' → SessionManager.init() → respond
client/new_session
  └─ SessionManager.createNewSession → _createAcpSession (ACP session/new) → DB row
client/ask
  └─ ingester.createContentBlocks() → SessionManager.prompt() → agent session/prompt
agent → session/update notifications
  └─ SessionUpdateHandler → 'agentic/session_update' notify to editor
```

### Managers

- `BaseManager<TEvents>` extends `EventEmitter` and gives typed `emit`/`on`.
  Event maps live in `src/data/events.ts`. **Use these typed events, never raw
  `'event'` strings, for cross-manager communication.**
- `AgentManager` — owns the provider subprocess lifecycle, the ACP client
  (`AcpClient`), and the ACP request handlers (`FileSystemHandler`,
  `PermissionHandler`, `TerminalHandler`, `SessionUpdateHandler`). **One
  instance per active provider** (see "Single active provider" below).
- `SessionManager` — owns the in-memory `sessions` map, the DB session table,
  and calls agent-side ACP session methods through `connection.clientContext`
  (`request`/`notify` with `methods.agent.session.*`). It is a **singleton** for
  the server's lifetime; `init()` is re-run on provider switch.
- `McpServerManager` — collects MCP servers from config + indexer.
- `IndexerManager` — runs the `index` command via config for `agentic-indexer` MCP Server.

### Single active provider & switching

Only **one provider is active at a time**. `client/init` constructs a new
`AgentManager` for the requested `(provider, cwd)`; `client/switch_provider`
tears the current one down (`AgenticServer._teardownAgent` → `AgentManager.dispose`,
which closes the ACP connection then kills the process) and initialises the new
one. Because the ACP connection is closed first, teardown is async and awaited
before the replacement spawns.

- `client/init` is idempotent for the same `(provider, cwd)` when already
  connected (responds immediately; re-runs `SessionManager.init()`).
- The session list is **scoped to the active provider** (`SessionManager.init`
  loads `sessions` where `agent_id === active agent id`, clearing first). The
  previous provider's sessions stay in the DB and reappear on switching back.
- `client/list_providers` reports the known providers plus which is active.

### Session operations: configurable fallback queue

List/export/import/delete run through `src/sessionops/queue.ts`
(`runTierQueue`). Tiers are `memory` | `acp` | `cli`, ordered per operation by
`config.sessionOps` (defaults: list `[memory, acp, cli]`, others `[acp, cli]`).
An ASM `source` param (`'auto' | 'memory' | 'acp' | 'cli'`) can force a single
tier; `'auto'`/omitted uses the configured policy.

The queue **advances only on `unavailable`** (capability absent, no ACP method,
no provider CLI). A genuine error from an available tier stops the queue and is
surfaced — it never falls through (avoids masking failures / duplicating side
effects). Each tier is a pure `() => Promise<TierOutcome<T>>`.

### Config options, modes & reasoning level

`SessionManager.listConfigOptions` returns a uniform view (`id`, `name`,
`category`, `type`, `currentValue`, flattened `options[]`) and
`setSessionConfigOption(idOrCategory, value)` resolves by `id` first then by
`category`, calls `session/set_config_option`, and **applies the agent-returned
`configOptions`** (authoritative) to the tracked session + DB.

- **Mode** uses `session/set_mode` (authoritative) plus the `category: 'mode'`
  config option when present.
- **Model** has no dedicated ACP method — it is the `category: 'model'` /
  `'model_config'` config option.
- **Reasoning / thought level** is spec-supported **only** as a config option
  with `category: 'thought_level'` (no dedicated method/enum). See
  `setThoughtLevel`.
- Interactive prompts (`agentic/question`) now carry optional `options[]`
  (`{id,label,description}`); answers resolve by option `id`/`label` first, then
  fall back to the legacy 1-based numeric index.
- Agent-initiated `current_mode_update` / `config_option_update` are applied to
  the tracked session + DB before being forwarded to the editor.

### Cross-provider continuation (client-driven)

There is **no server-side "continue on another provider"** method. Same provider
→ `client/resume_session`. Across providers the client composes:
`client/summarize_session` → `client/switch_provider` → `client/new_session` →
`client/ask` (passing the summary as a context block).

`client/summarize_session` summarizes **only the active session of the active
provider** (the agent already holds that conversation in context): it arms an
extra `agent_message_chunk` listener (a second subscriber on the
`SessionUpdateHandler` fan-out — the editor-forwarding subscriber is untouched),
prompts the agent to summarize, writes `<sessionId>.md` (metadata header +
body) under `config.sessions.summaryPath`, and upserts one `session_summaries`
row (`session_id` → `file_path`).

### The ACP client boundary

`src/acp/Client.ts` implements the SDK `Client` interface and delegates to the
handlers. When the SDK version changes, this is the layer most likely to break:
handlers must match the SDK's request/response types exactly. The `ClientApp`
(`client()`) in the SDK registers these handlers and calls `connectWith(...)`.

### State management

`src/state/` is intentionally minimal today:

- `AppStateManager` is a flat `Map`-like object (`setItem`/`updateItem`/
  `getItem`/`getState`).
- `AppState` keys: `workspaceRoot`, `config`, `agent`, `session`, `connection`,
  `promptActive`, `availableCommands`.
- `AppState.session` holds only the **active** `TrackedSession`, kept in sync by
  `SessionManager` through the state manager. The full session list is owned by
  `SessionManager`'s `sessions` Map with the DB as the durable store; the
  `AppState` slot is a mirror of the active session, not the list.

> **WIP:** A larger rethink of state management is planned. Today
> `SessionManager` owns the in-memory `sessions` Map + `activeSessionId` (with the
> DB as the durable store) and mirrors the active session into `AppState` via the
> state manager. When touching this, avoid introducing a *third* copy and keep
> mirror updates going through the state manager.

## Conventions

- **Events:** emit typed events via `BaseManager`. Consumers subscribe in
  `AgenticServer` and translate to `notify()` calls.
- **Naming:** files are `PascalCase.ts` for classes (`SessionManager.ts`),
  `kebab-case.ts` for utilities. Handlers live in `src/acp/handlers/`.
- **Error handling:** wrap risky calls; log via `src/utils/logger` helpers
  (`logDebug`, `logInfo`, `logWarning`, `logError`). Do not `console.log` raw —
  in RPC mode output goes to stdout as JSON-RPC notifications.
- **CLI wrappers** (`src/cli/`) wrap provider binaries for session import/export
  /stats. Only `opencode` has full CLI support today (`PROVIDER_CLI` in
  `src/data/providers.ts`).

### Testing

- Test files live in `tests/` and `tests/unit/`. `bun test` uses
  `bunfig.toml` (preload + coverage).
- `tests/fixtures/echo-provider.ts` is a fake ACP agent used to run the server
  end-to-end in tests.
- Keep tests green before and after changes: `bun run lint` + `bun test`.

## Working with the ACP SDK

The project pins `@agentclientprotocol/sdk`. **The installed version is the
ground truth.** When the version bumps:

- Check `src/AgenticServer.ts` (`client(...)`, `ndJsonStream`, `methods`) and
  `src/acp/Client.ts` for signature drift first — these are where SDK changes
  surface.
- `SessionManager` drives everything through `connection.clientContext.request` /
  `notify` with `methods.agent.session.*` (new/load/fork/resume/delete/list/
  prompt/cancel/set_mode/set_config_option). There are no `csc`/`unstable_*`
  helpers left; if a future SDK bump reintroduces a stable `ActiveSession`
  handle, reconcile it against this request/notify style.
- Handshake/version constants (`PROTOCOL_VERSION`) come from the SDK.

### Note: how `SessionManager` drives the agent

`SessionManager` does **not** hold SDK session handles. It stores a
`TrackedSession` (`Session['Select']`; the `modes` / `configOptions` columns
persist the agent-reported state) and issues stateless calls through
`connection.clientContext`:

- `request(methods.agent.session.new | load | fork | resume | ...)` for the
  session lifecycle, and
- `notify(methods.agent.session.cancel, ...)` for cancellation.

Model selection has no dedicated ACP method — it is a `session/set_config_option`
call against the config option whose `category === 'model'` (or `'model_config'`);
mode uses `session/set_mode` plus the `category === 'mode'` config option. Keep
this request/notify style when the SDK version bumps.
