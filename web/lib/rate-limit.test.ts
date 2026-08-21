import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isRateLimited } from "./rate-limit"

beforeEach(() => {
  process.env.PUBLIC_RATE_LIMIT_MAX = "3"
  delete process.env.RATE_LIMIT_MAX_IPS
})
afterEach(() => {
  vi.useRealTimers()
  delete process.env.PUBLIC_RATE_LIMIT_MAX
  delete process.env.RATE_LIMIT_MAX_IPS
})

function req(ip: string) {
  return new Request("https://x/", { headers: { "x-forwarded-for": ip } })
}

describe("rate limiter", () => {
  it("allows up to the limit then blocks", () => {
    const ip = "1.1.1.1"
    expect(isRateLimited(req(ip))).toBe(false)
    expect(isRateLimited(req(ip))).toBe(false)
    expect(isRateLimited(req(ip))).toBe(false)
    expect(isRateLimited(req(ip))).toBe(true)
  })

  it("resets after the window elapses", () => {
    const ip = "2.2.2.2"
    vi.useFakeTimers()
    vi.setSystemTime(0)
    expect(isRateLimited(req(ip))).toBe(false)
    expect(isRateLimited(req(ip))).toBe(false)
    expect(isRateLimited(req(ip))).toBe(false)
    expect(isRateLimited(req(ip))).toBe(true)
    vi.advanceTimersByTime(61_000)
    expect(isRateLimited(req(ip))).toBe(false)
  })

  it("handles many unique IPs without throwing", () => {
    for (let i = 0; i < 5000; i++) isRateLimited(req(`10.0.0.${i % 255}`))
    expect(true).toBe(true)
  })
})
