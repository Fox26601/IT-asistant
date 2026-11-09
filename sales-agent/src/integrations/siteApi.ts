import { config } from "../config.js";

export type SiteApiResult = {
  ok: boolean;
  status: number;
  error?: string;
  data?: unknown;
};

const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 300_000;

type CacheEntry = {
  result: SiteApiResult;
  expiresAt: number;
};

const ttlCache = new Map<string, CacheEntry>();

function siteConfigured(): boolean {
  return Boolean(config.siteBaseUrl && config.siteWebhookSecret);
}

function mapHttpError(status: number, body: unknown): string {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 503) {
    const err =
      body && typeof body === "object" && "error" in body
        ? String((body as { error?: unknown }).error || "")
        : "";
    return err === "not_configured" ? "not_configured" : "service_unavailable";
  }
  if (status === 404) return "not_found";
  return `http_${status}`;
}

function getCached(key: string): SiteApiResult | null {
  const entry = ttlCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    ttlCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCached(key: string, result: SiteApiResult): void {
  if (!result.ok) return;
  ttlCache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function siteFetch(
  path: string,
  init: RequestInit = {}
): Promise<SiteApiResult> {
  if (!siteConfigured()) {
    return { ok: false, status: 0, error: "site_not_configured" };
  }

  const url = `${config.siteBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers = new Headers(init.headers || {});
    headers.set("x-webhook-secret", config.siteWebhookSecret);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    let data: unknown = undefined;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 500) };
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: mapHttpError(res.status, data),
        data,
      };
    }

    return { ok: true, status: res.status, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const aborted = /abort/i.test(msg);
    return {
      ok: false,
      status: 0,
      error: aborted ? "timeout" : "network_error",
      data: { detail: msg },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCatalog(): Promise<SiteApiResult> {
  const key = "catalog";
  const cached = getCached(key);
  if (cached) return cached;
  const result = await siteFetch("/api/sales-agent/catalog");
  setCached(key, result);
  return result;
}

export async function fetchAvailability(date: string): Promise<SiteApiResult> {
  const q = encodeURIComponent(date);
  return siteFetch(`/api/sales-agent/availability?date=${q}`);
}

export async function fetchPolicy(): Promise<SiteApiResult> {
  const key = "policy";
  const cached = getCached(key);
  if (cached) return cached;
  const result = await siteFetch("/api/sales-agent/policy");
  setCached(key, result);
  return result;
}

export async function fetchBookingStatus(
  orderId: string
): Promise<SiteApiResult> {
  const q = encodeURIComponent(orderId);
  return siteFetch(`/api/sales-agent/booking-status?order_id=${q}`);
}

export async function fetchCustomsStatus(
  requestId: string
): Promise<SiteApiResult> {
  const q = encodeURIComponent(requestId);
  return siteFetch(`/api/sales-agent/customs-status?request_id=${q}`);
}

export async function fetchCompatiblePractices(input: {
  creator_ids?: string[];
  creator_keys?: string[];
}): Promise<SiteApiResult> {
  return siteFetch("/api/sales-agent/compatible-practices", {
    method: "POST",
    body: JSON.stringify({
      creator_ids: input.creator_ids || [],
      creator_keys: input.creator_keys || [],
    }),
  });
}

/** Remove hard_limits / limits_text so the model cannot quote them to buyers. */
export function sanitizePolicyForModel(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const src = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "hard_limits") continue;
    out[k] = stripLimitsText(v);
  }
  return out;
}

function stripLimitsText(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripLimitsText);
  }
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "limits_text" || k === "hard_limits") continue;
    next[k] = stripLimitsText(v);
  }
  return next;
}
