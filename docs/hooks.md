# Hooks

Hooks are small TypeScript (or JavaScript) functions that run when something happens between your editor and the
agent: a prompt is sent, the agent writes a file, runs a command, asks for permission, and so on. A hook can watch,
change what happens (for example, rewrite a prompt), or allow/deny it.

You write hooks in your own files. You never need to touch the server's source.

- [Quick start](#quick-start)
- [Where hooks live](#where-hooks-live)
- [Trusting project hooks](#trusting-project-hooks)
- [Writing a hook](#writing-a-hook)
- [Events](#events)
- [How hooks combine](#how-hooks-combine)
- [The `ctx` argument](#the-ctx-argument)
- [Built-in hooks](#built-in-hooks)
- [Configuration](#configuration)
- [Editor integration](#editor-integration)
- [Limits](#limits)

## Quick start

Create `~/.config/agentic/hooks/prefer-bun.ts`:

```ts
import { defineHook } from 'agentic-acp-server/hooks'

export default defineHook({
  name: 'preferBun',
  event: 'terminal.beforeCreate',
  match: { command: '^npm\\b' },
  handler(input) {
    return { command: input.command.replace(/^npm\b/, 'bun') }
  },
})
```

Restart the server, or call `client/reload_hooks`. From then on, when the agent runs `npm test` in a terminal, `bun test`
runs instead. To refuse something rather than change it, return `{ decision: 'deny', reason: '…' }`. The agent then
gets an error, and your editor gets an `agentic/hook` notification saying why.

## Where hooks live

Hook files are loaded from, in this order:

| Location | Source | Needs trust? |
|---|---|---|
| `~/.config/agentic/hooks/*.ts` (or `$XDG_CONFIG_HOME/agentic/hooks`) | `global` | No: these are your own files |
| Each entry of `hooks.paths` in the config (a file or a directory) | `config` | Only if it's inside the workspace |
| `<workspace>/.agentic/hooks/*.ts` | `project` | Yes |

- `.ts`, `.js` and `.mjs` files are loaded. Files starting with `_` (helpers) or `.`, and `.d.ts` files, are skipped.
  Directories are not searched recursively.
- A file's **default export** is one hook, or an array of hooks.
- Hook names must be unique. If two files define the same name, the one loaded later wins (so a project hook replaces
  a global one of the same name), and a warning is logged.
- `ACP_HOOKS_GLOBAL_DIR` overrides the global directory.

## Trusting project hooks

A hook file inside the workspace may come from the repository you cloned, and hooks run with your user permissions.
So project hook files only run after you approve them, similar to `direnv allow`:

- **At startup**, project files you haven't approved are left pending.
- **On `client/init`**, the server asks about each one (`agentic/question`: *Trust* or *Skip*). Your answer is stored
  together with the file's SHA-256. If you edit the file, you're asked again.
- **On `client/reload_hooks`**, new or changed files are asked about right away. Pass `askSkipped: true` to be asked
  again about files you skipped earlier.
- **`hooks.trustProjectHooks: "never"`** in the config never runs project files.
- **`ACP_TRUST_PROJECT_HOOKS=always`** (an env var, for CI and tests) runs them without asking. There is deliberately no
  config setting for this: the config file itself may come from the repository.

Trust covers the hook file itself. Other files it imports are not checked.

## Writing a hook

```ts
import { defineHook } from 'agentic-acp-server/hooks'

export default defineHook({
  name: 'myHook',              // unique; `group:part` names can be disabled together by `group`
  event: 'fs.beforeWrite',     // see Events
  description: 'Optional, shown by client/list_hooks',
  match: { path: 'src/**/*.ts' }, // optional, see below
  priority: 100,               // lower runs first (default 100)
  timeoutMs: 5000,             // default: hooks.defaultTimeoutMs
  onError: 'deny',             // if the hook throws or times out: allow | deny | ignore
  async handler(input, ctx) {
    // return nothing to leave things as they are
  },
})
```

`defineHook` only provides types; a plain `export default { … }` works too. The `agentic-acp-server/hooks` import
works without installing anything, because the server provides it at runtime.

For editor types and checking, put a `tsconfig.json` next to your hooks that extends the server's own (replace
`/path/to/agentic_acp_server`):

```jsonc
// e.g. ~/.config/agentic/hooks/tsconfig.json
{
  "extends": "/path/to/agentic_acp_server/tsconfig.json",
  "compilerOptions": {
    "typeRoots": ["/path/to/agentic_acp_server/node_modules/@types"],
    "paths": {
      "agentic-acp-server/hooks": ["/path/to/agentic_acp_server/src/hooks/public.ts"],
      "*": ["/path/to/agentic_acp_server/*"]
    }
  },
  "include": ["*.ts"]
}
```

With that in place, the handler's `input` and allowed results follow from `event`. For example, returning
`{ decision: 'nope' }` or reading `input.content` in an `fs.beforeRead` hook is a type error.

**`match`** narrows when a hook runs. Each field applies only when the event's input has the corresponding value:

| Field | Matches |
|---|---|
| `provider` | the active provider id(s), e.g. `'opencode'` |
| `path` | glob(s) against `input.path`, tried on the absolute path and on the path relative to the workspace (`'**/.env*'`, `'src/**/*.ts'`) |
| `command` | regex against the command line (`command` + `args`; for permission requests, the tool's `rawInput.command`) |
| `updateType` | `session.update` kind(s), e.g. `'tool_call'` |
| `origin` | `'user'` or `'internal'` for `prompt.*` (internal = prompts the server sends itself, e.g. summaries) |

## Events

**Observe** events let hooks watch: every matching hook runs in parallel, and anything they return is ignored.
**Sequential** events let hooks act: they run one at a time and may return
`{ decision?: 'allow' | 'deny' | 'ask', reason?: string, …changes }`.

| Event | Mode | Input | A hook may change | Default `onError` |
|---|---|---|---|---|
| `server.start` / `server.shutdown` | observe | `workspaceRoot` | — | ignore |
| `agent.beforeSpawn` | sequential | `provider, cwd, command, args, env` | `command, args, env` (deny = don't start) | ignore |
| `agent.connected` | observe | `provider, agentId, cwd, firstConnect` | — | ignore |
| `agent.exited` | observe | `provider, agentId, exitCode` (the agent exited on its own) | — | ignore |
| `session.created` / `session.loaded` / `session.suspended` | observe | `sessionId, acpSessionId, name` | — | ignore |
| `session.deleted` | observe | `sessionId` | — | ignore |
| `prompt.before` | sequential | `sessionId, acpSessionId, origin, prompt` (ACP content blocks) | `prompt` (deny = block the prompt) | deny |
| `prompt.after` | observe | `sessionId, acpSessionId, origin, stopReason?, usage?, durationMs, error?` | — | ignore |
| `permission.request` | sequential | `sessionId?, acpSessionId, toolCall {toolCallId, title?, kind?, rawInput?}, options` | allow/deny answers without asking you | deny |
| `fs.beforeRead` | sequential | `sessionId?, acpSessionId, path, line?, limit?` | deny = refuse | deny |
| `fs.beforeWrite` | sequential | `sessionId?, acpSessionId, path, content` | `content` (deny = refuse) | deny |
| `fs.afterWrite` | observe | `sessionId?, acpSessionId, path` | — | ignore |
| `terminal.beforeCreate` | sequential | `sessionId?, acpSessionId, command, args, cwd?, env?` | `command, args, cwd, env` (deny = refuse) | deny |
| `terminal.afterExit` | observe | `sessionId?, acpSessionId, terminalId, command?, exitCode?, signal?` | — | ignore |
| `session.update` | observe | `sessionId?, acpSessionId, updateType, update` (the raw ACP update) | — | ignore |
| `elicitation.request` | sequential | `acpSessionId?, mode, message, requestedSchema?, url?, content?` | `content` (allow = answer with it; deny = decline) | ignore |

`sessionId` is the session id your editor uses. `acpSessionId` is the agent's own id. On agent-raised events
`sessionId` is missing only for sessions the server doesn't track. All paths are absolute.

The exact types are in [`src/hooks/events.ts`](../src/hooks/events.ts); with the tsconfig mapping above, your editor
shows them.

## How hooks combine

For each event, matching enabled hooks are ordered by `priority` (lower first), then by load order.

- **Sequential events:**
  - Each hook gets its own copy of the input, including changes made by earlier hooks. Changes are applied only
    through the returned fields (mutating `input` does nothing).
  - The **first `allow` or `deny` ends the chain.** Later hooks don't run.
  - `ask` asks you in the editor (*Allow* / *Deny*) and uses your answer.
  - With no decision, the normal flow continues with the changed input. For example, a permission request with no
    decision is shown to you as usual.
- **Errors:**
  - A hook that throws or times out is handled by its `onError`, or by the event's default (table above). Guard events
    default to `deny`, which is the safe choice.
  - A result that doesn't fit the event's schema is ignored, with a warning.
  - On a timeout, `ctx.signal` is aborted.
- **Observe hooks** run in parallel and never block the editor or the agent.
- **Decisions and errors** are sent to the editor as `agentic/hook` notifications. Successful runs aren't, since
  `session.update` alone would flood it.

## The `ctx` argument

| Member | |
|---|---|
| `hook`, `event` | This hook's name and the current event |
| `workspaceRoot`, `provider` | The workspace and the active provider |
| `session` | The active session (`id, acpSessionId, name, status`) or `null` |
| `config` | The server config (read-only) |
| `options` | `hooks.options[<hook name>]` from the config (for built-ins, their config block) |
| `signal` | Aborted when the hook times out |
| `log.debug/info/warn/error(msg)` | Server log, prefixed with the hook name |
| `notify(msg, level?)` | Shows a message in the editor (`agentic/log`) |
| `ask(question, options?)` | Asks you in the editor; returns the answer (an option `id` when options are given) |
| `exec(command, { cwd?, timeoutMs? })` | Runs a shell command (in the workspace by default) → `{ exitCode, stdout, stderr }` |
| `cancelTurn(sessionId?)` | Cancels a session's running turn (the active session by default) |
| `store.get/set/delete(key)` | Persistent JSON storage for this hook (`.agentic/hooks-state/<hook>.json`) |

## Built-in hooks

Built-ins use the same API as your own hooks, and are configured under `hooks.builtin.<name>`.

| Built-in | Default | What it does |
|---|---|---|
| `projectInit` | on | On an agent's first connect, runs the provider CLI's project init in the background (`runProviderInit`) |
| `protectedPaths` | on | Refuses agent reads (`read` globs) and writes (`write` globs) of secrets: `.env*`, keys, `.ssh`, `.aws/credentials`, `.netrc`; writes also exclude `.git/**` |
| `commandPolicy` | on | `deny` regexes refuse terminal commands and command permission requests (defaults: `rm -rf /`, `rm -rf ~`, `git push --force`, `mkfs`, `dd of=/dev/…`, fork bomb); `allow` regexes approve them without asking |
| `formatOnWrite` | on (no commands) | After the agent writes a file, runs the command for each matching glob in `commands` (`{file}` = quoted path), e.g. `{ "**/*.ts": "bunx prettier --write {file}" }` |
| `secretRedaction` | on | Replaces API keys, tokens and private keys in your prompts with `[REDACTED …]` and tells you; add regexes in `patterns` |
| `notifyOnTurnEnd` | on | Tells you when a turn of at least `minDurationMs` (30 s) finishes; optional `command` (e.g. `notify-send "Agent done"`) |
| `auditLog` | off | Appends permission requests, tool calls, terminal commands, file writes and finished turns to `path` (`.agentic/audit.jsonl`) |
| `turnCheckpoint` | off | Before each turn, snapshots the working tree under `refs/agentic/checkpoints` without changing the tree, the index or your stash list, and keeps the newest `keep` (20). List them with `git reflog refs/agentic/checkpoints`; restore one with `git stash apply refs/agentic/checkpoints@{n}`. Untracked files aren't included, and `git gc` may expire entries older than `gc.reflogExpireUnreachable` (30 days by default) |
| `contextInjection` | off | Prepends `files` (default `AGENTS.md`) and the git branch/status to your prompts, once per session (`firstPromptOnly`) |
| `usageBudget` | off | When a session's usage passes `maxTokens` and/or `maxCost`, cancels the turn and refuses further prompts in it |

Multi-part built-ins are named `group:part`, for example `protectedPaths:read`, `protectedPaths:write` and
`commandPolicy:terminal`. Disabling the group disables every part.

## Configuration

In `.agentic/agentic_acp_config.json` (merged over the defaults):

```jsonc
{
  "hooks": {
    "enabled": true,               // false: no hooks run at all
    "paths": ["tools/hooks"],      // extra hook files/dirs (workspace-relative or absolute)
    "trustProjectHooks": "prompt", // or "never"
    "defaultTimeoutMs": 5000,
    "disabled": ["notifyOnTurnEnd", "commandPolicy"], // hook names or groups
    "options": { "myHook": { "level": 2 } },          // → ctx.options of user hooks
    "builtin": {
      "formatOnWrite": { "commands": { "**/*.{ts,tsx}": "bunx prettier --write {file}" } },
      "auditLog": { "enabled": true },
      "usageBudget": { "enabled": true, "maxCost": 5 }
    }
  }
}
```

Configs from older versions are upgraded automatically: `hooks.projectInit` moves to `hooks.builtin.projectInit`, and
`hooks.sessionCleanup` is dropped.

## Editor integration

| Method / notification | |
|---|---|
| `client/list_hooks` | Loaded hooks (`name, event, source, file?, priority, enabled`) and `pendingTrust` files |
| `client/reload_hooks` | Re-reads all hook files (edited files are re-evaluated); asks about new or changed project files. Returns `loaded`, `pendingTrust` and load `errors` |
| `client/set_hook_enabled` | `{ name, enabled }`: turns a hook or group on/off until the server restarts |
| `agentic/hook` | `{ hook, event, outcome: 'allow' \| 'deny' \| 'error', reason? }` |

## Limits

- **File and terminal hooks only see what the agent routes through the editor.** `fs.*` and `terminal.*` fire when the
  agent uses the client's file system and terminals. Many agents also read and write files or run commands with their
  own built-in tools. Those show up as `permission.request` (when the agent asks) and as `tool_call` updates in
  `session.update`, but can't be changed or refused at the file level.
- **Only the hook file itself is reloaded.** On `client/reload_hooks`, a changed hook file is re-evaluated, but modules
  it imports are cached until the server restarts.
- **Toggles don't persist.** `client/set_hook_enabled` lasts until the server restarts; use `hooks.disabled` to make
  it permanent.
