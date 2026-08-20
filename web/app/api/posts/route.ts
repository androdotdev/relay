import { NextRequest, NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { db } from "@/db"
import { posts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { withError } from "@/lib/with-error"
import { getAuthenticatedUserId } from "@/lib/auth-user"
import { BASE_URL, MAX_HTML_SIZE } from "@/lib/constants"
import { renderPageHtml, isPostType, POST_TYPES } from "@/lib/markdown"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = withError(async (request: NextRequest) => {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { html, title, isPrivate, type } = await request.json()
  if (!html || typeof html !== "string") {
    return NextResponse.json({ error: "html is required" }, { status: 400 })
  }
  if (type !== undefined && !isPostType(type)) {
    return NextResponse.json({ error: `type must be one of: ${POST_TYPES.join(", ")}` }, { status: 400 })
  }
  if (html.length > MAX_HTML_SIZE) {
    return NextResponse.json({ error: `HTML content exceeds ${MAX_HTML_SIZE / (1024 * 1024)}MB limit` }, { status: 413 })
  }
  const id = nanoid(16)
  const rendered = renderPageHtml(html, type)
  await db.insert(posts).values({
    id,
    html: rendered,
    userId,
    title: title ?? "",
    type: type ?? "html",
    ...(typeof isPrivate === "boolean" ? { isPrivate } : {}),
  })
  return NextResponse.json({
    id,
    url: `${BASE_URL}/p/${id}`,
    title: title ?? "",
    type: type ?? "html",
    ...(typeof isPrivate === "boolean" ? { isPrivate } : {}),
  })
})

export const GET = withError(async (request: NextRequest) => {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const list = await db
    .select({ id: posts.id, title: posts.title, createdAt: posts.createdAt, updatedAt: posts.updatedAt, isPrivate: posts.isPrivate })
    .from(posts)
    .where(eq(posts.userId, userId))
    .orderBy(posts.createdAt)
  return NextResponse.json(list)
})
