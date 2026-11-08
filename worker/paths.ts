import { dirname, join } from "node:path";

export const WORKER_DIR = dirname(new URL(import.meta.url).pathname);
export const START_DIR = join(WORKER_DIR, "fixtures/start");
export const REPO_DIR = join(WORKER_DIR, "repo");
export const EVIDENCE_FILE = process.env.EVIDENCE_FILE ?? join(WORKER_DIR, "../judge/evidence.json");
