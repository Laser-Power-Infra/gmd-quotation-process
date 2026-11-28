# Prompt: rebuild the Ceebuild Items & Docket Dashboard in the GMD Quotation dashboard's UI

Paste everything below the line into the agent working on the Ceebuild dashboard.

Source of the reference values (`apps/gmd-quotation-process`): `app/layout.tsx`, `app/page.tsx`,
`app/DashboardContainer.tsx`, `app/globals.css`, `components/table/EnquiryTable.tsx`, `DocketRow.tsx`,
`EnquiryFilterBar.tsx`, `Pagination.tsx`, `EditableText.tsx`, `CellSelect.tsx`, `DocketEditDrawer.tsx`,
`components/dashboard/*`, `components/layout/*`, `lib/enquiryColumns.ts`, `lib/uiSlice.ts`.

Revision 2: reviewed for user experience. Where GMD's own screen is weak (text too small, too many
control strips, a rainbow of buttons, hidden click targets), this prompt keeps GMD's look but fixes the
weakness. Those departures are listed in section 10.

---

## Your task

Restyle and restructure the **Ceebuild Items & Docket Dashboard** (the Dockets screen: dockets with their
underlying items) so it looks and behaves like the **GMD Quotation dashboard** described below. Keep
Ceebuild's data, fields, permissions and business rules exactly as they are. Change only layout, styling,
table behaviour and interaction patterns.

The reference design is a **dense, neutral "control room" console**: white surfaces, near-black text,
hairline borders, one signal colour (blue `#0f62fe`), compact type, many rows per screen. On
Tailwind + React, use the class strings given here. On another stack, reproduce the same pixel values.

Before editing, read the current Dockets page and list every column, filter and action it has, then map
each one to a slot below. Nothing may be lost in the move.

## 0. Principles to apply when this prompt is silent

1. **Rows first.** The user is here to read and edit rows. Every strip of chrome above the table costs
   rows. Budget in 3.1 is a hard limit.
2. **One place per job.** One place to filter, one place for bulk actions, one place for paging. Never
   show the same control or the same number twice.
3. **Instant response.** Feedback starts on pointer-down or on the keystroke, never after the server
   answers. Typed text echoes immediately; only the request waits.
4. **Nothing happens silently, everything can be undone.** Every save shows that it saved. Edits,
   fills and item deletes offer Undo. Only an irreversible docket delete asks for confirmation.
5. **What looks clickable is clickable, and nothing else is.** No hidden click targets without a
   visible hover cue. Things that look the same behave the same.
6. **Colour means something.** Blue = primary action or active state. Amber = needs attention.
   Rose = destructive or error. Everything else is neutral.

## 1. What changes on the Ceebuild screen (old to new)

| Today on Ceebuild | Replace with |
|---|---|
| Tall page header: logo card, big title, user box, tab group with counts | One 56 px sticky navbar: logo left, tabs (Items, Dockets, Terms & Conditions, Audit Log, each with its count), user and sign-in on the right |
| Separate large search card with date range and "Refresh & Reset Data" | Search and date range move into the filter bar inside the table card. Reset becomes "Clear all", shown only while a filter is active |
| "Dockets" card header, hint text, pagination at the top right | One toolbar row: title and totals on the left, actions on the right. Pagination moves to the footer |
| Second header row of "All Dockets / All Parties / All States..." selects | The filter bar. Column headers carry the label and sort only |
| "Filter Dockets by Item Name" row of 16 chips | One "Item" multi-select, first in the filter bar (searchable, with counts) |
| ACTIONS as the first column (PDF / AI / delete) | Sticky **right** "Actions" column |
| Separate ID column (`#395`) | Shown inside the Docket cell |
| One wide column per docket field | Four stacked two-line docket cells (3.3) |
| Nested card "Items belonging to Docket ..." with its own table and filter row | **No nested card.** Items are rows of the same table (3.4) |
| Always-visible textareas with resize grips and selects in every cell | Plain text that becomes an input on click (section 5) |
| Two-line wrapped red text under price/payment condition | One line each, full text in a fast hover card |
| Rounded display font, large bold labels | Inter, sizes in 2.2 |

## 2. Design tokens

### 2.1 Colour (CSS variables, light theme is canonical)

```css
:root {
  --background: oklch(1 0 0);          /* page and table floor */
  --foreground: oklch(0.145 0 0);      /* body text */
  --card: oklch(1 0 0);
  --popover: oklch(1 0 0);
  --primary: oklch(0.205 0 0);         /* near-black: active nav underline */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --muted: oklch(0.97 0 0);            /* header row, toolbar, footer, hover fill */
  --muted-foreground: oklch(0.556 0 0);/* secondary text on WHITE only */
  --accent: oklch(0.97 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);          /* every hairline */
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.625rem;                  /* 10px; sm = 6px, md = 8px, xl = 14px */
}
.dark {
  --background: oklch(0.195 0.014 258); --foreground: oklch(0.925 0.008 255);
  --card: oklch(0.228 0.016 258);       --popover: oklch(0.248 0.018 258);
  --primary: oklch(0.74 0.105 250);     --primary-foreground: oklch(0.2 0.02 258);
  --muted: oklch(0.27 0.018 258);       --muted-foreground: oklch(0.72 0.016 256);
  --accent: oklch(0.3 0.024 256);       --border: oklch(0.32 0.02 258);
  --input: oklch(0.34 0.022 258);       --ring: oklch(0.62 0.09 250);
}
```

- **Signal blue `#0f62fe`** (hover `#0353e9`; dark mode `blue-500/80`, text `blue-300`): the one
  primary button, active page number, active filter, docket number text, sort arrow when sorted,
  loading bar, column-resize line, focus ring on a cell being edited. Nowhere else.
- **Secondary buttons are neutral:** `border border-border bg-background text-foreground hover:bg-muted`
  with a muted icon. Do not give each toolbar button its own colour.
- **Tinted recipe, for state only** (never decoration):
  `border-{c}-200 bg-{c}-50 text-{c}-700` (dark: `border-{c}-500/25 bg-{c}-500/10 text-{c}-300`).
  Amber = warning / pending / missing data. Rose = destructive, error, duplicate. Emerald = success.
- **Text on the muted wash** (header row, toolbar, footer) uses `text-foreground/70`, not
  `muted-foreground`: grey on grey falls to about 4.4:1, under the 4.5:1 minimum.
- **Row states:** hover `bg-muted`; selected `bg-blue-50/70`; needs attention `bg-amber-50`;
  item sub-row `bg-muted/10`. A tinted row must also carry an icon or chip saying why. Colour alone is
  not enough.
- **Status pills** (full pill, 11 px / 600, padding `2px 10px`, 1 px border):
  green `#d1fae5 / #065f46 / #a7f3d0`, red `#fee2e2 / #991b1b / #fecaca`,
  amber `#fef3c7 / #92400e / #fde68a`, blue `#dbeafe / #1e40af / #bfdbfe` (bg / text / border).

### 2.2 Type (Inter only, weights 400 / 500 / 600 / 700)

**Nothing on this screen is smaller than 11 px.**

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Screen title ("Dockets") | 16 px / 24 | 700 | `tracking-tight` |
| Nav tab, buttons | 13-14 px | 500 / 600 | |
| Table cell | 12 px / 16 | 400; 600 for the key value in a cell | |
| Secondary line in a cell | 12 px / 16 | 400 | `muted-foreground` |
| Column header | 11 px / 16 | 600 | UPPERCASE, `tracking-wide`, `foreground/70` |
| Filter controls | 12 px | 500 | |
| Chips, counts, badges | 11 px / 16 | 500-600 | |
| Totals in the toolbar, footer text | 12 px | 500 | `tabular-nums` |

Numbers (quantity, weight, rate) are right-aligned with `tabular-nums` and Indian digit grouping.
Dates read `12 Nov` in a cell and `12 Nov 2026` in the hover card and drawer.

### 2.3 Shape, spacing, sizes

- Radius: cards and panels 10 px; buttons and nav 8 px; filter controls and cell inputs 6 px; chips
  and status badges full pill. Rectangles and pills only.
- Spacing on a 4 px grid: 4, 8, 12, 16, 24.
- Control heights: nav tab 36 px, toolbar button 32 px, filter control 32 px, in-cell chip 22 px.
- **Minimum click target 24 x 24 px** for anything clickable (icon buttons, chevrons, checkboxes,
  chips), even when the glyph inside is 12-16 px. Pad the hit area, not the glyph.
- Flat: separation comes from 1 px borders and the muted wash. The table and its rows never cast a
  shadow. Only the table card (`shadow-sm`) and floating layers (popover, drawer, dialog) have one.

### 2.4 Motion

- Hover and pressed states are **instant**: no transition on row hover (it lags behind the pointer
  while scrolling). Buttons show a pressed state on pointer-down (`active:translate-y-px`).
- Popovers and menus: 120-150 ms, opacity plus a 0.97 to 1 scale from the edge nearest their trigger.
- Drawer: slides in from the right in 200-250 ms ease-out and leaves by the same path. It can be
  closed while still opening.
- Rows appear and disappear without animation. Do not animate table layout.
- Drags (column resize) follow the pointer 1:1, with no easing.
- `prefers-reduced-motion`: replace slides and scales with a 150 ms fade.

## 3. Page layout and positions

### 3.1 Shell and the chrome budget

Nothing scrolls except the table.

```
<html class="h-screen overflow-hidden">
  <body class="h-screen flex flex-col overflow-hidden bg-background">
    Navbar                          56px  sticky, z-40, border-b, bg-background/85 + backdrop-blur
    <main class="flex-1 min-h-0 flex flex-col p-3 overflow-hidden">
      Table card                    flex-1, overflow-hidden
        Toolbar                     48px  title + totals | actions
        Filter bar                  44px  one line at 1366px wide
        Loading bar                  2px
        Scroll area                 the ONLY scroller (both axes), holds the table
          Header row                36px  sticky
        Footer                      44px  range, rows per page, pager
```

**Budget: fixed chrome is at most 254 px tall** (56 + 24 padding + 48 + 44 + 2 + 36 + 44). On a
1366 x 768 laptop that must leave **at least 8 docket rows** visible. Do not add another strip (stat
cards, chip rows, hint text, a second header row) without removing one. If Ceebuild needs totals, put
them in the toolbar line, not in cards.

- **Navbar:** `h-14 px-4 lg:px-6`, logo 32 px tall at far left, then tabs. Tab:
  `h-9 px-3 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground`.
  Active tab: foreground text plus a 2 px underline bar in `--primary` on the navbar's bottom border.
  Each tab's count sits beside its label as a small muted number. User, role and sign-in sit at the
  far right behind a left border.
- **Table card:** `bg-card rounded-lg border border-border shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden`.

### 3.2 Toolbar (title and actions in one row)

`flex items-center justify-between gap-4 h-12 px-4 bg-muted/50 border-b`

- **Left:** title `Dockets`, then totals for the **filtered** set in 12 px `foreground/70`:
  `231 dockets · 5,251 items`. Totals come from the server, not from the visible page.
- **Right, normal state:** up to three neutral secondary buttons (for example Export), a `More` menu
  for the rest, a `Columns` button, then the one blue primary button last:
  `Add Docket` (`h-8 px-3 bg-[#0f62fe] text-white text-[13px] font-semibold hover:bg-[#0353e9]`, plus icon).
- **When dockets are selected, the toolbar becomes the selection bar:** left reads
  `3 selected` with a `Clear` link; right shows only the actions that apply to a selection (Export
  selected, PDF, Delete). The bar is tinted `bg-blue-50`. Actions that need a selection are never
  shown greyed out in the normal state.
- A running action disables its button, spins its icon and changes the label ("Exporting...").

### 3.3 Docket columns: stack, don't spread

Show docket-level data as a few **two-line cells** of read-only text:

| Cell (default width) | Line 1 | Line 2 |
|---|---|---|
| **Docket** (300 px, frozen left, cannot be hidden or shrunk below 260) | expand chevron (only if the docket has more than one item), docket no. in blue 600, `+N` pill when collapsed, `· 12 Nov` with age in days, type chip (Purchase / ...) | party name in 600, truncated. Warning chips go here. At the right edge: icon buttons (attachments with count) and, on row hover or focus, a pencil "Edit docket" button |
| **Location** (160 px) | state | utility · delivery location (muted) |
| **Terms** (220 px) | price condition | payment condition |
| **Status** (160 px) | main status | secondary status (muted) |

Cell style: `border-r border-b border-border align-top py-1.5 px-2.5 text-xs`.

- Every value is one line and truncates. Hovering or focusing a truncated value shows a **hover card
  with the full text within 150 ms**. Do not rely on the browser's `title` tooltip: it takes about a
  second and never appears for keyboard users.
- Empty values show a muted `-`. A blank value that blocks the docket's next step shows an amber chip
  naming it ("Payment missing").
- The docket's `#id` goes in the hover card and the drawer title, not in the cell.
- A small copy icon appears beside the docket number on hover; clicking it copies and confirms with a
  toast.

**Opening the docket.** The docket cells show `cursor-pointer` and the row highlights on hover.
A click on them opens the edit drawer, **except** when the click lands on a button, link or input, or
when the user has just selected text by dragging (check that the selection is empty). The pencil
button and Enter on a focused row do the same thing, so the action is never hidden.

### 3.4 Items: same table, not a nested card

- The docket row carries its **first item** in the item columns (as Ceebuild's "First item name"
  column does today). A docket with one item has no chevron.
- A collapsed docket with more items shows a `+N` pill. The chevron (or Right arrow on a focused row)
  expands it; Left arrow collapses.
- Expanded: each further item is its own row directly below, with the item columns filled and
  `bg-muted/10`. Its frozen Docket cell is not empty: it shows `item 3 of 23` and the docket number in
  muted text, so the user still knows which docket they are in after the docket row scrolls away.
- While items load, show skeleton rows, **as many as the known item count** (up to the cap below), so
  the table does not jump when they arrive.
- **Large dockets:** show the first 20 items, then one full-width row
  `Show all 23 items`. "Expand all" in the header expands every docket on the page only when that
  adds fewer than 500 rows; above that it asks first.
- Dockets are collapsed by default, also under a filter. Auto-expand only when a search matches
  exactly one docket.
- Item columns for Ceebuild, in this order: **Item Name (party)** (220 px, frozen left after Docket),
  UOM, Qty, Our Item / Not, Our Item Name, Size, Unit Wt, the remaining item fields, then
  **Actions** (88 px, frozen right).
- **Frozen columns may take at most 45% of the table's visible width.** Below 1440 px wide, unfreeze
  Item Name and keep only Docket and Actions pinned.

## 4. The table card, top to bottom

### 4.1 Filter bar: the only place to filter

`flex items-center gap-2 h-11 px-4 border-b bg-background`. Controls are
`h-8 rounded-md border border-border bg-background text-xs`.

- **Inline, in this order** (the filters used every day): search box (`w-56`, magnifier icon,
  placeholder says what it searches: "Docket no, party or item"), `Item`, `Party`, `State`, `Type`,
  date-range button (shows `1 Nov – 19 Nov` when set).
- **`More filters`** button holds the rest in one popover, grouped under two small headings:
  *Docket* (Utility, Attachments, Price condition, Payment condition) and *Items* (UOM,
  Our Item / Not, Size). It shows a count badge when any of its filters is set: `More filters (2)`.
- **`Clear all`** (rose text button) appears only while a filter is active.
- Pick the inline set from real usage if Ceebuild has it; the rule is that the bar stays on one line
  at 1366 px.
- **Multi-select:** the button shows the field name, or `Party (2)` when values are chosen. An active
  one turns `border-blue-500 bg-blue-50/80 text-blue-700 font-semibold`. Its popover has a search box
  that is focused on open, "Select all / Clear", a checkbox list (12 px text, 28 px rows, max height
  240 px), a `(Blank)` option, and a count beside each option. Options with zero matches under the
  other filters are hidden.
- **No filter inputs in column headers** and no per-docket item filter row.

### 4.2 Loading bar

A 2 px bar directly above the table: empty normally, pulsing blue while a page loads.

### 4.3 Table element

```html
<div class="flex-1 min-h-0 overflow-auto w-full min-w-0">
  <table class="border-collapse text-left"
         style="table-layout: fixed; width: {sum of visible column widths}px">
    <colgroup><col style="width:40px"/> ...one <col> per column... </colgroup>
```

- **Fixed layout with explicit widths.** Width comes from `<col>` elements; the table's own width is
  the sum. Content never sizes a column.
- **Header:** `<thead class="sticky top-0 z-30 bg-muted">`. Each `<th>`:
  `relative sticky top-0 z-30 bg-muted h-9 px-2.5 text-[11px] font-semibold tracking-wide uppercase text-foreground/70 border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)]`.
- **Sort:** the **whole header label is the sort button**, with a small arrow after it (muted when
  idle, blue when sorted) and `aria-sort` on the `<th>`. First click: A to Z for text, newest or
  largest first for dates and numbers. Second click reverses. Third click returns to the default
  order. Sorting returns to page 1. The Docket header sorts by docket number; a small menu on its
  arrow offers Date and Party.
- **Frozen columns:** Docket (and Item Name, when frozen) stick to the left with `left` = the sum of
  the frozen widths before them; Actions sticks to the right. Body cells: `sticky z-20 bg-background`,
  following the row's hover and selected colours. Header cells: `z-40`. Sticky cells must be opaque.
  Collapsed borders do not travel with sticky cells, so draw their dividers as
  `shadow-[inset_-1px_0_0_var(--border),inset_0_-1px_0_var(--border)]` (mirror the first value for
  the right-frozen column).
- **Column resize:** an 8 px grab zone on each header's right edge (`cursor-col-resize`) showing a
  2 px blue line on hover and while dragging. Use Pointer Events with pointer capture so the drag
  survives leaving the header. Minimum 72 px. During the drag write the width straight to the
  `<col>` and the table width; save once on release. **Double-click the edge to return that column
  to its default width.** Widths are remembered per user.
- **Columns popover** (toolbar): a checkbox per column, Docket and Actions locked on, and a
  `Reset layout` link that restores default widths and visibility. Hide a column with one injected
  CSS rule (`col:nth-child(n), tr > :nth-child(n) { display: none }`), not by re-rendering rows.
  The default set must fit 1366 px without a horizontal scrollbar.
- **Rows:** docket row height 44 px. Body cells `py-1.5 px-2.5 border-r border-b border-border text-xs`.
- **Selection:** first column, 40 px. A 16 px checkbox per docket whose whole cell is the click
  target; none on item sub-rows. The header checkbox selects **the dockets on this page**. When the
  filter matches more than one page, the selection bar then offers
  `Select all 231 matching dockets`. Never select across pages without that explicit second step.
- **Empty states** (one full-width cell, `py-16`, 12 px text, one action):
  - Filters or search returned nothing: "No dockets match these filters" with a `Clear filters` button.
  - No dockets exist yet: "No dockets yet" with the `Add Docket` button.
- **Load failed:** keep the previous rows, and show a slim rose bar above the table:
  "Couldn't load dockets" with `Retry`.

### 4.4 Footer

`flex h-11 items-center justify-between border-t bg-muted/50 px-4 text-xs`

- Left: `1–50 of 231`, then `Rows per page` select with **25, 50, 100, 200**. Changing it returns to
  page 1.
- Right: previous / next icon buttons (28 px, disabled at the ends), numbered pages as 28 px squares
  with `...` gaps (first, last, current ± 1). Active page is blue with white text.
- This is the only place the range and page number appear.

## 5. Editing and cell rules

- **Read-only users (Ceebuild's "Viewer" role) get no edit affordances at all:** no hover fill, no
  text cursor, no pencil, no row checkboxes for edit-only actions. The drawer opens as "View" with no
  Save. Do not show disabled controls they can never use.
- **Text and number cells are plain text until clicked.** Click, or Enter on a focused cell, swaps in
  an input pre-filled and fully selected. Resting state: transparent, hover `bg-muted`, `cursor-text`.
  Editing state: `ring-1 ring-blue-500 bg-background`. Never render a page full of live inputs or
  textareas; that was the main cause of slowness in the reference table.
- **Keys while editing:** Enter saves and moves down to the same field of the next item; Tab and
  Shift+Tab save and move to the next or previous editable cell in the row; Esc cancels and restores
  the old value. Blur saves.
- **Save lifecycle, visible in the cell:** the new value shows at once (optimistic). While the request
  runs the cell is 60% opacity. On success the cell flashes a pale green wash for 600 ms. On failure
  the old value comes back, the cell gets a rose ring, and a toast explains why with `Retry`.
  A background refresh must never overwrite a cell the user is editing.
- **Validation is inline and immediate:** a number field that receives text stays in edit mode with a
  rose ring and a one-line reason under it. Nothing is sent.
- **Undo:** after an edit, a fill-down or an item delete, show a toast `Saved · Undo` for 6 seconds.
- **Choice fields in a cell** (UOM, Our Item / Not, Our Item Name, Size): a chip
  `h-[22px] rounded border px-1.5 text-[11px]` showing the value (`-` when blank) with a small chevron.
  It opens a popover with a search box (focused on open) and a single-select list with a tick on the
  current value. Type to filter, arrows to move, Enter to choose, Esc to close.
- **Long text** (item name): clamp to two lines, full text in the hover card.
- **Locked cells:** `bg-muted`, value at 60% opacity, `cursor-not-allowed`, and the hover card says
  why it is locked and how to unlock it.
- **Paste from Excel:** pasting a column of values into a numeric item cell fills that field down the
  docket's items in order, flashes every changed cell, and reports `Filled 12 items · Undo`.
- **Docket fields are edited in a right-side drawer** (max width 448 px). Title `Edit {docket no}`
  with `#id`; fields in 2 and 3 column grids; 12 px 500-weight labels above `h-8` inputs; footer with
  `Cancel` and `Save` at the right. The table stays visible and scrollable beside it (light scrim or
  none). Esc or Cancel closes; with unsaved changes it asks once. On close, focus returns to the row
  it came from, and that row flashes if it changed.
- **Row actions** live in the sticky right column: the one most-used action as an icon button (PDF),
  the rest in a `...` menu. Every icon button has an `aria-label` and a tooltip.
- **Confirm only what cannot be undone.** Deleting a docket asks in an in-app dialog (never
  `window.confirm`) that names it: "Delete CEE-000533 and its 23 items?" with a rose `Delete` button.
  Deleting an item does not ask; it offers Undo.
- **Toasts** appear at the top right. A long action shows one loading toast that turns into success
  or error. Copying a value confirms with a toast.

## 6. Data behaviour (required, not optional)

- **Server-side everything.** The browser holds one page. Search, filters, sort, paging, dropdown
  options, counts and totals are computed on the server. Never load the full set to filter in the
  browser.
- **First paint from the server:** the page renders with page 1 already loaded. Before that, show
  8 skeleton rows in the real column layout, not a spinner.
- **Each docket row arrives with its first item and an item count.** The rest load on expand.
- **Typing in search echoes instantly; the request fires 250 ms after the last keystroke.** Each
  filter input is its own small component so a keystroke re-renders only that input.
- **Latest request wins.** Cancel or ignore earlier responses, so a slow old reply can never replace
  newer results.
- **While a page loads** keep the old rows on screen at 60% opacity with `aria-busy`, and keep the
  scroll position. Never blank the table.
- **Cascading filter options:** a dropdown's options are fetched when it opens, computed under all
  the *other* active filters, each with a count. Keep the previous options visible until the new
  ones arrive.
- **Any filter change returns to page 1** and fires exactly one request. Paging and sorting do not
  recompute totals; filter changes do.
- **After a save,** refetch the current page quietly in the background so totals, order and filters
  stay correct. Rows must not jump while the user is working in them: if a saved row no longer
  matches the filter or sort, keep it in place until the next page change or explicit refresh.
- **Rendering cost:** memoise rows and pass stable callbacks; subscribe each row to its own data
  only; load heavy libraries (Excel export) on demand.
- **Remember per user:** column widths, visible columns, rows per page.
- **Filters, sort and page live in the URL,** so a view can be bookmarked, shared and reached with
  the Back button.

## 7. Keyboard and accessibility

- Every control is reachable by keyboard and shows a visible focus ring (3 px at 50% of `--ring`;
  `ring-1 ring-blue-500` inside the table).
- The table has one tab stop. Inside it: Up / Down move between rows, Right / Left expand and
  collapse a docket, Enter opens the drawer, Space toggles selection, `/` focuses search.
- Chevrons carry `aria-expanded`; sorted headers `aria-sort`; the scroll area `aria-busy` while
  loading; icon buttons an `aria-label`.
- Text contrast is at least 4.5:1, including muted text and text on the muted wash.
- State is never shown by colour alone: tinted rows also carry a chip or icon.
- Honour `prefers-reduced-motion`.

## 8. Do not copy from GMD

GMD-specific; leave out unless Ceebuild has a real equivalent: the analytics sidebar and its switch,
the stat-card strip, the drag bar that zooms the area above the table, stage tiles, the "pending by
person" strip, saved column-view presets, cost / VA% / contract-rate columns and their bulk buttons
(Auto-Fill, Fetch Item Codes, Update BOM Costs, Fetch CR Rates, Sync Stock), the offer-PDF and
send-email cells, and the red "VA% below minimum" row rule.

## 9. Check your work

1. At 1366 x 768 the page itself never scrolls, fixed chrome is 254 px or less, and at least 8 docket
   rows are visible. Navbar, toolbar, filter bar, header row and footer stay in place.
2. Scrolling right keeps Docket pinned left and Actions pinned right, with no rows showing through
   and no missing divider lines. Pinned columns take under 45% of the width.
3. A docket with 23 items shows one row with `+22`; expanding shows skeleton rows, then 19 more items
   and `Show all 23 items`; each sub-row names its docket.
4. No text on the screen is under 11 px, and every clickable thing has a 24 px target.
5. Typing in search never lags; one request fires 250 ms after typing stops; a slow earlier response
   never replaces a newer one.
6. Opening a filter shows only values that exist under the other active filters, with counts.
7. Click a cell, change it, press Enter: the value shows at once, the cell confirms the save, focus
   moves down, and Undo restores it. Esc leaves the old value and sends nothing.
8. Break the network and edit a cell: the old value returns and the error says what happened.
9. Header checkbox selects only this page; a second explicit step selects all matching dockets.
10. As a Viewer there is nothing that looks editable.
11. Using only the keyboard you can filter, move through rows, expand a docket, open and close the
    drawer, and edit and save a cell.
12. Blue appears only on the primary button, active states, docket numbers, focus and the loading
    bar. Toolbar buttons are neutral.
13. The network tab shows one page of rows per request, never the whole table.
14. Every column, filter and action from the old Ceebuild screen is still reachable.

## 10. Where this deliberately differs from the GMD screen

So nobody "fixes" these back:

| GMD today | Here | Why |
|---|---|---|
| 9-11 px text | 11 px minimum, 12 px cells | GMD needs 36 columns; Ceebuild does not, and 9 px is not readable for a full day |
| Title bar, toolbar, filter bar, filters inside column headers | One toolbar row, one filter bar | Four strips left about six rows on a laptop screen |
| Six toolbar buttons in six colours | Neutral buttons, one blue primary | The colours carried no meaning and drowned the one that does |
| Header checkbox selects every matching docket on all pages | Page first, then an explicit "select all 231" | A bulk action on hidden rows is the costliest mistake on this screen |
| Docket cell 360 px, Item Name always frozen | 300 px, Item Name unfreezes under 1440 px | Pinned columns covered over half a laptop screen |
| Saves are silent; no undo | Visible save state, Undo | Save-on-blur with no feedback hides accidental edits |
| Browser `title` tooltips for truncated text | Fast hover card | `title` takes a second and never shows for keyboard users |
| 8 px sort arrow is the click target | Whole header label sorts | Easier to hit, and it is what users expect |
| Sub-rows have an empty docket cell | Sub-rows name their docket | Context is lost once the docket row scrolls away |
| Rows per page up to 500 | Up to 200 | 500 dockets with expanded items is thousands of rows |
