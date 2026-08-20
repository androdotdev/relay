import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { posts } from "@/db/schema"
import { eq, sql } from "drizzle-orm"
import { withError } from "@/lib/with-error"
import { getAuthenticatedUserId } from "@/lib/auth-user"
import { isRateLimited } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Allow the public page origin (postshare) to PATCH data cross-origin using an
// x-api-key header (no cookies/credentials, so reflecting Origin is safe).
function withCors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get("origin")
  res.headers.set("Access-Control-Allow-Origin", origin || "*")
  res.headers.set("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS")
  res.headers.set("Access-Control-Allow-Headers", "x-api-key, content-type")
  return res
}

export const OPTIONS = withError(async (request: NextRequest) => {
  return withCors(request, new NextResponse(null, { status: 204 }))
})


// GET /api/posts/:id/data — public unless post.isPrivate, then owner-only
export const GET = withError(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  if (isRateLimited(request)) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  const row = await db
    .select({ data: posts.data, isPrivate: posts.isPrivate, userId: posts.userId })
    .from(posts)
    .where(eq(posts.id, id))
    .then(r => r[0])

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (row.isPrivate) {
    const userId = await getAuthenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (row.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return withCors(request, NextResponse.json(row.data ?? {}))
})

// PATCH /api/posts/:id/data — auth via x-api-key. Merges into existing jsonb by
// default; pass `?replace=1` to overwrite the whole jsonb instead.
export const PATCH = withError(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  // `?replace=1` overwrites data wholesale; otherwise the body is merged in.
  const replace = request.nextUrl.searchParams.get("replace") === "1"

  // Verify ownership
  const post = await db
    .select({ userId: posts.userId })
    .from(posts)
    .where(eq(posts.id, id))
    .then(r => r[0])

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (post.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 })
  }

  const fragment = JSON.stringify(body)
  // `?replace=1` overwrites the whole jsonb; otherwise merge into existing data.
  const updated = await db
    .update(posts)
    .set({ data: replace ? sql`${fragment}::jsonb` : sql`${posts.data} || ${fragment}::jsonb` })
    .where(eq(posts.id, id))
    .returning({ data: posts.data })

  return withCors(request, NextResponse.json(updated[0].data))
})
