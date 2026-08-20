// Shared server-side constants. Single source of truth for the values that
// used to be re-declared per route with subtly different fallbacks.

// Posts domain — the auth base URL (same origin in production). Used to
// build share links. Trailing slashes stripped so URLs compose cleanly.
export const BASE_URL = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "")

// Hard cap on uploaded HTML size (matches the PATCH validation limit).
export const MAX_HTML_SIZE = 2_097_152 // 2MB
