// The judge loop: every TICK_MS, read the evidence, ask both judges, post p = min(p_a, p_b) on-chain,
// signed by both judge keys, with the hash of exactly what the judges saw.
//
//   pnpm judge                 # judges laya + laya-alt, posts to the stream in judge/stream.json
//   JUDGES=jev,laya pnpm judge # Jev as judge A once JEV_API_KEY is set
//   DRY_RUN=1 pnpm judge       # judge and log, post nothing
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { address } from "@solana/kit";
import { getPostTickInstruction } from "../src/generated/vault";
import { JUDGE_DIR, loadJudgeKeys, readStreamInfo, send } from "./chain";
import { makeJudge, type Questions, type Verdict } from "./judges";
import { stateText } from "./state";

const TICK_MS = Number(process.env.TICK_MS ?? 3_000);
const DRY_RUN = process.env.DRY_RUN === "1";
// Stop after this many ticks (0 = run forever); useful when judge calls are metered.
const MAX_TICKS = Number(process.env.MAX_TICKS ?? 0);
const EVIDENCE_FILE = process.env.EVIDENCE_FILE ?? join(JUDGE_DIR, "evidence.json");
const LOG_FILE = join(JUDGE_DIR, "ticks.jsonl");
// Laya reads at most 512 tokens; keep the serialized evidence well under that.
const MAX_EVIDENCE_CHARS = 1_500;

const [kindA, kindB] = (process.env.JUDGES ?? "laya,laya-alt").split(",");
const judgeA = makeJudge(kindA);
const judgeB = makeJudge(kindB);

const promise = JSON.parse(readFileSync(join(JUDGE_DIR, "promise.json"), "utf8")) as {
  promise: string;
  questions: { a: Questions; b: Questions };
};

function readEvidence(): unknown {
  const file = existsSync(EVIDENCE_FILE) ? EVIDENCE_FILE : join(JUDGE_DIR, "evidence.example.json");
  const raw = readFileSync(file, "utf8");
  const json = JSON.stringify(JSON.parse(raw));
  if (json.length > MAX_EVIDENCE_CHARS) {
    console.warn(`[judge] evidence is ${json.length} chars; Laya will truncate past ~512 tokens`);
  }
  return JSON.parse(json);
}

function sha256(bytes: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

// Node's HTTP/2 client can emit "socket idle timeout" on a pooled connection between ticks, outside any
// await. It doesn't affect the next request, so log it instead of letting it end the loop.
process.on("uncaughtException", (err: Error & { code?: string }) => {
  if (err.code === "UND_ERR_INFO" || /idle timeout/i.test(err.message)) {
    console.warn(`[judge] ignored connection error: ${err.message}`);
    return;
  }
  console.error(err);
  process.exit(1);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stream = DRY_RUN ? null : readStreamInfo();
const [keyA, keyB] = await loadJudgeKeys();
if (stream && (stream.judgeA !== keyA.address || stream.judgeB !== keyB.address)) {
  throw new Error("judge keys in judge/keys do not match the judges named in judge/stream.json");
}

console.log(`[judge] ${judgeA.name} + ${judgeB.name}, every ${TICK_MS} ms${DRY_RUN ? " (dry run)" : ""}`);
if (stream) console.log(`[judge] stream ${stream.stream}`);

let n = 0;
for (;;) {
  const started = Date.now();
  n++;
  try {
    const evidence = readEvidence();
    // State shared by both judges: the promise and the measured evidence, as plain text. Its hash goes on-chain.
    const state = stateText(promise.promise, evidence);
    const input = JSON.stringify({ state, questions: promise.questions });
    const inputHash = sha256(input);

    const [va, vb]: Verdict[] = await Promise.all([
      judgeA.judge(state, promise.questions.a),
      judgeB.judge(state, promise.questions.b),
    ]);
    const p = Math.min(va.p, vb.p);
    const pBps = Math.round(p * 10_000);
    const hashHex = Buffer.from(inputHash).toString("hex");

    let sig: string | null = null;
    if (stream) {
      const ix = getPostTickInstruction({
        stream: address(stream.stream),
        judgeA: keyA,
        judgeB: keyB,
        pBps,
        inputHash,
      });
      sig = await send(keyA, ix);
    }

    console.log(
      `#${n} p=${p.toFixed(3)} (${va.judge} ${va.p.toFixed(3)} ${va.ms}ms, ${vb.judge} ${vb.p.toFixed(3)} ${vb.ms}ms) hash=${hashHex.slice(0, 12)}${sig ? ` tx=${sig.slice(0, 12)}` : ""}`,
    );
    // Everything needed to replay the tick: the exact input, both verdicts, the hash and the transaction.
    appendFileSync(
      LOG_FILE,
      JSON.stringify({ n, ts: new Date().toISOString(), pBps, hash: hashHex, sig, input, verdicts: [va, vb] }) + "\n",
    );
  } catch (err) {
    // A missed tick is safe: the program stops paying after the stale window.
    console.error(`#${n} tick failed:`, err instanceof Error ? err.message : err);
  }
  if (MAX_TICKS > 0 && n >= MAX_TICKS) break;
  await sleep(Math.max(0, TICK_MS - (Date.now() - started)));
}
console.log(`[judge] stopped after ${n} ticks`);
process.exit(0);
