# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:**

---

## How to run it

Anything we need to know beyond `npm install && npm run dev`.

## Time spent

Roughly, and how you split it.

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends every selected id in one call; API rejects >50 | `App.tsx` `applyBulkStatus` | fixed (chunked + pooled) |
| 2 | Search race: an early slow response (`tra`) overwrites a newer query (`trail`) | `useAssets.ts` `.then` | fixed (keyed cache) |
| 3 | No debounce — every keystroke fires a request and trips the 80/10s rate limit | `App.tsx` `onChange` | fixed (300 ms debounce) |
| 4 | No request cancellation; in-flight work keeps burning the rate budget | `useAssets.ts` effect cleanup absent | fixed (AbortSignal) |
| 5 | Errors flattened to a string; cannot distinguish retryable from permanent | `client.ts` `request` | fixed (structured `ApiError`) |
| 6 | No retry, no backoff, no jitter, `Retry-After` ignored (6% 503 / 12% write 500) | `client.ts` | fixed (retry policy) |
| 7 | No de-duplication of identical concurrent requests | `client.ts` | fixed (Query cache dedup) |
| 8 | `getAssetsByIds` ignores the 25-id batch cap | `client.ts` | fixed (chunked; unused by UI) |
| 9 | Renders every fetched row; DOM grows with the dataset (12,400 items) | `AssetGrid.tsx` `.map` | fixed (virtualized) |
| 10 | Selection toggle re-renders every card in the grid | `AssetGrid.tsx` / `App.tsx` state | fixed (zustand atomic selector + memo) |
| 11 | Grid not keyboard-operable; cards are plain `div` with `onClick` | `AssetGrid.tsx:37` | fixed (roving tabindex grid) |
| 12 | Thumbnails loaded eagerly; `hasThumbnail` ignored; 404 breaks layout | `AssetGrid.tsx:39` | fixed (lazy + placeholder) |
| 13 | Loading / empty / error states indistinguishable — a failure shows "Nothing matches" | `AGrid` empty branch / `useAssets` | fixed (distinct states) |
| 14 | Query state (`q`, status, sort) not in the URL; no share/restore | `App.tsx` `useState` | fixed (searchParams) |
| 15 | Detail panel breaks focus (no focus-on-open, no return, no Escape), raw error strings, `409 version_conflict` unhandled | `AssetDetail.tsx` | fixed (Task 3/5) |
| 16 | Saved edits never update the grid (`handleSaved` no-op) | `App.tsx:51` | fixed (cache + overlay) |
| 17 | `stale_cursor` surfaced to users; cursor not reset on filter change (baseline has no cursor) | `useAssets.ts` | fixed (cursor dropped with query) |
| 18 | No error boundary, no offline handling, no live regions for screen readers | root / `App.tsx` | fixed (Task 4/5) |

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching**

**Stale response handling**

**Virtualization approach**

**Optimistic updates and rollback**

**Retry and backoff policy**

**State placement and URL sync**

---

## Performance

Measured 2026-09-21. Bundle: `npm run build` (Vite 5.4, React 18.3). Interaction
metrics: headless Google Chrome (real Chromium out-of-process compositing, no
CPU throttle) against the local assessment server with chaos enabled
(12,400 assets, 90–350 ms latency, 503/500 injection, 80 req/10s limit), driven
over the Chrome DevTools Protocol. Production build served by `vite preview`
equivalent (dev server).

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 600 rows loaded | ~1,400 (est., 600 naive cards) | **233** (27 cards, 9 rows) | CDP: scrolled feed until caption read "600 of 12,400 shown", then `document.getElementsByTagName('*').length` |
| Cards re-rendered when toggling one selection | All ~28 visible cards (App-level `Set` state) | **1** (the toggled card), by construction | zustand atomic selector `useAssetUi(s => s.selected.has(id))` + `memo`; append/toggle re-renders only subscribers |
| Longest task during sustained scroll | — | **81 ms** (2 long tasks, 133 ms total over 40 scroll cycles) | `PerformanceObserver('longtask')` during the CDP scroll loop |
| Requests fired while typing a 6-char query | 6 (one per keystroke) | **1** | vitest: 300 ms debounce + coalescing assertion (no `q=tra` request when typing `trail`) |
| Production bundle, gzipped | 48.30 kB | **82.75 kB** (258 kB raw) | `vite build`: baseline vs current. Delta = TanStack Query (~38 kB gz incl. virtual-core, router, zustand) |

Boundedness is structural, not tuned: 2,000-item single page renders < 300
cards in the automation test, and the browser run holds ~27 cards regardless of
whether 24 or 600 are loaded, because only viewport rows (±3 overscan) exist in
the DOM. The bind in the scroll loop was the backend rate limit (25 pages in
~18.5 s = 15 successful fetches, each a few seconds of chaos latency/backoff),
which the 80 req/10s budget and per-retry backoff cap deliberately respect.

Bundle size is the honest cost of the prize: for the assessment surface there
is no way to reach 12,400 assets without row virtualization paying back far
more than 82 kB of JS.

What was the actual bottleneck: the API itself — latency (90–350 ms), 6%
503s with `Retry-After: 2`, and a 80-req/10s budget that retries consume too,
all surfaced by the decision to run against the real hostile server from the
first commit rather than a happy-path mock, and by reading the status-code
distribution in the server source before writing any retry logic.

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

---

## Interface decisions

Three or four sentences: what you were optimising for, and the decisions that
follow from it. Then briefly:

- **Visual system.** Your colour, spacing and type decisions, and where they live.
- **Status treatment.** How the four statuses read as a progression, and how they
  stay distinguishable without relying on colour.
- **States.** What you did with loading, empty, error, offline and partial
  failure.
- **Contrast.** What you checked against, and with what.
- **Copy.** Any user-facing message you rewrote and why.

Screenshots in the repo are welcome — link them here.

---

## Trade-offs and cuts

What you deliberately did not do, and what you would do with another day.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
