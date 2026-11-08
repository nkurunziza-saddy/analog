// The whole loop as one diagram: an off-chain lane (agent → tests → evidence → two judges → min) and an
// on-chain lane (post_tick → accrue → vault → claim / cancel). Blocks carry live values; an arrow moves
// only while data is flowing along it.
import type { ReactNode } from "react";
import { isStale, projectEarned, STATUS_CANCELLED, type LiveStream } from "./stream";
import { cn } from "./ui";

export type FlowInput = {
  now: number;
  autoRunning: boolean;
  judgeRunning: boolean;
  evidence: {
    updated_at: string;
    tests: { total: number; passed: number; failed: number; skipped: number };
    diff?: { test_files_changed: number };
    agent_note?: { text: string };
  } | null;
  lastTick: { ts: string; pBps: number; sig: string | null; verdicts: { p: number }[] } | null;
  stream: LiveStream | null;
};

type Tone = "live" | "idle" | "warn";

const W = 150;
const H = 64;

function Block({
  x,
  y,
  w = W,
  h = H,
  title,
  value,
  detail,
  tone,
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  title: string;
  value: string;
  detail?: string;
  tone: Tone;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={14}
        className={cn(
          "fill-raised stroke-[1.25]",
          tone === "live" ? "stroke-accent" : tone === "warn" ? "stroke-negative" : "stroke-line",
        )}
      />
      <circle
        cx={x + 14}
        cy={y + 17}
        r={3.5}
        className={tone === "live" ? "fill-accent" : tone === "warn" ? "fill-negative" : "fill-fg-subtle"}
      />
      <text x={x + 24} y={y + 21} className="fill-fg-muted text-[12.5px]">
        {title}
      </text>
      <text x={x + 12} y={y + 41} className="fill-fg text-[15px] font-medium">
        {value}
      </text>
      {detail && (
        <text x={x + 12} y={y + 57} className="fill-fg-subtle text-[11.5px]">
          {detail}
        </text>
      )}
    </g>
  );
}

function Edge({ d, active }: { d: string; active: boolean }) {
  return (
    <path
      d={d}
      fill="none"
      markerEnd={active ? "url(#arrow-live)" : "url(#arrow)"}
      className={cn("stroke-[1.5]", active ? "flow stroke-accent" : "stroke-fg-subtle/60")}
    />
  );
}

function Lane({ y, h, label, children }: { y: number; h: number; label: string; children?: ReactNode }) {
  return (
    <g>
      <rect x={6} y={y} width={1108} height={h} rx={18} className="fill-surface" />
      <text x={22} y={y + 22} className="fill-fg-muted text-[12.5px] font-medium">
        {label}
      </text>
      {children}
    </g>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ago = (s: number) => (s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`);

export function FlowDiagram({ now, autoRunning, judgeRunning, evidence, lastTick, stream }: FlowInput) {
  const evAge = evidence ? now - Date.parse(evidence.updated_at) / 1000 : Infinity;
  const testsLive = evAge < 6;
  const gamed = !!evidence && (evidence.tests.skipped > 0 || (evidence.diff?.test_files_changed ?? 0) > 0);
  const tickAge = lastTick ? now - Date.parse(lastTick.ts) / 1000 : Infinity;
  const ticking = judgeRunning && tickAge < 15;

  const s = stream?.data;
  const decimals = stream?.mint.decimals ?? 6;
  const unit = 10 ** decimals;
  const cancelled = s?.status === STATUS_CANCELLED;
  const paying = !!s && !cancelled && !isStale(s, now) && s.lastP > 0;
  const earned = s ? projectEarned(s, now) : 0;
  const p = (lastTick?.pBps ?? s?.lastP ?? 0) / 10_000;
  const rate = s ? (Number(s.rateMax) / unit) * (s.lastP / 10_000) : 0;
  const note = evidence?.agent_note?.text?.replace(/^\d\d:\d\d:\d\d /, "") ?? "";

  return (
    <div className="overflow-x-auto rounded-[20px] bg-surface p-1">
      <div className="min-w-[860px] rounded-2xl bg-raised p-3 shadow-card">
        <svg viewBox="0 0 1120 386" className="h-auto w-full font-sans" role="img" aria-label="How a payment is decided, from the agent's edit to the money it moves">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10Z" className="fill-fg-subtle/60" />
            </marker>
            <marker id="arrow-live" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10Z" className="fill-accent" />
            </marker>
          </defs>

          <Lane y={6} h={176} label="Off-chain · this machine" />
          <Lane y={204} h={176} label="On-chain · Solana devnet" />

          {/* off-chain lane, left to right */}
          <Block
            x={26}
            y={62}
            title="Agent"
            value={autoRunning ? "Fixing on a timer" : "Edits the repo"}
            detail={note ? clip(note, 22) : "No notes yet"}
            tone={autoRunning ? "live" : "idle"}
          />
          <Block
            x={206}
            y={62}
            title="Test runner"
            value={evidence ? `${evidence.tests.passed}/${evidence.tests.total} passing` : "Not running"}
            detail={evidence ? (testsLive ? "every 2 s" : `stopped ${ago(evAge)}`) : "start it below"}
            tone={testsLive ? "live" : evidence ? "warn" : "idle"}
          />
          <Block
            x={386}
            y={62}
            title="Evidence"
            value={evidence ? `${evidence.tests.failed} fail · ${evidence.tests.skipped} skip` : "None yet"}
            detail={gamed ? "tests skipped or edited" : "agent notes left out"}
            tone={!evidence ? "idle" : gamed ? "warn" : "live"}
          />
          <Block
            x={586}
            y={26}
            title="Judge A"
            value={lastTick?.verdicts[0] ? `p = ${lastTick.verdicts[0].p.toFixed(3)}` : "No verdict"}
            detail="all pass × none skipped"
            tone={ticking ? "live" : "idle"}
          />
          <Block
            x={586}
            y={106}
            title="Judge B"
            value={lastTick?.verdicts[1] ? `p = ${lastTick.verdicts[1].p.toFixed(3)}` : "No verdict"}
            detail="most pass × suite intact"
            tone={ticking ? "live" : "idle"}
          />
          <Block
            x={786}
            y={62}
            w={140}
            title="Lower score wins"
            value={lastTick ? `p = ${p.toFixed(3)}` : "—"}
            detail="min of both judges"
            tone={ticking ? "live" : "idle"}
          />

          <Edge d="M176 94 H202" active={testsLive} />
          <Edge d="M356 94 H382" active={testsLive} />
          <Edge d="M536 94 C561 94 561 58 582 58" active={ticking} />
          <Edge d="M536 94 C561 94 561 138 582 138" active={ticking} />
          <Edge d="M736 58 C761 58 761 94 782 94" active={ticking} />
          <Edge d="M736 138 C761 138 761 94 782 94" active={ticking} />
          <Edge d="M926 94 H1031 V256" active={ticking && !!lastTick?.sig} />

          {/* on-chain lane, right to left */}
          <Block
            x={956}
            y={260}
            w={150}
            title="post_tick"
            value={lastTick?.sig ? `posted ${ago(tickAge)}` : lastTick ? "dry run" : "No ticks"}
            detail="both judge keys sign"
            tone={ticking && lastTick?.sig ? "live" : "idle"}
          />
          <Block
            x={746}
            y={260}
            w={170}
            title="Accrue"
            value={!s ? "—" : paying ? `${rate.toFixed(4)} tokens/s` : cancelled ? "stopped" : "paused · 0/s"}
            detail={s ? `max ${(Number(s.rateMax) / unit).toString()}/s × p` : "max rate × p"}
            tone={paying ? "live" : "idle"}
          />
          <Block
            x={556}
            y={260}
            w={150}
            title="Vault"
            value={s ? `${((Number(s.deposit) - earned) / unit).toFixed(2)} left` : "No stream"}
            detail={s ? `of ${(Number(s.deposit) / unit).toFixed(0)} deposited` : "the deposit"}
            tone={paying ? "live" : "idle"}
          />
          <Block
            x={346}
            y={226}
            w={170}
            h={58}
            title="Worker claims"
            value={s ? `${(earned / unit).toFixed(4)} earned` : "—"}
            tone={paying ? "live" : "idle"}
          />
          <Block
            x={346}
            y={302}
            w={170}
            h={58}
            title="Payer cancels"
            value={s ? (cancelled ? "cancelled" : `refund ${((Number(s.deposit) - earned) / unit).toFixed(2)}`) : "—"}
            tone="idle"
          />

          <Edge d="M956 292 H920" active={ticking && !!lastTick?.sig} />
          <Edge d="M746 292 H710" active={paying} />
          <Edge d="M556 292 C536 292 536 255 520 255" active={paying} />
          <Edge d="M556 292 C536 292 536 331 520 331" active={false} />

          {/* what the loop guarantees */}
          <text x={26} y={254} className="fill-fg-muted text-[12.5px] font-medium">
            Guarantees
          </text>
          {[
            "Both judges sign every tick",
            "The lower score is paid",
            "Never more than the deposit",
            "Silent judges stop the flow",
            "Earned tokens stay the worker's",
          ].map((g, i) => (
            <text key={g} x={26} y={277 + i * 20} className="fill-fg-subtle text-[12px]">
              {g}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
