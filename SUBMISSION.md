# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

**Link:**
https://drive.google.com/file/d/1dMWuPnK80E-pHmimaEY4Wfn0fU1NBseK/view?usp=sharing
---

## How to run it

Requires Node 20.11 or newer. Run `npm install`, then `npm run dev`. The command starts the mock API on `8787` and Vite on `5173`. The default chaos and latency remain enabled. No additional package is required beyond the dependencies already in `package.json`.

## Time spent

Implemented in focused passes across the network client, asset loader, grid, bulk workflow, detail panel, accessibility behavior, styling, and documentation. Runtime performance profiling and a screen-reader pass remain manual follow-up work.

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends more than the API's 50-id limit | `App.tsx` | Fixed: chunks of 50 with three workers |
| 2 | Every search keystroke sends a request | `App.tsx` | Fixed: 280ms debounce |
| 3 | Old responses overwrite newer search results | `useAssets.ts` | Fixed: request ids and cancellation |
| 4 | Obsolete requests are not cancelled | `useAssets.ts` | Fixed: `AbortController` |
| 5 | Cursors are not reset when filters change | `useAssets.ts` | Fixed: query identity drops cursors |
| 6 | Concurrent identical requests are duplicated | `client.ts` | Fixed: in-flight request map |
| 7 | API errors lose their code and retry metadata | `client.ts` | Fixed: `ApiError` preserves code, status, request id, and Retry-After |
| 8 | Transient failures are not retried | `client.ts` | Fixed: capped exponential backoff with jitter |
| 9 | All assets are rendered and selection rerenders every card | `AssetGrid.tsx` | Fixed: bounded window and memoized cards |
| 10 | Pagination stops after the first page | `useAssets.ts` | Fixed: cursor loading on scroll |
| 11 | Missing thumbnails produce broken images | `AssetGrid.tsx`, `AssetDetail.tsx` | Fixed: `hasThumbnail` placeholder |
| 12 | Detail focus, Escape, and return focus are missing | `AssetDetail.tsx`, `AssetGrid.tsx` | Fixed |
| 13 | Bulk updates do not roll back per-item failures | `App.tsx` | Fixed: successful assets remain optimistic; failures restore originals |
| 14 | Version conflicts show raw errors and do not explain recovery | `AssetDetail.tsx` | Fixed: actionable refetch/reopen guidance |
| 15 | No offline state or component error boundary | `App.tsx`, `ErrorBoundary.tsx` | Fixed |
| 16 | Empty, loading, and failure states are conflated | `App.tsx`, `AssetGrid.tsx` | Fixed |

---

## Key decisions

**Data fetching and caching:** Kept the client small and local rather than adding a data library. The request map de-duplicates identical in-flight calls, while the hook owns query-scoped pages and cancellation.

**Stale response handling:** Search input is debounced by 280ms because it absorbs normal typing without making the UI feel delayed. Each query gets an id and an abort controller; only the current id may commit results.

**Virtualization approach:** Used a fixed-height responsive windowed grid with four rows of overscan. This avoids a dependency and keeps the rendered DOM proportional to the viewport. Card geometry is reserved in CSS to avoid layout shift.

**Optimistic updates and rollback:** The visible map changes immediately. Bulk responses replace successful entries with server assets and restore only failed entries. `legal_hold` is reported as non-retryable; `conflict` and transient request failures can be retried.

**Retry and backoff policy:** GET requests retry 503, 429, and network errors up to three attempts; PATCH retries only 500; bulk POST follows the client policy for safe server failures. Delays use jitter and honor `Retry-After`.

**State placement and URL sync:** Filter state is initialized from the URL and written with `replaceState`, so reload/share restores the view without creating a history entry for each keystroke. The cursor stays internal to the active query.

---

## Performance

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | Unmeasured | Designed to stay viewport-bounded | Windowed grid implementation; browser DOM count still needs a profiling pass |
| Cards re-rendered when toggling one selection | All mounted baseline cards | One changed card plus parent bookkeeping | `React.memo` card boundary; React DevTools measurement still needs to be recorded |
| Longest task during sustained scroll | Unmeasured | Unmeasured | Requires a Chrome Performance recording |
| Requests fired while typing a 6-character query | Up to 6 | One after 280ms idle, unless the value changes again | Hook debounce and request map |
| Production bundle, gzipped | Not captured before implementation | 52.28 kB JS, 2.05 kB CSS | `npm run build` output on Node 20.19 / Vite 5.4.21 |

What was the actual bottleneck, and how did you find it?
The principal known bottleneck in the baseline was unbounded rendering and request churn. The implementation addresses both structurally; browser profiler numbers should be captured before submitting the assessment video.


---

## Accessibility

The asset collection uses a grid and gridcell semantics with one roving tabindex. Arrow keys move between cards, Shift+arrows and Shift-click extend a range, Enter opens detail, Space toggles selection, and Escape closes detail. Opening focuses the panel close control; closing returns focus to the originating card. Checkboxes have asset-specific names, selection is exposed with `aria-selected`, status/result/error regions use live status or alert roles, focus is visible, and reduced motion is respected.

I validated the keyboard paths from the implementation and TypeScript build. I did not run a dedicated screen reader or automated accessibility scanner, so that remains a known gap rather than a claimed pass.

---

## Interface decisions

Three or four sentences: what you were optimising for, and the decisions that
follow from it. Then briefly:

The interface is optimized for repeated scanning: a warm paper background, restrained green progression, dense controls, fixed card geometry, and a detail panel that never displaces the grid. 
Statuses use both labels and a marker shape so color is not the only signal. Loading, offline, error, empty, and partial-failure states are explicit and actionable. The visual tokens live at the top of `src/styles.css`; the palette was chosen for readable dark text and high-contrast controls, but an automated WCAG contrast audit remains follow-up work.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

What you deliberately did not do, and what you would do with another day.
No external runtime library was added. Live SSE reconciliation, offline write queuing, automated tests, and a full browser performance/accessibility audit were not completed. The next day would go first to focused tests for stale-response cancellation and bulk rollback, then a real profiler and screen-reader pass.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

The client has to reconstruct retry policy from HTTP status and headers, while bulk failures use a separate per-item code vocabulary. A typed SDK response envelope, explicit idempotency keys for writes, and a server-provided page/cache version would make this safer. The cursor contract is reasonable, but a cursor invalidation response would be easier to recover from than a generic stale-cursor failure.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
The highest-signal areas are 
`src/api/client.ts`, 
`src/features/assets/useAssets.ts`, 
and the bulk rollback path in 
`src/App.tsx`: 
they contain the concurrency, retry, cancellation, and partial-success decisions.





**Built with Ashutosh Maurya ❤️ using React.js + Vite and Typescript**