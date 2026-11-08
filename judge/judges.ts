// A judge turns (state, promise) into p in [0, 1]: its calibrated belief that the promise is being kept right now.
// Every judge asks only `noul` questions; TypeSafe documents score levels as unsafe to interpolate.

export type NoulQuestion = { type: "noul"; instructions: string };
export type Questions = Record<string, NoulQuestion>;

export type Verdict = {
  judge: string;
  p: number;
  answers: Record<string, number>;
  ms: number;
};

export interface Judge {
  name: string;
  judge(state: unknown, questions: Questions): Promise<Verdict>;
}

// A judge's p is the product of its answers: every narrow condition has to hold at once.
function product(xs: number[]): number {
  return xs.reduce((a, b) => a * b, 1);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// ---------------------------------------------------------------- Laya (open weights, runs locally)

// One loaded model is shared by every Laya judge in the process: the weights are ~1.7 GB of RAM.
type LayaModel = {
  systemOne(
    state: unknown,
    questions: Questions,
  ): Promise<{ answers: Record<string, { noul: number }> }>;
};
let layaModel: Promise<LayaModel> | null = null;

function loadLaya(): Promise<LayaModel> {
  if (!layaModel) {
    layaModel = (async () => {
      const { Laya } = await import("@receptron/laya");
      const modelDir = process.env.LAYA_MODEL_DIR;
      console.log(
        modelDir
          ? `[laya] loading local bundle from ${modelDir}`
          : "[laya] loading model (first run downloads ~1.7 GB to ~/.cache/receptron-laya)",
      );
      let lastPct = -1;
      const model = await Laya.load({
        ...(modelDir ? { modelDir } : {}),
        onProgress: ({ file, received, total }: { file: string; received: number; total: number | null }) => {
          if (!total) return;
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            console.log(`[laya] ${file} ${pct}%`);
          }
        },
      });
      return model as unknown as LayaModel;
    })();
  }
  return layaModel;
}

export class LayaJudge implements Judge {
  constructor(public name: string) {}

  async judge(state: unknown, questions: Questions): Promise<Verdict> {
    const model = await loadLaya();
    const t0 = performance.now();
    const res = await model.systemOne(state, questions);
    const answers: Record<string, number> = {};
    for (const key of Object.keys(questions)) answers[key] = clamp01(res.answers[key].noul);
    return {
      judge: this.name,
      p: product(Object.values(answers)),
      answers,
      ms: Math.round(performance.now() - t0),
    };
  }
}

// ---------------------------------------------------------------- Jev (TypeSafe API)

// Request/response shape follows the system_one API that Laya mirrors: { state, questions } → { answers }.
// Not yet checked against a live key: confirm against docs.typesafe.ai before relying on it.
export class JevJudge implements Judge {
  private url = process.env.JEV_URL ?? "https://api.typesafe.ai/v1/systemone";
  private model = process.env.JEV_MODEL ?? "jev-latest";
  private key = process.env.JEV_API_KEY;

  constructor(public name = "jev") {
    if (!this.key) throw new Error("JEV_API_KEY is not set");
  }

  async judge(state: unknown, questions: Questions): Promise<Verdict> {
    const t0 = performance.now();
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.key}`,
      },
      body: JSON.stringify({ model: this.model, state, questions }),
      signal: AbortSignal.timeout(Number(process.env.JUDGE_TIMEOUT_MS ?? 5_000)),
    });
    if (!res.ok) throw new Error(`jev ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { answers: Record<string, { noul: number }> };
    const answers: Record<string, number> = {};
    for (const key of Object.keys(questions)) answers[key] = clamp01(body.answers[key].noul);
    return {
      judge: this.name,
      p: product(Object.values(answers)),
      answers,
      ms: Math.round(performance.now() - t0),
    };
  }
}

export function makeJudge(kind: string): Judge {
  switch (kind) {
    case "jev":
      return new JevJudge();
    case "laya":
      return new LayaJudge("laya");
    case "laya-api":
      // Laya hosted behind a Jev-compatible /v1/systemone API; set JEV_URL, JEV_API_KEY and JEV_MODEL=laya.
      return new JevJudge("laya-api");
    case "laya-alt":
      // Same open model, asked the alternate question set: the stand-in second judge until Jev has credits.
      return new LayaJudge("laya-alt");
    default:
      throw new Error(`unknown judge "${kind}" (use jev, laya, laya-alt or laya-api)`);
  }
}
