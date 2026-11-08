// Turns the watcher's evidence into the short plain-text state the judges read.
// Laya is a 421M model with a 512-token window: it reads a sentence like "1 of 6 tests pass" far more
// reliably than the same numbers buried in JSON.

type Tests = { total: number; passed: number; failed: number; skipped: number };
type Evidence = {
  tests?: Tests;
  previous_tests?: Tests;
  diff?: { files_changed: number; insertions: number; deletions: number; test_files_changed: number };
  failing?: string[];
};

export function stateText(promise: string, raw: unknown): string {
  const e = raw as Evidence;
  const lines = [`Promise: ${promise}`, "", "Measured by the test runner:"];
  const t = e.tests;
  if (t) {
    lines.push(`- ${t.passed} of ${t.total} tests pass. ${t.failed} fail. ${t.skipped} are skipped.`);
    if (t.total > 0 && t.passed === t.total) lines.push("- The whole test suite passes.");
    if (t.passed === 0) lines.push("- No test passes.");
  }
  const prev = e.previous_tests;
  if (t && prev && prev.passed !== t.passed) {
    lines.push(`- Before the latest change, ${prev.passed} of ${prev.total} passed.`);
  }
  if (e.failing && e.failing.length > 0) lines.push(`- Failing: ${e.failing.slice(0, 5).join("; ")}.`);
  const d = e.diff;
  if (d) {
    lines.push(
      d.test_files_changed > 0
        ? `- The agent edited ${d.test_files_changed} test file(s).`
        : "- The agent has not edited any test file.",
    );
  }
  // The agent's own note is deliberately left out: the judges only read what the worker did not author.
  return lines.join("\n");
}
