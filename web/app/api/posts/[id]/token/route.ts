import { NextRequest, NextResponse } from "next/server"
import { db } from "@/db"
import { posts } from "@/db/schema"
import { eq } from "drizzle-orm"
import { withError } from "@/lib/with-error"
import { getAuthenticatedUserId } from "@/lib/auth-user"
import { signCapability, type CapabilityScope } from "@/lib/post-token"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SCOPES: CapabilityScope[] = ["post:read", "data:read", "data:patch"]

// POST /api/posts/:id/token — mint a scoped capability token for this post.
// Owner-only (session or API key). The token is post-scoped and optionally
// subkey/plugin-limited, so it can be embedded in a public client page without
// exposing the owner's full account key.
export const POST = withError(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const post = await db
    .select({ userId: posts.userId, tokenVersion: posts.tokenVersion })
    .from(posts)
    .where(eq(posts.id, id))
    .then(r => r[0])
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (post.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const scope = body?.scope as CapabilityScope | undefined
  if (!scope || !ALLOWED_SCOPES.includes(scope)) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 })
  }

  const subkeys: string[] | undefined = Array.isArray(body?.subkeys)
    ? body.subkeys.map(String)
    : undefined
  const pluginId: string | undefined =
    typeof body?.pluginId === "string" ? body.pluginId : undefined
  const expiresInMs: number | undefined =
    typeof body?.expiresInMs === "number" ? body.expiresInMs : undefined

  const token = signCapability({
    postId: id,
    scope,
    subkeys,
    pluginId,
    version: post.tokenVersion ?? 1,
    userId,
    expiresInMs,
  })

  return NextResponse.json({
    token,
    scope,
    subkeys: subkeys ?? null,
    pluginId: pluginId ?? null,
  })
})
