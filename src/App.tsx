import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, bulkSetStatus } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssets } from '@/features/assets/useAssets';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetKind, AssetQuery, AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const KINDS: AssetKind[] = ['image', 'video', 'document'];
const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A-Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const validStatuses = STATUSES.filter((status) => params.get('status')?.split(',').includes(status));
  const validKinds = KINDS.filter((kind) => params.get('kind')?.split(',').includes(kind));
  const sort = SORTS.some((option) => option.value === params.get('sort'))
    ? params.get('sort') as NonNullable<AssetQuery['sort']>
    : 'updatedAt:desc';
  return {
    q: params.get('q') ?? '',
    status: validStatuses,
    kind: validKinds,
    tag: params.get('tag')?.split(',').filter(Boolean) ?? [],
    sort,
  };
}

function userMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'version_conflict') return 'This asset changed elsewhere. Reload its details, then try again.';
    if (error.code === 'rate_limited') return 'The library is busy. We will try again shortly.';
    if (error.code === 'network_error') return 'The connection was interrupted. Check your network and try again.';
    if (error.code === 'upstream_unavailable') return 'The asset service is temporarily unavailable. Please try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

interface Failure {
  id: string;
  code: string;
  message: string;
  retryable: boolean;
  status: AssetStatus;
}

export function App() {
  const initial = useMemo(readUrlState, []);
  const [q, setQ] = useState(initial.q);
  const [debouncedQ, setDebouncedQ] = useState(initial.q);
  const [status, setStatus] = useState<AssetStatus[]>(initial.status);
  const [kind, setKind] = useState<AssetKind[]>(initial.kind);
  const [tagInput, setTagInput] = useState(initial.tag.join(', '));
  const [sort, setSort] = useState<NonNullable<AssetQuery['sort']>>(initial.sort);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [optimistic, setOptimistic] = useState<Map<string, Asset>>(new Map());
  const [offline, setOffline] = useState(!navigator.onLine);
  const focusReturnId = useRef<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQ(q);
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [q]);

  const tags = useMemo(() => tagInput.split(',').map((tag) => tag.trim()).filter(Boolean), [tagInput]);
  const query = useMemo<AssetQuery>(() => ({
    q: debouncedQ, status, kind, tag: tags, sort, limit: 48
  }), [debouncedQ, kind, sort, status, tags]);
  const assetsState = useAssets(query);
  const displayedItems = useMemo(
    () => assetsState.items.map((asset) => optimistic.get(asset.id) ?? asset),
    [assetsState.items, optimistic],
  );

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status.length) params.set('status', status.join(','));
    if (kind.length) params.set('kind', kind.join(','));
    if (tags.length) params.set('tag', tags.join(','));
    if (sort !== 'updatedAt:desc') params.set('sort', sort);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
  }, [kind, q, sort, status, tags]);

  useEffect(() => {
    const setConnection = () => setOffline(!navigator.onLine);
    window.addEventListener('online', setConnection);
    window.addEventListener('offline', setConnection);
    return () => {
      window.removeEventListener('online', setConnection);
      window.removeEventListener('offline', setConnection);
    };
  }, []);

  useEffect(() => {
    if (assetsState.items.length === 0) return;
    setSelectedIds((current) => new Set([...current].filter((id) => assetsState.items.some((asset) => asset.id === id))));
  }, [assetsState.items]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectRange = useCallback((startId: string, endId: string) => {
    const start = assetsState.items.findIndex((asset) => asset.id === startId);
    const end = assetsState.items.findIndex((asset) => asset.id === endId);
    if (start < 0 || end < 0) return;
    const [from, to] = start < end ? [start, end] : [end, start];
    setSelectedIds((current) => {
      const next = new Set(current);
      assetsState.items.slice(from, to + 1).forEach((asset) => next.add(asset.id));
      return next;
    });
  }, [assetsState.items]);

  const selectAllLoaded = useCallback(() => {
    setSelectedIds(new Set(assetsState.items.map((asset) => asset.id)));
  }, [assetsState.items]);

  const applyBulkStatus = useCallback(async (nextStatus: AssetStatus, retryIds?: string[]) => {
    const ids = retryIds ?? [...selectedIds];
    if (ids.length === 0 || offline) return;
    const original = new Map(assetsState.items.filter((asset) => ids.includes(asset.id)).map((asset) => [asset.id, asset]));
    setFailures([]);
    setNotice(null);
    setOptimistic((current) => {
      const next = new Map(current);
      ids.forEach((id) => {
        const asset = original.get(id) ?? assetsState.items.find((item) => item.id === id);
        if (asset) next.set(id, { ...asset, status: nextStatus });
      });
      return next;
    });

    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += 50) chunks.push(ids.slice(index, index + 50));
    const pending = [...chunks];
    const collected: Failure[] = [];
    const worker = async () => {
      while (pending.length) {
        const chunk = pending.shift();
        if (!chunk) return;
        try {
          const result = await bulkSetStatus(chunk, nextStatus);
          result.results.forEach((item) => {
            if (item.ok) {
              setOptimistic((current) => new Map(current).set(item.id, item.asset));
            } else {
              collected.push({ id: item.id, code: item.code, message: item.message ?? 'The server rejected this change.', retryable: item.code === 'conflict', status: nextStatus });
              setOptimistic((current) => {
                const next = new Map(current);
                const prior = original.get(item.id);
                if (prior) next.set(item.id, prior); else next.delete(item.id);
                return next;
              });
            }
          });
        } catch (error) {
          chunk.forEach((id) => collected.push({ id, code: error instanceof ApiError ? error.code : 'network_error', message: userMessage(error), retryable: true, status: nextStatus }));
          setOptimistic((current) => {
            const next = new Map(current);
            chunk.forEach((id) => { const prior = original.get(id); if (prior) next.set(id, prior); else next.delete(id); });
            return next;
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, () => worker()));
    setFailures(collected);
    setSelectedIds(new Set());
    setNotice(collected.length ? `${ids.length - collected.length} updated. ${collected.length} need attention.` : `${ids.length} assets updated.`);
  }, [assetsState.items, offline, selectedIds]);

  function closeDetail() {
    const id = focusReturnId.current;
    setActiveId(null);
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-asset-id="${id}"]`)?.focus(), 0);
  }

  function handleSaved(asset: Asset) {
    setOptimistic((current) => new Map(current).set(asset.id, asset));
  }

  const errorText = assetsState.error ? userMessage(assetsState.error) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Media library</p>
          <h1>MediaVault</h1>
        </div>
        <label className="search-wrap">
          <span className="sr-only">Search assets</span>
          <input className="search"
            type="search"
            placeholder="Search by name or tag"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </label>
        <label className="control"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>{SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </header>

      <div className="filters" aria-label="Asset filters">
        <div className="filter-group"><span className="filter-label">Status</span>{STATUSES.map((value) => <label key={value}><input type="checkbox" checked={status.includes(value)} onChange={(event) => setStatus((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} />{statusLabel(value)}</label>)}</div>
        <label className="control"><span>Kind</span><select value={kind[0] ?? ''} onChange={(event) => setKind(event.target.value ? [event.target.value as AssetKind] : [])}><option value="">All kinds</option>{KINDS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="control control--tag"><span>Tags</span><input value={tagInput} placeholder="hero, raw" onChange={(event) => setTagInput(event.target.value)} /></label>
        <span className="result-count" role="status">{assetsState.loading ? 'Loading assets...' : `${displayedItems.length} of ${assetsState.total.toLocaleString()} shown`}</span>
      </div>

      {offline && <div className="banner banner--offline" role="alert">You are offline. Reading and saving will resume when the connection returns.</div>}
      {errorText && <div className="banner banner--error" role="alert"><span>{errorText}</span><button onClick={assetsState.refresh}>Try again</button></div>}
      {notice && <div className="banner" role="status">{notice}</div>}
      {failures.length > 0 && <div className="failure-list" role="status"><strong>Unchanged assets:</strong> {failures.map((failure) => `${failure.id} (${failure.message})`).join('; ')} {failures.some((failure) => failure.retryable) && <button onClick={() => { const retryable = failures.filter((failure) => failure.retryable); const first = retryable[0]; if (first) void applyBulkStatus(first.status, retryable.map((failure) => failure.id)); }}>Retry retryable failures</button>}</div>}

      {selectedIds.size > 0 &&
        <div className="bulkbar" aria-label="Bulk actions">
          <strong>{selectedIds.size} selected</strong>
          <button onClick={selectAllLoaded}>Select all loaded ({assetsState.items.length})</button>
          {STATUSES.map((value) => <button key={value}
            disabled={offline}
            onClick={() => void applyBulkStatus(value)}>Set {statusLabel(value).toLowerCase()}</button>)}
          <button onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>}

      <main className="content">
        {assetsState.loading && assetsState.items.length === 0 ?
          <div className="loading-state" role="status">Loading library...</div> :
          <AssetGrid
            assets={displayedItems}
            selectedIds={selectedIds}
            activeId={activeId}
            onToggleSelect={toggleSelect}
            onSelectRange={selectRange}
            onOpen={(id) => { focusReturnId.current = id; setActiveId(id); }}
            onLoadMore={assetsState.loadMore}
            loadingMore={assetsState.loadingMore}
          />}
        {activeId && <AssetDetail id={activeId} onClose={closeDetail} onSaved={handleSaved} />}
      </main>
    </div>
  );
}
