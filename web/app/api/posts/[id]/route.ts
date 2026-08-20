import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { posts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { withError } from "@/lib/with-error"
import { getAuthenticatedUserId } from "@/lib/auth-user"
import { isRateLimited } from "@/lib/rate-limit"
import { BASE_URL, MAX_HTML_SIZE } from "@/lib/constants"
import { renderPageHtml, isPostType, POST_TYPES } from "@/lib/markdown"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/posts/:id — public unless post.isPrivate, then owner-only
export const GET = withError(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  if (isRateLimited(request)) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  const post = await db
    .select({
      id: posts.id,
      html: posts.html,
      data: posts.data,
      title: posts.title,
      isPrivate: posts.isPrivate,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      userId: posts.userId,
    })
    .from(posts).where(eq(posts.id, id)).then(r => r[0])
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (post.isPrivate) {
    const userId = await getAuthenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (post.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { userId: _userId, ...publicPost } = post
  return NextResponse.json(publicPost)
})

export const DELETE = withError(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const post = await db.select({ userId: posts.userId }).from(posts).where(eq(posts.id, id)).then(r => r[0])
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (post.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  await db.delete(posts).where(eq(posts.id, id))
  return NextResponse.json({ success: true })
})

export const PATCH = withError(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 })
  }

  const updates: Record<string, string | boolean | number> = {}
  if (body.type !== undefined && !isPostType(body.type)) {
    return NextResponse.json({ error: `type must be one of: ${POST_TYPES.join(", ")}` }, { status: 400 })
  }
  if (body.title !== undefined) {
    if (typeof body.title !== "string") return NextResponse.json({ error: "title must be a string" }, { status: 400 })
    updates.title = body.title
  }
  if (body.html !== undefined) {
    if (typeof body.html !== "string") return NextResponse.json({ error: "html must be a string" }, { status: 400 })
    if (body.html.length > MAX_HTML_SIZE) {
      return NextResponse.json({ error: `HTML content exceeds ${MAX_HTML_SIZE / (1024 * 1024)}MB limit` }, { status: 413 })
    }
    // Convert when html is (re)submitted; `type` labels the source format of
    // the html in this request, so a type-only PATCH just relabels the post.
    updates.html = renderPageHtml(body.html, body.type)
    if (body.type !== undefined) updates.type = body.type
  } else if (body.type !== undefined) {
    if (!isPostType(body.type)) {
      return NextResponse.json({ error: `type must be one of: ${POST_TYPES.join(", ")}` }, { status: 400 })
    }
    updates.type = body.type
  }
  if (body.isPrivate !== undefined) {
    if (typeof body.isPrivate !== "boolean") return NextResponse.json({ error: "isPrivate must be a boolean" }, { status: 400 })
    updates.isPrivate = body.isPrivate
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "html, title, type, or isPrivate is required" }, { status: 400 })
  }

  const post = await db.select({ userId: posts.userId, isPrivate: posts.isPrivate, tokenVersion: posts.tokenVersion, type: posts.type }).from(posts).where(eq(posts.id, id)).then(r => r[0])
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (post.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // A visibility toggle must invalidate every previously issued capability
  // token — bump the post's token version so old ?key= tokens stop verifying.
  if (updates.isPrivate !== undefined && updates.isPrivate !== post.isPrivate) {
    updates.tokenVersion = post.tokenVersion + 1
  }

  await db.update(posts).set(updates).where(eq(posts.id, id))
  return NextResponse.json({
    id,
    url: `${BASE_URL}/p/${id}`,
    ...(updates.title !== undefined ? { title: updates.title } : {}),
    type: updates.type !== undefined ? updates.type : post.type,
    isPrivate: updates.isPrivate !== undefined ? updates.isPrivate : post.isPrivate,
  })
})
