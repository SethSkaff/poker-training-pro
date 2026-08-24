import test from "node:test";
import assert from "node:assert/strict";
import { validateNpmAuditReport } from "./dependency-security-lib.mjs";

test("npm audit schema fails closed for malformed and non-finite counts", () => {
  assert.ok(validateNpmAuditReport({}).errors.length > 0);
  assert.ok(validateNpmAuditReport({
    auditReportVersion: 2,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: NaN, critical: 0, total: 0 } },
  }).errors.some((error) => error.includes("high")));
});

test("npm audit schema accepts complete consistent finite counts", () => {
  assert.deepEqual(validateNpmAuditReport({
    auditReportVersion: 2,
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 2, high: 0, critical: 0, total: 3 } },
  }).errors, []);
});
