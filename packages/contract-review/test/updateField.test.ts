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
