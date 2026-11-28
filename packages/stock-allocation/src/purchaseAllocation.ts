import type { PurchaseAllocationInput, PurchaseLineView } from "./types"
// Pure split of a purchase line's allocations into physical / incoming / short. Every qty clamps at 0.
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export function splitPurchaseAllocations(
  line: { ordered: number; received: number; closed: boolean },
  allocs: { id: string; qty: number; allocatedAt: string }[],
): { perAlloc: { id: string; physicalQty: number; incomingQty: number; shortQty: number }[]; freeIncoming: number } {
  let left = n(line.received)
  const byId = new Map<string, { id: string; physicalQty: number; incomingQty: number; shortQty: number }>()
  let incomingTotal = 0
  // oldest first: the receipt covers earlier allocations before later ones
  const sorted = [...allocs].sort((a, b) => (a.allocatedAt ?? '').localeCompare(b.allocatedAt ?? '') || a.id.localeCompare(b.id))
  for (const a of sorted) {
    const qty = n(a.qty)
    const physicalQty = Math.min(qty, left)
    left -= physicalQty
    const rest = qty - physicalQty
    const incomingQty = line.closed ? 0 : rest
    incomingTotal += incomingQty
    byId.set(a.id, { id: a.id, physicalQty, incomingQty, shortQty: line.closed ? rest : 0 })
  }
  const freeIncoming = line.closed ? 0 : Math.max(0, n(line.ordered) - n(line.received) - incomingTotal)
  return { perAlloc: allocs.map((a) => byId.get(a.id)!), freeIncoming }
}

/** Error text when `adding` would push a purchase line past its ordered qty, else null. */
export function checkCapacity(ordered: number | null, existingTotal: number, adding: number): string | null {
  if (ordered == null || !Number.isFinite(ordered) || ordered <= 0) return 'purchase line has no ordered qty'
  const free = Math.max(0, ordered - n(existingTotal))
  return n(adding) > free ? `only ${free} free on this purchase line` : null
}

type PurchaseLineIn = { poNo: string; poLineNo: string; itemCode: string; ordered: number; received: number; closed: boolean; eta: string | null }
type AllocRowIn = {
  id: string; poNo: string; poLineNo: string; contractNo: string; itemCode: string; qty: number; lot: string | null; tinaInvoiceNo: string | null
  blNo: string | null; eta: string | null; shipStatus: string | null; needsConfirmation: boolean; allocatedAt: string
}

/**
 * Engine inputs from purchase lines + their allocations: each allocation split received / incoming / short, the pending qty
 * no allocation claims (feeds the engine's auto-incoming, so nothing is counted twice) and the per-line view.
 */
export function buildPurchaseInputs(lines: PurchaseLineIn[], allocs: AllocRowIn[], isLive: (a: AllocRowIn) => boolean = () => true) {
  const purchaseAllocations: PurchaseAllocationInput[] = []
  const incoming: { erpCode: string; qty: number; eta: string | null }[] = []
  const views: PurchaseLineView[] = []
  // fixed order: ties between lines must not follow the caller's row order
  for (const pl of [...lines].sort((a, b) => a.poNo.localeCompare(b.poNo) || a.poLineNo.localeCompare(b.poLineNo))) {
    const all = allocs.filter((a) => a.poNo === pl.poNo && a.poLineNo === pl.poLineNo)
    // an allocation whose contract line is not live is released: it claims neither received stock nor pending qty
    const mine = all.filter(isLive)
    const { perAlloc, freeIncoming } = splitPurchaseAllocations(pl, mine)
    // eta stays null: Ready to Bill and Contract Review read it off the line; the delivery date lives on `sources` only
    if (freeIncoming > 0 && pl.itemCode.trim()) incoming.push({ erpCode: pl.itemCode, qty: freeIncoming, eta: null })
    const allocatedTo: PurchaseLineView['allocatedTo'] = []
    mine.forEach((a, i) => {
      const s = perAlloc[i]
      purchaseAllocations.push({
        contractNo: a.contractNo, itemCode: a.itemCode, erpCode: pl.itemCode, physicalQty: s.physicalQty, incomingQty: s.incomingQty,
        shortQty: s.shortQty, poNo: a.poNo, poLineNo: a.poLineNo, lot: a.lot, tinaInvoiceNo: a.tinaInvoiceNo, blNo: a.blNo,
        eta: a.eta, shipStatus: a.shipStatus, needsConfirmation: a.needsConfirmation, id: a.id, allocatedAt: a.allocatedAt,
      })
      for (const [state, qty] of [['received', s.physicalQty], ['incoming', s.incomingQty], ['short', s.shortQty]] as const) {
        if (qty > 0) allocatedTo.push({ contractNo: a.contractNo, itemCode: a.itemCode, qty, state })
      }
    })
    views.push({
      poNo: pl.poNo, poLineNo: pl.poLineNo, itemCode: pl.itemCode, ordered: n(pl.ordered), received: n(pl.received),
      // an unknown ordered qty still shows what is allocated as incoming, never 0 beside it
      pending: pl.closed ? 0 : Math.max(0, n(pl.ordered) - n(pl.received), perAlloc.reduce((t, p) => t + p.incomingQty, 0)), allocatedTo,
      freeBalance: Math.max(0, n(pl.ordered) - all.reduce((t, a) => t + n(a.qty), 0)),
    })
  }
  return { purchaseAllocations, incoming, views }
}
