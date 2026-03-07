import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './drizzle_migrations',
  dialect: 'sqlite',
  schema: './src/database/schemas/*.schema.ts',

  migrations: {
    table: '__drizzle_migrations__',
  },

  strict: true,
  verbose: true,
  breakpoints: true,
})
