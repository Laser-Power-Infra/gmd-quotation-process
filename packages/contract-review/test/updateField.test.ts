import test from "node:test";
import assert from "node:assert/strict";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { fillOnceColumns, resolveContractReviewFlags } from "../src/flags";
import { blankOnlyFieldsFor, editableFieldsFor, updateContractReviewField } from "../src/server/index";

// Allow-list is checked before any DB access, so no database is needed.
test("updateContractReviewField rejects fields outside the allow-list", async () => {
  for (const field of ["diagramUrl", "diagramVerdict", "contractNo", "bomId", "id"]) {
    const res = await updateContractReviewField("some-id", field, "x");
    assert.equal(res.success, false, field);
    assert.match(res.error ?? "", /cannot be edited/);
  }
});

// In-memory rows behind the ContractReview read and writes the guard makes.
const rows: Record<string, Record<string, unknown>> = {};
// Runs between the guard's read and its write: another user saving meanwhile.
let meanwhile = () => {};
type Where = { id: string } & Record<string, unknown>;
type Write = { where: Where; data: Record<string, unknown> };
Object.assign(tenderPrisma.contractReview, {
  findUnique: async ({ where: { id } }: { where: Where }) => {
    const snapshot = rows[id] ? { ...rows[id] } : null;
    meanwhile();
    return snapshot;
  },
  updateMany: async ({ where: { id, ...eq }, data }: Write) => {
    const row = rows[id];
    if (!row || !Object.entries(eq).every(([k, v]) => row[k] === v)) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  },
  update: async ({ where: { id }, data }: Write) => Object.assign(rows[id], data),
});

// What both apps' update action does for a caller with this role.
function savePoNo(role: string | null | undefined, id: string, value: string) {
  const flags = resolveContractReviewFlags({ blankOnlyColumns: fillOnceColumns(role) });
  return updateContractReviewField(id, "poNo", value, editableFieldsFor(flags), blankOnlyFieldsFor(flags));
}

test("PO NO: anyone can fill a blank one", async () => {
  for (const role of [undefined, "user", "admin"]) {
    for (const blank of [null, ""]) {
      rows.r = { poNo: blank };
      assert.equal((await savePoNo(role, "r", "PO-1")).success, true);
      assert.equal(rows.r.poNo, "PO-1");
    }
  }
});

test("PO NO: one holding only spaces counts as blank, and the fill is trimmed", async () => {
  rows.r = { poNo: "  " };
  assert.equal((await savePoNo("user", "r", " PO-1 ")).success, true);
  assert.equal(rows.r.poNo, "PO-1");
});

test("PO NO: a non-admin cannot change or clear a saved one", async () => {
  for (const role of [undefined, null, "user"]) {
    for (const value of ["PO-2", "  "]) {
      rows.r = { poNo: "PO-1" };
      const res = await savePoNo(role, "r", value);
      assert.equal(res.success, false);
      assert.match(res.error ?? "", /already saved/);
      assert.equal(rows.r.poNo, "PO-1");
    }
  }
});

test("PO NO: one saved by someone else meanwhile is not overwritten", async () => {
  rows.r = { poNo: null };
  meanwhile = () => { rows.r.poNo = "PO-1"; };
  const res = await savePoNo("user", "r", "PO-2");
  meanwhile = () => {};
  assert.equal(res.success, false);
  assert.equal(rows.r.poNo, "PO-1");
});

test("PO NO: an admin can change a saved one", async () => {
  rows.r = { poNo: "PO-1" };
  assert.equal((await savePoNo("admin", "r", "PO-2")).success, true);
  assert.equal(rows.r.poNo, "PO-2");
});

// APPROVAL DATE on a line a current drawing covers belongs to Drawings & QAP (guards both apps).
test("APPROVAL DATE: covered line refused, uncovered saved, lookup error fails closed without saving", async () => {
  const allowed = new Set(["approvalDate", "mcDate"]);
  const save = (field: string, covered: (ids: string[]) => Promise<Set<string>>) =>
    updateContractReviewField("a1", field, "01-Nov-2026", allowed, new Set(), covered);
  rows.a1 = { approvalDate: null, mcDate: null };
  const refused = await save("approvalDate", async (ids) => new Set(ids));
  assert.equal(refused.success, false);
  assert.match(refused.error ?? "", /Drawings & QAP/);
  assert.equal(rows.a1.approvalDate, null);
  const failed = await save("approvalDate", async () => { throw new Error("no table"); });
  assert.equal(failed.success, false);
  assert.match(failed.error ?? "", /Could not check Drawings & QAP/);
  assert.equal(rows.a1.approvalDate, null);
  assert.equal((await save("mcDate", async () => { throw new Error("unused"); })).success, true);
  assert.equal((await save("approvalDate", async () => new Set())).success, true);
  assert.equal(rows.a1.approvalDate, "01-Nov-2026");
});
