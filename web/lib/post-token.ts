import { createHmac, timingSafeEqual } from "node:crypto"

const TOKEN_EXPIRY_MS = 1_000 * 60 * 60 * 24 * 30 // 30 days

/** Operations a capability token may grant. Never includes destructive scopes. */
export type CapabilityScope = "post:read" | "data:read" | "data:patch"

export interface TokenPayload {
  postId: string
  userId: string
  /** token version — bumped when the post's visibility toggles, revoking older tokens */
  v: number
  iat: number
  exp: number
  /** capability scope granted by this token (absent = legacy private-viewer token) */
  scope?: CapabilityScope
  /** for data:patch — only these top-level data keys may be written */
  subkeys?: string[]
  /** plugin the token is scoped to (prevents cross-plugin reuse) */
  pluginId?: string
}

function getSecret(): string {
  const secret = process.env.POST_TOKEN_SECRET
  if (!secret) throw new Error("POST_TOKEN_SECRET is not set")
  return secret
}

/**
 * Sign a capability token for viewing a private post.
 * Token is HMAC-SHA256 over a JSON payload, base64url-encoded.
 */
export function signToken(postId: string, userId: string, version = 1): string {
  const secret = getSecret()
  const now = Date.now()
  const payload: TokenPayload = { postId, userId, v: version, iat: now, exp: now + TOKEN_EXPIRY_MS }

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url")

  return `${encoded}.${sig}`
}

/**
 * Verify a capability token. Returns the decoded payload if valid, null otherwise.
 * Uses timing-safe comparison for the HMAC.
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const secret = getSecret()
    const parts = token.split(".")

    // Must be exactly 2 parts: payload and signature
    if (parts.length !== 2) {
      return null
    }

    const [encoded, sig] = parts

    // Verify HMAC with timing-safe comparison
    const expectedSig = createHmac("sha256", secret).update(encoded).digest("base64url")
    const sigBuf = Buffer.from(sig, "base64url")
    const expectedBuf = Buffer.from(expectedSig, "base64url")

    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null
    }

    const payload: TokenPayload = JSON.parse(Buffer.from(encoded, "base64url").toString())

    // Check expiry
    if (Date.now() > payload.exp) {
      return null
    }

    // Tokens signed before versioning (missing v) are treated as version 1 —
    // still valid until the post's visibility is first toggled.
    if (typeof payload.v !== "number") {
      payload.v = 1
    }

    return payload
  } catch {
    return null
  }
}

export interface SignCapabilityOptions {
  postId: string
  scope: CapabilityScope
  subkeys?: string[]
  pluginId?: string
  version?: number
  userId?: string
  expiresInMs?: number
}

/** Sign a scoped capability token (post-scoped, optionally subkey/plugin-limited). */
export function signCapability(opts: SignCapabilityOptions): string {
  const secret = getSecret()
  const now = Date.now()
  const payload: TokenPayload = {
    postId: opts.postId,
    userId: opts.userId ?? "",
    v: opts.version ?? 1,
    iat: now,
    exp: now + (opts.expiresInMs ?? TOKEN_EXPIRY_MS),
    scope: opts.scope,
    subkeys: opts.subkeys,
    pluginId: opts.pluginId,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url")
  return `${encoded}.${sig}`
}

export interface VerifyCapabilityOptions {
  postId: string
  scope: CapabilityScope
  pluginId?: string
}

/**
 * Verify a capability token and assert it grants the requested scope for the
 * post. Returns the payload (incl. allowed subkeys) or null.
 */
export function verifyCapability(
  token: string,
  check: VerifyCapabilityOptions,
): TokenPayload | null {
  const payload = verifyToken(token)
  if (!payload) return null
  if (payload.postId !== check.postId) return null
  if (payload.scope !== check.scope) return null
  if (check.pluginId && payload.pluginId !== check.pluginId) return null
  return payload
}
