import { NextRequest, NextResponse } from "next/server";

const AUTH_CHALLENGE = 'Basic realm="qqq-million-plan", charset="UTF-8"';

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

function basicPassword(header: string | null): string | null {
  if (!header || header.length > 4096 || !header.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    return separator >= 0 && decoded.slice(0, separator) === "owner" ? decoded.slice(separator + 1) : null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  if (process.env.CLOUDFLARE_RUNTIME !== "1" && process.env.SITE_AUTH_REQUIRED !== "1") return NextResponse.next();

  // This endpoint authenticates its existing, independent ingestion token itself.
  if (request.nextUrl.pathname === "/api/ingestion/quota" && request.method === "POST") return NextResponse.next();

  // Machine job endpoints validate their own credential and never accept it for the website.
  if (["/api/jobs/refresh", "/api/jobs/reconcile", "/api/jobs/info"].includes(request.nextUrl.pathname) && request.method === "POST") return NextResponse.next();

  if (process.env.SITE_AUTH_REQUIRED !== "0") {
    const expected = process.env.SITE_ACCESS_TOKEN;
    if (!expected || !/^[A-Za-z0-9_-]{43,}$/.test(expected)) {
      return new NextResponse("Site authentication is not configured", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const supplied = basicPassword(request.headers.get("authorization"));
    if (!supplied || !(await constantTimeEqual(supplied, expected))) {
      return new NextResponse("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": AUTH_CHALLENGE, "Cache-Control": "no-store" },
      });
    }
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== request.nextUrl.origin)) {
      return new NextResponse("Invalid origin", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
