import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listAssets } from '@/api/client';
import type { Asset, AssetQuery } from '@/lib/types';

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
}

const initialState: State = {
  items: [],
  total: 0,
  nextCursor: null,
  loading: true,
  loadingMore: false,
  error: null,
};

function queryKey(query: AssetQuery): string {
  const { cursor: _cursor, ...filters } = query;
  return JSON.stringify(filters);
}

export function useAssets(query: AssetQuery) {
  const [state, setState] = useState<State>(initialState);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const queryIdentity = useMemo(() => queryKey(query), [query]);

  const loadPage = useCallback(async (cursor: string | null, append: boolean, id: number) => {
    const nextQuery = cursor ? { ...query, cursor } : { ...query };
    try {
      const page = await listAssets(nextQuery, controller.current?.signal);
      if (requestId.current !== id) return;
      setState((current) => ({
        items: append ? [...current.items, ...page.items] : page.items,
        total: page.total,
        nextCursor: page.nextCursor,
        loading: false,
        loadingMore: false,
        error: null,
      }));
    } catch (error) {
      if (requestId.current !== id || (error instanceof DOMException && error.name === 'AbortError')) return;
      setState((current) => ({ ...current, loading: false, loadingMore: false, error }));
    }
  }, [query]);

  useEffect(() => {
    const id = ++requestId.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setState({ ...initialState });
    const timer = window.setTimeout(() => void loadPage(null, false, id), query.q?.trim() ? 280 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
    };
  }, [loadPage, queryIdentity]);

  const loadMore = useCallback(() => {
    if (state.loading || state.loadingMore || !state.nextCursor) return;
    const id = requestId.current;
    setState((current) => ({ ...current, loadingMore: true }));
    void loadPage(state.nextCursor, true, id);
  }, [loadPage, state.loading, state.loadingMore, state.nextCursor]);

  const refresh = useCallback(() => {
    controller.current?.abort();
    const id = ++requestId.current;
    controller.current = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));
    void loadPage(null, false, id);
  }, [loadPage]);

  return { ...state, loadMore, refresh };
}
