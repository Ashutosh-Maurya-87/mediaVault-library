import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { thumbnailUrl } from '@/api/client';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import type { Asset } from '@/lib/types';

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onSelectRange: (startId: string, endId: string) => void;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
  loadingMore: boolean;
}

const ROW_HEIGHT = 284;
const MIN_CARD_WIDTH = 230;

interface CardProps {
  asset: Asset;
  selected: boolean;
  active: boolean;
  tabIndex: number;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onShiftClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
}

const AssetCard = memo(function AssetCard({
  asset,
  selected,
  active,
  tabIndex,
  onToggleSelect,
  onOpen,
  onShiftClick,
  onKeyDown,
  onFocus,
}: CardProps) {
  return (
    <div
      className={'card' + (selected ? ' card--selected' : '') + (active ? ' card--active' : '')}
      data-asset-id={asset.id}
      role="gridcell"
      aria-selected={selected}
      tabIndex={tabIndex}
      onClick={(event) => { if (event.shiftKey) onShiftClick(); else onOpen(asset.id); }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {asset.hasThumbnail ? (
        <img className="card__thumb" src={thumbnailUrl(asset.id)} alt="" loading="lazy" />
      ) : (
        <div className="card__thumb card__thumb--missing" aria-hidden="true">No preview</div>
      )}
      <div className="card__body">
        <p className="card__name">{asset.name}</p>
        <p className="muted">
          {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
        </p>
        <span className={`pill pill--${asset.status}`}>{statusLabel(asset.status)}</span>
      </div>
      <input
        type="checkbox"
        className="card__check"
        checked={selected}
        aria-label={`Select ${asset.name}`}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggleSelect(asset.id)}
      />
    </div>
  );
});

export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  onToggleSelect,
  onSelectRange,
  onOpen,
  onLoadMore,
  loadingMore,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [columns, setColumns] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [anchorIndex, setAnchorIndex] = useState(0);

  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const updateColumns = () => setColumns(Math.max(1, Math.floor((element.clientWidth - 32) / MIN_CARD_WIDTH)));
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (focusedIndex >= assets.length) setFocusedIndex(Math.max(0, assets.length - 1));
  }, [assets.length, focusedIndex]);

  const rows = Math.ceil(assets.length / columns);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const lastRow = Math.min(rows, firstRow + Math.ceil((gridRef.current?.clientHeight ?? 600) / ROW_HEIGHT) + 4);
  const visibleAssets = useMemo(
    () => assets.slice(firstRow * columns, lastRow * columns),
    [assets, columns, firstRow, lastRow],
  );

  function focusIndex(index: number) {
    const bounded = Math.max(0, Math.min(assets.length - 1, index));
    setFocusedIndex(bounded);
    const asset = assets[bounded];
    if (asset) cardRefs.current.get(asset.id)?.focus();
  }

  function handleKeyDown(index: number, event: ReactKeyboardEvent<HTMLDivElement>) {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex += 1;
    else if (event.key === 'ArrowLeft') nextIndex -= 1;
    else if (event.key === 'ArrowDown') nextIndex += columns;
    else if (event.key === 'ArrowUp') nextIndex -= columns;
    else if (event.key === 'Enter') {
      event.preventDefault();
      const asset = assets[index];
      if (asset) onOpen(asset.id);
      return;
    } else if (event.key === ' ') {
      event.preventDefault();
      const asset = assets[index];
      if (asset) onToggleSelect(asset.id);
      setAnchorIndex(index);
      return;
    } else {
      return;
    }
    event.preventDefault();
    if (nextIndex < 0 || nextIndex >= assets.length) return;
    const nextAsset = assets[nextIndex];
    const anchorAsset = assets[anchorIndex];
    if (!nextAsset || !anchorAsset) return;
    if (event.shiftKey) onSelectRange(anchorAsset.id, nextAsset.id);
    else setAnchorIndex(nextIndex);
    focusIndex(nextIndex);
  }

  if (assets.length === 0) {
    return (
      <div className="empty" role="status">
        <p>Nothing matches these filters.</p>
        <p className="muted">Clear the search or widen the filters.</p>
      </div>
    );
  }

  return (
    <div
      ref={gridRef}
      className="grid"
      role="grid"
      aria-label="Media assets"
      aria-rowcount={rows}
      onScroll={(event) => {
        const element = event.currentTarget;
        setScrollTop(element.scrollTop);
        if (element.scrollTop + element.clientHeight >= element.scrollHeight - ROW_HEIGHT * 3) onLoadMore();
      }}
    >
      <div className="grid__canvas" style={{ height: rows * ROW_HEIGHT }}>
        {visibleAssets.map((asset, visibleIndex) => {
          const index = firstRow * columns + visibleIndex;
          const column = index % columns;
          const row = Math.floor(index / columns);
          return (
            <div
              className="grid__item"
              key={asset.id}
              style={{
                top: row * ROW_HEIGHT,
                left: `${(column * 100) / columns}%`,
                width: `${100 / columns}%`
              }}
            >
              <div ref={(element) => { if (element) cardRefs.current.set(asset.id, element); else cardRefs.current.delete(asset.id); }}>
                <AssetCard
                  asset={asset}
                  selected={selectedIds.has(asset.id)}
                  active={activeId === asset.id}
                  tabIndex={focusedIndex === index ? 0 : -1}
                  onToggleSelect={onToggleSelect}
                  onOpen={onOpen}
                  onShiftClick={() => {
                    const anchorAsset = assets[anchorIndex];
                    if (anchorAsset) onSelectRange(anchorAsset.id, asset.id);
                  }}
                  onKeyDown={(event) => handleKeyDown(index, event)}
                  onFocus={() => setFocusedIndex(index)}
                />
              </div>
            </div>
          );
        })}
      </div>
      {loadingMore && <div className="grid__loading" role="status">Loading more assets...</div>}
    </div>
  );
}
