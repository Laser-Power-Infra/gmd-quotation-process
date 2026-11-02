import test from "node:test"
import assert from "node:assert/strict"
import { isAllowedEmailDomain, normalizeEmail } from "../lib/registration"

test("normalizeEmail trims and lower-cases", () => {
  assert.equal(normalizeEmail("  John.Doe@LaserPowerInfra.COM "), "john.doe@laserpowerinfra.com")
})

test("only company domains may register", () => {
  assert.ok(isAllowedEmailDomain("a@laserpowerinfra.com"))
  assert.ok(isAllowedEmailDomain("A@GMDALUI.CO.IN"))
  assert.ok(!isAllowedEmailDomain("a@gmail.com"))
  assert.ok(!isAllowedEmailDomain("a@evil-laserpowerinfra.com"))
  assert.ok(!isAllowedEmailDomain("a@laserpowerinfra.com.evil.com"))
  assert.ok(!isAllowedEmailDomain("a@sub.gmdalui.co.in"))
  assert.ok(!isAllowedEmailDomain("a@b@laserpowerinfra.com"))
})
