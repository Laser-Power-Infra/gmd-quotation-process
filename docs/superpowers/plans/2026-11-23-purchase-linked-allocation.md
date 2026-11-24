# Purchase-Linked Lot Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allocate incoming China lots to contract lines against the app's own purchase lines (Materials > Purchases & Pending Receipts), visible from both sides, moving from "incoming" to "physical" on GRN without re-entry.

**Architecture:** One new db-stock table `PurchaseAllocation` (purchase line x contract line x qty, plus lot/invoice/B-L/ETA as reference text). Incoming vs received vs short is *derived on read* from the purchase line's ordered/received/closed figures, never stored, so a GRN needs no re-entry. The engine takes the allocations as an input: received part is held on physical stock like a manual booking, pending part is held as incoming, and what no allocation claims still feeds the existing auto-incoming step (which today gets an empty list). Writes go through the existing `StockAllocationLog`.

**Tech Stack:** Next.js host `apps/gmd-quotation-process` (and `apps/stock-physical`), packages `stock-allocation`, `purchase`, `db-stock` (Prisma + hand-written migration), Redux Toolkit data-table kit in `@gmd/ui`, vitest.

**Spec:** Puja's mails of 23 Nov 2026: brief (Gmail thread `1a20743950da8611`) and the correction that overrides it (`1a2074572bc8fcf2`). Where they differ, the correction wins.

## Global Constraints

- Allocation is against `PurchaseOrderLine` (key `poNo` + `poLineNo`), never against lot numbers or Tina invoice numbers; those are reference text only.
- Never allocate the same purchase qty twice: per purchase line, sum of allocations <= ordered qty (`netQtyOrder`).
- Allocation lockable and logged, as in the earlier brief: every write adds a `StockAllocationLog` row in the same transaction.
- A lot that matches no purchase line is listed for Puja and **not loaded and not guessed**.
- Import and supplier details (lot, Tina invoice, B/L, ETA, supplier, PO no) are internal: never in the offer PDF/Excel, the inspection call list, or any list "shared outside".
- SD26Y-00058 FSD040002 150 mm (323) and FSD040044 80 mm (547 short) show **"needs confirmation"**, not final.
- Tables follow the repo rule: server-side page/filter/sort/facet, SQL aggregates (AGENTS.md "Tables: server-side by default"). No `GMDUpdateTable`.
- Schema change = edit `schema.prisma` + hand-written `migration.sql`; never `prisma db push`; the user runs `db:deploy`. Release order: db:deploy -> db:generate -> build.
- Replies to Puja are Gmail drafts only, labelled "Claude estimate" in subject and body.

## Review Focus

- Short receipt: line closed (balance 0) with received < allocated -> contract line shows the shortage, allocation shrinks; not an error.
- Over-receipt (GRN > ordered): allocations stay as booked; the extra is free physical stock, never auto-assigned to the contract.
- Two allocators writing the same purchase line at once must not exceed ordered (the interactive-transaction guard, same pattern as `lib/grnSync.ts`).
- Purchase line with blank/unparseable qty, blank item code, or no GRN yet: no crash; shows as incoming with the ordered qty.
- Client-facing outputs stay free of lot/invoice/B-L/ETA/PO even for lines that have purchase sources.

---

## File Structure

- Create `packages/db-stock/prisma/migrations/20261123120000_purchase_allocation/migration.sql`; modify `schema.prisma` (model `PurchaseAllocation`).
- Create `packages/stock-allocation/src/purchaseAllocation.ts`: pure split + capacity check.
- Create `packages/stock-allocation/src/server/purchaseLedger.ts`: list/add/update/delete + loader for the engine.
- Modify `packages/stock-allocation/src/engine.ts`, `types.ts`, `server/index.ts`.
- Modify `packages/purchase/src/columns.ts`, `server/query.ts`, `ui/v2/PoLines.tsx`: allocated-to + free balance.
- Modify `packages/stock-allocation/src/ui/StockAllocationTable.tsx` (+ both hosts' `actions.ts`); Contract Review column in `packages/contract-review`.
- Create `apps/gmd-quotation-process/scripts/load-china-lot-allocation.ts`.
- Tests beside each in `packages/*/test/`.

### Task 0: Stock Allocation page stuck on loading

Do first; Puja reported it on 23 Nov and Task 3 makes the page heavier.

**Files:** `apps/gmd-quotation-process/app/stock_allocation/page.tsx`, `packages/stock-allocation/src/server/index.ts`

- [ ] **Step 1:** Use superpowers:systematic-debugging. Reproduce on the real data: time `computeStockAllocation(stockAllocationInputs)` and check the server log for a thrown read or a hung query (the page awaits the whole engine; no `loading.tsx` exists in `app/stock_allocation`).
- [ ] **Step 2:** Fix the root cause once in the shared code. If it is only slowness, add `app/stock_allocation/loading.tsx` and cache the engine result per request (the `shortcut:` note at `server/index.ts:~75` already names this).
- [ ] **Step 3:** Run `pnpm --filter @gmd/stock-allocation test`. Expected: PASS. Commit.

### Task 1: Table and the pure split

**Files:** modify `packages/db-stock/prisma/schema.prisma`; create migration `20261123120000_purchase_allocation/migration.sql`; create `packages/stock-allocation/src/purchaseAllocation.ts`; test `packages/stock-allocation/test/purchaseAllocation.test.ts`

**Interfaces:**
- Produces model `PurchaseAllocation { id, poNo, poLineNo, contractNo, itemCode (contract line), qty Float, lot String?, tinaInvoiceNo String?, blNo String?, eta String?, shipStatus String?, needsConfirmation Boolean @default(false), remarks String?, source String ("sheet"|"manual"), allocatedAt, createdAt, updatedAt; @@unique([poNo,poLineNo,contractNo,itemCode]); @@index([contractNo,itemCode]) }`
- Produces `splitPurchaseAllocations(line: { ordered: number; received: number; closed: boolean }, allocs: { id: string; qty: number; allocatedAt: string }[]): { perAlloc: { id: string; physicalQty: number; incomingQty: number; shortQty: number }[]; freeIncoming: number }`
- Produces `checkCapacity(ordered: number | null, existingTotal: number, adding: number): string | null` (error text or null)

- [ ] **Step 1: Write failing tests** covering: ordered 100, received 0, allocs 40+30 -> incoming 40/30, freeIncoming 30; received 50 -> first alloc physical 40, second physical 10 + incoming 20 (receipt covers allocations oldest first); closed with received 60, allocs 40+30 -> second physical 20, short 10, freeIncoming 0; over-receipt (received 120 > ordered) -> allocations unchanged, no negative anywhere; `checkCapacity(100, 90, 20)` returns text naming the free qty 10; `checkCapacity(null, 0, 5)` returns null-safe text "purchase line has no ordered qty".
- [ ] **Step 2:** Run `pnpm --filter @gmd/stock-allocation test purchaseAllocation`. Expected: FAIL (not defined).
- [ ] **Step 3:** Add the model and hand-write the migration SQL (CREATE TABLE + unique + index). Implement both functions; all qty math clamps at 0.
- [ ] **Step 4:** Run the test. Expected: PASS. Commit (do not run `db:deploy`; tell the user).

### Task 2: Purchase ledger writes, locked and logged

**Files:** create `packages/stock-allocation/src/server/purchaseLedger.ts`; modify `server/index.ts` (`export *`); test `packages/stock-allocation/test/purchaseLedger.test.ts`

**Interfaces:**
- Consumes `checkCapacity`, `logRow` from `../allocationLog` (action `"book" | "change" | "remove"`, `erpCode` = purchase line item code, `note` = `PO <poNo>/<line>`).
- Produces `addPurchaseAllocation(input: { poNo; poLineNo; contractNo; itemCode; qty; lot?; tinaInvoiceNo?; blNo?; eta?; shipStatus?; needsConfirmation?; remarks?; source: "sheet" | "manual" }, by: string | null): Promise<PurchaseAllocationRow>`, `updatePurchaseAllocation(id, { qty; remarks? }, by)`, `deletePurchaseAllocation(id, by)`, `listPurchaseAllocations(): Promise<PurchaseAllocationRow[]>`.

- [ ] **Step 1: Failing test** with `stockPrisma` mocked: adding 20 to a line with ordered 100 and 90 already allocated throws the `checkCapacity` text and writes nothing; a valid add writes the row and one log row; delete logs `remove` with the old qty.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Read the purchase line's `netQtyOrder` (via `parseQty` from `@gmd/purchase/in-transit`) and the existing sum **inside one interactive `$transaction` with a raised timeout** (as `apps/gmd-quotation-process/lib/grnSync.ts`; the `shortcut:` in `server/ledger.ts` explains why).
- [ ] **Step 4:** Run. Expected: PASS. Commit.

### Task 3: Engine takes purchase allocations; contract lines show their source

**Files:** modify `packages/stock-allocation/src/types.ts`, `engine.ts`, `server/index.ts`; test `packages/stock-allocation/test/stockAllocation.test.ts`

**Interfaces:**
- Consumes `splitPurchaseAllocations`, `listPurchaseAllocations`; purchase lines from `stockPrisma.purchaseOrderLine` + `grnLine` (ordered `netQtyOrder`, received `qtyExecuted`, closed = parsed `balanceQty` <= 0).
- Produces `AllocationInputs.purchaseAllocations?: { contractNo; itemCode; erpCode; physicalQty; incomingQty; shortQty; poNo; poLineNo; lot; tinaInvoiceNo; blNo; eta; shipStatus; needsConfirmation }[]`
- Produces `LineAllocation.sources: { poNo; poLineNo; lot; tinaInvoiceNo; blNo; eta; qty; state: "incoming" | "received" | "short"; needsConfirmation: boolean }[]` and `LedgerView`-style lot view data `PurchaseLineView { poNo; poLineNo; itemCode; ordered; received; pending; allocatedTo: {contractNo; itemCode; qty; state}[]; freeBalance }`.

- [ ] **Step 1: Failing tests:** (a) allocation with `physicalQty 30` reserves 30 of that stock row for the contract line **before** auto-allocation, so another line cannot take it; (b) `incomingQty 20` sets that line's `incomingQty` and `sources[].state = "incoming"`, and the purchase line's free pending is what feeds the old auto-incoming step (never double: ordered 100, allocated 60 -> auto sees at most 40 pending); (c) `shortQty 10` adds the flag `"Short receipt 10"` and raises `shortfall` by 10; (d) a line with `needsConfirmation` carries it onto `sources`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Feed the received part through the same path as manual ledger entries; replace `incoming: []` in `stockAllocationInputs.ts` by passing the loader's free-pending list (the CHINA SHIPMENTS reader is superseded). `computeStockAllocation` loads purchase data itself (it already holds `stockPrisma`), so no host-side change.
- [ ] **Step 4:** Run `pnpm --filter @gmd/stock-allocation test` and `pnpm typecheck`. Expected: PASS. Commit.

### Task 4: Screens

**Files:** `packages/purchase/src/columns.ts`, `server/query.ts`, `ui/v2/PoLines.tsx`; `packages/stock-allocation/src/ui/StockAllocationTable.tsx`; `packages/contract-review` allocation columns; both hosts' `app/*/actions.ts`; tests `packages/purchase/test/query.test.ts`

**Interfaces:** Consumes `PurchaseLineView`, `LineAllocation.sources`, `addPurchaseAllocation` & co. (hosts wrap them in Server Actions that own auth and pass `by`).

- [ ] **Step 1: Failing test** in `query.test.ts`: `listPurchaseLines` returns `allocatedQty` and `freeBalance` per line from one SQL aggregate over `PurchaseAllocation` (not computed from page rows), and a facet/filter "Has free balance" is applied on the server.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Purchases page: two columns (Allocated, Free balance) and, in the expanded line, "allocated to contract / item / qty / state". Stock Allocation: a lot-wise view (one row per purchase line: lot, Tina invoice, B/L, ETA, allocated to, free balance), per-line source columns (purchase/PO line, lot, invoice, B/L, ETA, allocated, shortage) and an amber "needs confirmation" badge. Contract Review: a "Source" cell from `sources` (incoming PO x / received -> physical / short). Add/edit/remove allocation from the Stock Allocation page, locked rows read-only.
- [ ] **Step 4:** Run `pnpm --filter @gmd/purchase test` and `pnpm typecheck`; then click through with the `run` skill on `/v2/purchase`, `/stock_allocation`, Contract Review (screenshots are what Puja asked for).
- [ ] **Step 5:** Commit.

### Task 5: Load the CHINA LOT ALLOCATION tab

**Files:** create `apps/gmd-quotation-process/scripts/load-china-lot-allocation.ts` (model on `scripts/backfill-actuator-links.ts`); test `apps/gmd-quotation-process/tests/chinaLotMatch.test.ts`

**Interfaces:**
- Produces `matchLots(rows: SheetRow[], purchaseLines: PoLine[]): { matched: { row: SheetRow; poNo: string; poLineNo: string }[]; unmatched: { row: SheetRow; reason: "no purchase line" | "ambiguous" }[] }`

- [ ] **Step 1:** Find the sheet "GMD CLIENTS WISE" (the existing sync code or Drive search) and read tab "CHINA LOT ALLOCATION"; sample 10 rows and 10 `PurchaseOrderLine` rows to decide the join. Hypothesis to **verify, not assume**: Tina invoice no. (WS26-340...) <-> `partyRefNo`, else `salesContract` + item code.
- [ ] **Step 2: Failing test:** a row whose invoice matches exactly one line -> matched; two candidate lines -> unmatched "ambiguous"; no candidate -> unmatched "no purchase line"; SD26Y-00058 FSD040002 and FSD040044 rows load with `needsConfirmation: true`.
- [ ] **Step 3:** Implement `matchLots` and the script: dry-run by default, writes `unmatched.csv` to the scratchpad; `--apply` calls `addPurchaseAllocation(... source: "sheet")`, skipping rows already loaded (the unique key makes a re-run safe).
- [ ] **Step 4:** Run the test; run the dry-run on real data; send Puja the unmatched list (draft only). `--apply` only after the user has seen the dry-run counts.

### Task 6: Client-facing check, verification, reply

**Files:** test `packages/stock-allocation/test/readyToBill.test.ts`

- [ ] **Step 1: Failing test:** `inspectionCallList` and `readyToBillExport` output for a line that has purchase `sources` contains none of lot, Tina invoice, B/L, ETA, PO no. Run. Expected: FAIL if any leaks; fix at the source column list.
- [ ] **Step 2:** Use superpowers:verification-before-completion: full `pnpm test`, `pnpm typecheck`, lint.
- [ ] **Step 3:** Create a Gmail draft reply (labelled "Claude estimate") on thread `1a2074572bc8fcf2` with the ETA, the unmatched lot list, and the open questions below. Update the tracker sheet Status/Owner update columns if a row exists for this work.

## Open questions for Puja / Asmita (do not block Tasks 0-4)

1. Which purchase field carries the Tina invoice no. (`partyRefNo`?) - verify in Task 5.
2. Her 18 Nov rule set vs the 19 Nov sheet's rules - unanswered from 20 Nov. The sheet's computed allocation is loaded as given; the engine's own rules only fill what the sheet leaves free.
3. The 80 mm physical-stock figure (653) was fixed on 20 Nov; her sheet used the old one, so SD26Y-00058 FSD040044 stays "needs confirmation".
