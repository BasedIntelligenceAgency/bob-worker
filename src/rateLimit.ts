// Simple rate limiting implementation
const RATE_LIMIT = 300; // requests
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface RateLimitInfo {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateLimitInfo>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const info = rateLimits.get(key);

  if (!info || now > info.resetAt) {
    rateLimits.set(key, {
      count: 1,
      resetAt: now + WINDOW_MS
    });
    return false;
  }

  if (info.count >= RATE_LIMIT) {
    return true;
  }

  info.count++;
  return false;
}

export function getRateLimitRemaining(key: string): number {
  const now = Date.now();
  const info = rateLimits.get(key);

  if (!info || now > info.resetAt) {
    return RATE_LIMIT;
  }

  return Math.max(0, RATE_LIMIT - info.count);
}

export function getRateLimitReset(key: string): number {
  const info = rateLimits.get(key);
  return info ? info.resetAt : Date.now() + WINDOW_MS;
} 