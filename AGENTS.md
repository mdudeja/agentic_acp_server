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
client/init
  └─ AgentManager.init → load-or-create Agent row (DB)
       └─ spawn (provider CLI subprocess) → connect (ACP client)
            └─ on 'agent.connected' → respond client/init → SessionManager.init()
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
  `PermissionHandler`, `TerminalHandler`, `SessionUpdateHandler`).
- `SessionManager` — owns the in-memory `sessions` map, the DB session table,
  and calls agent-side ACP session methods (`csc.*`/`ClientContext`).
- `McpServerManager` — collects MCP servers from config + indexer.
- `IndexerManager` — runs the `index` command via config for `agentic-indexer` MCP Server.

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

> **WIP:** A larger rethink of state management is planned (see
> `src/managers/SessionManager.ts` — it currently keeps its own `sessions` Map +
> `activeSessionId` that duplicate what lives in `AppState`, and it mixes older
> SDK APIs like `csc.unstable_*` with the newer `buildSession().start()` flow).
> When touching this, prefer a single authoritative source of truth and avoid
> the duplicated session bookkeeping.

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
- `SessionManager` uses both `ClientContext` session helpers (`buildSession`,
  `csc`/`ClientContext`) and old `unstable_*` helpers; reconcile them on upgrade.
- Handshake/version constants (`PROTOCOL_VERSION`) come from the SDK.

### Gotcha: `SessionManager` mixing old + new SDK API

After the SDK bump, `SessionManager` mixes:
- new: `connection.clientContext.buildSession({...}).start()` returns an
  `ActiveSession` (which has `sessionId`, `modes`, `prompt(...)`, `nextUpdate()`);
- old: `connection.csc.unstable_forkSession(...)`,
  `connection.csc.unstable_resumeSession(...)`, `connection.csc.unstable_setSessionModel(...)`.

The `ActiveSession` API is the recommended path. When refactoring, prefer it and
drop the `unstable_` helpers once the equivalent stable API exists.
