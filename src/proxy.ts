import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  // These endpoints authenticate machine requests independently.
  if (request.method === "POST" && [
    "/api/ingestion/quota",
    "/api/jobs/refresh",
    "/api/jobs/reconcile",
    "/api/jobs/info",
  ].includes(request.nextUrl.pathname)) return NextResponse.next();

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
