// Dev-only control API behind the /dev page: starts and stops the watcher, the judge and the auto agent,
// runs one-shot agent commands, and reports everything the page draws. Only exists under `vite` (serve).
//   GET  /api/dev/status
//   POST /api/dev/agent        { cmd }
//   POST /api/dev/proc/start   { name, opts }
//   POST /api/dev/proc/stop    { name }
//   POST /api/dev/key          { provider, key, url?, model? }   saves the judge API key to .env.local
//   POST /api/dev/key/check                                      one free GET /v1/models with the saved key
//   POST /api/dev/key/clear
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";

const ROOT = import.meta.dirname;
const TSX = join(ROOT, "node_modules/.bin/tsx");
const AGENT_CMDS = new Set(["reset", "step", "break", "unbreak", "inject", "cheat"]);
const JUDGE_SETS = new Set(["laya-api,laya-api", "laya,laya-alt", "laya-api,laya"]);
const ENV_FILE = join(ROOT, ".env.local");
const KEY_VARS = ["JEV_API_KEY", "JEV_URL", "JEV_MODEL"] as const;
const PROVIDERS: Record<string, { url: string; model: string; label: string }> = {
  "laya-ai": { url: "https://api.laya-ai.com/v1/systemone", model: "laya", label: "Hosted Laya (laya-ai.com)" },
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", label: "TypeSafe Jev" },
};

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Rewrites only the judge variables in .env.local; every other line is kept as it was. */
function writeKeyVars(values: Partial<Record<(typeof KEY_VARS)[number], string>> | null) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n") : [];
  const kept = lines.filter((l) => l.trim() && !KEY_VARS.some((k) => l.startsWith(`${k}=`)));
  const added = values ? KEY_VARS.filter((k) => values[k]).map((k) => `${k}=${values[k]}`) : [];
  writeFileSync(ENV_FILE, [...kept, ...added].join("\n") + "\n", { mode: 0o600 });
}

function keyStatus() {
  const env = readEnv();
  const key = env.JEV_API_KEY ?? "";
  const url = env.JEV_URL ?? PROVIDERS.typesafe.url;
  const provider = Object.entries(PROVIDERS).find(([, p]) => p.url === url)?.[0] ?? "custom";
  return { set: key.length > 0, last4: key.slice(-4), url, model: env.JEV_MODEL ?? "jev-latest", provider };
}
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
    apiKey: keyStatus(),
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

          if (req.url === "/key") {
            const provider = String(b.provider ?? "");
            const key = String(b.key ?? "").trim();
            const preset = PROVIDERS[provider];
            const url = preset ? preset.url : String(b.url ?? "").trim();
            const model = preset ? preset.model : String(b.model ?? "").trim();
            if (!/^[A-Za-z0-9_.-]{8,200}$/.test(key)) return send(res, 400, { error: "That doesn't look like an API key" });
            if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9/_.-]*$/.test(url))
              return send(res, 400, { error: "The endpoint must be an https URL" });
            if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(model)) return send(res, 400, { error: "Enter a model name" });
            writeKeyVars({ JEV_API_KEY: key, JEV_URL: url, JEV_MODEL: model });
            return send(res, 200, { ok: true, apiKey: keyStatus() });
          }

          if (req.url === "/key/clear") {
            writeKeyVars(null);
            return send(res, 200, { ok: true, apiKey: keyStatus() });
          }

          if (req.url === "/key/check") {
            const env = readEnv();
            if (!env.JEV_API_KEY) return send(res, 200, { ok: false, message: "No key saved" });
            // Listing models costs no judge calls; the endpoint sits next to /systemone.
            const modelsUrl = (env.JEV_URL ?? PROVIDERS.typesafe.url).replace(/\/systemone\/?$/, "/models");
            try {
              const r = await fetch(modelsUrl, {
                headers: { authorization: `Bearer ${env.JEV_API_KEY}` },
                signal: AbortSignal.timeout(8_000),
              });
              if (r.ok) {
                const body = (await r.json().catch(() => null)) as { data?: { id: string }[] } | null;
                const ids = body?.data?.map((m) => m.id) ?? [];
                const model = env.JEV_MODEL ?? "";
                const message =
                  ids.length && model && !ids.includes(model)
                    ? `Key works, but this endpoint has no model "${model}"`
                    : "Key works";
                return send(res, 200, { ok: ids.length === 0 || !model || ids.includes(model), message });
              }
              return send(res, 200, {
                ok: false,
                message: r.status === 401 || r.status === 403 ? "The endpoint rejected this key" : `The endpoint answered ${r.status}`,
              });
            } catch (err) {
              return send(res, 200, { ok: false, message: `Couldn't reach the endpoint: ${err instanceof Error ? err.message : err}` });
            }
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
