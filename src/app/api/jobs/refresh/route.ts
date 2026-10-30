import { authorizeCloudJob } from "@/server/jobs/cloud-auth";
import { POST as refresh } from "../../market/refresh/route";

export async function POST(request: Request) {
  if (!await authorizeCloudJob(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.CLOUDFLARE_RUNTIME !== "1") return Response.json({ error: "cloud_only" }, { status: 404 });
  return refresh(request);
}
