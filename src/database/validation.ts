import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from 'drizzle-orm/typebox'
import { agents, sessions } from './schemas'
import { Value } from 'typebox/value'
import type { TSchema } from 'typebox'

export const AgentInsertSchema = createInsertSchema(agents)
export const AgentSelectSchema = createSelectSchema(agents)
export const AgentUpdateSchema = createUpdateSchema(agents)

export const SessionInsertSchema = createInsertSchema(sessions)
export const SessionSelectSchema = createSelectSchema(sessions)
export const SessionUpdateSchema = createUpdateSchema(sessions)

export function isValid<T extends TSchema>(schema: T, data: unknown): boolean {
  return Value.Check(schema, data)
}
