import { getNowMillis } from 'src/utils/datetime'
import * as t from 'drizzle-orm/sqlite-core'
import { createId } from '@paralleldrive/cuid2'
import type { Providers } from 'src/data/providers'

// Enums
const customEnum = <T>(name: string) =>
  t.customType<{
    data: T
  }>({
    dataType() {
      return 'text'
    },
  })(name)

// Common Schemas
export const timestampsSchema = {
  created_at: t
    .integer({ mode: 'number' })
    .notNull()
    .$default(() => getNowMillis()),
  updated_at: t
    .integer({ mode: 'number' })
    .notNull()
    .$onUpdate(() => getNowMillis()),
}

export const baseSchema = {
  id: t
    .text()
    .primaryKey()
    .$defaultFn(() => createId()),
  ...timestampsSchema,
}

export const providerSchema = {
  provider_name: customEnum<Providers>('provider_name').notNull(),
  provider_title: t.text().notNull(),
  provider_command: t.text().notNull(),
  provider_args: t.text({ mode: 'json' }).$type<string[]>().notNull(),
}

export enum GlobalPermissionsRule {
  allow = 'allow',
  deny = 'deny',
  ask = 'ask',
}

export const agentPermissionsSchema = {
  permissions_rule: customEnum<GlobalPermissionsRule>('permissions_rule')
    .notNull()
    .default(GlobalPermissionsRule.ask),
}

export enum SessionStatus {
  active = 'active',
  completed = 'completed',
  archived = 'archived',
  suspended = 'suspended',
  error = 'error',
}
export const sessionStatusSchema = {
  status: customEnum<SessionStatus>('status')
    .notNull()
    .default(SessionStatus.active),
}
