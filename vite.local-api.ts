// Dev-only API that exposes the local judge's files to the dashboard, so the evidence the judge sees is on screen.
//   GET /api/local/stream    judge/stream.json
//   GET /api/local/evidence  judge/evidence.json (falls back to the example)
//   GET /api/local/ticks     last 30 lines of judge/ticks.jsonl, newest first
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const JUDGE_DIR = join(import.meta.dirname, "judge");

function readJson(file: string): unknown {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export function localApi(): Plugin {
  return {
    name: "analog-local-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/local", (req, res) => {
        let body: unknown = null;
        try {
          if (req.url === "/stream") body = readJson(join(JUDGE_DIR, "stream.json"));
          else if (req.url === "/evidence")
            body =
              readJson(join(JUDGE_DIR, "evidence.json")) ??
              readJson(join(JUDGE_DIR, "evidence.example.json"));
          else if (req.url === "/ticks") {
            const file = join(JUDGE_DIR, "ticks.jsonl");
            const lines = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [];
            body = lines
              .slice(-30)
              .reverse()
              .map((l) => {
                const t = JSON.parse(l);
                // The full input stays in the log file; the dashboard only needs the summary.
                return { n: t.n, ts: t.ts, pBps: t.pBps, hash: t.hash, sig: t.sig, verdicts: t.verdicts };
              });
          } else {
            res.statusCode = 404;
          }
        } catch (err) {
          res.statusCode = 500;
          body = { error: String(err) };
        }
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(body));
      });
    },
  };
}
