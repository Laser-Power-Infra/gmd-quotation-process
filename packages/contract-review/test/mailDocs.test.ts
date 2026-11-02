import test from "node:test";
import assert from "node:assert/strict";
import { appendMailDoc, parseMailDocs } from "../src/lib/columns";

test("parseMailDocs treats junk and unknown categories as empty", () => {
  assert.deepEqual(parseMailDocs(null), []);
  assert.deepEqual(parseMailDocs("not json"), []);
  assert.deepEqual(parseMailDocs('[{"c":"Bogus","u":"https://x"}]'), []);
  assert.equal(parseMailDocs('[{"c":"PO","u":"https://x","at":"t"}]').length, 1);
});

test("appendMailDoc validates, appends and de-duplicates", () => {
  assert.equal(appendMailDoc(null, "Nope", "https://x").ok, false);
  assert.equal(appendMailDoc(null, "PO", "ftp://x").ok, false);
  const a = appendMailDoc(null, "PO", " https://mail.google.com/x ");
  assert.ok(a.ok);
  const b = appendMailDoc(a.json, "PO", "https://mail.google.com/x");
  assert.ok(b.ok);
  assert.equal(parseMailDocs(b.json).length, 1);
  const c = appendMailDoc(b.json, "DI", "https://mail.google.com/x");
  assert.ok(c.ok);
  assert.deepEqual(parseMailDocs(c.json).map((d) => d.c), ["PO", "DI"]);
});
