/** A dedicated machine credential grants access only to the cloud job endpoints. */
export async function authorizeCloudJob(request: Request): Promise<boolean> {
  const expected = process.env.CLOUD_JOB_TOKEN;
  const authorization = request.headers.get("authorization");
  if (!expected || !/^[A-Za-z0-9_-]{43,}$/.test(expected) || !authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice(7);
  if (supplied.length > 4096) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= new Uint8Array(left)[i] ^ new Uint8Array(right)[i];
  return difference === 0;
}
