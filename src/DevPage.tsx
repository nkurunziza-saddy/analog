import { useCallback, useEffect, useState, type ReactNode } from "react";
import { address, isAddress } from "@solana/kit";
import { isStale, projectEarned, STATUS_CANCELLED, useNow, useStream } from "./stream";
import {
  Button,
  Card,
  cn,
  Empty,
  fieldClass,
  IconCheck,
  IconExternal,
  IconMinus,
  IconPlay,
  IconPulse,
  IconStop,
  IconX,
  Pill,
  SectionTitle,
  Segmented,
  type Tone,
} from "./ui";

// ---------------------------------------------------------------- data

type ProcView = {
  running: boolean;
  startedAt: number | null;
  exitCode: number | null;
  opts: Record<string, unknown> | null;
  log: string[];
};
type Verdict = { judge: string; p: number; answers: Record<string, number>; ms: number };
type DevTick = {
  n: number;
  ts: string;
  pBps: number;
  hash: string;
  sig: string | null;
  verdicts: Verdict[];
  state: unknown;
};
type Question = { type: string; instructions: string };
type Status = {
  procs: { watch: ProcView; judge: ProcView; auto: ProcView };
  agentLog: string[];
  evidence: {
    updated_at: string;
    tests: { total: number; passed: number; failed: number; skipped: number };
    results?: { name: string; status: "pass" | "fail" | "skip" }[];
    diff?: { test_files_changed: number };
    agent_note?: { text: string };
  } | null;
  stream: { stream: string } | null;
  promise: { promise: string; questions: { a: Record<string, Question>; b: Record<string, Question> } } | null;
  ticks: DevTick[];
  hasApiKey: boolean;
  now: number;
};

function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/status");
      if (!res.ok) throw new Error(String(res.status));
      setStatus(await res.json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 1_000);
    return () => clearInterval(id);
  }, [load]);
  return { status, offline, reload: load };
}

async function post(path: string, body: unknown): Promise<{ error?: string; output?: string }> {
  const res = await fetch(`/api/dev${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const EXPLORER = "https://explorer.solana.com";

function ago(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

// ---------------------------------------------------------------- page

type LiveStreamView = ReturnType<typeof useStream>["stream"];

export function DevPage() {
  const { status, offline, reload } = useStatus();
  const now = useNow(4);
  const streamAddr = status?.stream?.stream && isAddress(status.stream.stream) ? address(status.stream.stream) : null;
  const { stream } = useStream(streamAddr, 2_000);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-fg-muted">Dev console</p>
          <p className="text-[19px] font-medium tracking-tight">Run the pipeline and see how p is decided</p>
        </div>
        {status && <ProcPills status={status} />}
      </header>

      {offline && (
        <Empty icon={<IconPulse />} title="The dev API isn't reachable">
          It only runs under pnpm dev. Restart the dev server and this page reconnects.
        </Empty>
      )}

      {status && (
        <>
          <Pipeline status={status} now={now} stream={stream} />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-10">
            <div className="flex flex-col gap-8">
              <Controls status={status} reload={reload} now={now} />
              <Tests status={status} />
            </div>
            <div className="flex flex-col gap-8">
              <TickLogic status={status} stream={stream} />
              <Logs status={status} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ProcPills({ status }: { status: Status }) {
  const items: { label: string; on: boolean }[] = [
    { label: "Test runner", on: status.procs.watch.running },
    { label: "Judge", on: status.procs.judge.running },
    { label: "Auto-fix", on: status.procs.auto.running },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Pill key={i.label} tone={i.on ? "accent" : "subtle"} live={i.on} dot={!i.on}>
          {i.label}
        </Pill>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- workflow map

type Health = "live" | "idle" | "warn";
const HEALTH_TONE: Record<Health, Tone> = { live: "accent", idle: "subtle", warn: "negative" };
const HEALTH_LABEL: Record<Health, string> = { live: "Live", idle: "Idle", warn: "Check" };

function Pipeline({ status, now, stream }: { status: Status; now: number; stream: LiveStreamView }) {
  const ev = status.evidence;
  const evAge = ev ? now - Date.parse(ev.updated_at) / 1000 : Infinity;
  const last = status.ticks[0];
  const tickAge = last ? now - Date.parse(last.ts) / 1000 : Infinity;
  const s = stream?.data;
  const earned = s ? projectEarned(s, now) : 0;
  const decimals = stream?.mint.decimals ?? 6;
  const stale = s ? isStale(s, now) : true;
  const cancelled = s?.status === STATUS_CANCELLED;
  const note = ev?.agent_note?.text ?? "";
  const gamed = ev && (ev.tests.skipped > 0 || (ev.diff?.test_files_changed ?? 0) > 0);

  const stages: { title: string; health: Health; value: string; detail: string }[] = [
    {
      title: "Agent",
      health: status.procs.auto.running ? "live" : "idle",
      value: status.procs.auto.running ? "Fixing on a timer" : "Waiting",
      detail: note ? note.replace(/^\d\d:\d\d:\d\d /, "") : "No notes yet",
    },
    {
      title: "Test runner",
      health: evAge < 6 ? "live" : ev ? "warn" : "idle",
      value: ev ? `${ev.tests.passed}/${ev.tests.total} passing` : "No results",
      detail: ev ? (evAge < 6 ? `Ran ${ago(evAge)}` : `Stopped ${ago(evAge)}`) : "Start the test runner",
    },
    {
      title: "Evidence",
      health: !ev ? "idle" : gamed ? "warn" : "live",
      value: ev ? `${ev.tests.failed} failing · ${ev.tests.skipped} skipped` : "None",
      detail: gamed ? "Tests skipped or edited" : "Agent notes are left out",
    },
    {
      title: "Judges",
      health: status.procs.judge.running ? "live" : "idle",
      value: last ? last.verdicts.map((v) => v.p.toFixed(2)).join(" · ") : "No verdicts",
      detail: status.procs.judge.running ? "Ticking" : last ? `Last verdict ${ago(tickAge)}` : "Start the judge",
    },
    {
      title: "Chain",
      health: last?.sig && tickAge < 20 ? "live" : "idle",
      value: last ? `p = ${(last.pBps / 10_000).toFixed(3)}` : "No ticks",
      detail: last?.sig ? `post_tick ${ago(tickAge)}` : last ? "Dry run, not posted" : "Both judges sign",
    },
    {
      title: "Stream",
      health: !s || cancelled || stale ? "idle" : "live",
      value: s ? `${(earned / 10 ** decimals).toFixed(4)} earned` : "No stream",
      detail: !s ? "Run create-stream" : cancelled ? "Cancelled" : stale ? "Paused, judge silent" : "Paying",
    },
  ];

  return (
    <section>
      <SectionTitle>Workflow</SectionTitle>
      <ol className="grid gap-2 rounded-[20px] bg-surface p-1 sm:grid-cols-3 lg:grid-cols-6">
        {stages.map((st, i) => (
          <li key={st.title} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-raised p-3.5 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[12px] text-fg-muted">
                {i + 1} · {st.title}
              </span>
              <Pill tone={HEALTH_TONE[st.health]} live={st.health === "live"} className="h-5 px-2 text-[11px]">
                {HEALTH_LABEL[st.health]}
              </Pill>
            </div>
            <span className="nums truncate text-[15px] font-medium">{st.value}</span>
            <span className="truncate text-[12px] text-fg-subtle" title={st.detail}>
              {st.detail}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- controls

const AGENT_ACTIONS: { cmd: string; label: string }[] = [
  { cmd: "reset", label: "Reset repo" },
  { cmd: "step", label: "Fix one test" },
  { cmd: "break", label: "Break tests" },
  { cmd: "unbreak", label: "Undo break" },
  { cmd: "inject", label: "Plant injection" },
  { cmd: "cheat", label: "Skip tests" },
];

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1">
      <div>
        <p className="text-[14px] font-medium">{title}</p>
        {hint && <p className="mt-0.5 text-[13px] text-fg-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Controls({ status, reload, now }: { status: Status; reload: () => void; now: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepSeconds, setStepSeconds] = useState(20);
  const [judges, setJudges] = useState("laya-api,laya-api");
  const [maxTicks, setMaxTicks] = useState(3);
  const [tickSeconds, setTickSeconds] = useState(3);
  const [dryRun, setDryRun] = useState(false);

  async function act(key: string, fn: () => Promise<{ error?: string }>) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (r.error) setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      reload();
    }
  }

  const { watch, judge, auto } = status.procs;
  const evAge = status.evidence ? now - Date.parse(status.evidence.updated_at) / 1000 : Infinity;
  const externalWatch = !watch.running && evAge < 6;
  const paid = judges.includes("api") || judges.includes("jev");

  return (
    <section>
      <SectionTitle>Controls</SectionTitle>
      <Card surfaceClassName="px-4 py-3">
        <div className="divide-y divide-line">
          <Row title="Agent" hint="Edits the demo repo for real. The judges only see the test results.">
            <div className="flex flex-wrap gap-1.5">
              {AGENT_ACTIONS.map((a) => (
                <Button
                  key={a.cmd}
                  size="sm"
                  variant="secondary"
                  loading={busy === a.cmd}
                  disabled={(busy !== null && busy !== a.cmd) || auto.running}
                  onClick={() => act(a.cmd, () => post("/agent", { cmd: a.cmd }))}
                >
                  {a.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {auto.running ? (
                <Button size="sm" variant="outline" onClick={() => act("auto", () => post("/proc/stop", { name: "auto" }))}>
                  <IconStop /> Stop auto-fix
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => act("auto", () => post("/proc/start", { name: "auto", opts: { stepSeconds } }))}
                >
                  <IconPlay /> Auto-fix
                </Button>
              )}
              <label className="flex items-center gap-2 text-[13px] whitespace-nowrap text-fg-muted">
                one fix every
                <NumberField value={stepSeconds} onChange={setStepSeconds} min={3} max={120} disabled={auto.running} />
                seconds
              </label>
            </div>
          </Row>

          <Row
            title="Test runner"
            hint={externalWatch ? "Already running in a terminal. Results are fresh." : "Runs the real tests every 2 seconds."}
          >
            <div>
              {watch.running ? (
                <Button size="sm" variant="outline" onClick={() => act("watch", () => post("/proc/stop", { name: "watch" }))}>
                  <IconStop /> Stop test runner
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={externalWatch ? "outline" : "primary"}
                  disabled={busy !== null || externalWatch}
                  onClick={() => act("watch", () => post("/proc/start", { name: "watch" }))}
                >
                  <IconPlay /> Start test runner
                </Button>
              )}
            </div>
          </Row>

          <Row
            title="Judge"
            hint={
              paid
                ? `Each tick makes 2 metered calls. This run uses ${maxTicks === 0 ? "calls until you stop it" : `${maxTicks * 2} calls`}.`
                : "Local Laya is free and downloads about 1.7 GB on first run."
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="col-span-2 flex flex-col gap-1.5 text-[13px] text-fg-muted">
                Judges
                <select
                  value={judges}
                  onChange={(e) => setJudges(e.target.value)}
                  disabled={judge.running}
                  className={fieldClass}
                >
                  <option value="laya-api,laya-api">Hosted Laya × 2</option>
                  <option value="laya,laya-alt">Local Laya × 2</option>
                  <option value="jev,laya">Jev + local Laya</option>
                  <option value="jev,laya-api">Jev + hosted Laya</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                Ticks
                <NumberField value={maxTicks} onChange={setMaxTicks} min={0} max={500} disabled={judge.running} wide />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                Every (s)
                <NumberField value={tickSeconds} onChange={setTickSeconds} min={2} max={60} disabled={judge.running} wide />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-fg-muted">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                disabled={judge.running}
                className="size-4 accent-(--accent)"
              />
              Dry run: judge without posting on-chain
            </label>
            {paid && !status.hasApiKey && (
              <p className="text-[13px] text-negative">No JEV_API_KEY in .env.local, so the judge can't start.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {judge.running ? (
                <Button size="md" variant="outline" onClick={() => act("judge", () => post("/proc/stop", { name: "judge" }))}>
                  <IconStop /> Stop judge
                </Button>
              ) : (
                <Button
                  size="md"
                  variant="accent"
                  loading={busy === "judge"}
                  disabled={busy !== null && busy !== "judge"}
                  onClick={() =>
                    act("judge", () =>
                      post("/proc/start", {
                        name: "judge",
                        opts: { judges, maxTicks, tickMs: tickSeconds * 1000, dryRun },
                      }),
                    )
                  }
                >
                  <IconPlay />
                  {maxTicks === 0 ? "Start judge" : `Run ${maxTicks} ${maxTicks === 1 ? "tick" : "ticks"}`}
                </Button>
              )}
              {!judge.running && judge.exitCode !== null && judge.exitCode !== 0 && (
                <span className="text-[13px] text-negative">Judge exited with code {judge.exitCode}. Its log has why.</span>
              )}
            </div>
          </Row>
        </div>
        {error && <p className="pb-1 text-[13px] text-negative">{error}</p>}
      </Card>
    </section>
  );
}

function NumberField({
  value,
  onChange,
  min,
  max,
  disabled,
  wide,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
      className={
        wide
          ? cn(fieldClass, "nums")
          : "nums h-8 w-16 rounded-full bg-surface-2 px-3 text-[13px] text-fg outline-none focus:bg-raised focus:shadow-[inset_0_0_0_1.5px_var(--accent)] disabled:opacity-50"
      }
    />
  );
}

// ---------------------------------------------------------------- latest tick, explained

function TickLogic({ status, stream }: { status: Status; stream: LiveStreamView }) {
  const [index, setIndex] = useState(0);
  const tick = status.ticks[Math.min(index, Math.max(0, status.ticks.length - 1))];
  const questions = status.promise?.questions;
  const sets = questions ? [questions.a, questions.b] : [];
  const decimals = stream?.mint.decimals ?? 6;
  const rateMax = stream ? Number(stream.data.rateMax) / 10 ** decimals : null;
  const stale = stream ? Number(stream.data.staleAfter) : null;

  return (
    <section>
      <SectionTitle
        action={
          status.ticks.length > 1 && (
            <select
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              aria-label="Tick"
              className="h-7 rounded-full bg-surface-2 px-3 text-[13px] text-fg outline-none"
            >
              {status.ticks.map((t, i) => (
                <option key={`${t.n}-${t.ts}`} value={i}>
                  {i === 0 ? "Latest tick" : new Date(t.ts).toLocaleTimeString()} · p {(t.pBps / 10_000).toFixed(3)}
                </option>
              ))}
            </select>
          )
        }
      >
        How p was decided
      </SectionTitle>

      {!tick ? (
        <Empty icon={<IconPulse />} title="No ticks yet">
          Run the judge and each tick is taken apart here, from what the judges read to what it pays.
        </Empty>
      ) : (
        <Card surfaceClassName="p-0">
          <ol className="divide-y divide-line">
            <Step n={1} title="What the judges read">
              <pre className="max-h-52 overflow-auto rounded-xl bg-surface p-3 font-mono text-[12px] leading-[18px] whitespace-pre-wrap text-fg-muted">
                {typeof tick.state === "string" ? tick.state : JSON.stringify(tick.state, null, 2)}
              </pre>
            </Step>

            <Step n={2} title="Each judge answers; its p is the product of its answers">
              <div className="grid gap-4 sm:grid-cols-2">
                {tick.verdicts.map((v, i) => (
                  <div key={i} className="flex flex-col gap-3 rounded-xl bg-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">Judge {i === 0 ? "A" : "B"}</span>
                      <span className="nums text-[12px] text-fg-subtle">
                        {v.judge} · {v.ms} ms
                      </span>
                    </div>
                    {Object.entries(v.answers).map(([key, ans]) => (
                      <div key={key} className="flex flex-col gap-1.5">
                        <div className="flex justify-between gap-3 text-[13px]">
                          <span className="text-fg-muted" title={key}>
                            {sets[i]?.[key]?.instructions ?? key}
                          </span>
                          <span className="nums">{ans.toFixed(3)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-fg/50" style={{ width: `${ans * 100}%` }} />
                        </div>
                      </div>
                    ))}
                    <span className="nums text-[13px] text-fg-muted">
                      {Object.values(v.answers)
                        .map((a) => a.toFixed(3))
                        .join(" × ")}{" "}
                      = <span className="font-medium text-fg">{v.p.toFixed(3)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Step>

            <Step n={3} title="The lower judge wins">
              <p className="nums text-[15px]">
                min({tick.verdicts.map((v) => v.p.toFixed(3)).join(", ")}) ={" "}
                <span className="font-medium">{(tick.pBps / 10_000).toFixed(3)}</span>
                <span className="text-fg-muted"> · posted as {tick.pBps} bps</span>
              </p>
            </Step>

            <Step n={4} title="Posted on-chain with the hash of step 1">
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[12px] break-all text-fg-muted">sha256 {tick.hash}</span>
                {tick.sig ? (
                  <a
                    className="inline-flex items-center gap-1 text-[13px] text-accent"
                    href={`${EXPLORER}/tx/${tick.sig}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View the post_tick transaction <IconExternal className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-[13px] text-fg-subtle">Dry run, not posted</span>
                )}
              </div>
            </Step>

            <Step n={5} title="What it pays">
              {rateMax !== null ? (
                <p className="nums text-[15px]">
                  {rateMax} × {(tick.pBps / 10_000).toFixed(3)} ={" "}
                  <span className="font-medium">{((rateMax * tick.pBps) / 10_000).toFixed(4)} tokens/s</span>
                  <span className="block text-[13px] text-fg-muted">
                    Until the next tick, or for {stale} s if none comes.
                  </span>
                </p>
              ) : (
                <span className="text-[13px] text-fg-subtle">No stream loaded</span>
              )}
            </Step>
          </ol>
        </Card>
      )}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 p-4">
      <span className="nums grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-medium text-fg-muted">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <p className="text-[13px] font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- tests and logs

const MARK = {
  pass: { Icon: IconCheck, label: "Pass", tone: "positive" as Tone },
  fail: { Icon: IconX, label: "Fail", tone: "negative" as Tone },
  skip: { Icon: IconMinus, label: "Skipped", tone: "subtle" as Tone },
};

function Tests({ status }: { status: Status }) {
  const results = status.evidence?.results ?? [];
  const passed = results.filter((r) => r.status === "pass").length;
  return (
    <section>
      <SectionTitle action={results.length > 0 && <span className="nums text-[13px] text-fg-subtle">{passed}/{results.length}</span>}>
        Tests
      </SectionTitle>
      {results.length === 0 ? (
        <Empty title="No test results">Start the test runner to see each test.</Empty>
      ) : (
        <Card padded={false} surfaceClassName="px-4 py-1">
          <ul className="divide-y divide-line">
            {results.map((r) => {
              const m = MARK[r.status];
              return (
                <li key={r.name} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 text-[13px]">{r.name}</span>
                  <Pill tone={m.tone}>
                    <m.Icon className="size-3" />
                    {m.label}
                  </Pill>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}

function Logs({ status }: { status: Status }) {
  const [tab, setTab] = useState<"judge" | "watch" | "agent">("judge");
  const lines = tab === "agent" ? [...status.agentLog, ...status.procs.auto.log].sort() : status.procs[tab].log;
  return (
    <section>
      <SectionTitle
        action={
          <div className="w-64">
            <Segmented
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: "judge", label: "Judge" },
                { value: "watch", label: "Tests" },
                { value: "agent", label: "Agent" },
              ]}
            />
          </div>
        }
      >
        Logs
      </SectionTitle>
      <Card surfaceClassName="p-0">
        <pre className="h-72 overflow-auto p-4 font-mono text-[12px] leading-[18px] whitespace-pre-wrap text-fg-muted">
          {lines.length ? lines.join("\n") : "Nothing yet. Processes started from this page log here."}
        </pre>
      </Card>
    </section>
  );
}
