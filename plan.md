# Agentic Server Enhancement Plan

> Transform Agentic Server from a basic ACP intermediary into a powerful orchestration layer with CLI command integration, codebase indexing, and best practices enforcement.

## Overview

### Goals
1. **CLI Orchestration** - Invoke provider CLI commands for operations not exposed via ACP
2. **Codebase Indexing** - MCP server providing semantic codebase navigation tools
3. **Best Practices Enforcement** - Hooks system for project initialization and workflow automation

### Architecture Summary

```
Editor Plugin
    |
    | JSON-RPC 2.0
    v
AgenticServer (enhanced)
    |-- ProviderCLI (new)      # Invoke provider CLI commands
    |-- HooksManager (new)      # Lifecycle hooks
    |-- IndexerManager (new)    # Manage indexer MCP server
    |
    | Spawns AI agent + indexer
    v
AI Agent (opencode, copilot, gemini)
    |
    | MCP connection
    v
workspace-indexer (new)         # Codebase indexing MCP server
```

### Key Decisions
- **Tree-sitter**: WASM grammars by default, user can override with `.so` paths
- **Index storage**: SQLite in `.agentic/index/symbols.sqlite` (repo-local)
- **MCP server name**: `workspace-indexer`
- **Languages (MVP)**: TypeScript, Python, Lua, Go
- **AGENTS.md**: Run OpenCode `/init` first, then append indexer instructions
- **Gitignore**: User chooses whether to commit `.agentic/`

---

## ~~Phase 1: Foundation (CLI + Config)~~

**Estimated effort**: 1 week

### 1.1 Create `.agentic/` Directory Convention

- [x] Define directory structure:
  ```
  .agentic/
    config.json          # User configuration
    index/
      symbols.sqlite     # Symbol index database
      files.json         # File metadata cache
    docs/                # AI-generated documentation (future)
  ```
- [x] Create TypeBox schema for `config.json` in `src/config/types.ts`
- [x] Create config loader with defaults in `src/config/loader.ts`
- [x] Add config loading to `AgenticServer` initialization

**Config schema (initial)**:
```typescript
{
  indexer: {
    enabled: boolean,
    languages: {
      [lang: string]: {
        extensions: string[],
        treesitter?: { parser: string }  // path to .so file
      }
    }
  },
  hooks: {
    projectInit: { enabled: boolean, runProviderInit: boolean },
    sessionCleanup: { enabled: boolean }
  },
  sessions: {
    memoryPath: string  // path to store exported sessions (e.g. .agentic/sessions/)
  },
  gitignore: boolean  // whether .agentic/ should be gitignored
}
```

### 1.2 Provider CLI Abstraction

- [x] Create `src/cli/types.ts` with `CLIProvider` interface:
  ```typescript
  interface CLIProvider {
    deleteSession(sessionId: string): Promise<CLIResult>
    exportSession(sessionId: string, outputPath?: string): Promise<CLIResult>
    importSession(filePath: string): Promise<CLIResult>
    stats(options?: StatsOptions): Promise<CLIResult>
    init(): Promise<CLIResult>
  }
  ```
- [x] Create `src/cli/BaseCLI.ts` with common spawn/exec logic
- [x] Create `src/cli/OpenCodeCLI.ts` implementing:
  - `deleteSession` → `opencode session delete` (need to verify exact command)
  - `exportSession` → `opencode export <sessionId>`
  - `importSession` → `opencode import <file>`
  - `stats` → `opencode stats --days N --format json` (need to verify)
  - `init` → `opencode run --command /init`
- [x] Create placeholder files for `CopilotCLI.ts` and `GeminiCLI.ts`

### 1.3 Extend Provider Configuration

- [x] Update `src/data/providers.ts` to include CLI command mappings:
  ```typescript
  opencode: {
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    cli: {
      available: true,
      commands: {
        deleteSession: ['session', 'delete'],  // placeholder, verify
        exportSession: ['export'],
        importSession: ['import'],
        listSessions: ['session', 'list', '--format', 'json'],
        stats: ['stats'],
        init: ['run', '--command', '/init']
      }
    }
  }
  ```

### 1.4 Wire CLI into Session Lifecycle

- [x] Inject `ProviderCLI` instance into `SessionManager`
- [x] Update `SessionManager.deleteSession()`:
  - After DB deletion, call `ProviderCLI.deleteSession()` (best-effort)
  - Log warning on failure, don't fail the RPC
- [x] Update `SessionManager.archiveSession()` to optionally export first.
- [x] While exporting sessions, use config.sessions.memoryPath as default export location (if the user doesn't specify an outputPath, export to `${memoryPath}/${sessionId}.json`)

### 1.5 Add New RPC Methods

- [x] Add `client/export_session` to `src/openrpc/schemas.ts`
:
  ```typescript
  {
    method: 'client/export_session',
    params: { sessionId: string, outputPath?: string },
    result: { success: boolean, filePath?: string, error?: string }
  }
  ```
- [x] Add `client/import_session` to schemas
- [x] Add `client/stats` to schemas:
  ```typescript
  {
    method: 'client/stats',
    params: { days?: number },
    result: { /* stats object from provider */ }
  }
  ```
- [x] Implement handlers in `main.ts`
- [x] Run `bun run gen:openrpc` to update spec

### 1.6 Testing & Verification

- [x] Verify OpenCode CLI commands work as expected
- [x] Test session deletion with CLI cleanup
- [x] Test export/import flow
- [x] Test stats retrieval

---

~~## Phase 2: Indexer MCP Server MVP~~

**Estimated effort**: 2-3 weeks

### 2.1 Package Scaffold

- [x] Create `packages/agentic-indexer/` directory structure:
  ```
  packages/agentic-indexer/
    package.json
    tsconfig.json
    index.ts                    # MCP server entry point
    src/
      config/
        types.ts                # IndexerConfig types
        loader.ts               # Load config from .agentic/
      indexer/
        TreeSitterIndexer.ts    # Core indexing logic
        SymbolStore.ts          # SQLite persistence
        types.ts                # Symbol, File types
      tools/                    # MCP tool implementations
        search_symbols.ts
        get_file_summary.ts
        list_files.ts
        get_definition.ts
      watcher/
        FileWatcher.ts          # File change detection
  ```
- [x] Set up `package.json` with dependencies:
  - `@modelcontextprotocol/sdk` for MCP
  - `tree-sitter` and `tree-sitter-wasms` for parsing
  - `better-sqlite3` or use Bun's `bun:sqlite`
- [x] Configure TypeScript for the package

### 2.2 Tree-sitter Integration

- [x] Research tree-sitter WASM setup in Bun
- [x] Create `TreeSitterIndexer` class:
  - Load grammar (WASM or .so based on config)
  - Parse file and extract symbols
  - Support for: functions, classes, interfaces, types, variables, methods
- [x] Implement language-specific extractors:
  - [x] TypeScript/JavaScript extractor
  - [x] Python extractor
  - [x] Lua extractor
  - [x] Go extractor
- [x] Handle `.so` parser override from user config

### 2.3 Symbol Storage (SQLite)

- [x] Create `SymbolStore` class with schema:
  ```sql
  CREATE TABLE symbols (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,  -- function, class, interface, type, variable, method
    file_path TEXT NOT NULL,
    line INTEGER NOT NULL,
    column INTEGER NOT NULL,
    end_line INTEGER,
    end_column INTEGER,
    signature TEXT,      -- function signature, type definition
    docstring TEXT,      -- extracted documentation
    parent_id TEXT,      -- for nested symbols (methods in class)
    exported BOOLEAN,
    FOREIGN KEY (parent_id) REFERENCES symbols(id)
  );

  CREATE TABLE files (
    path TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    indexed_at INTEGER NOT NULL,
    language TEXT
  );

  CREATE INDEX idx_symbols_name ON symbols(name);
  CREATE INDEX idx_symbols_kind ON symbols(kind);
  CREATE INDEX idx_symbols_file ON symbols(file_path);
  ```
- [x] Implement CRUD operations
- [x] Implement incremental update (hash-based change detection)

### 2.4 MCP Server Implementation

- [x] Set up MCP server with stdio transport
- [x] Implement `tools/list` handler returning tool definitions
- [x] Implement core tools:

**`search_symbols`**:
```typescript
{
  name: "search_symbols",
  description: `PREFERRED: Search the pre-built codebase index for symbols (functions, classes, types).
FASTER and MORE ACCURATE than grep/glob. Use this FIRST when looking for code definitions.
Only fall back to grep if this returns no results.`,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Symbol name or pattern (supports wildcards)" },
      kind: { type: "string", enum: ["function", "class", "interface", "type", "variable", "method", "all"] },
      file_pattern: { type: "string", description: "Filter by file path pattern" },
      limit: { type: "number", default: 20 }
    },
    required: ["query"]
  }
}
```

**`get_file_summary`**:
```typescript
{
  name: "get_file_summary",
  description: `Get a structured summary of a file's exports and symbols.
Use this BEFORE reading an entire file to understand its structure.
Returns functions, classes, types with their signatures.`,
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path to the file" }
    },
    required: ["file_path"]
  }
}
```

**`list_files`**:
```typescript
{
  name: "list_files",
  description: `List indexed files with metadata.
Faster than glob for indexed file types.`,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern to filter files" },
      language: { type: "string", description: "Filter by language" }
    }
  }
}
```

**`get_definition`**:
```typescript
{
  name: "get_definition",
  description: `Get the full definition of a symbol including its source code.
Use after search_symbols to get complete implementation details.`,
  inputSchema: {
    type: "object",
    properties: {
      symbol_id: { type: "string", description: "Symbol ID from search_symbols" },
      // OR
      name: { type: "string" },
      file_path: { type: "string" }
    }
  }
}
```

### 2.5 CLI Entry Point

- [x] Create CLI for standalone indexer operations:
  ```sh
  # Index a directory
  bun run packages/agentic-indexer/index.ts index --cwd /path/to/project

  # Start MCP server
  bun run packages/agentic-indexer/index.ts serve --cwd /path/to/project

  # Query index (for debugging)
  bun run packages/agentic-indexer/index.ts query --name "handleRequest"
  ```
- [x] Support `--cwd` flag for working directory

### 2.6 Testing

- [x] Test indexing on this repo (TypeScript)
- [x] Test indexing on a Python project
- [x] Test indexing on a Lua project (Neovim config)
- [x] Test indexing on a Go project
- [x] Test MCP tool responses
- [x] Benchmark indexing time on medium-sized repos

---

## Phase 3: Agentic Integration

**Estimated effort**: 1 week

### 3.1 IndexerManager

- [x] Create `src/indexer/IndexerManager.ts`:
  - Spawn indexer process for a cwd
  - Track running indexers (Map<cwd, Process>)
  - Health check / restart on crash
  - Graceful shutdown on dispose
- [x] Create `src/indexer/types.ts` with types

### 3.2 Wire into Agent Lifecycle

- [x] In `AgentManager.connect()`:
  - Check if indexer is enabled in config
  - Ensure index exists (trigger initial index if not)
  - Spawn indexer MCP server via IndexerManager
- [x] Build `mcpServers` config for ACP:
  ```typescript
  {
    name: 'workspace-indexer',
    transport: {
      type: 'stdio',
      command: 'bun',
      args: ['run', indexerPath, 'serve', '--cwd', cwd]
    }
  }
  ```

### 3.3 Update SessionManager

- [x] Update `createNewSession()` to pass `mcpServers`:
  ```typescript
  await this.connection.csc.newSession({
    cwd: currentAgent.cwd,
    mcpServers: this.indexerManager.getMcpConfig()
  })
  ```
- [x] Update `loadSession()` similarly
- [x] Update `resumeSession()` similarly

### 3.4 Add Reindex RPC Method

- [x] Add `client/index` to schemas:
  ```typescript
  {
    method: 'client/index',
    params: { force?: boolean },  // force=true rebuilds from scratch
    result: { success: boolean, filesIndexed: number, duration: number }
  }
  ```
- [x] Implement handler that triggers IndexerManager.reindex()

### 3.5 Testing

- [ ] Test indexer spawning on agent connect
- [ ] Test MCP server availability in sessions
- [ ] Test reindex command
- [ ] Test indexer cleanup on dispose

---

## Phase 4: ProjectInit Hook & AGENTS.md

**Estimated effort**: 1 week

### 4.1 Hooks System Foundation

- [ ] Create `src/hooks/types.ts`:
  ```typescript
  type HookPoint = 
    | 'agent.created'      // First time agent for this cwd
    | 'agent.connected'    // Agent subprocess connected
    | 'session.created'    // New session started
    | 'session.completed'  // Session ended
    | 'tool_call'          // Agent made a tool call

  interface Hook {
    name: string
    point: HookPoint
    enabled: boolean
    execute(context: HookContext): Promise<void>
  }
  ```
- [ ] Create `src/hooks/HooksManager.ts`:
  - Register hooks
  - Execute hooks at lifecycle points
  - Handle hook errors gracefully

### 4.2 ProjectInit Hook

- [ ] Create `src/hooks/builtin/ProjectInit.ts`:
  - Triggers on `agent.created` (first time for cwd)
  - Creates `.agentic/` directory if missing
  - Creates default `config.json`
  - Runs OpenCode `/init` if enabled (generates AGENTS.md)
  - Appends indexer instructions to AGENTS.md

**Indexer instructions to append**:
```markdown

## Codebase Navigation (Agentic Indexer)

This project uses a pre-built codebase index via the `workspace-indexer` MCP server.

### REQUIRED: Use Index Tools First

When exploring or searching the codebase, use these tools BEFORE grep/glob:

| Task | Use This Tool | NOT This |
|------|---------------|----------|
| Find a function/class/type | `search_symbols` | grep/glob |
| Understand file structure | `get_file_summary` | read entire file |
| Find where something is defined | `get_definition` | grep |

### Why Use the Index?

- **Faster**: Pre-computed, instant results
- **More accurate**: Semantic understanding vs text matching  
- **Less tokens**: Returns only relevant information

### When to Fall Back

Only use grep/glob when:
- Index tools return no results
- Searching for literal strings (not symbols)
- Searching file types not in the index
```

### 4.3 Add init_project RPC Method

- [ ] Add `client/init_project` to schemas:
  ```typescript
  {
    method: 'client/init_project',
    params: { 
      runProviderInit?: boolean,  // default: true
      force?: boolean             // overwrite existing
    },
    result: { 
      success: boolean, 
      created: string[],          // files/dirs created
      agentsMdGenerated: boolean 
    }
  }
  ```
- [ ] Implement handler that triggers ProjectInit hook manually

### 4.4 Wire Hooks into Lifecycle

- [ ] Call HooksManager from AgentManager on relevant events
- [ ] Call HooksManager from SessionManager on relevant events

### 4.5 Testing

- [ ] Test ProjectInit on fresh directory
- [ ] Test ProjectInit with existing .agentic/
- [ ] Test AGENTS.md generation and appending
- [ ] Test manual init_project RPC

---

## Phase 6: Additional Provider CLIs (Future)

### 6.1 Copilot CLI

- [ ] Research Copilot CLI commands
- [ ] Implement `CopilotCLI.ts`
- [ ] Test session management commands

### 6.2 Gemini CLI

- [ ] Research Gemini CLI commands
- [ ] Implement `GeminiCLI.ts`
- [ ] Test session management commands

### 6.3 Future Providers

- [ ] Codex (when available)
- [ ] Other ACP-compatible agents

---

## File Structure (Final)

```
agentic_acp_server/
├── packages/
│   └── agentic-indexer/
│       ├── package.json
│       ├── tsconfig.json
│       ├── index.ts
│       └── src/
│           ├── config/
│           │   ├── types.ts
│           │   └── loader.ts
│           ├── indexer/
│           │   ├── TreeSitterIndexer.ts
│           │   ├── SymbolStore.ts
│           │   ├── types.ts
│           │   └── languages/
│           │       ├── typescript.ts
│           │       ├── python.ts
│           │       ├── lua.ts
│           │       └── go.ts
│           ├── tools/
│           │   ├── search_symbols.ts
│           │   ├── get_file_summary.ts
│           │   ├── list_files.ts
│           │   └── get_definition.ts
│           └── watcher/
│               └── FileWatcher.ts
│
├── src/
│   ├── cli/
│   │   ├── types.ts
│   │   ├── BaseCLI.ts
│   │   ├── OpenCodeCLI.ts
│   │   ├── CopilotCLI.ts          # placeholder
│   │   └── GeminiCLI.ts           # placeholder
│   │
│   ├── config/
│   │   ├── types.ts
│   │   └── loader.ts
│   │
│   ├── hooks/
│   │   ├── types.ts
│   │   ├── HooksManager.ts
│   │   └── builtin/
│   │       ├── ProjectInit.ts
│   │       └── SessionCleanup.ts
│   │
│   ├── indexer/
│   │   ├── IndexerManager.ts
│   │   └── types.ts
│   │
│   └── ... (existing structure)
│
└── .agentic/                       # Per-repo (created by ProjectInit)
    ├── config.json
    └── index/
        └── symbols.sqlite
```

---

## Dependencies to Add

### Main Package
- None new (uses existing Bun APIs)

### agentic-indexer Package
- `@modelcontextprotocol/sdk` - MCP server implementation
- `web-tree-sitter` - Tree-sitter WASM bindings
- Tree-sitter grammars (WASM):
  - `tree-sitter-typescript`
  - `tree-sitter-python`
  - `tree-sitter-lua`
  - `tree-sitter-go`

---

## Open Questions / Risks

1. **Tree-sitter WASM in Bun**: Need to verify `web-tree-sitter` works in Bun runtime. May need alternative approach.

2. **OpenCode CLI verification**: Need to test actual CLI commands - documentation may differ from implementation.

3. **MCP server stability**: Long-running MCP server process needs proper error handling and restart logic.

4. **Large repo performance**: SQLite should handle medium repos well, but may need optimization for very large monorepos.

5. **ACP mcpServers format**: Need to verify exact format expected by ACP SDK for MCP server configuration.

---

## Success Criteria

### Phase 1 Complete When:
- [ ] Session deletion also cleans up provider's session
- [ ] Export/import sessions work via RPC
- [ ] Stats command returns provider statistics
- [ ] Config file loads and validates

### Phase 2 Complete When:
- [ ] Indexer parses TS/Python/Lua/Go files
- [ ] Symbols stored in SQLite
- [ ] MCP server responds to tool calls
- [ ] search_symbols returns accurate results

### Phase 3 Complete When:
- [ ] Agents automatically have indexer tools available
- [ ] Reindex command works
- [ ] Indexer restarts on crash

### Phase 4 Complete When:
- [ ] New projects get .agentic/ directory
- [ ] AGENTS.md includes indexer instructions
- [ ] Agents actually use indexer tools preferentially

### Phase 5 Complete When:
- [ ] Index updates automatically on file changes
- [ ] No manual reindex needed for normal workflow
