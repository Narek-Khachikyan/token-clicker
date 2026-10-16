# CODING_STANDARDS.md

Read before your first edit or code review. `AGENTS.md` names the five invariants; this file holds
their mechanism and every other rule that attaches to code. The tree is the source of truth: where
this file disagrees with it, fix this file in the same change.

## Invariants in detail

1. **Save.** Read `src/economy/state.ts` (`GameState`, `newGame(now)`, `SAVE_VERSION`) and
   `save.ts` (`migrate`, `MIGRATIONS`, import/export, the `CORRUPT_SAVE_KEY` quarantine) together.
   `migrate` silently drops model, upgrade and perk ids that have left the catalog; `importSave`
   rejects a whole export over one bad `generation`; a `SAVE_VERSION` bump with no matching
   `MIGRATIONS` entry rewrites old saves. Nothing in the repo recovers a lost run, so the migration
   and its test land in the same commit as the change.
2. **Offline.** Any gap past `OFFLINE_THRESHOLD_SEC` goes through `applyOffline` and its cap: a
   background tab or a sleeping laptop hands `advanceTime` a huge `dt`. Let `lastTick` drift from an
   income mutation, or skip the cap, and hours of income are silently created or destroyed.
3. **Balance.** Within a Поколение, cost and income strictly increase with Ранг, and every Модель's
   payback (cost ÷ income) stays within 3× of every other in its Поколение — the bound that keeps
   the Флагман, the only key to Престиж, reachable. Each Поколение scales ×1000; the real price
   bends cost within ±30% only, and speed is reference-only. `catalog.ts` is ADR-0001 in code
   (`buildCatalog`, `GEN_SCALE`, `MOD_SPREAD`, `PRESTIGE_DIVISOR_UNITS`). Before changing the
   ladder, run `tools/sim.ts`: the real engine with no renderer, printing when each milestone
   lands; its header gives the flags, and it runs under `npx tsx`, which is not a declared
   dependency.
4. **AA data.** The snapshot is public (see Снимок in `CONTEXT.md`). `npm run sync:aa` is
   maintainer-only and takes the key inline or from a gitignored `.env`. Vite hands only
   `VITE_`-prefixed variables to the bundle, so the key stays unprefixed and out of `index.html`.
   To override a number, `pin` it on the seed rather than hand-editing the JSON. The attribution
   stays in `Footer.tsx` and the shop's «Справка AA»; monetization would additionally need a
   commercial AA license.
5. **Russian.** The avoided synonyms — монета, тап, здание, юнит, сессия — stay out of
   player-facing text, identifiers and commit messages. `src/economy/economy.test.ts` enforces them
   over the glossary, `src/economy/quips.test.ts` over the quip table.

## Where each rule lives

```
App.tsx        the shell and the only game clock
  └─ store/useGameStore   the only mutable owner, the only side effects
      └─ economy/         every rule, pure, free of React and the DOM
data/          content tables, never logic
components/    presentation: reads state, calls actions
```

- **Money math lives in `src/economy/`.** Components get every number by calling it; only the store
  and `src/economy/` construct or change `GameState`. Anything that needs a side effect (a sound, a
  toast, a write) is a store action, covered in `useGameStore.test.ts`.
- **A transition is `(GameState) => GameState` and returns the same object when nothing changed.**
  The store checks `next !== state` to skip sounds, toasts and re-renders.
- **Components subscribe to slices, never to `state`.** The tick stores a new `GameState` twenty
  times a second, so `useGameStore((s) => s.state)` re-renders its component at 20 Hz even when no
  number on screen moved. Read one primitive (`useGameStore((s) => s.state.generation)`), a stable
  reference (`s.state.agents` changes on a purchase, not on a tick) or a view from
  `src/store/selectors.ts` through `useStateSlice`: flat, already formatted, rounded to what the
  eye can tell apart. `selectors.test.ts` asserts each view stays equal across idle ticks. A window
  that needs most of the state (`StatsBody`, `PrestigeBody`) subscribes only while it is open.
- **One clock, one persistence path.** `App.tsx`'s 50 ms tick drives `advanceTime`. Every
  `localStorage` write goes through the store's save: throttled to `SAVE_INTERVAL_MS` (1 s) for the
  tick and the Клик, written at once on every other player action, flushed on
  `visibilitychange`/`pagehide`. New code hangs off the tick through the store; a bounded one-shot
  `setTimeout` (a toast's dwell) is the only other timer it starts. The repeating timers that
  already exist — `NewsTicker`'s news rotation, the rAF counters in `ClickColumn` and
  `PrestigeOverlay`, `music.ts`'s note scheduler — are exceptions, not patterns to copy.
- **Numbers reach the screen only through `formatNumber`, `formatCount` and `formatDuration`**; a
  bare number renders through `Num`, which picks no font of its own (ADR-0009): it inherits
  Departure Mono on a pixel step and is Nunito everywhere else.
- **`src/layout.ts` holds every layout number**; `THREE_COL_MIN` is the desktop/mobile switch.
- **One column (below `THREE_COL_MIN`) is a phone layout with a pinned `StatusStrip`** over the
  work area: Токены, Доход and a mini Температура (`thermalMiniView`), on every bottom tab. Its
  height is `STATUS_STRIP_H` in `layout.ts`, summed from named parts and handed to CSS as
  `--status-*` variables; the strip carries the `click-counter` class because the toast stack
  anchors on it (`pinnedToastAnchors`), and the Click column draws no counter of its own in that
  mode. The Click button and the Температура scale live in `.click-dock`, sticky at the bottom of
  the column — the thumb zone. Touch targets are 44 px (`--tap-min`); the one exception is the
  20 px «Справка AA» mark, whose hit area grows to 44 px through `.aa-toggle::after`.
- **The shell fits a phone, not just a width.** At or below `NARROW_MAX` (960 px, so a phone on its
  side counts) the header is one 52 px row — «Поколение N» with Compute under it, four 44 px
  buttons; the long forms («TOKEN CLICKER», name and period, «Инфо») stay in the accessibility
  tree as `.header-full`. Heights are `dvh` after a `vh` fallback and live in CSS, never inline.
  `viewport-fit=cover` lets the page reach under the notch, so every band respects `--safe-*`
  (`env(safe-area-inset-*)` on `.app-root`): the root keeps the sides, the header the top, the
  footer the bottom, `.modal-scrim` and the toast stack their own margins; code that places
  something by window coordinates (`Hint`) reads them through `safeInsets.ts`. A phone on its
  side (`isLandscapePhone`, `data-landscape`) keeps the same order of the same buttons: the strip
  is one row, the news ticker hides until a Слух arrives, only the Click button stays pinned and
  the Температура scale scrolls above it. Inline `style` beats these rules, so `display` and
  `position` of anything they touch live in the class.
- **Content tables move in pairs:** a new Лаборатория edits the `LabId` union and `LABS` together;
  `data/glossary.ts` timings are asserted against the code constants, so change both.
- **Type is two faces and three steps** (ADR-0009). Departure Mono — headings, tabs, buttons,
  labels, numbers — only through `pixel-22`, `pixel-33` or `pixel-44`: the class sets family and size
  together, and there is no other way to name the face. Everything under 22 px is Nunito, never
  under 12 px; a caption inside a pixel node (a price line on a button) takes `body-font` back. Never
  set `fontSize` inline on a node with a `pixel-*` class. The counter's reserve of characters lives in
  `layout.ts` beside the column minima, because the face is wider than Nunito.
- **Components** style with inline `style` objects, the CSS variables and `pixel-*` classes from
  `index.css`, where keyframes live too. `gap`, `padding` and `margin` take a step of the
  `--space-0…6` ladder (2/4/8/12/16/24/32 px) by name, borders are `var(--frame-w)`, and there is no
  `borderRadius` or blurred shadow on a button, tab, card or panel — `index.test.ts` enforces the
  CSS side (ADR-0008). A button is clipped by `clip-path`, so its rings go inside it. Dialogs trap focus through `useDialogFocus.ts`. Over a
  Сцена, every readable label sits off the artwork or on a darkened HUD band of its own (ADR-0002).
- **A row of tabs is `role="tablist"` with `onTabRowKeyDown`** (`components/tabRow.ts`, keys from
  `nextTabIndex` in `src/a11y.ts`): `role="tab"`, `aria-selected`, `aria-controls` and a roving
  `tabIndex` (the selected tab is the only one in the Tab order; arrows, Home and End walk the rest
  and select as they go), with one `role="tabpanel"` it labels. The shop, the Престиж sections and
  the phone's bottom bar are all rows of this kind. The one live region is `Announcer.tsx`
  (`role="status"`, polite, always mounted, hidden with `.visually-hidden`): it reads an Achievement
  toast and the moment «Престиж готов» begins, never the Токены counter or the Доход, which change
  twenty times a second. No visible text is under 12 px (`--text-xs`); `index.test.ts` holds the CSS side.
- **Hints are `Hint.tsx`, never `title=`.** It opens on hover, on keyboard focus and on a tap (touch),
  closes on Esc or a tap elsewhere, and mounts its content only while open. The Модель card
  (`ModelHintCard`) reads `modelCardSummary` from `src/economy/modelCard.ts`, whose breakdown comes
  from the same `modelMultiplier` the tick pays from; `FullNumber` shows `formatFull` for an
  abbreviated number. Where a hint sits is `placeHint` in `layout.ts`.
- **Keys are `src/hotkeys.ts`** (1/2/3, `?`, the Shift/Ctrl/Cmd amount of a purchase) plus the hold of Space/Enter
  in `ClickColumn` and Ctrl + arrows on the Температура dial. A key's meaning is a pure function; its effect is
  the store's `runHotkey` / `buyAgents(id, amount)`; one guard (`holdClickKeys.ts`: not in a field, not over an
  `aria-modal` window or the Престиж veil) serves all of them. A new key goes into `HOTKEY_HELP`, the «?» card.
- **Audio is synthesized** — no files, no asset pipeline. `AudioContext` resumes only after a user
  gesture, so silence before the first click is expected. `sound.ts` owns the one context and the
  graph: the player's volume and mute live only on the master gain, the music and effects levels
  only on their own channel gains above it, so every source connects through `audioBus()` — an
  effect to `bus.sfx`, a note to `bus.musicBus` — and writes its own level, never a volume. A
  signal fired by the tick rather than a press goes through `runningBus()`, or it would pile up on
  a sleeping context and burst on the first click. `music.ts` is the single music loop; it reads
  the current settings every tick. A hidden page is silenced on that same master, but by its own
  flag rather than the player's mute: the store calls `setAudioHidden` on `visibilitychange`, and
  every effect takes its bus from `effectBus()` or `runningBus()`, which return null while it
  holds — never test `settings.muted` by hand.
- **`npm run sprites` is dead**: `scripts/chroma-key.py` is not in the repo. Flag it rather than
  rely on it.
- `docs/vision.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md` and `docs/research/` are history, not
  instructions.

## Code

- Content that varies in shape is a discriminated union (`Upgrade`, `PerkEffect`), never a bag of
  optional flags. There is no `any`, in shipped code or in tests.
- Comments carry the **why** a name cannot, in Russian like the rest of the tree.
- **Language by audience**: identifiers English; player-facing strings Russian; a commit's type
  prefix English (`feat(ui):`) with a subject, usually Russian, naming what the player sees —
  `fix(ux): не спрашивать про Испытание Забега до первого Престижа`.
- `npm install` from the committed lockfile. React, Vite, TypeScript, Zustand and Vitest move only
  when the task is about them; state a new dependency's maintenance cost out loud before adding it.
- **Blast radius**, before calling it done: who reads what you changed, which UI states it reaches,
  and whether it crosses the save contract.

## Tests

- Name every test `*.test.ts`: `vite.config.ts` includes only `src/**/*.test.ts`, so a `.test.tsx`
  is skipped silently. Run one case with `npm test -- -t '<name>'`.
- A bug fix ships with a test that goes **red** on the bug, in the test file of the area it
  touches, named after the behaviour the player gets — not after the issue number. The issue
  number belongs in the PR (`Closes #N`).
- Assert values and contracts, not markup snapshots, wiring, or the text of the source. A regex
  over a `.tsx` passes on code that is broken and fails on code that is fine. The three exceptions
  read `index.css` through `readFileSync`: `src/index.test.ts` checks the file's structure
  (balanced braces, no `@keyframes` inside `@media`), `src/palette.test.ts` reads the `:root`
  palette, the `color-mix` shares in `.app-root` and the eight accents from `generations.ts`, and
  asserts the ADR-0007 pairs at 4.5:1 — change a surface or a fill and it tells you which pair
  fell — and `src/typography.test.ts` reads `index.css`, `index.html` and the woff2 files
  themselves: no network font, Departure Mono only on a rule with a step size, every letter of
  the Russian alphabet, digit and sign present in each file, one advance width across the
  monospace face. There is no `@types/node`: extend `src/node-fs.d.ts` rather than adding the package.
- Use the real pure functions of `src/economy/` in store tests; mock only what node cannot run
  (audio). A mock that re-implements a rule asserts the mock, not the game.
- Assert over the **whole catalog**, not one hand-picked Поколение; a test that shrinks its loop is
  a deleted invariant.
- An async test waits on the real signal, or polls under a bound.
- Build state with `newGame(T0)` plus `buyAgents` / `buyUpgrade` / `prestige`, or a literal spread
  (`rich`); there is no fixture directory. Drive late-game volumes: a fresh state hides the rounding
  and overflow bugs in `formatNumber`, `maxAffordable` and prestige gains.

## Checking the UI in a browser

Component behaviour is checked in a real browser driven by Playwright — the CLI, an MCP server or a
throwaway script — and never by committed browser tests: Playwright is not a declared dependency,
like `npx tsx` above, and its scripts live outside the tree. Run it against your own `npm run dev`
port in a fresh browser context, so no real save is read or overwritten; for a hit-stop or
`:active` state, send real input (`mouse.down`/`keyboard.press`), since a synthetic DOM event
doesn't trigger CSS `:active`. Screenshots go to the PR, not into git.

- Every text node on screen: a DOM walk over `getComputedStyle` — Departure Mono only at 22, 33
  or 44 px with every character in the font's `cmap`, no node in a third face. A rule elsewhere
  in `index.css` can overwrite the size of a `pixel-*` node, and only the browser sees that.
- Every layout band from `src/layout.ts`: three columns at or above `THREE_COL_MIN`, one tab at a
  time below it, and the one-row header at or below `NARROW_MAX` (320, 360, 390, and a phone on
  its side such as 844 × 390), where the footer's AA attribution must still show.
- The states you touched: empty first run, no income yet, the offline report at its cap, Престиж
  confirmation, the content finale, an import error.
- To reach a late state on a throwaway origin, export a run as a code from «Настройки» and import it
  there.
- A notch is emulated, not guessed: `Emulation.setSafeAreaInsetsOverride` on a CDP session
  (`context.new_cdp_session(page)`) with `is_mobile` and `has_touch`, in portrait (top and bottom)
  and landscape (left and right). Nothing readable or tappable may fall in an inset; `dvh` itself
  needs a real phone with a collapsing address bar.

## Performance

- Judge at representative volumes: all eight Поколения, and Токены up to the `1e300` the tests
  already drive.
- Hot paths: `advanceTime` every 50 ms, per-tick income in the shop (`incomeGain` per card),
  serialization on save, audio scheduling.
- Count re-renders on a production build, not in dev: install
  `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` before the page loads and count the function
  components whose fiber carries `PerformedWork` in each commit. A subtree that bailed out keeps its
  old flags, so count a fiber once, and build with `minify: false` to keep component names. At idle
  in a late run only what moves should re-render: the mascots' bob, a card whose printed deficit
  just changed.

## Documentation

- Write down only what the code cannot say: a decision's reason, a cross-module constraint, a trap.
  When a documented decision changes, rewrite it in place so one account remains.
- `CONTEXT.md` and `docs/adr/` are the internal docs; `README.md` is the player's and stays thin.
  A merged PR is the implementation record: commit no plans, research notes, screenshots or
  checklists, and add no doc file unless the developer asks.

## Pull requests

Only when the developer asks; the developer pushes.

- **Title:** Conventional Commits with a scope, matching the history — `feat(economy):`,
  `feat(ui):`, `fix(format):`, `fix:`. Say what the player sees.
- **Body:** the problem in a sentence or two, the fix, and the alternatives you rejected and why.
  `Closes #N` for GitHub Issues (`Narek-Khachikyan/token-clicker`, driven by `gh`). Macroscope
  appends its own sections between invisible markers — leave them alone and never paste them
  elsewhere.
- **One concern per PR.** If the description says "also", split it.
- **Evidence:** before/after screenshots for UI changes, uploaded to the PR.
- **Babysitting:** poll checks and comments newer than the last push, verify each finding against
  the source, fix the real ones, dismiss false positives in writing. Stop when checks are green on
  the latest commit.
