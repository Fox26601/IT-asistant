type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

/**
 * Best-effort in-process rate limit (per serverless isolate).
 * Enough to blunt casual abuse on a public webhook surface.
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  // Occasional prune
  if (buckets.size > 2000) {
    for (const [k, b] of buckets) {
      if (now >= b.resetAt) buckets.delete(k);
    }
  }

  const allowed = bucket.count <= opts.limit;
  return {
    allowed,
    remaining: Math.max(0, opts.limit - bucket.count),
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function clientKey(
  c: { req: { header: (name: string) => string | undefined } },
  route: string
): string {
  const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || c.req.header("x-real-ip") || "unknown";
  return `${route}:${ip}`;
}
