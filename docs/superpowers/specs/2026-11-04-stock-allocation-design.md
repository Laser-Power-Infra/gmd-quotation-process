# Stock Allocation / Offer from Stock — design

Source: three mails from Puja Agarwal, 4 Nov 2026 (main request, sluice-valve CS/DI correction,
Physical Stock order-wise allocation). App: `apps/gmd-quotation-process`.

## Goal
For every live contract line (Contract Review: `status` blank, `clearanceStatus = APPROVED`,
`mcReceivedPending = Received`) show what can be offered from physical stock, never allocate the
same stock twice, and show the same allocation on the Physical Stock page per ERP code / location.

## Architecture (one engine, two pages)
```
tender DB ContractReview ──┐
stock DB PhysicalStock  ───┼─► computeStockAllocation()  ─► Stock Allocation tab (/stock_allocation)
stock DB StockAllocation ──┘        (lib/stockAllocation/)  └► Physical Stock page (allocations per row)
   (manual bookings + locked offers)
```
* Nothing auto-computed is persisted. The engine recomputes on every load from stock, live
  lines and the persisted ledger. Persisted ledger rows are only **manual bookings** and
  **locked offers** (Offer sent = Y). Stage is derived from Contract Review at render time, so
  it "updates automatically" with no sync job.
* Both pages call the same server loader, so figures always agree.

## Files (ownership)
| Area | Files | Owner |
|---|---|---|
| Ledger | `packages/db-stock/prisma/schema.prisma` (+ hand-written migration), `apps/gmd-quotation-process/lib/stockAllocation/ledger.ts` | Agent A |
| Engine | `lib/stockAllocation/types.ts`, `lib/stockAllocation/engine.ts`, `tests/stockAllocation*.test.ts` | Agent B |
| Physical Stock | `packages/physical-stock/src/{types,columns,ui/PhysicalStockPage}.ts(x)` | Agent C |
| Tab | `lib/stockAllocation/load.ts`, `app/stock_allocation/{page,actions}.ts(x)`, `components/stock-allocation/*`, `components/layout/nav-items.ts`, host `app/physical_stock/actions.ts` wiring | Agent D (after A+B) |

Shared types live in `lib/stockAllocation/types.ts` exactly as below. Agents A and C copy nothing:
A imports from it (B writes it first thing); C defines the `Allocation` shape locally in the package
`types.ts` (the package must not import from the app).

## Data model (stock DB, `packages/db-stock`)
```prisma
// Persisted allocation: a manual booking, or an Offer Now row locked by "Offer sent = Y".
// Keys are plain text: ContractReview lives in another database.
model StockAllocation {
  id          String   @id @default(cuid())
  erpCode     String
  location    String?            // KGP / BALTIKURI; null = any
  contractNo  String
  itemCode    String             // contract line item code
  qty         Float
  source      String             // "manual" | "locked"
  basis       String?            // "Finished" | "Assemble" | "Actuator to map" (locked rows)
  remarks     String?
  allocatedAt DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([erpCode])
  @@index([contractNo, itemCode])
}
```
Migration is hand-written under `packages/db-stock/prisma/migrations/20261104100000_stock_allocation/`.
Never `prisma db push`; the user runs `db:deploy`.

## Shared types (`lib/stockAllocation/types.ts`)
```ts
export type Stage = "Booked" | "Offered" | "Inspection done" | "Dispatched";
export type Basis = "Finished" | "Assemble" | "Actuator to map";

export interface StockItem {            // one PhysicalStock row
  id: string; erpCode: string; location: string | null;
  valveType: string | null; dimension: string | null; component: string | null;
  material: string | null; std: string | null; pn: string | null;   // l2, Dia, l4, l5, l6, l7
  category: string | null; itemType: string | null;                 // l8, item_type
  availableQty: number;
}
export interface ContractLine {         // one live ContractReview row
  id: string; contractNo: string; party: string; poNo: string | null; project: string | null;
  dateOfContract: string | null;        // as stored, e.g. "2-May-2024"; parse with lib/gmd_lib/dateParse
  itemCode: string; itemName: string; item: string | null; size: string | null; pnRating: string | null;
  actuator: string | null; rate: number; balanceQty: number;        // balanceQty = BAL BILL AG CONT
  inspection: "DONE" | "PENDING"; offer: "DONE" | "PENDING";
}
export interface LedgerEntry {          // persisted StockAllocation row
  id: string; erpCode: string; location: string | null; contractNo: string; itemCode: string;
  qty: number; source: "manual" | "locked"; basis: Basis | null; remarks: string | null; allocatedAt: string;
}
export interface Allocation {           // one stock row → one contract line
  stockId: string; erpCode: string; location: string | null;
  contractNo: string; itemCode: string; party: string; poNo: string | null;
  qty: number; stage: Stage; basis: Basis; source: "manual" | "locked" | "auto";
  ledgerId: string | null; spare: boolean; flags: string[]; allocatedAt: string | null;
}
export interface OfferLine {
  line: ContractLine; offerableQty: number; offerValue: number;      // rate × qty, excl. GST
  rmCodes: { erpCode: string; location: string | null; qty: number; spare: boolean }[];
  basis: Basis; flags: string[]; offerSent: boolean; remarks: string | null;
}
export interface LedgerView { erpCode: string; location: string | null; description: string; availableQty: number;
  allocatedTo: { contractNo: string; itemCode: string; qty: number; stage: Stage }[]; allocatedQty: number; freeBalance: number; }
export interface ShortContract { contractNo: string; party: string; shortValue: number;
  lines: { line: ContractLine; shortQty: number; shortValue: number }[]; }
export interface AllocationResult {
  allocations: Allocation[]; offerNow: OfferLine[]; ledger: LedgerView[]; notInStock: ShortContract[];
  summary: { finished: number; assemble: number; actuator: number; short: number;   // values (Rs)
             finishedLines: number; assembleLines: number; actuatorLines: number };
}
```

## Engine (`allocateStock({ stock, lines, ledger }): AllocationResult`, pure, tested)
Line attributes parsed from `item` + `itemName` (observed values in the DB):
* valve type: `SLV*`, `TPAV+SLV*` → SLUICE VALVE (TPAV+SLV = TPAV **and** SLUICE VALVE of the same
  size, both needed, qty = min); `BFV*` → BUTTERFLY VALVE; `TPAV` → TPAV; `NRV*` → CHECK VALVE;
  `DPCV*` → DPCV; `PRV` → PRESSURE REDUCING VALVE; `GLOBE VALVE`; `CF` → COMPANION FLANGE; others → not in stock.
* seat: "METAL" in item/itemName → metal; otherwise resilient. Stock seat: component METAL TO METAL = metal,
  METAL TO RUBBER = resilient; HW OP / GEAR OP / BLANK BASE / STD rows are resilient unless std says METAL.
* material: itemName has CAST STEEL / CARBON STEEL, or item has `CS` / `CAST STEEL` → CS (stock
  l5 "CARBON STEEL/CAST STEEL"); FORGED → FORGED STEEL; else DI (stock "DUCTILE IRON", "CAST IRON").
  **Sluice valves only:** CS stock may serve a DI line, flagged "CS offered against DI"; never DI stock for a CS line.
  All other types: material must match.
* rising: item/itemName has RISING (not NON-RISING) → rising, else non-rising. Stock l6 RISING* vs
  NON-RISING*/STD*. Must match for sluice valves.
* drilling: `9523` in item/itemName → only stock std ending `-9523`; `1538` → only plain; else either.
* PN: line "PN - 10"/"PN - 16" → stock PN-16 (or PN-10); stock PN-25 also allowed when size ≤ 80 and
  same drilling; line "PN - 20"/"PN - 25" → only PN-25; "CLASS-150#" → only "CLASS 150#" (same class).
* size: line `size` mm vs stock dimension "200MM".
* actuated: itemName has `_ACT`, `ACT_`, MOTORISED, ELECTRIC, or `actuator` non-blank → basis
  "Actuator to map", flag "actuator to be mapped (AUMA / Rotork)". Valve still allocated.
* Finished stock = l8 "FINISHED VALVES" or item_type "FINISHED / COMPLETE VALVE" → basis Finished.
  Assemble stock = component LIGHT BBD, or erp code starting RXA, or l8 SPARES/SS SPARES with a valve
  type + dimension → basis Assemble, `spare: true`, **pending lines only**.
* Ignore stock rows with blank / `#N/A` erp code or availableQty ≤ 0.
* Candidate order per line: exact `erpCode === itemCode` finished rows, then other finished matches
  (same PN before PN-25-for-PN16, same material before CS-for-DI), then assemble rows.

Priority order (free balance per stock row never below zero):
1. ledger entries (manual, locked) in `allocatedAt` order — stage Booked, or Offered/Inspection done when the line says so;
2. lines with inspection DONE (balanceQty > 0) — stage "Inspection done";
3. lines with offer DONE — stage "Offered";
4. pending lines, oldest `dateOfContract` first — stage "Booked" once allocated.
Lines with balanceQty ≤ 0 are dispatched/closed: skipped. A ledger entry whose line is closed (or missing) → stage "Dispatched", excluded from totals.

Outputs: `offerNow` = one row per line with offerableQty > 0 (offerSent = a locked ledger entry exists for
the line); `ledger` = per ERP code+location; `notInStock` = per contract, lines with shortQty =
balanceQty − offerableQty > 0, shortValue = shortQty × rate; `summary` by basis.

## Server loader (`lib/stockAllocation/load.ts`)
`computeStockAllocation()` reads live lines from `@gmd/db-tender` (`prisma.contractReview`, filters above),
stock from `stockPrisma.physicalStock`, ledger from `listLedger()`, maps to the shared types and runs the engine.
Party = `partyNameDump` else `erpPartyNameFromGmdSupplyHistory`; balanceQty/rate parsed with comma stripping.

## Ledger server (`lib/stockAllocation/ledger.ts`)
`listLedger(): Promise<LedgerEntry[]>`, `addBooking({erpCode, location, contractNo, itemCode, qty, remarks})`, `updateBooking(id, {qty, remarks})`,
`deleteBooking(id)`, `lockOffer({contractNo, itemCode, basis, remarks, rmCodes: {erpCode, location, qty}[]})` (one "locked" row per RM code, replacing earlier locked rows of that line),
`unlockOffer(contractNo, itemCode)`.
Validation: qty > 0; erpCode trimmed upper-case; contractNo/itemCode non-blank. Server actions in
`app/stock_allocation/actions.ts` call `requireAccess()` first, like every other page.

## Stock Allocation tab (`/stock_allocation`, nav group Contracts, after Contract Review)
Server page like `app/order_status/page.tsx` (`GMDUpdateHeader`, `force-dynamic`), client table component using
`components/execution/ui.tsx` primitives (`Tile`, `TH`, `TD`, `TDN`), `DebouncedSearchInput`, CSV export via `downloadCsv/toCsv`.
Views as sub-tabs: Offer Now | Stock Allocation Ledger | Not in Stock. Summary tiles on top (finished / assemble /
actuator offerable value, short value, each with line count). Offer Now columns: Contract, Party, Date, Item code, Item,
Rate, Balance qty, Offerable qty, Offer value, RM codes (qty, spare marked), Basis, Project, Offer sent (checkbox → lock),
Remarks (saved on the locked row). Ledger view has an "Add booking" form and per-row edit/delete for manual entries.

## Physical Stock page
`PhysicalStockRow` gains `allocations: Allocation[] | null` (null = host did not look up, like `in_transit`).
New trailing columns (index order matters, append at the end): "ALLOCATED QTY", "FREE QTY" (available − allocated,
min 0), "ALLOCATIONS" (expandable cell: one sub-row per order — Contract no, PO no, Party, Contract item code,
Allocated qty, Stage, Allocation date). CSV export writes one column set per order (`Order 1 contract`, `Order 1 qty`, …).
Filters in the toolbar: Location (KGP / BALTIKURI), Contract no / Party text, Free stock only / Allocated only.
Host `app/physical_stock/actions.ts` `load()` fills `allocations` from `computeStockAllocation()` keyed by stock row id,
inside a try/catch like the in-transit lookup (failure → null, page still loads).

## Testing
Engine: node:test files under `tests/` (run `pnpm test` in the app). Cover: exact-code match, CS-for-DI sluice only,
PN-25 for PN-16 ≤ DN80, drilling 9523, TPAV+SLV pair, actuator flag, assemble only for pending lines, priority order,
no negative balance, ledger first, locked = offerSent. Then `pnpm typecheck` in the app. Reconciliation against
Puja's 3 Nov figures (Rs 54.0 lakh / 54 lines offerable; Rs 4.2 cr short) happens on the test link.
