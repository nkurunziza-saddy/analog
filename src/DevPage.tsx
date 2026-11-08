import { useCallback, useEffect, useState, type ReactNode } from "react";
import { address, isAddress } from "@solana/kit";
import { FlowDiagram } from "./FlowDiagram";
import { useNow, useStream } from "./stream";
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
  Heading,
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
  apiKey: { set: boolean; last4: string; url: string; model: string; provider: string };
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


// ---------------------------------------------------------------- page

type LiveStreamView = ReturnType<typeof useStream>["stream"];

export function DevPage() {
  const { status, offline, reload } = useStatus();
  const now = useNow(4);
  const streamAddr = status?.stream?.stream && isAddress(status.stream.stream) ? address(status.stream.stream) : null;
  const { stream } = useStream(streamAddr, 2_000);

  return (
    <div className="flex flex-col gap-8">
      <Heading
        size="page"
        title="Dev console"
        subtitle="Run the pipeline and see how every payment is decided"
        action={status && <ProcPills status={status} />}
      />

      {offline && (
        <Empty icon={<IconPulse />} title="The dev API isn't reachable">
          It only runs under pnpm dev. Restart the dev server and this page reconnects.
        </Empty>
      )}

      {status && (
        <>
          <Workflow status={status} now={now} stream={stream} />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-10">
            <div className="flex flex-col gap-8">
              <ApiKeyCard status={status} reload={reload} />
              <AgentCard status={status} reload={reload} />
              <RunnerCard status={status} reload={reload} now={now} />
              <JudgeCard status={status} reload={reload} />
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

function Workflow({ status, now, stream }: { status: Status; now: number; stream: LiveStreamView }) {
  return (
    <section>
      <SectionTitle subtitle="From the agent's edit to the money it moves. Arrows move while data flows.">How it flows</SectionTitle>
      <FlowDiagram
        now={now}
        autoRunning={status.procs.auto.running}
        judgeRunning={status.procs.judge.running}
        evidence={status.evidence}
        lastTick={status.ticks[0] ?? null}
        stream={stream}
      />
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

/** Runs a dev API call, holding which button is busy and the last error. */
function useAct(reload: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  return { busy, error, act };
}

const PROVIDER_OPTIONS = [
  { value: "laya-ai", label: "Hosted Laya" },
  { value: "typesafe", label: "TypeSafe Jev" },
  { value: "custom", label: "Other" },
] as const;
type Provider = (typeof PROVIDER_OPTIONS)[number]["value"];

function ApiKeyCard({ status, reload }: { status: Status; reload: () => void }) {
  const saved = status.apiKey;
  const [editing, setEditing] = useState(!saved.set);
  const [provider, setProvider] = useState<Provider>(saved.set ? (saved.provider as Provider) : "laya-ai");
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(saved.provider === "custom" ? saved.url : "");
  const [model, setModel] = useState(saved.provider === "custom" ? saved.model : "");
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const { busy, error, act } = useAct(reload);

  async function save() {
    setCheck(null);
    await act("save", async () => {
      const r = await post("/key", { provider, key, url, model });
      if (!r.error) {
        setKey("");
        setEditing(false);
      }
      return r;
    });
  }

  async function runCheck() {
    setCheck(null);
    await act("check", async () => {
      const r = (await post("/key/check", {})) as { ok?: boolean; message?: string; error?: string };
      if (!r.error) setCheck({ ok: !!r.ok, message: r.message ?? "" });
      return r;
    });
  }

  return (
    <section>
      <SectionTitle subtitle="Used by the hosted judges. Saved to .env.local on this machine.">Judge API key</SectionTitle>
      <Card surfaceClassName="flex flex-col gap-4 p-4">
        {!editing && saved.set ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium">
                  {PROVIDER_OPTIONS.find((p) => p.value === saved.provider)?.label ?? "Other"}
                  <span className="font-mono text-[13px] font-normal text-fg-muted"> ···{saved.last4}</span>
                </p>
                <p className="truncate font-mono text-[12px] text-fg-subtle">
                  {saved.model} · {saved.url.replace(/^https:\/\//, "")}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" loading={busy === "check"} onClick={runCheck}>
                  Check key
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  Change
                </Button>
              </div>
            </div>
            {check && (
              <Pill tone={check.ok ? "positive" : "negative"} className="self-start">
                {check.ok ? <IconCheck className="size-3" /> : <IconX className="size-3" />}
                {check.message}
              </Pill>
            )}
          </>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Segmented size="sm" value={provider} onChange={setProvider} options={[...PROVIDER_OPTIONS]} />
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={provider === "typesafe" ? "TypeSafe API key" : provider === "laya-ai" ? "laya-ai.com API key" : "API key"}
              autoComplete="off"
              spellCheck={false}
              className={cn(fieldClass, "font-mono text-[13px]")}
            />
            {provider === "custom" && (
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…/v1/systemone"
                  spellCheck={false}
                  className={cn(fieldClass, "font-mono text-[13px]")}
                />
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Model"
                  spellCheck={false}
                  className={cn(fieldClass, "font-mono text-[13px]")}
                />
              </div>
            )}
            <p className="text-[13px] text-fg-muted">
              {provider === "laya-ai"
                ? "Laya through api.laya-ai.com. Each tick makes two calls."
                : provider === "typesafe"
                  ? "Jev through api.typesafe.ai. Each tick makes two calls."
                  : "Any endpoint that speaks the system_one API: state and questions in, answers out."}
            </p>
            <div className="flex gap-1.5">
              <Button type="submit" size="sm" variant="primary" loading={busy === "save"} disabled={key.trim().length < 8}>
                Save key
              </Button>
              {saved.set && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Keep the saved key
                </Button>
              )}
            </div>
          </form>
        )}
        {error && <p className="text-[13px] text-negative">{error}</p>}
      </Card>
    </section>
  );
}

function AgentCard({ status, reload }: { status: Status; reload: () => void }) {
  const [stepSeconds, setStepSeconds] = useState(20);
  const { busy, error, act } = useAct(reload);
  const auto = status.procs.auto;
  return (
    <section>
      <SectionTitle subtitle="Edits the demo repo for real. The judges only see the test results.">Agent</SectionTitle>
      <Card surfaceClassName="flex flex-col gap-3 p-4">
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
        {error && <p className="text-[13px] text-negative">{error}</p>}
      </Card>
    </section>
  );
}

function RunnerCard({ status, reload, now }: { status: Status; reload: () => void; now: number }) {
  const { busy, error, act } = useAct(reload);
  const watch = status.procs.watch;
  const evAge = status.evidence ? now - Date.parse(status.evidence.updated_at) / 1000 : Infinity;
  const external = !watch.running && evAge < 6;
  return (
    <section>
      <SectionTitle
        subtitle={external ? "Already running in a terminal." : "Runs the real tests every 2 seconds."}
      >
        Test runner
      </SectionTitle>
      <Card surfaceClassName="flex flex-col gap-3 p-4">
        <div>
          {watch.running ? (
            <Button size="sm" variant="outline" onClick={() => act("watch", () => post("/proc/stop", { name: "watch" }))}>
              <IconStop /> Stop test runner
            </Button>
          ) : (
            <Button
              size="sm"
              variant={external ? "outline" : "primary"}
              disabled={busy !== null || external}
              onClick={() => act("watch", () => post("/proc/start", { name: "watch" }))}
            >
              <IconPlay /> Start test runner
            </Button>
          )}
        </div>
        {error && <p className="text-[13px] text-negative">{error}</p>}
      </Card>
    </section>
  );
}

function JudgeCard({ status, reload }: { status: Status; reload: () => void }) {
  const { busy, error, act } = useAct(reload);
  const [judges, setJudges] = useState("laya-api,laya-api");
  const [maxTicks, setMaxTicks] = useState(3);
  const [tickSeconds, setTickSeconds] = useState(3);
  const [dryRun, setDryRun] = useState(false);
  const judge = status.procs.judge;
  const hosted = judges.split(",").filter((j) => j === "laya-api").length;
  const missingKey = hosted > 0 && !status.apiKey.set;

  return (
    <section>
      <SectionTitle
        subtitle={
          hosted > 0
            ? `${hosted} hosted ${hosted === 1 ? "call" : "calls"} per tick. This run uses ${maxTicks === 0 ? "calls until stopped" : maxTicks * hosted}.`
            : "Local Laya is free; it downloads about 1.7 GB on first run."
        }
      >
        Judge
      </SectionTitle>
      <Card surfaceClassName="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="col-span-2 flex flex-col gap-1.5 text-[13px] text-fg-muted">
            Judges
            <select value={judges} onChange={(e) => setJudges(e.target.value)} disabled={judge.running} className={fieldClass}>
              <option value="laya-api,laya-api">Hosted × 2</option>
              <option value="laya-api,laya">Hosted + local Laya</option>
              <option value="laya,laya-alt">Local Laya × 2</option>
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
        {missingKey && <p className="text-[13px] text-negative">Save a judge API key above to use the hosted judge.</p>}
        <div className="flex flex-wrap items-center gap-3">
          {judge.running ? (
            <Button variant="outline" onClick={() => act("judge", () => post("/proc/stop", { name: "judge" }))}>
              <IconStop /> Stop judge
            </Button>
          ) : (
            <Button
              variant="accent"
              loading={busy === "judge"}
              disabled={missingKey || (busy !== null && busy !== "judge")}
              onClick={() =>
                act("judge", () =>
                  post("/proc/start", { name: "judge", opts: { judges, maxTicks, tickMs: tickSeconds * 1000, dryRun } }),
                )
              }
            >
              <IconPlay />
              {maxTicks === 0 ? "Start judge" : `Run ${maxTicks} ${maxTicks === 1 ? "tick" : "ticks"}`}
            </Button>
          )}
          {!judge.running && judge.exitCode !== null && judge.exitCode !== 0 && (
            <span className="text-[13px] text-negative">The judge exited with code {judge.exitCode}. Its log says why.</span>
          )}
        </div>
        {error && <p className="text-[13px] text-negative">{error}</p>}
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
        subtitle="One tick, from what the judges read to what it pays"
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
      <SectionTitle subtitle={results.length > 0 ? `${passed} of ${results.length} passing` : "The demo repo's suite"}>
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
        subtitle="Processes started from this page"
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
