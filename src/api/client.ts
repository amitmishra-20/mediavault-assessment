import { ApiError } from '@/lib/errors';
import type { Asset, AssetPage, AssetQuery, BulkResult, AssetStatus } from '@/lib/types';

/** Single-shot API client: throws ApiError, honours AbortSignal; retries live one layer up. */

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

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

function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const secs = Number.parseInt(raw, 10);
  return Number.isFinite(secs) ? secs : undefined;
}

async function errorBody(res: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') return body as { code?: string; message?: string };
  } catch {
    /* body was not JSON */
  }
  return {};
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: init?.signal,
    });
  } catch (err) {
    // Abort = intentional cancellation, not a retryable network error.
    if ((err as DOMException)?.name === 'AbortError') throw err;
    throw new ApiError('network_error', 'Cannot reach the MediaVault API', 0);
  }

  if (!res.ok) {
    const { code, message } = await errorBody(res);
    throw new ApiError(
      code ?? `http_${res.status}`,
      message ?? res.statusText,
      res.status,
      parseRetryAfter(res),
      res.headers.get('x-request-id') ?? undefined,
    );
  }
  return res.json() as Promise<T>;
}

export function listAssets(query: AssetQuery, options?: RequestInit): Promise<AssetPage> {
  return requestJson<AssetPage>(`/api/assets?${toSearchParams(query)}`, options);
}

export function getAsset(id: string, options?: RequestInit): Promise<Asset> {
  return requestJson<Asset>(`/api/assets/${id}`, options);
}

export function getAssetsByIds(ids: string[]): Promise<{ items: Asset[]; missing: string[] }> {
  return requestJson(`/api/assets/batch?ids=${ids.join(',')}`);
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, 'name' | 'status' | 'tags'>>,
): Promise<Asset> {
  return requestJson<Asset>(`/api/assets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ version, patch }),
  });
}

export function bulkSetStatus(ids: string[], status: AssetStatus): Promise<BulkResult> {
  return requestJson<BulkResult>('/api/assets/bulk-status', {
    method: 'POST',
    body: JSON.stringify({ ids, status }),
  });
}

export const thumbnailUrl = (id: string) => `${API_BASE}/api/thumb/${id}.svg`;