import type { Asset, AssetPage, AssetQuery, BulkResult } from '@/lib/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryAfterMs = 0,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.kind?.length) params.set('kind', query.kind.join(','));
  if (query.tag?.length) params.set('tag', query.tag.join(','));
  if (query.collectionId) params.set('collectionId', query.collectionId);
  if (query.owner) params.set('owner', query.owner);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

const inFlight = new Map<string, { promise: Promise<unknown>; signal?: AbortSignal | null }>();
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('The request was cancelled.', 'AbortError'));
    }, { once: true });
  });

function retryDelay(attempt: number, retryAfterMs: number): number {
  if (retryAfterMs > 0) return retryAfterMs;
  const base = Math.min(2000, 250 * 2 ** attempt);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function canRetry(method: string, status?: number): boolean {
  return method === 'GET' ? status === undefined || RETRYABLE_STATUSES.has(status) : status === 500;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const key = `${method}:${path}:${init.body ?? ''}`;
  const existing = inFlight.get(key);
  if (existing && !existing.signal?.aborted) return existing.promise as Promise<T>;
  if (existing) inFlight.delete(key);

  const promise = (async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(path, {
          ...init,
          headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        });
        if (res.ok) return res.json() as Promise<T>;

        let code = 'request_failed';
        let message = res.statusText || 'The server rejected the request.';
        try {
          const body = await res.json();
          code = body?.error?.code ?? code;
          message = body?.error?.message ?? message;
        } catch {
          // Keep the HTTP status text when the server did not return JSON.
        }
        const retryAfter = Number(res.headers.get('retry-after') ?? 0);
        if (attempt < 2 && canRetry(method, res.status)) {
          await sleep(retryDelay(attempt, retryAfter * 1000), init.signal);
          continue;
        }
        throw new ApiError(message, code, res.status, retryAfter * 1000, res.headers.get('x-request-id') ?? undefined);
      } catch (error) {
        if (error instanceof ApiError || (error instanceof DOMException && error.name === 'AbortError')) {
          throw error;
        }
        if (attempt < 2 && canRetry(method)) {
          await sleep(retryDelay(attempt, 0), init.signal);
          continue;
        }
        throw new ApiError('The network connection failed. Check your connection and try again.', 'network_error', 0);
      }
    }
    throw new ApiError('The request could not be completed.', 'request_failed', 0);
  })();

  inFlight.set(key, { promise, signal: init.signal });
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

export function listAssets(query: AssetQuery, signal?: AbortSignal): Promise<AssetPage> {
  return request<AssetPage>(`/api/assets?${toSearchParams(query)}`, { signal });
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, { signal });
}

export function getAssetsByIds(ids: string[]): Promise<{ items: Asset[]; missing: string[] }> {
  // Note: the endpoint rejects more than 25 ids per call.
  return request(`/api/assets/batch?ids=${ids.join(',')}`);
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, 'name' | 'status' | 'tags'>>,
): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version, patch }),
  });
}

export function bulkSetStatus(ids: string[], status: Asset['status']): Promise<BulkResult> {
  return request<BulkResult>('/api/assets/bulk-status', {
    method: 'POST',
    body: JSON.stringify({ ids, status }),
  });
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
