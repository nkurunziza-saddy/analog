// The judge loop. Every TICK_MS it reads the evidence, asks both judges, and posts p = min(p_a, p_b)
// to every active stream that names these two judge keys, signed by both, with the hash of what they read.
//
//   pnpm judge                  # hosted judges when JEV_API_KEY is set in .env.local, else local Laya
//   JUDGES=laya,laya-alt pnpm judge
//   DRY_RUN=1 pnpm judge        # judge and log, post nothing
//   MAX_TICKS=5 pnpm judge      # stop after 5 ticks (metered keys)
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Base58EncodedBytes } from "@solana/kit";
import { getPostTickInstruction, getStreamDecoder, getStreamSize, VAULT_PROGRAM_ADDRESS } from "../src/generated/vault";
import { JUDGE_DIR, loadJudgeKeys, rpc, send } from "./chain";
import { makeJudge, type Questions, type Verdict } from "./judges";
import { stateText } from "./state";

const TICK_MS = Number(process.env.TICK_MS ?? 3_000);
const DRY_RUN = process.env.DRY_RUN === "1";
const MAX_TICKS = Number(process.env.MAX_TICKS ?? 0);
const EVIDENCE_FILE = process.env.EVIDENCE_FILE ?? join(JUDGE_DIR, "evidence.json");
const LOG_FILE = join(JUDGE_DIR, "ticks.jsonl");
// How often to look for new streams, and the most streams one transaction carries.
const DISCOVER_MS = 15_000;
const STREAMS_PER_TX = 8;
// Offset of judge_a in a Stream account: discriminator, payer, worker, mint, id, rate_max, deposit,
// earned, claimed, last_p, last_tick_ts, accrued_until.
const JUDGE_A_OFFSET = 8 + 32 * 3 + 8 * 5 + 2 + 8 + 8;

const [kindA, kindB] = (process.env.JUDGES ?? (process.env.JEV_API_KEY ? "laya-api,laya-api" : "laya,laya-alt")).split(",");
const judgeA = makeJudge(kindA);
const judgeB = makeJudge(kindB);

const promise = JSON.parse(readFileSync(join(JUDGE_DIR, "promise.json"), "utf8")) as {
  promise: string;
  questions: { a: Questions; b: Questions };
};

function readEvidence(): unknown {
  const file = existsSync(EVIDENCE_FILE) ? EVIDENCE_FILE : join(JUDGE_DIR, "evidence.example.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

const sha256 = (s: string) => new Uint8Array(createHash("sha256").update(s).digest());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const [keyA, keyB] = await loadJudgeKeys();

/** Active streams (not cancelled, not fully paid) that name both of our judge keys. */
async function activeStreams(): Promise<Address[]> {
  const res = await rpc
    .getProgramAccounts(VAULT_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(getStreamSize()) },
        { memcmp: { offset: BigInt(JUDGE_A_OFFSET), bytes: keyA.address as unknown as Base58EncodedBytes, encoding: "base58" } },
      ],
    })
    .send();
  const decoder = getStreamDecoder();
  return res
    .map((r) => ({ address: r.pubkey, data: decoder.decode(Buffer.from(r.account.data[0], "base64")) }))
    .filter((s) => s.data.judgeB === keyB.address && s.data.status === 0 && s.data.earned < s.data.deposit)
    .map((s) => s.address);
}

console.log(
  `[judge] ${judgeA.name} + ${judgeB.name}, every ${TICK_MS} ms${DRY_RUN ? " (dry run)" : ""}${MAX_TICKS ? `, ${MAX_TICKS} ticks` : ""}`,
);
console.log(`[judge] keys ${keyA.address}, ${keyB.address}`);

let streams: Address[] = [];
let discoveredAt = 0;
let failures = 0;
let n = 0;

for (;;) {
  const started = Date.now();
  try {
    if (!DRY_RUN && Date.now() - discoveredAt > DISCOVER_MS) {
      const found = await activeStreams();
      if (found.join() !== streams.join() || discoveredAt === 0)
        console.log(found.length ? `[judge] judging ${found.length} active stream(s)` : "[judge] no active streams name these judges; waiting");
      streams = found;
      discoveredAt = Date.now();
    }

    // Nothing to pay means nothing to judge: metered calls are only spent on live streams.
    if (!DRY_RUN && streams.length === 0) {
      await sleep(DISCOVER_MS);
      discoveredAt = 0;
      continue;
    }

    n++;
    const state = stateText(promise.promise, readEvidence());
    const input = JSON.stringify({ state, questions: promise.questions });
    const inputHash = sha256(input);

    const [va, vb]: Verdict[] = await Promise.all([
      judgeA.judge(state, promise.questions.a),
      judgeB.judge(state, promise.questions.b),
    ]);
    const p = Math.min(va.p, vb.p);
    const pBps = Math.round(p * 10_000);
    const hash = Buffer.from(inputHash).toString("hex");

    // One verdict, posted to every active stream, a few streams per transaction.
    const sigs: string[] = [];
    for (let i = 0; !DRY_RUN && i < streams.length; i += STREAMS_PER_TX) {
      const ixs = streams
        .slice(i, i + STREAMS_PER_TX)
        .map((stream) => getPostTickInstruction({ stream, judgeA: keyA, judgeB: keyB, pBps, inputHash }));
      sigs.push(await send(keyA, ixs));
    }
    const sig = sigs[0] ?? null;

    console.log(
      `#${n} p=${p.toFixed(3)} (${va.judge} ${va.p.toFixed(3)} ${va.ms}ms, ${vb.judge} ${vb.p.toFixed(3)} ${vb.ms}ms) hash=${hash.slice(0, 12)}${sig ? ` ${streams.length} stream(s) tx=${sig.slice(0, 12)}` : ""}`,
    );
    // Everything needed to replay the tick: the exact input, both verdicts, the hash and the transactions.
    appendFileSync(
      LOG_FILE,
      JSON.stringify({ n, ts: new Date().toISOString(), pBps, hash, sig, sigs, streams, input, verdicts: [va, vb] }) + "\n",
    );
    failures = 0;
  } catch (err) {
    // A missed tick is safe: the program stops paying after the stale window. Back off on repeated errors.
    failures++;
    console.error(`#${n} tick failed:`, err instanceof Error ? err.message : err);
  }
  if (MAX_TICKS > 0 && n >= MAX_TICKS) break;
  const backoff = failures > 1 ? Math.min(30_000, 1_000 * 2 ** failures) : 0;
  await sleep(Math.max(0, TICK_MS - (Date.now() - started)) + backoff);
}
console.log(`[judge] stopped after ${n} ticks`);
process.exit(0);
