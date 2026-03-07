#!/usr/bin/env bun
/**
 * Generates openrpc.json from the TypeScript spec definition.
 * Run: bun run gen:openrpc
 */

import { spec } from 'src/openrpc/spec'
import { write } from 'bun'
import { resolvePath } from 'src/utils/paths'

const outPath = resolvePath(
  process.env.OPENRPC_SCHEMA_PATH || 'src/openrpc/openrpc.json',
)
const json = JSON.stringify(spec, null, 2) + '\n'

await write(outPath, json)
console.log(`✓ openrpc.json written to ${outPath}`)
