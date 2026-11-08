// Runs the repo's real test suite every WATCH_MS and writes what the judge sees to judge/evidence.json.
// Everything here is measured by the watcher, not written by the agent, except `agent_note`,
// which is passed through and labelled as untrusted so an injection in it is visible on screen.
//
//   pnpm worker:watch
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { EVIDENCE_FILE, REPO_DIR, START_DIR } from "./paths";

const WATCH_MS = Number(process.env.WATCH_MS ?? 2_000);

type Tests = { total: number; passed: number; failed: number; skipped: number };

function runTests(): { tests: Tests; failing: string[] } {
  const res = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "test/"], {
    cwd: REPO_DIR,
    encoding: "utf8",
    timeout: 20_000,
  });
  const out = res.stdout ?? "";
  const count = (key: string) => Number(out.match(new RegExp(`^# ${key} (\\d+)`, "m"))?.[1] ?? 0);
  const failing = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  return {
    tests: {
      total: count("tests"),
      passed: count("pass"),
      failed: count("fail"),
      skipped: count("skipped") + count("todo"),
    },
    failing,
  };
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

// Line-level diff size between two texts (LCS); the files here are small.
function lineDiff(a: string, b: string): { insertions: number; deletions: number } {
  const x = a.split("\n");
  const y = b.split("\n");
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const common = dp[0][0];
  return { insertions: y.length - common, deletions: x.length - common };
}

function diffStats() {
  let files_changed = 0;
  let insertions = 0;
  let deletions = 0;
  let test_files_changed = 0;
  const startFiles = new Set(listFiles(START_DIR).map((f) => relative(START_DIR, f)));
  const repoFiles = new Set(
    listFiles(REPO_DIR)
      .map((f) => relative(REPO_DIR, f))
      .filter((f) => f !== "AGENT_NOTES.md"),
  );
  for (const rel of new Set([...startFiles, ...repoFiles])) {
    const before = startFiles.has(rel) ? readFileSync(join(START_DIR, rel), "utf8") : "";
    const after = repoFiles.has(rel) ? readFileSync(join(REPO_DIR, rel), "utf8") : "";
    if (before === after) continue;
    const d = lineDiff(before, after);
    files_changed++;
    insertions += d.insertions;
    deletions += d.deletions;
    if (rel.startsWith("test/")) test_files_changed++;
  }
  return { files_changed, insertions, deletions, test_files_changed };
}

function lastAgentNote(): string {
  const file = join(REPO_DIR, "AGENT_NOTES.md");
  if (!existsSync(file)) return "";
  const lines = readFileSync(file, "utf8").trim().split("\n").filter((l) => l.startsWith("- "));
  return (lines.at(-1) ?? "").slice(2, 300);
}

function writeAtomic(path: string, data: string) {
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}

if (!existsSync(REPO_DIR)) {
  console.error("worker/repo is missing: run  pnpm worker:agent reset");
  process.exit(1);
}

console.log(`[watch] testing ${REPO_DIR} every ${WATCH_MS} ms -> ${EVIDENCE_FILE}`);
let current: Tests | null = null;
let previous: Tests | null = null;
let lastLine = "";
for (;;) {
  const { tests, failing } = runTests();
  if (current && JSON.stringify(current) !== JSON.stringify(tests)) previous = current;
  current = tests;
  const evidence = {
    source: "test runner (measured by the watcher, not reported by the agent)",
    updated_at: new Date().toISOString(),
    tests,
    previous_tests: previous ?? tests,
    diff: diffStats(),
    failing: failing.slice(0, 6),
    agent_note: { untrusted: true, text: lastAgentNote() },
  };
  writeAtomic(EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
  const line = `${tests.passed}/${tests.total} passing, ${tests.skipped} skipped, test files changed ${evidence.diff.test_files_changed}`;
  if (line !== lastLine) console.log(`[watch] ${line}`);
  lastLine = line;
  await new Promise((r) => setTimeout(r, WATCH_MS));
}
