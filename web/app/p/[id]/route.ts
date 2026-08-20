import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAuthenticatedUserId } from "@/lib/auth-user";
import { verifyToken } from "@/lib/post-token";
import { interpolate } from "@/lib/interpolate";
import { isRateLimited } from "@/lib/rate-limit";

if (!process.env.POSTS_DOMAIN) {
  console.warn(
    "[p/[id]] POSTS_DOMAIN env var not set — token-based private page access " +
    "from the posts domain will silently fall back to session auth.",
  );
}

export const dynamic = "force-dynamic";

const PRIVATE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Private page</title>
<style>body{font-family:ui-monospace,monospace;background:#0a0a0a;color:#e8e8e8;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{text-align:center;padding:2rem}svg{opacity:.5}h1{font-size:1.25rem;margin:.75rem 0 .5rem}.msg{color:#888;max-width:22rem;font-size:.85rem}.home{border:1px solid #333;color:#888;padding:.5rem 1rem;border-radius:2px;text-decoration:none;display:inline-block;margin-top:1rem}.home:hover{color:#e8e8e8;border-color:#444}</style>
</head>
<body><main>
<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
<h1>This page is private</h1>
<p class="msg">The owner has marked this page as private. Sign in with the owner account to view it.</p>
<a class="home" href="/">Go home</a>
</main></body></html>`;

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Page not found</title>
<style>body{font-family:ui-monospace,monospace;background:#0a0a0a;color:#e8e8e8;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{text-align:center;padding:2rem}svg{opacity:.5}h1{font-size:1.25rem;margin:.75rem 0 .5rem}.msg{color:#888;max-width:22rem;font-size:.85rem}.home{border:1px solid #333;color:#888;padding:.5rem 1rem;border-radius:2px;text-decoration:none;display:inline-block;margin-top:1rem}.home:hover{color:#e8e8e8;border-color:#444}</style>
</head>
<body><main>
<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
<h1>Page not found</h1>
<p class="msg">This page doesn't exist or may have been deleted.</p>
<a class="home" href="/">Go home</a>
</main></body></html>`;

// safe: `<` in the JSON payload can't prematurely close the script tag —
// browsers only scan for the literal byte sequence "</script", so escaping
// just the "<" of "</" is sufficient and keeps the JSON otherwise untouched.
const DATA_SCRIPT = (data: unknown) =>
  `<script>window.__PH_DATA=${JSON.stringify(data ?? {}).replace(/</g, "\\u003c")};</script>`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (isRateLimited(request)) {
    return new NextResponse("Too many requests", { status: 429 })
  }

  const post = await db
    .select({ html: posts.html, data: posts.data, isPrivate: posts.isPrivate, userId: posts.userId, tokenVersion: posts.tokenVersion })
    .from(posts)
    .where(eq(posts.id, id))
    .then((rows) => rows[0]);

  if (!post) {
    return new NextResponse(NOT_FOUND_HTML, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" } });
  }

  // Gate private pages to the owner only
  // On the posts domain, validate a capability token from the URL
  // instead of the session cookie (which can't cross origins)
  if (post.isPrivate) {
    const host = request.headers.get("host") || ""
    const isPostsDomain = host === (process.env.POSTS_DOMAIN ?? false)

    if (isPostsDomain) {
      const token = request.nextUrl.searchParams.get("key")
      if (!token) {
        return new NextResponse(PRIVATE_HTML, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
      }
      const payload = verifyToken(token)
      if (!payload || payload.postId !== id || payload.userId !== post.userId || payload.v !== post.tokenVersion) {
        return new NextResponse(PRIVATE_HTML, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
      }
    } else {
      const userId = await getAuthenticatedUserId(request);
      if (!userId) {
        return new NextResponse(PRIVATE_HTML, { status: 401, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
      }
      if (post.userId !== userId) {
        return new NextResponse(PRIVATE_HTML, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
      }
    }
  }

  const html = post.html ?? "";
  if (!post.html) {
    console.warn(`[p/${id}] post.html is null or empty, serving empty content`);
  }

  const rendered = interpolate(html, (post.data ?? {}) as Record<string, unknown>);
  const dataScript = `${DATA_SCRIPT(post.data)}\n`;
  const injected = rendered.includes("</body>")
    ? rendered.replace("</body>", `${dataScript}\n</body>`)
    : `${rendered}\n${dataScript}`;

  return new NextResponse(injected, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src 'self' data: https://i.ytimg.com https://res.cloudinary.com; media-src 'self' data: https://res.cloudinary.com; font-src 'self' data:; script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; connect-src 'self' https://www.youtube.com https://posthtml.vercel.app; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
      // Private page HTML + window.__PH_DATA + ?key= token must never hit shared caches
      "Cache-Control": post.isPrivate ? "private, no-store" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
