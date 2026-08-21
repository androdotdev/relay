import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { signCapability, verifyCapability, signToken, verifyToken } from "./post-token"

beforeEach(() => {
  process.env.POST_TOKEN_SECRET = "test-secret"
})
afterEach(() => {
  delete process.env.POST_TOKEN_SECRET
})

describe("capability tokens", () => {
  it("roundtrips a scoped data:patch token with subkeys", () => {
    const t = signCapability({ postId: "p1", scope: "data:patch", subkeys: ["layout"], userId: "u1", version: 2 })
    const p = verifyCapability(t, { postId: "p1", scope: "data:patch" })
    expect(p).not.toBeNull()
    expect(p!.postId).toBe("p1")
    expect(p!.subkeys).toEqual(["layout"])
    expect(p!.v).toBe(2)
  })

  it("rejects wrong postId", () => {
    const t = signCapability({ postId: "p1", scope: "data:patch" })
    expect(verifyCapability(t, { postId: "p2", scope: "data:patch" })).toBeNull()
  })

  it("rejects wrong scope", () => {
    const t = signCapability({ postId: "p1", scope: "data:patch" })
    expect(verifyCapability(t, { postId: "p1", scope: "data:read" })).toBeNull()
  })

  it("rejects wrong pluginId", () => {
    const t = signCapability({ postId: "p1", scope: "data:patch", pluginId: "A" })
    expect(verifyCapability(t, { postId: "p1", scope: "data:patch", pluginId: "B" })).toBeNull()
  })

  it("legacy signToken/verifyToken still works", () => {
    const t = signToken("p1", "u1", 3)
    const p = verifyToken(t)
    expect(p?.postId).toBe("p1")
    expect(p?.v).toBe(3)
  })

  it("rejects a tampered token", () => {
    const t = signCapability({ postId: "p1", scope: "data:patch" })
    expect(verifyCapability(t + "x", { postId: "p1", scope: "data:patch" })).toBeNull()
  })
})
