# Code review: 2026-10-09

A review of `agentic_acp_server` at `00a4e8f`, plus the uncommitted working-tree changes. File:line references
point at that snapshot.

## Findings (ordered by severity)

### High: broken behavior on real use
1. ~~**RPC (stdio) mode never receives messages.** `AgenticServer._initCommsInterface` calls `onMessage`/`onClose`
   *before* `init()` (AgenticServer.ts:169-197). `ReadlineCommsInterface.onMessage` attaches to `this._reader?`, which
   is still `null` at that point, and `init()` never re-attaches it. Tests hide this because they call `init()` first.~~
2. ~~**Readline `question()` corrupts the JSON-RPC stream.** `readline.question()` writes the raw prompt text to stdout
   (`output: process.stdout`). It sends no `agentic/question` notification and ignores `options`. The answer line
   also fires the `'line'` handler, so it gets dispatched as a payload too. The `client/answer` response it sends has no `id`.~~
3. ~~**Permissions always fail (or use the wrong rule).** `PermissionHandler` reads `state.agent` once, in its
   constructor (PermissionHandler.ts:31). `AgentManager` builds it *before* the agent row loads, and teardown deletes
   `state.agent` first (AgenticServer.ts:250, 302). Result: `agent` is undefined, so every interactive permission
   request throws "No agent found in state". After a provider switch, the handler gets the previous provider's rule.~~
4. ~~**Permission prompt can hang the agent forever.** `new Promise(async …)` throws inside its executor
   (PermissionHandler.ts:107-141). An invalid or non-numeric answer (NaN is never checked) causes an unhandled rejection,
   and the promise never settles. `pendingRequests` is keyed by `sessionId`, so concurrent requests overwrite each other,
   and entries are never removed.~~
5. ~~**ACP session id and local session id get mixed up.** ACP notifications carry `acp_session_id`. The server compares
   that against the local `TrackedSession.id` (AgenticServer.ts:768, 794, 924), and `applyAgentUpdate` looks it up by
   local id (SessionManager.ts:571). So agent-initiated **mode, config and title updates are always dropped** with real
   agents. The tests hide this by sending the local id (tests/commands/events.test.ts:182). Two more places have the
   same problem:~~
   - ~~`cancelTurn` → `rejectAllPending(localId)`, but the permission map is keyed by the ACP id.~~
   - ~~`agentic/session_update.sessionId` sends the ACP id, while every ASM method takes local ids.~~
6. ~~**Failures are reported as success, or get no response at all.**~~
   - ~~SessionManager methods report failure with `session.error` and return `void`, and the dispatcher then answers
     `success: true` anyway. This affects load, rename, archive, fork, resume, switch mode and switch model
     (AgenticServer.ts:1108-1262).~~
   - ~~If `client/new_session` fails, no response is sent; only `session.created` responds. The client hangs.~~
   - ~~If spawn/connect fails during `client/init`, the error is thrown inside an async event listener (AgenticServer.ts:387).
     That is an unhandled rejection, and no response is sent.~~
   - ~~`client/index` never responds (AgenticServer.ts:1417).~~
7. ~~**`throw new error(...)`**: `error` is imported from `node:console` (AgenticServer.ts:22, 1412), so this throws a
   `TypeError` instead.~~
8. ~~**`prompt()` has no try/finally** (SessionManager.ts:1172). If `session/prompt` rejects, `promptActive` stays
   `true`. In `writeSessionSummary` the capture listener also leaks (SessionManager.ts:1314).~~
9. ~~**The auth retry latch gets stuck.** If the retry after auth fails with a non-auth error, `retriedAfterAuth` stays
   `true`. Every later session creation is then refused until restart (SessionManager.ts:1503-1539). Also,
   `_authenticate` is missing a `return` after the "no auth capability" error (SessionManager.ts:1425-1430).~~
10. ~~**Agent process death is never noticed.** `agent.disconnected` is declared but never emitted, and `proc.exited`
    is not watched. The idempotent `client/init` check (AgenticServer.ts:273-277) only tests that `process` is truthy,
    so it reports success for a dead agent.~~
11. ~~**`dispose()` doesn't await the async `agentManager.dispose()`** before `process.exit(0)` (AgenticServer.ts:132,
    148). The ACP drain/close and the kill never finish. It also disposes `stateManager` first, while other teardown
    code still reads it. SIGINT goes through the same path.~~
12. ~~**`NesManager` is re-created on every `_initSessionManager`** (AgenticServer.ts:534). That is every init, idempotent
    init and switch. The old instance and its listeners are never disposed. Also, `default_config.ts` sets
    `nes.enabled: true` while the schema default is `false`.~~

### Medium: wrong results or regressions
13. **Uncommitted diff (SessionManager export/import `acp` tiers):**
    - Export now *prompts the agent* to summarize. That shows up in the chat, only works for the active session, and
      ignores `outputPath`. For any other session it returns `tierError`, which stops the queue, so opencode's working
      CLI export is never reached.
    - Import prompts the file into the *current* session; no new session is created. It returns `ok` even with no
      active session, because `prompt()` returns void. It also shadows the CLI tier.
    - Both break the queue's rule that a tier returns `unavailable` when it can't serve a request and `error` only when
      an attempt fails. Suggestion: make it an opt-in tier (e.g. `'summary'`) or keep `acp` `unavailable`.
14. **Delete CLI tier swallows failures**: it returns `ok` on a non-zero exit (SessionManager.ts:310-315).
15. **Fork, resume and load handle state inconsistently.**
    - `forkSession` has no null check on `sessionToFork` (`!` at SessionManager.ts:448), and it never suspends the
      currently active session.
    - `resumeSession` doesn't suspend the current session, so two rows end up `active`.
    - `loadSession` and `createNewSession` suspend the current session *before* the request. If the request fails,
      nothing is active.
16. **`switchSessionModel` only checks `category === 'model'`** (SessionManager.ts:695), but `_setSessionModel` also
    accepts `model_config`.
17. **Title updates don't stick.** `session_info_update` changes only the AppState mirror, not the sessions Map or the
    DB (AgenticServer.ts:930). The next `_updateSession` reverts it. This is the "third copy" AGENTS.md warns about.
18. **`available_commands_update` replaces the whole per-session map** with one entry (AgenticServer.ts:748).
19. **WebSocket comms problems.**
    - Fixed questionIds (`select_session_mode`, …) collide with each other.
    - Questions have no timeout, and `dispose()` clears pending questions without rejecting them, so awaiting callers hang.
    - There is only one `_ws`: a second client overwrites it, and any socket closing shuts the whole server down.
    - `respond` throws once the socket is disconnected.
    - Answers are detected with `message.includes('client/answer')`.
20. **Env var names don't match.** `index.ts:47-50` reads `APP_MODE` / `HTTP_PORT`, but the declared and documented
    names are `ACP_APP_MODE` / `ACP_HTTP_PORT`.
21. **Config is never validated.** `loadConfig` only runs JSON.parse + deepMerge, and `AgenticConfigSchema` is never
    `Check()`ed. It also returns `DEFAULT_CONFIG` by reference, so any mutation is shared.
22. **Events fire before anyone listens.** `IndexerManager.init()` emits `indexer.ready` before its listeners are
    attached. With the indexer disabled, `runCommand('index')` logs an "Invalid command" error on every start. The
    `MiscActionsManager` constructor's `action.error` is lost and never subscribed. The startup `_initSessionManager`
    logs a spurious "No active agent" error.
23. **The agent row caches provider `command`/`args` at creation** (AgentManager.ts:485-491). Later changes to
    `PROVIDERS` never reach existing rows.
24. **opencode export pipe never runs.** `['2>&1','|','tee','$2']` are passed as args, and args get `shellEscape`d
    (shell.ts:24), so they arrive as literal strings.
25. **TerminalHandler bugs.**
    - It stores a locally generated `terminalId` but returns the editor's id (TerminalHandler.ts:148-160), so later
      lookups fail when the two differ.
    - `output` returns `stderr || stdout`, which drops stdout whenever there is any stderr.
    - A failed create leaves a stale record behind.
26. **FileSystemHandler bugs.** `line` is ignored unless `limit` is also set. There is no workspace-boundary check.
    Writes bypass Neovim buffers, so they can conflict with unsaved edits.
27. **McpServerManager passes `env: []` always** and doesn't support http/sse servers. **Elicitation** returns every
    form value as a string, regardless of the schema type.

### Low / hygiene
- `import type … from 'node_modules/@agentclientprotocol/sdk/dist/schema'` (AgenticServer.ts:23): import from the package instead.
- `./config/loader` and `./managers/...` use relative imports, which breaks the `src/` alias convention.
- WebSocket comms use `console.*` directly.
- `listConfigOptions` has a no-op ternary (SessionManager.ts:818).
- Unset `ACP_EDITOR_NAME` produces the client name "undefined Agentic Client".
- The summary capture relies on a 75 ms sleep to catch the last chunks, which is a race.
- `_createNew` can return `0`.
- The client advertises capabilities it doesn't implement (`auth.terminal`).

## Suggested fix order
1. The uncommitted diff (#13): update the ingester tests to the new signature, and restore `acp` to `unavailable` for export/import (or move the behavior into an opt-in tier).
2. Comms correctness (#1, #2, #19): without these, the server is unusable in RPC mode.
3. Permission handler (#3, #4) and session-id mapping (#5).
4. Response correctness (#6, #7, #8, #9), then lifecycle (#10, #11, #12).

The hooks work in [hooks-design.md](hooks-design.md) depends on #1–#5, #8, #10 and #11.
