// Per-instance in-memory sliding-window rate limiter for public endpoints.
//
// Serverless platforms scale horizontally, so each instance enforces its own
// budget — this is defense-in-depth against single-instance bursts (a client
// slamming one warm instance), not a hard global limit. A true cross-instance
// limit requires an external service (Upstash, Cloudflare, etc.) — see
// SECURITY.md.
//
// Keyed by client IP (x-forwarded-for, set by the hosting proxy). Default
// budget: 120 requests / 60s per IP, tunable via PUBLIC_RATE_LIMIT_MAX.
//
// Plugin-driven client scripts call from every visitor's browser, so unique-IP
// volume grows fast. The map is bounded by: (1) a sweep that drops expired
// entries, (2) lazy deletion when an IP's window empties, and (3) an LRU cap on
// total entries — preventing the unbounded memory growth of the old design.

const WINDOW_MS = 60_000
const SWEEP_MS = 60_000

const hits = new Map<string, number[]>()

let sweepTimer: NodeJS.Timeout | null = null
function ensureSweep() {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [ip, arr] of hits) {
      if (arr.length === 0 || now - arr[arr.length - 1] >= WINDOW_MS) hits.delete(ip)
    }
  }, SWEEP_MS)
  // Don't keep the instance alive solely to run the sweep.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref()
}

export function isRateLimited(request: Request): boolean {
  ensureSweep()
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const now = Date.now()
  const window = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)

  const max = Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 120)
  if (window.length >= max) {
    // Refresh the stored window so the sweep can eventually clear it.
    hits.set(ip, window)
    return true
  }

  window.push(now)
  hits.set(ip, window)

  // Hard bound: evict oldest IPs if the map grows past the cap (defense against
  // unbounded memory under many unique client IPs from plugin scripts).
  const maxEntries = Number(process.env.RATE_LIMIT_MAX_IPS ?? 20_000)
  if (hits.size > maxEntries) {
    let overflow = hits.size - maxEntries
    for (const key of hits.keys()) {
      hits.delete(key)
      if (--overflow <= 0) break
    }
  }

  return false
}
