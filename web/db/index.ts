import { Pool, neon, neonConfig } from "@neondatabase/serverless"
import { drizzle as drizzleWs, type NeonDatabase } from "drizzle-orm/neon-serverless"
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http"
import { schemaRelations } from "./relations"

// Transport: WebSocket by default — one handshake per warm invocation, then all
// queries share the connection, avoiding the per-query HTTP round trip of
// neon-http on multi-query operations (e.g. replace/update flows). Set
// NEON_TRANSPORT=http to force the per-query HTTP transport. Runtimes without a
// global WebSocket (Node <22) can't do the WebSocket transport, so they fall
// back to HTTP automatically instead of failing every query.
const useWebSocket = process.env.NEON_TRANSPORT !== "http" && typeof WebSocket !== "undefined"

function getUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return url
}

function buildDb(): NeonDatabase {
  if (useWebSocket) {
    // useWebSocket implies a global WebSocket exists (Node 22+, Bun, Vercel
    // Node 22) — the driver picks it up via neonConfig.webSocketConstructor.
  // Bound the pool: plugin-driven client writes (drag-position saves, etc.)
  // can open many concurrent connections; an unbounded pool hits Neon's
  // connection ceiling. allowExitOnIdle releases idle slots so warm instances
  // don't hold connections forever (serverless has no process exit to call .end()).
  const pool = new Pool({
    connectionString: getUrl(),
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  })
    return drizzleWs({ client: pool, relations: schemaRelations })
  }
  // Both drivers expose the same query-builder surface; the HTTP result is
  // structurally compatible with the WS database type.
  return drizzleHttp({ client: neon(getUrl()), relations: schemaRelations }) as unknown as NeonDatabase
}

/**
 * Lazy drizzle instance: built on first query, not at import. Lets modules be
 * evaluated without a reachable DATABASE_URL (local dev, CI builds, prerender),
 * and surfaces a clear error if a query actually runs without one.
 */
let instance: NeonDatabase | null = null

export const db = new Proxy({} as NeonDatabase, {
  get(_target, prop) {
    if (!instance) instance = buildDb()
    return Reflect.get(instance, prop)
  },
})
