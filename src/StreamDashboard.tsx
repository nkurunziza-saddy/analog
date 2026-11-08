import { useEffect, useState } from "react";
import { address, isAddress, type Address } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import {
  cancelInstructions,
  claimInstructions,
  isStale,
  projectEarned,
  STATUS_CANCELLED,
  useLocal,
  useNow,
  useStream,
  type Evidence,
  type LiveStream,
  type Tick,
} from "./stream";

const EXPLORER = "https://explorer.solana.com";

function short(s: string, head = 4, tail = 4) {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function tokens(units: number, decimals: number, digits = 4) {
  return (units / 10 ** decimals).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function initialStreamParam(): string {
  return new URLSearchParams(window.location.search).get("stream") ?? "";
}

export function StreamDashboard() {
  const [input, setInput] = useState(initialStreamParam);
  const localStream = useLocal<{ stream: string } | null>("stream", 5_000);

  // Prefill from the local judge's stream.json when no ?stream= was given.
  useEffect(() => {
    if (!input && localStream?.stream) setInput(localStream.stream);
  }, [input, localStream]);

  const trimmed = input.trim();
  const streamAddress: Address | null = isAddress(trimmed) ? address(trimmed) : null;
  const { stream, error } = useStream(streamAddress);

  return (
    <div className="flex flex-col gap-8">
      <label className="flex flex-col gap-2">
        <span className="text-muted">Stream address</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a stream address"
          spellCheck={false}
          className="h-7 w-full rounded-md border border-border-low bg-cream/60 px-2 font-mono text-[12px] outline-none focus:border-accent-solid"
        />
        {trimmed && !streamAddress && <span className="text-status-warn">Not a valid address</span>}
        {streamAddress && error && <span className="text-status-warn">{error}</span>}
      </label>

      {stream ? <StreamPanel live={stream} /> : <EmptyState hasAddress={!!streamAddress && !error} />}

      <div className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <EvidencePanel />
        <TickLog />
      </div>
    </div>
  );
}

function EmptyState({ hasAddress }: { hasAddress: boolean }) {
  return (
    <section className="rounded-xl border border-border-low bg-card p-6 text-muted">
      {hasAddress ? (
        "Reading the stream from devnet"
      ) : (
        <>
          No stream yet. Create one with{" "}
          <code className="font-mono text-[12px] text-foreground">pnpm judge:create-stream</code>, or paste its address
          above.
        </>
      )}
    </section>
  );
}

function StreamPanel({ live }: { live: LiveStream }) {
  const { data, mint } = live;
  const now = useNow();
  const { wallet, status } = useWalletConnection();
  const { send, isSending } = useSendTransaction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [txNote, setTxNote] = useState<{ kind: "ok" | "error"; text: string; sig?: string } | null>(null);

  const [shown, setShown] = useState(0);
  const projected = projectEarned(data, now);
  // Never count backwards between polls.
  useEffect(() => {
    setShown((prev) => Math.max(prev, projected));
  }, [projected]);
  useEffect(() => setShown(0), [live.address]);

  const cancelled = data.status === STATUS_CANCELLED;
  const stale = !cancelled && isStale(data, now);
  const finished = !cancelled && Number(data.earned) >= Number(data.deposit);
  const p = data.lastP / 10_000;
  const rateNow = stale || cancelled ? 0 : Number(data.rateMax) * p;
  const claimable = Math.max(0, shown - Number(data.claimed));

  const me = status === "connected" ? wallet?.account.address.toString() : undefined;
  const isWorker = me === data.worker;
  const isPayer = me === data.payer;

  const state = cancelled
    ? { label: "Cancelled", tone: "text-muted", dot: "bg-muted" }
    : finished
      ? { label: "Fully paid", tone: "text-muted", dot: "bg-muted" }
      : stale
        ? {
            label: `Paused, no tick for ${Math.floor(now - Number(data.lastTickTs))}s`,
            tone: "text-status-warn",
            dot: "bg-status-warn",
          }
        : { label: "Streaming", tone: "text-status-ok", dot: "bg-status-ok" };

  async function run(kind: "claim" | "cancel") {
    setTxNote(null);
    try {
      const instructions = kind === "claim" ? await claimInstructions(live) : await cancelInstructions(live);
      const sig = await send({ instructions: [...instructions] });
      setTxNote({ kind: "ok", text: kind === "claim" ? "Claimed" : "Stream cancelled", sig: sig ?? undefined });
    } catch (err) {
      setTxNote({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setConfirmCancel(false);
    }
  }

  return (
    <section className="flex flex-col gap-6 rounded-xl border border-border-low bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted">Earned by the worker</span>
          <span className="text-[26px] leading-[34px] font-medium tabular-nums">
            {tokens(shown, mint.decimals)}
            <span className="ml-2 text-[13px] font-normal text-muted">
              of {tokens(Number(data.deposit), mint.decimals, 2)} tokens
            </span>
          </span>
          <span className="text-muted tabular-nums">
            Paying {tokens(rateNow, mint.decimals)}/s of {tokens(Number(data.rateMax), mint.decimals)}/s max
          </span>
        </div>
        <span className={`flex items-center gap-2 ${state.tone}`}>
          <span className={`h-2 w-2 rounded-full ${state.dot}`} aria-hidden />
          {state.label}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Judged probability the promise is being kept</span>
          <span className="text-[16px] font-medium tabular-nums">{p.toFixed(3)}</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-cream"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={p}
          aria-label="Judged probability"
        >
          <div className="h-full rounded-full bg-accent-solid" style={{ width: `${p * 100}%` }} />
        </div>
        <span className="text-[12px] text-muted">
          The lower of two judges. Both must sign every tick.
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Claimable" value={tokens(claimable, mint.decimals)} />
        <Stat label="Claimed" value={tokens(Number(data.claimed), mint.decimals)} />
        <Stat
          label={cancelled ? "Refunded to payer" : "Returns to payer on cancel"}
          value={tokens(Number(data.deposit) - shown, mint.decimals)}
        />
      </dl>

      <div className="flex flex-col gap-3 border-t border-border-low pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {isWorker && (
            <button
              onClick={() => run("claim")}
              disabled={isSending || claimable < 1}
              className="h-7 rounded-md bg-accent-solid px-3 font-medium text-accent-contrast transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] not-disabled:active:scale-[0.98] disabled:opacity-50"
            >
              Claim {tokens(claimable, mint.decimals, 2)} tokens
            </button>
          )}
          {isPayer && !cancelled && !confirmCancel && (
            <button
              onClick={() => setConfirmCancel(true)}
              disabled={isSending}
              className="h-7 rounded-md border border-border-low bg-card px-3 font-medium transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] not-disabled:active:scale-[0.98] disabled:opacity-50"
            >
              Cancel stream
            </button>
          )}
          {isPayer && confirmCancel && (
            <>
              <span className="text-muted">The worker keeps what they earned; the rest returns to you.</span>
              <button
                onClick={() => run("cancel")}
                disabled={isSending}
                className="h-7 rounded-md bg-foreground px-3 font-medium text-background transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] not-disabled:active:scale-[0.98] disabled:opacity-50"
              >
                Cancel stream
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                className="h-7 rounded-md border border-border-low bg-card px-3 font-medium"
              >
                Keep streaming
              </button>
            </>
          )}
          {!isWorker && !isPayer && (
            <span className="text-muted">
              {me ? "This wallet is neither the worker nor the payer." : "Connect a wallet to act on the stream."}{" "}
              The worker claims, the payer cancels.
            </span>
          )}
          {isSending && <span className="text-muted">Waiting for your wallet</span>}
        </div>
        {txNote && (
          <span className={txNote.kind === "error" ? "text-status-warn" : "text-muted"}>
            {txNote.text}
            {txNote.sig && (
              <>
                {" · "}
                <a
                  className="text-accent-solid"
                  href={`${EXPLORER}/tx/${txNote.sig}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                </a>
              </>
            )}
          </span>
        )}
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-[12px] text-muted sm:grid-cols-[auto_1fr]">
        <Meta label="Stream" value={live.address} />
        <Meta label="Worker" value={data.worker} />
        <Meta label="Payer" value={data.payer} />
        <Meta label="Judges" value={`${short(data.judgeA, 6, 6)}, ${short(data.judgeB, 6, 6)}`} link={false} />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted">{label}</dt>
      <dd className="text-[15px] font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Meta({ label, value, link = true }: { label: string; value: string; link?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="font-mono break-all">
        {link ? (
          <a href={`${EXPLORER}/address/${value}?cluster=devnet`} target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </>
  );
}

function EvidencePanel() {
  const evidence = useLocal<Evidence>("evidence", 1_000);
  const t = evidence?.tests;
  const prev = evidence?.previous_tests;
  const delta = t && prev ? t.passed - prev.passed : 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[15px] font-medium">What the judges see</h2>
      {!evidence || !t ? (
        <p className="text-muted">
          Evidence appears here while <code className="font-mono text-[12px]">pnpm worker:watch</code> runs.
        </p>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-border-low bg-card p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[21px] font-medium tabular-nums">
              {t.passed}/{t.total}
            </span>
            <span className="text-muted">tests passing</span>
            {delta !== 0 && (
              <span className={`tabular-nums ${delta > 0 ? "text-status-ok" : "text-status-warn"}`}>
                {delta > 0 ? `+${delta}` : delta}
              </span>
            )}
          </div>
          {(t.skipped > 0 || (evidence.diff?.test_files_changed ?? 0) > 0) && (
            <p className="text-status-warn">
              {t.skipped > 0 && `${t.skipped} skipped. `}
              {(evidence.diff?.test_files_changed ?? 0) > 0 && "Test files were edited."}
            </p>
          )}
          {evidence.failing && evidence.failing.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-muted">Failing</span>
              <ul className="flex flex-col gap-1">
                {evidence.failing.map((f) => (
                  <li key={f} className="font-mono text-[12px]">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evidence.diff && (
            <span className="text-muted tabular-nums">
              {evidence.diff.files_changed} files changed, +{evidence.diff.insertions} −{evidence.diff.deletions}
            </span>
          )}
          {evidence.agent_note?.text && (
            <div className="flex flex-col gap-1">
              <span className="text-muted">Agent note, written by the worker and not trusted</span>
              <p className="rounded-md bg-cream/60 px-3 py-2 text-[12px] break-words">{evidence.agent_note.text}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TickLog() {
  const ticks = useLocal<Tick[]>("ticks", 1_000);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[15px] font-medium">Ticks</h2>
      {!ticks || ticks.length === 0 ? (
        <p className="text-muted">
          Ticks appear here while <code className="font-mono text-[12px]">pnpm judge</code> runs.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-low bg-card">
          <table className="w-full text-left tabular-nums">
            <thead className="text-muted">
              <tr className="border-b border-border-low">
                <th className="px-3 py-2 font-normal">Time</th>
                <th className="px-3 py-2 font-normal">p</th>
                <th className="px-3 py-2 font-normal">Judges</th>
                <th className="px-3 py-2 font-normal">Input hash</th>
                <th className="px-3 py-2 font-normal">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {ticks.slice(0, 12).map((t) => (
                <tr key={`${t.n}-${t.ts}`} className="border-b border-border-low last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">{t.ts.slice(11, 19)}</td>
                  <td className="px-3 py-2 font-medium">{(t.pBps / 10_000).toFixed(3)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">
                    {t.verdicts.map((v) => v.p.toFixed(2)).join(" · ")}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{t.hash.slice(0, 10)}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">
                    {t.sig ? (
                      <a
                        className="text-accent-solid"
                        href={`${EXPLORER}/tx/${t.sig}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(t.sig, 6, 4)}
                      </a>
                    ) : (
                      <span className="text-muted">dry run</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
