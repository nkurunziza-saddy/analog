// Dev-only control API behind the /dev page: starts and stops the watcher, the judge and the auto agent,
// runs one-shot agent commands, and reports everything the page draws. Only exists under `vite` (serve).
//   GET  /api/dev/status
//   POST /api/dev/agent        { cmd }
//   POST /api/dev/proc/start   { name, opts }
//   POST /api/dev/proc/stop    { name }
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";

const ROOT = import.meta.dirname;
const TSX = join(ROOT, "node_modules/.bin/tsx");
const AGENT_CMDS = new Set(["reset", "step", "break", "unbreak", "inject", "cheat"]);
const JUDGE_SETS = new Set(["laya-api,laya-api", "laya,laya-alt", "jev,laya", "jev,laya-api"]);
const LOG_LINES = 200;

type Proc = {
  child: ChildProcess | null;
  running: boolean;
  startedAt: number | null;
  exitCode: number | null;
  log: string[];
  opts?: Record<string, unknown>;
};

const procs: Record<"watch" | "judge" | "auto", Proc> = {
  watch: blank(),
  judge: blank(),
  auto: blank(),
};
const agentLog: string[] = [];

function blank(): Proc {
  return { child: null, running: false, startedAt: null, exitCode: null, log: [] };
}

function push(log: string[], chunk: string) {
  for (const raw of chunk.split("\n")) {
    // eslint-disable-next-line no-control-regex
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
    if (!line || /ExperimentalWarning|trace-warnings/.test(line)) continue;
    log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  }
  if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
}

function start(name: keyof typeof procs, args: string[], env: Record<string, string> = {}, opts?: Record<string, unknown>) {
  const p = procs[name];
  if (p.running) throw new Error(`${name} is already running`);
  const child = spawn(TSX, ["--env-file-if-exists=.env.local", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
  });
  Object.assign(p, { child, running: true, startedAt: Date.now(), exitCode: null, log: [], opts });
  child.stdout?.on("data", (d) => push(p.log, String(d)));
  child.stderr?.on("data", (d) => push(p.log, String(d)));
  child.on("exit", (code) => {
    p.running = false;
    p.exitCode = code;
    p.child = null;
    push(p.log, `[exited ${code ?? "by signal"}]`);
  });
}

function stop(name: keyof typeof procs) {
  procs[name].child?.kill("SIGTERM");
}

function runAgent(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(TSX, ["worker/agent.ts", cmd], { cwd: ROOT });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", () => {
      push(agentLog, `$ agent ${cmd}\n${out}`);
      resolve(out.trim());
    });
  });
}

function readJson(file: string): unknown {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

function ticks() {
  const file = join(ROOT, "judge/ticks.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-20)
    .reverse()
    .map((l) => {
      const t = JSON.parse(l);
      let state: unknown = null;
      try {
        state = JSON.parse(t.input).state;
      } catch {
        // older log line
      }
      return { n: t.n, ts: t.ts, pBps: t.pBps, hash: t.hash, sig: t.sig, verdicts: t.verdicts, state };
    });
}

function status() {
  const view = (p: Proc) => ({
    running: p.running,
    startedAt: p.startedAt,
    exitCode: p.exitCode,
    opts: p.opts ?? null,
    log: p.log.slice(-60),
  });
  return {
    procs: { watch: view(procs.watch), judge: view(procs.judge), auto: view(procs.auto) },
    agentLog: agentLog.slice(-60),
    evidence: readJson(join(ROOT, "judge/evidence.json")),
    stream: readJson(join(ROOT, "judge/stream.json")),
    promise: readJson(join(ROOT, "judge/promise.json")),
    ticks: ticks(),
    hasApiKey: /JEV_API_KEY=\S+/.test(existsSync(join(ROOT, ".env.local")) ? readFileSync(join(ROOT, ".env.local"), "utf8") : ""),
    now: Date.now(),
  };
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(res: ServerResponse, code: number, data: unknown) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}

export function devApi(): Plugin {
  return {
    name: "analog-dev-api",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.on("close", () => Object.keys(procs).forEach((n) => stop(n as keyof typeof procs)));
      server.middlewares.use("/api/dev", async (req, res) => {
        try {
          if (req.method === "GET" && req.url === "/status") return send(res, 200, status());
          if (req.method !== "POST") return send(res, 404, { error: "not found" });
          const b = await body(req);

          if (req.url === "/agent") {
            const cmd = String(b.cmd);
            if (!AGENT_CMDS.has(cmd)) return send(res, 400, { error: `unknown agent command ${cmd}` });
            return send(res, 200, { output: await runAgent(cmd) });
          }

          if (req.url === "/proc/start") {
            const name = String(b.name);
            const o = (b.opts ?? {}) as Record<string, unknown>;
            if (name === "watch") start("watch", ["worker/watch.ts"]);
            else if (name === "auto") {
              const every = Math.min(120, Math.max(3, Number(o.stepSeconds ?? 20)));
              start("auto", ["worker/agent.ts", "auto"], { AGENT_STEP_S: String(every) }, { stepSeconds: every });
            } else if (name === "judge") {
              const judges = String(o.judges ?? "laya-api,laya-api");
              if (!JUDGE_SETS.has(judges)) return send(res, 400, { error: `unknown judge pair ${judges}` });
              const maxTicks = Math.min(500, Math.max(0, Math.floor(Number(o.maxTicks ?? 3))));
              const tickMs = Math.min(60_000, Math.max(2_000, Math.floor(Number(o.tickMs ?? 3_000))));
              const dryRun = o.dryRun === true;
              start(
                "judge",
                ["judge/run.ts"],
                {
                  JUDGES: judges,
                  MAX_TICKS: String(maxTicks),
                  TICK_MS: String(tickMs),
                  ...(dryRun ? { DRY_RUN: "1" } : {}),
                },
                { judges, maxTicks, tickMs, dryRun },
              );
            } else return send(res, 400, { error: `unknown process ${name}` });
            return send(res, 200, { ok: true });
          }

          if (req.url === "/proc/stop") {
            const name = String(b.name) as keyof typeof procs;
            if (!(name in procs)) return send(res, 400, { error: `unknown process ${name}` });
            stop(name);
            return send(res, 200, { ok: true });
          }

          return send(res, 404, { error: "not found" });
        } catch (err) {
          return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
