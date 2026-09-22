# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:**

---

## How to run it

Nothing beyond `npm install && npm run dev` (runs API + Vite via concurrently).
The assessment server must be running **with chaos enabled** — that is the
contract everything here is built against. `npm test` runs the 27-test suite
(vitest + jsdom, no network).

Note on Node: `.nvmrc` pins 20; the harness also runs on Node 21+ (vite 5 +
vitest 3 are compatible).

## Time spent

~13h, roughly:
- ~1.5h reading the brief, server source, and building the defect inventory.
- ~2h harness + data layer + client (typed errors, retry policy).
- ~3h Task 1 (race-proof search, URL state) incl. tests — real bugs found here
  (array-identity cancel key, RTL cleanup) shaped every later test.
- ~2.5h Task 2 (virtualization, selection store, perf methodology + numbers).
- ~2h Task 3 (bulk pipeline, optimistic overlay, undo, 409 handling).
- ~1.5h Task 4 + 5 (offline, boundary, keyboard model).
- ~1h Task 6 + measurements + writeup.

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends every selected id in one call; API rejects >50 | `App.tsx` `applyBulkStatus` | fixed (chunked + pooled) |
| 2 | Search race: an early slow response (`tra`) overwrites a newer query (`trail`) | `useAssets.ts` `.then` | fixed (query-key identity + abort) |
| 3 | No debounce — every keystroke fires a request and trips the 80/10s rate limit | `App.tsx` `onChange` | fixed (300 ms debounce) |
| 4 | No request cancellation; in-flight work keeps burning the rate budget | `useAssets.ts` effect cleanup absent | fixed (AbortSignal) |
| 5 | Errors flattened to a string; cannot distinguish retryable from permanent | `client.ts` `request` | fixed (structured `ApiError`) |
| 6 | No retry, no backoff, no jitter, `Retry-After` ignored (6% 503 / 12% write 500) | `client.ts` | fixed (retry policy) |
| 7 | No de-duplication of identical concurrent requests | `client.ts` | fixed (Query cache dedup) |
| 8 | `getAssetsByIds` ignores the 25-id batch cap | `client.ts` | avoided — the UI only ever requests one id (detail panel prev/next), so the cap never triggers |
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

**Data fetching and caching.** React Query owns every request lifecycle because
it already solves the hard 10% — cache identity, dedup, refetch, GC — with a
well-tested core, and the assessment's pain is the client, not the stack.
Rejected: writing a bespoke cache or wiring Astronaut's `useAssets` into a plain
effect. The client wrapper (`src/api/client.ts`) is dependency-free Node/DOM
`fetch` with structured errors, so the data layer has no framework coupling.

**Stale response handling.** In `src/features/assets/useAssetFeed.ts`, every
query is keyed by a stable identity of (query, status, sort). A resolving
response updates only its own query-key entry and can never publish into a
different key — so an out-of-order response for a superseded filter is dropped
by TanStack Query's query-key identity. The hook additionally
`cancelQueries`s the key being left (via AbortSignal) so a stale in-flight
request doesn't keep burning the rate budget. That pair — key identity + abort
— closes the "`tra` resolves after `trail`" search race; defense in depth,
because cancel is not guaranteed (the signal may arrive as the response lands).

**Virtualization approach.** `@tanstack/react-virtual` with *rows as the virtual
unit* rather than items. Cards are a fixed 244 px row height (140 px thumbnail +
clamped two-line body), so the size estimator is a constant (`estimateSize: () =>
ROW_HEIGHT`) and there's deliberately no `measureElement` hookup or measurement
pass — rows never resize, so the offset math stays exact and nothing causes a
measurement jump while scrolling. A `ResizeObserver` re-derives columns from
real card width without a `window` resize listener. Rejected: infinite-scroll via `IntersectionObserver` (doesn't
solve DOM growth), every-row-renders libraries like `react-window` grids were
ruled out by the no-prebuilt-grid constraint. Virtualizer is ~9 kB gz of the
bundle delta.

**Optimistic updates and rollback.** Bulk status changes apply instantly
(chunky: 50 ids per call, 3 concurrent). Confirmed-success assets are patched
into cached feeds (the row updates *stay*), failed ids are reverted to their
real status. Undo is a store-level overlay: on new optimistic values it patches
the pages *and* the panel; on failure or undo it clears the overlay and replays
each server's true status (or 409s itself → re-fetch that id). Detail-panel saves
are **not** optimistic — a `409 version_conflict` means a bulk op beat the user;
the panel re-fetches that asset rather than clobbering it. Optimistic-with-undo
was chosen over pessimistic-lock disco because the API gives us no version lock
on the bulk endpoint.

**Retry and backoff policy.** One policy in `src/lib/retry.ts`, applied to both
reads and writes: 3 attempts max (1 initial + 2 retries), `Retry-After` honoured
whenever the server sends it, else exponential backoff `500 ms × 2^attempt` with
full jitter (×0.5–1.0), capped at 8 s — deliberately under the 10 s rate
budget. Only `429`, `503`, `500`, and network-type failures (`TypeError`) are
retried; `400`/`409`/`422` and everything else are terminal — those are our own
bugs, not the server's. Rejected: reflexively retrying everything (burns the
rate budget twice) or using React Query's built-in retry (same hook, but one
code path is easier to test than two knobs).

**State placement and URL sync.** Selection, focus, anchor, and bulk-busy live in
a small zustand store (atomic selectors → only the toggled card re-renders; no
context re-render storm on each `keydown`/toggle). Query + status + sort are in
the URL (`searchParams`), restored on load and pushState'd on change — linkable
UI, back/forward works, and it's the single source of truth for fetching.
Rejected: putting filter state in the store too (would have split state and made
the URL a mirror rather than the source).

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
| Production bundle, gzipped | 48.30 kB | **85.68 kB** (267 kB raw) | `vite build`: baseline vs current. Delta = TanStack Query + Router + zustand + virtual-core (~37 kB gz). CSS 19.97 kB raw / 5.08 kB gz on top |
| Requests fired while typing a 6-char query | 6 (one per keystroke) | **1** | vitest: 300 ms debounce + coalescing assertion (no `q=tra` request when typing `trail`) |
| Longest task during sustained scroll | — | **81 ms** (2 long tasks, 133 ms total over 40 scroll cycles) | `PerformanceObserver('longtask')` during the CDP scroll loop |

Boundedness is structural, not tuned: 2,000-item single page renders < 300
cards in the automation test, and the browser run holds ~27 cards regardless of
whether 24 or 600 are loaded, because only viewport rows (±3 overscan) exist in
the DOM. The bind in the scroll loop was the backend rate limit (25 pages in
~18.5 s = 15 successful fetches, each a few seconds of chaos latency/backoff),
which the 80 req/10s budget and per-retry backoff cap deliberately respect.

Bundle size is the honest cost of the prize: for the assessment surface there
is no way to reach 12,400 assets without row virtualization paying back far
more than 85 kB of JS.

What was the actual bottleneck: the API itself — latency (90–350 ms), 6%
503s with `Retry-After: 2`, and a 80-req/10s budget that retries consume too,
all surfaced by the decision to run against the real hostile server from the
first commit rather than a happy-path mock, and by reading the status-code
distribution in the server source before writing any retry logic.

---

## Accessibility

**Keyboard model.** The grid is a three-state roving-tabindex grid (ARIA grid /
tables pattern); no hidden stops, no focus trap: exactly one card is always
tabbable (the focused card, or the lead card on a fresh filter). Arrow keys move
2D through the virtual matrix, Home/End jump to first/last row, Shift+Arrow and
Space extend/contract a selection **anchored at the keypress position** (fixing
AIRA's broken anchor-after-range) while plain Space toggles. `data-asset-id`
identifies cells; a click also focuses first, matching the "clicked card is the
entry point for arrows" model. Enter or a click opens the detail panel, which
**returns focus to the originating card** on close (Escape too) — so the roving
index stays honest. Filter/status/sort changes silently reset navigation to the
lead card instead of leaving focus stranded on a card that no longer exists. A
`sr-only` live region announces selection changes and bulk outcomes; checkbox
inputs sit inside each card for assistive-tech selection.

**How it was tested.** 4 keyboard tests in `keyboard.test.tsx` (roving
tabindex + arrow movement, Shift+Arrow multi-select anchored at the last
toggle, panel open → Escape returning focus to the originating card, and the
`sr-only` live-region announcement), the full 27-test suite, plus a manual
pass against a real browser grid before Task 5 landed. No screen-reader pass —
dev-only. The mock row layout (1200×800) also means tests pin columns=5, so the
grid math is asserted, not just arrows.

**Known gaps.** The checkbox remains nested inside the `<button>` card (nonstandard
nested interactive content — clickable at the DOM level, but not ideal for every
screen reader's button/checkbox interaction model); the arrows move on `keydown`
without a visual focus-ring transition; the detail panel is a simple slide-over,
not a dialog role. All three are future polish rather than defects in depth.

---

## Interface decisions

Optimising for: on a 12,400-item library, the *feed itself* must
feel fast and the statuses must read at a glance — so the grid gets the visual
budget (elevation, cinematic thumbnails, quiet glass text) and the toolbar is
deliberately flatter. All decisions live as tokens in `styles.css` (ink/soft/
line/bg/accent/danger, status progression, shape/space/elevation, type stack,
motion); the component layer uses only those tokens and never invents a colour,
radius, or spacing inline.

- **Visual system.** Baseline was MUI-blue on white with table borders; here
  statuses own the colour budget: a near-ink on warm paper, so approved/bulk
  accents pop against an otherwise quiet surface. Type is a system stack
  (`--font-ui: system-ui…`) with a mono `font-mono` for asset IDs/versions —
  editable id in a mono face signals "this is a raw value". Cards are 16px
  radius (`--radius-md`), 1px `--line` hairline, 140px thumbnails, hover lifts with a soft
  shadow.
- **Status treatment.** Statuses are a *progression* (draft → review → approved
  → archived), each owning ink/bg/border pairs and a shape glyph (○ ◐ ✓ ▣) that
  reads without colour and without the label. The progression also behaves:
  `in_review` is the loudest (open ends, a candidate to act on), approved stays
  quiet (work is done), archived dims the thumbnail to grayscale so it reads as
  "out of rotation".
- **States.** Distinct UI for loading (skeleton cards with a CSS shimmer that
  `prefers-reduced-motion` kills), empty (explanatory copy + the search box
  pre-focused), failure ("Something went wrong" + reason, retry offered, retry
  count shown), offline (top banner with live reconnect), and partial failure
  (bulk partial results are surfaced with an undo affordance, never swallowed).
- **Contrast.** Measured against WCAG AA 4.5:1 (text) and 3:1 (non-text).
  `--accent` (indigo) checks 6:1+ on both dark and light uses; body `--ink-soft`
  raised to ~5.6:1; control borders `--control-border` at ~3:1 present even
  when focused so the grid never looks chrome-less; status text pairs check
  6–13:1; focus is a 2px accent outline.
- **Copy.** Every user-facing string names what happened and what's next: the
  live count reads "24 of 12,400 shown", empty is "No assets match these
  filters — try a different search or widen the status filter.", failures
  offer "Retry" / "Try again", bulk outcomes are "3 updated to approved.",
  and offline is "You're offline — showing what was already loaded. Reconnect
  and I'll refresh the list." Nothing blames the user or the sandbox.

---

## Trade-offs and cuts

- **No optimistic UI for detail-panel *edits*** — only bulk ops are optimistic.
  A corrupt parallel-edit story (409) is recoverable by re-fetch, so pessimism
  here is the cheaper bug. Bulk was made optimistic because every row consumed
  a rare API call and the whole feature degrades to "click, wait, click".
- **Selection semantics.** Cursor = toggle-at-position (Space/click), but only
  Shift+Arrow extends; there's no "select first N" drag precedent. Fine for the
  brief, but a visible "selected N / clear" chip would be a better cross-ref.
- **No persistence of selection, filters, or live-region log** beyond URL — out
  of scope for the assessment, but the obvious "add another day" item.
- **Rate-limit budget is deliberately wasted** by the 25-page prefetch during a
  scroll (one 503 per page during chaos) because the bind was the API, not the
  grid; a coalescing scroll fetch (one cursor per ~600 ms) would halve it.
- **Bundle.** Virtualization + Query + router cost ~37 kB gz over baseline;
  accepted as the price of reaching this dataset, but worth a code-split/route-
  level lazy import if this were long-lived.
- **Reduced-motion** honours only the animation threshold — full colour-contrast
  presets (high-contrast mode) are not implemented.

## Critique of the API

- **Bulk mutations have no version locking** — every id is a plain status write,
  so "edit then bulk" or two bulk calls race to the same asset with no
  conflict signal. The client patches optimistically and cannot detect whether
  the write landed on a stale version. A per-id version/etag on bulk (echoing
  the PATCH contract) would make optimistic->reconcile honest.
- **Endpoint shape is inconsistent**: PATCH mutates one asset and returns the
  asset; bulk-set mutates many and returns a 207 result list; paths/methods for
  reads use a search *cursor* (`stale_cursor`) while the id-search path is a
  hard 25-cap. Three data shapes plus two pagination models forced a lot of
  wrappers that a single `cursor`-plus-`ids` contract would have removed.
- **Error body varies** between `{error:{code,message}}`, plain `message`, and
  TCP dropouts with no body; the client has to sniff three shapes and treats
  empty responses as retryable. A single error envelope with a
  `retryable: boolean` flag would have deleted a whole branch of `retry.ts`.
- **Chaos mode makes the sandbox impossible to use calmly** — 503s land on the
  *first* page more than once per reload, which is honest but means "the app is
  slow" is often "the sandbox is chaos-ing right now".
- **`Retry-After` is only present on 503** — 429 gives no window, and the 429
  client can't know how long before the budget refills; the app infers it.

## Anything you would like us to look at

1. **`useAssetFeed.ts` stale-response guard** (`src/features/assets/useAssetFeed.ts`)
   — query-key identity + `cancelQueries` on key leave, which together close the
   search race; I'd like a reviewer to stress this against a mock server.
2. **`bulk.ts` overlay/apply/rollback** (`src/features/assets/bulk.ts`) — the
   store-level optimistic overlay with patch-and-replay: I believe it's
   correct but it juggles three state sources (overlay, cache, store) and any
   simplification that keeps both invariants is welcome.
3. **The card-is-a-button-with-a-checkbox-in-it** a11y compromise — I know it's
   nonstandard; I'd genuinely like your take on whether the "click card to open,
   click check to select" affordance justifies it over a `role=button` scaffold.
4. **Perf numbers** — methodology is in the Performance section (CDP-driven,
   real Chromium, chaos on); happy to re-run against anything the reviewer can
   point at.
