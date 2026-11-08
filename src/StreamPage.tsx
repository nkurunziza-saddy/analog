import { useEffect, useState } from "react";
import { address, isAddress } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { ExplorerLink, short, since, tokens } from "./format";
import { PLATFORM_JUDGES, useActivity, type Activity } from "./platform";
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
} from "./stream";
import {
  Button,
  Card,
  cn,
  Detail,
  DetailList,
  Empty,
  Heading,
  IconFlask,
  IconPulse,
  IconWallet,
  Pill,
  SectionTitle,
  type Tone,
} from "./ui";

export function StreamPage({ id }: { id: string }) {
  const streamAddress = isAddress(id) ? address(id) : null;
  const { stream, error } = useStream(streamAddress);
  const { wallet, status } = useWalletConnection();
  const me = status === "connected" ? wallet?.account.address.toString() : undefined;
  // The local judge reads one evidence feed for every stream it judges; show it on those streams (dev only).
  const isLocal = import.meta.env.DEV && stream?.data.judgeA === PLATFORM_JUDGES.a;

  const role = stream && me === stream.data.payer ? "You pay" : stream && me === stream.data.worker ? "You earn" : null;

  return (
    <div className="flex flex-col gap-6">
      <Heading
        size="page"
        title="Stream"
        subtitle={<span className="font-mono text-[22px]">{short(id, 6, 6)}</span>}
        action={role && <Pill tone="accent">{role}</Pill>}
      />

      {!streamAddress ? (
        <Empty icon={<IconPulse />} title="Not a stream address">
          Check the link, or open a stream from your list.
        </Empty>
      ) : !stream ? (
        <Empty icon={<IconPulse />} title={error ? "Stream not found" : "Reading the stream"}>
          {error ?? "Fetching it from devnet."}
        </Empty>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-10">
          <div className="flex flex-col gap-3">
            <StreamCard key={stream.address} live={stream} />
          </div>
          <div className="flex flex-col gap-8">
            {isLocal && <EvidenceSection />}
            <ActivitySection live={stream} />
          </div>
        </div>
      )}
    </div>
  );
}

function StreamCard({ live }: { live: LiveStream }) {
  const { data, mint } = live;
  const now = useNow();
  const { wallet, status } = useWalletConnection();
  const { send, isSending } = useSendTransaction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [txNote, setTxNote] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);

  const [shown, setShown] = useState(0);
  const projected = projectEarned(data, now);
  useEffect(() => {
    setShown((prev) => Math.max(prev, projected));
  }, [projected]);

  const cancelled = data.status === STATUS_CANCELLED;
  const stale = !cancelled && isStale(data, now);
  const finished = !cancelled && Number(data.earned) >= Number(data.deposit);
  const p = data.lastP / 10_000;
  const rateNow = stale || cancelled ? 0 : Number(data.rateMax) * p;
  const claimable = Math.max(0, shown - Number(data.claimed));

  const me = status === "connected" ? wallet?.account.address.toString() : undefined;
  const isWorker = me === data.worker;
  const isPayer = me === data.payer;

  const state: { label: string; tone: Tone; live?: boolean } = cancelled
    ? { label: "Cancelled", tone: "subtle" }
    : finished
      ? { label: "Fully paid", tone: "positive" }
      : stale
        ? { label: `Paused · no tick for ${since(now - Number(data.lastTickTs))}`, tone: "neutral" }
        : { label: "Streaming", tone: "accent", live: true };

  async function run(kind: "claim" | "cancel") {
    setTxNote(null);
    try {
      const instructions = kind === "claim" ? await claimInstructions(live) : await cancelInstructions(live);
      const sig = await send({ instructions: [...instructions] });
      setTxNote({ ok: true, text: kind === "claim" ? "Claimed" : "Stream cancelled", sig: sig ?? undefined });
    } catch (err) {
      setTxNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setConfirmCancel(false);
    }
  }

  return (
    <>
      <Card surfaceClassName="p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-fg-muted">Earned by the worker</p>
          <Pill tone={state.tone} live={state.live}>
            {state.label}
          </Pill>
        </div>
        <div className="nums mt-3 flex items-baseline gap-2 text-[44px] leading-none font-medium">
          {tokens(shown, mint.decimals)}
          <span className="text-[15px] font-normal tracking-normal text-fg-muted">
            of {tokens(Number(data.deposit), mint.decimals, 0)}
          </span>
        </div>
        <p className="nums mt-2 text-[13px] text-fg-muted">
          Paying {tokens(rateNow, mint.decimals)}/s of {tokens(Number(data.rateMax), mint.decimals)}/s max
        </p>

        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-fg-muted">Judged probability the promise is kept</span>
            <span className="nums text-[17px] font-medium">{p.toFixed(3)}</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={p}
            aria-label="Judged probability"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 ease-(--ease-out)"
              style={{ width: `${p * 100}%` }}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {isWorker && (
            <Button variant="accent" full loading={isSending} disabled={claimable < 1} onClick={() => run("claim")}>
              <IconWallet /> Claim {tokens(claimable, mint.decimals, 2)} tokens
            </Button>
          )}
          {isPayer && !cancelled && !confirmCancel && (
            <Button variant="outline" full disabled={isSending} onClick={() => setConfirmCancel(true)}>
              Cancel stream
            </Button>
          )}
          {isPayer && confirmCancel && (
            <div className="flex flex-col gap-2 rounded-2xl bg-surface p-3">
              <p className="text-[13px] text-fg-muted">
                The worker keeps the {tokens(shown, mint.decimals, 2)} tokens earned; the rest returns to you.
              </p>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" loading={isSending} onClick={() => run("cancel")}>
                  Cancel stream
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>
                  Keep streaming
                </Button>
              </div>
            </div>
          )}
          {!isWorker && !isPayer && (
            <p className="text-[13px] text-fg-muted">
              {me ? "This wallet is neither the worker nor the payer." : "Connect a wallet to act on this stream."} The
              worker claims; the payer cancels.
            </p>
          )}
          {txNote && (
            <p className={cn("text-[13px]", txNote.ok ? "text-fg-muted" : "text-negative")}>
              {txNote.text}
              {txNote.sig && (
                <>
                  {" · "}
                  <ExplorerLink kind="tx" value={txNote.sig}>
                    View transaction
                  </ExplorerLink>
                </>
              )}
            </p>
          )}
        </div>
      </Card>

      <DetailList>
        <Detail label="Claimable">
          <span className="nums">{tokens(claimable, mint.decimals)}</span>
        </Detail>
        <Detail label="Claimed">
          <span className="nums">{tokens(Number(data.claimed), mint.decimals)}</span>
        </Detail>
        <Detail label={cancelled ? "Refunded to payer" : "Returns to payer on cancel"}>
          <span className="nums">{tokens(Number(data.deposit) - shown, mint.decimals)}</span>
        </Detail>
        <Detail label="Worker" mono>
          <ExplorerLink kind="address" value={data.worker}>
            {short(data.worker, 6, 6)}
          </ExplorerLink>
        </Detail>
        <Detail label="Payer" mono>
          <ExplorerLink kind="address" value={data.payer}>
            {short(data.payer, 6, 6)}
          </ExplorerLink>
        </Detail>
        <Detail label="Judges" mono>
          {short(data.judgeA, 4, 4)}, {short(data.judgeB, 4, 4)}
        </Detail>
      </DetailList>
    </>
  );
}

function EvidenceSection() {
  const evidence = useLocal<Evidence>("evidence", 1_000);
  const t = evidence?.tests;
  const prev = evidence?.previous_tests;
  const delta = t && prev ? t.passed - prev.passed : 0;
  const gamed = t && (t.skipped > 0 || (evidence?.diff?.test_files_changed ?? 0) > 0);

  return (
    <section>
      <SectionTitle subtitle="Measured by the test runner, live from the local judge">What the judges see</SectionTitle>
      {!evidence || !t ? (
        <Empty icon={<IconFlask />} title="No evidence yet">
          Start the test runner with pnpm worker:watch, or from the dev console.
        </Empty>
      ) : (
        <Card surfaceClassName="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="nums flex items-baseline gap-2 text-[28px] leading-none font-medium">
              {t.passed}/{t.total}
              <span className="text-[15px] font-normal tracking-normal text-fg-muted">tests passing</span>
            </div>
            <div className="flex gap-1.5">
              {delta !== 0 && (
                <Pill tone={delta > 0 ? "positive" : "negative"}>
                  {delta > 0 ? `+${delta}` : delta} since last change
                </Pill>
              )}
              {gamed && <Pill tone="negative">Tests skipped or edited</Pill>}
            </div>
          </div>

          {evidence.failing && evidence.failing.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5">
              {evidence.failing.map((f) => (
                <li key={f} className="flex items-center gap-2 text-[13px]">
                  <span className="size-1.5 shrink-0 rounded-full bg-negative" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
          )}

          {evidence.agent_note?.text && (
            <div className="mt-5 rounded-2xl bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-fg-muted">Agent's note</span>
                <Pill tone="subtle">Not sent to the judges</Pill>
              </div>
              <p className="mt-2 text-[13px] break-words">{evidence.agent_note.text.replace(/^\d\d:\d\d:\d\d /, "")}</p>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}

const EVENT_LABEL: Record<Exclude<Activity["kind"], "tick">, string> = {
  create: "Stream created and funded",
  claim: "Worker claimed",
  cancel: "Payer cancelled",
};

function ActivitySection({ live }: { live: LiveStream }) {
  const items = useActivity(live.address);
  const now = useNow(1);

  return (
    <section>
      <SectionTitle subtitle="Ticks, claims and cancels, read from the chain">Activity</SectionTitle>
      {items === null ? (
        <Empty icon={<IconPulse />} title="Reading activity">
          Loading this stream's transactions from devnet.
        </Empty>
      ) : items.length === 0 ? (
        <Empty icon={<IconPulse />} title="No activity yet">
          Ticks from the two judges appear here as they land on-chain.
        </Empty>
      ) : (
        <Card padded={false} surfaceClassName="px-4 py-1">
          <ul className="divide-y divide-line">
            {items.map((a, i) => (
              <li key={a.sig} className={cn("flex items-center gap-4 py-3", i === 0 && "rise")}>
                {a.kind === "tick" ? (
                  <>
                    <span className="nums w-14 shrink-0 text-[17px] font-medium">{(a.pBps / 10_000).toFixed(3)}</span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-mono text-[12px] text-fg-subtle">sha256 {a.hash.slice(0, 16)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="w-14 shrink-0">
                      <Pill tone={a.kind === "claim" ? "positive" : a.kind === "cancel" ? "neutral" : "accent"}>
                        {a.kind === "claim" ? "Claim" : a.kind === "cancel" ? "Cancel" : "New"}
                      </Pill>
                    </span>
                    <span className="min-w-0 flex-1 text-[13px]">{EVENT_LABEL[a.kind]}</span>
                  </>
                )}
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="nums text-[12px] text-fg-muted">
                    {a.time ? `${since(now - a.time)} ago` : "Pending"}
                  </span>
                  <span className="text-[12px]">
                    {a.failed ? (
                      <Pill tone="negative">Failed</Pill>
                    ) : (
                      <ExplorerLink kind="tx" value={a.sig}>
                        {short(a.sig, 4, 4)}
                      </ExplorerLink>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
