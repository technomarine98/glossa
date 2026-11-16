import { ProviderError, RateLimitError } from "./types";

export function rateLimitError(
  response: Response,
  provider: string,
  detail = "",
  dailyLimit = false,
): RateLimitError {
  const now = Date.now();
  const retryAfter = response.headers.get("Retry-After")?.trim();
  let retryAt = now + 60_000;
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    retryAt = now + Number(retryAfter) * 1000;
  } else if (retryAfter && Number.isFinite(Date.parse(retryAfter))) {
    retryAt = Date.parse(retryAfter);
  } else {
    // MyMemory can put its quota reset time in the JSON error instead of a header.
    const reset = detail.match(/NEXT AVAILABLE IN\s+(\d+)\s+HOURS?\s+(\d+)\s+MINUTES?\s+(\d+)\s+SECONDS?/i);
    if (reset) {
      retryAt = now + (Number(reset[1]) * 3600 + Number(reset[2]) * 60 + Number(reset[3])) * 1000;
    }
  }
  if (!Number.isFinite(retryAt)) retryAt = now + 60_000;
  return new RateLimitError(provider, Math.max(now + 1000, retryAt), dailyLimit);
}

export async function readProviderJson<T>(response: Response, provider: string): Promise<T> {
  try {
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid JSON response");
    return data as T;
  } catch {
    // Rate limiting proxies may return HTML rather than the provider's usual JSON.
    if (response.status === 429) throw rateLimitError(response, provider);
    throw new ProviderError(response.ok
      ? `${provider} returned an invalid response.`
      : `${provider} returned HTTP ${response.status}.`, response.ok || response.status >= 500 || response.status === 408 || response.status === 403);
  }
}
