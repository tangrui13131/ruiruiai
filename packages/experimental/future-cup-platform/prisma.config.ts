import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.FUTURE_CUP_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/futurecup',
  },
})
