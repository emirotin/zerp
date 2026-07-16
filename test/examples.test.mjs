import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPresentation } from "../dist/check/checker.js";
import { formatReport } from "../dist/check/report.js";

for (const rootDir of [
  "test/fixtures/kitchen-sink",
  "examples/casino",
  "test/fixtures/wrapper-deck",
]) {
  test(`${rootDir} checks clean in both themes`, async () => {
    const report = await checkPresentation({ rootDir });
    const failures = report.findings.filter((f) => f.severity !== "unverifiable");
    assert.deepEqual(failures, [], formatReport(report));
  });
}
