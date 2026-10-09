# Hooks: recommended events and architecture

The design for a hooks system in `agentic_acp_server`. Users write hooks as **TS/JS modules** that Bun loads at
runtime, so they never need to edit server source. The unused `config.hooks.projectInit` / `sessionCleanup` stub in
`src/config/schemas.ts` is replaced by this design.

Status: **design only**, not implemented yet. Some of the bugs in [code-review.md](code-review.md) must be fixed first
(see "Bug fixes the hooks depend on" below).

## Recommended hooks

The server sits between the agent and the editor, and every file write, terminal command, permission and prompt passes
through it. That makes it the ideal place to enforce rules. Recommended events:

| Event | Mode | Example uses |
|---|---|---|
| `server.start` / `server.shutdown` | observe | warm caches, flush audit logs |
| `agent.beforeSpawn` | transform | inject env/API keys, wrap the command in a sandbox (bwrap/firejail), add flags |
| `agent.connected` / `agent.exited` | observe | **project init** (replaces `hooks.projectInit`), crash notification, auto-restart |
| `session.created` / `session.loaded` / `session.suspended` / `session.deleted` | observe | **auto-summarize/export on suspend** (replaces `hooks.sessionCleanup`), seed context |
| `prompt.before` | gate + transform | inject AGENTS.md/rules, git branch/diff, redact secrets, block prompts |
| `prompt.after` | observe | notify when a long turn finishes, log cost/usage, run tests/lint, git checkpoint |
| `permission.request` | gate | policy engine: auto-allow reads, deny `rm -rf`/`git push --force`, ask otherwise |
| `fs.beforeRead` | gate | block `.env`, `~/.ssh`, secrets |
| `fs.beforeWrite` | gate + transform | protected paths, workspace sandbox, backup before overwrite |
| `fs.afterWrite` | observe | format on write, lint, tell Neovim to `:checktime` the buffer |
| `terminal.beforeCreate` | gate + transform | command allow/deny lists, add timeouts, rewrite `npm` to `bun` |
| `terminal.afterExit` | observe | capture failing test output into context |
| `session.update` (with an `updateType` matcher) | observe | audit tool calls, mirror `plan` into a TODO file, usage budget guard that cancels the turn |
| `elicitation.request` | transform | auto-fill known form fields |

**Built-in hooks to ship.** These are written with the same public API as user hooks and enabled in config:
- `protectedPaths`: read/write guard by glob
- `workspaceSandbox`: writes outside the cwd require `ask`
- `commandPolicy`: allow/deny regexes for terminal commands and permissions
- `formatOnWrite`: maps globs to formatter commands
- `turnCheckpoint`: git stash snapshot before each turn, for one-step undo
- `notifyOnTurnEnd`
- `projectInit` and `sessionCleanup`: migrated from the existing stub
- `contextInjection`: rules file plus git status
- `auditLog`: JSONL of tool calls and permission decisions under `.agentic/`
- `usageBudget`
- `secretRedaction`

---

## Architecture

### Module layout: `src/hooks/`
- **`events.ts`**: TypeBox schemas for each event's `input` and `result`. This is the single source of truth, the same
  pattern as `src/openrpc/schemas.ts`. It exports `HookEventMap = { [event]: { input; result; mode } }`.
- **`public.ts`**: the stable user-facing API, exported via `package.json` `exports["./hooks"]` so user files get types:
  ```ts
  import { defineHook } from 'agentic-acp-server/hooks'
  export default defineHook({
    name: 'no-env-writes',
    event: 'fs.beforeWrite',
    match: { path: ['**/.env*'] },          // optional matcher: provider, path glob, command regex, updateType
    priority: 10, timeoutMs: 2000, onError: 'deny',
    async handler(input, ctx) {
      return { decision: 'deny', reason: `${input.path} is protected` }
    },
  })
  ```
  A file may default-export a single hook or an array of hooks.
- **`HookContext`** gives hooks a small, curated facade and never the `AgenticServer` itself, so internals can change
  without breaking user hooks:
  - `log`, `notify(msg)` (sends `agentic/log`), `ask(question, options)` (uses `comms.question`)
  - `exec(cmd, opts)` (`spawnShellCommand`)
  - `workspaceRoot`, `provider`, a read-only `session` snapshot and `config`
  - `store`: per-hook JSON KV under `.agentic/hooks-state/`
  - `signal: AbortSignal`
- **`HookRegistry`**: register/unregister, matcher evaluation and priority ordering. It also has an enable/disable list
  (`config.hooks.disabled`).
- **`HookManager extends BaseManager<HookManagerEvents>`**: `run(event, input)` with semantics chosen per event:
  - **observe**: runs in parallel, fire-and-forget; errors are logged.
  - **gate**: runs in order; the first `deny` short-circuits, and `ask` escalates to `ctx.ask`.
  - **transform**: a waterfall where each hook receives the previous output. Each result is checked with the event's
    result schema, and an invalid result is ignored with a warning.
  - Every hook gets a timeout through `AbortSignal`, plus an `onError` policy: `allow`/`deny`/`ignore`. Guard hooks
    default to `deny`, which is the safe choice.
  - It emits `hook.ran`, `hook.blocked` and `hook.error`. `AgenticServer` turns these into a new `agentic/hook`
    notification so the Neovim UI can show them.
- **`loader.ts`**: discovers and imports hooks.
  - Search order: `~/.config/agentic/hooks/*.{ts,js}` (global), then `<workspace>/.agentic/hooks/*.{ts,js}` (project),
    then `config.hooks.paths`.
  - Uses Bun's dynamic `import(path + '?v=' + mtime)` so hooks can be hot-reloaded.
  - **Project-hook trust:** repo-supplied code runs only after explicit approval, similar to `direnv allow`. On first
    load (or when a file's hash changes) the user is asked through `ctx.ask`. The decision is stored in a new
    `hook_trust` DB table (`path`, `sha256`, `trusted`). `config.hooks.trustProjectHooks: 'prompt' | true | false`.
- **`builtin/*.ts`**: the built-in hooks, written with `defineHook`, so they also exercise the public API.

### Config (`src/config/schemas.ts`)
Replace the current `hooks` object with:
```
hooks: { enabled, paths: string[], trustProjectHooks, defaultTimeoutMs, disabled: string[],
         builtin: { projectInit, sessionCleanup, protectedPaths: {enabled, patterns}, formatOnWrite: {enabled, commands}, … } }
```
Keep the old `projectInit` / `sessionCleanup` keys under `builtin`. While doing this, add the missing
`Check(AgenticConfigSchema)` call (code-review #21).

### Integration points
Wire the hooks through existing choke points, so most handlers stay unchanged:
- **`AcpClient`** ([src/acp/Client.ts](src/acp/Client.ts)) is where all agent→client requests arrive. Wrap each method
  there:
  - `requestPermission` → `permission.request`, before `PermissionHandler`
  - `readTextFile` / `writeTextFile` → `fs.*`
  - `createTerminal` → `terminal.beforeCreate`
  - `sessionUpdate` → `session.update`
- **`AgentManager.spawn/connect`** → `agent.beforeSpawn`, `agent.connected`. A new `proc.exited` watcher feeds
  `agent.exited` (and fixes code-review #10).
- **`SessionManager.prompt`** → `prompt.before` / `prompt.after`. The payload carries `origin: 'user' | 'internal'`, so
  the summarize and import prompts can be skipped.
- **Session lifecycle:** `AgenticServer` subscribes the `HookManager` to the existing typed `SessionEvents`, so no new
  coupling is needed.
- **New ASM methods** in `src/openrpc/schemas.ts`: `client/list_hooks`, `client/reload_hooks`,
  `client/set_hook_enabled`, plus the `agentic/hook` notification. Then regenerate with `bun run gen:openrpc`.

### Bug fixes the hooks depend on
These [code-review](code-review.md) items should be fixed first, or hooks will see wrong data:
- #1 and #2: RPC comms
- #3 and #4: permission handler
- #5: session id mapping. Hooks should always receive the local id plus `acpSessionId`.
- #8: `prompt()` try/finally
- #10: process exit
- #11: async dispose, so `server.shutdown` hooks can run

### Tests (for when this is implemented)
- Unit tests for `HookManager`: ordering, gate short-circuit, transform waterfall, timeout, `onError` policies, schema rejection.
- Loader tests with fixture hook dirs (`tests/fixtures/hooks/`), including the trust prompt.
- End-to-end with the echo provider: an `fs.beforeWrite` deny makes the write fail, and a `prompt.before` transform
  shows up in the agent's received prompt.
