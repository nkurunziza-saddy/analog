import { useEffect, useRef, useState } from "react";
import {
  address,
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import {
  fetchMaybeStream,
  findVaultPda,
  getCancelInstructionDataEncoder,
  getClaimInstructionDataEncoder,
  VAULT_PROGRAM_ADDRESS,
  type Stream,
} from "./generated/vault";

export const RPC_URL = "https://api.devnet.solana.com";
export const rpc = createSolanaRpc(RPC_URL);

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const BPS = 10_000n;

export const STATUS_CANCELLED = 1;

export type MintInfo = { tokenProgram: Address; decimals: number };

export type LiveStream = {
  address: Address;
  data: Stream;
  mint: MintInfo;
  vault: Address;
  fetchedAt: number;
};

/** Polls the stream account and its mint. */
export function useStream(streamAddress: Address | null, everyMs = 1_500) {
  const [stream, setStream] = useState<LiveStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mintCache = useRef(new Map<string, MintInfo>());

  useEffect(() => {
    setStream(null);
    setError(null);
    if (!streamAddress) return;
    let stopped = false;

    async function load() {
      try {
        const account = await fetchMaybeStream(rpc, streamAddress!);
        if (stopped) return;
        if (!account.exists) {
          setError("No stream at this address on devnet");
          return;
        }
        const data = account.data;
        let mint = mintCache.current.get(data.mint);
        if (!mint) {
          const { value } = await rpc.getAccountInfo(data.mint, { encoding: "base64" }).send();
          if (!value) throw new Error("Mint not found");
          const bytes = Uint8Array.from(atob(value.data[0]), (c) => c.charCodeAt(0));
          mint = { tokenProgram: value.owner, decimals: bytes[44] };
          mintCache.current.set(data.mint, mint);
        }
        const [vault] = await findVaultPda({ stream: streamAddress! });
        if (stopped) return;
        setStream({ address: streamAddress!, data, mint, vault, fetchedAt: Date.now() });
        setError(null);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    }

    load();
    const id = setInterval(load, everyMs);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [streamAddress, everyMs]);

  return { stream, error };
}

/** Earned at `nowSec`, projected the same way the program accrues: rate_max × last_p, stopped at the stale window. */
export function projectEarned(s: Stream, nowSec: number): number {
  if (s.status === STATUS_CANCELLED) return Number(s.earned);
  const staleAt = Number(s.lastTickTs + s.staleAfter);
  const end = Math.min(nowSec, staleAt);
  const dt = Math.max(0, end - Number(s.accruedUntil));
  const credit = (Number(s.rateMax) * s.lastP * dt) / Number(BPS);
  return Math.min(Number(s.deposit), Number(s.earned) + credit);
}

export function isStale(s: Stream, nowSec: number): boolean {
  return nowSec - Number(s.lastTickTs) > Number(s.staleAfter);
}

export async function findAta(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [enc.encode(owner), enc.encode(tokenProgram), enc.encode(mint)],
  });
  return ata;
}

// Account roles: 0 readonly, 1 writable, 2 readonly signer, 3 writable signer.

/** Creates the worker's token account if needed, then claims. */
export async function claimInstructions(live: LiveStream) {
  const { data, mint, vault } = live;
  const workerToken = await findAta(data.worker, data.mint, mint.tokenProgram);
  return [
    {
      programAddress: ATA_PROGRAM,
      accounts: [
        { address: data.worker, role: 3 },
        { address: workerToken, role: 1 },
        { address: data.worker, role: 0 },
        { address: data.mint, role: 0 },
        { address: SYSTEM_PROGRAM, role: 0 },
        { address: mint.tokenProgram, role: 0 },
      ],
      data: new Uint8Array([1]), // CreateIdempotent
    },
    {
      programAddress: VAULT_PROGRAM_ADDRESS,
      accounts: [
        { address: data.worker, role: 2 },
        { address: live.address, role: 1 },
        { address: data.mint, role: 0 },
        { address: vault, role: 1 },
        { address: workerToken, role: 1 },
        { address: mint.tokenProgram, role: 0 },
      ],
      data: getClaimInstructionDataEncoder().encode({}),
    },
  ] as const;
}

export async function cancelInstructions(live: LiveStream) {
  const { data, mint, vault } = live;
  const payerToken = await findAta(data.payer, data.mint, mint.tokenProgram);
  return [
    {
      programAddress: VAULT_PROGRAM_ADDRESS,
      accounts: [
        { address: data.payer, role: 2 },
        { address: live.address, role: 1 },
        { address: data.mint, role: 0 },
        { address: vault, role: 1 },
        { address: payerToken, role: 1 },
        { address: mint.tokenProgram, role: 0 },
      ],
      data: getCancelInstructionDataEncoder().encode({}),
    },
  ] as const;
}

// ---------------------------------------------------------------- local judge files (dev server only)

export type Tick = {
  n: number;
  ts: string;
  pBps: number;
  hash: string;
  sig: string | null;
  verdicts: { judge: string; p: number; ms: number }[];
};

export type Evidence = {
  updated_at?: string;
  tests?: { total: number; passed: number; failed: number; skipped: number };
  previous_tests?: { total: number; passed: number; failed: number; skipped: number };
  diff?: { files_changed: number; insertions: number; deletions: number; test_files_changed: number };
  failing?: string[];
  agent_note?: { untrusted: boolean; text: string };
};

export function useLocal<T>(path: string, everyMs = 1_500): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const res = await fetch(`/api/local/${path}`);
        if (!res.ok) return;
        const body = (await res.json()) as T;
        if (!stopped) setValue(body);
      } catch {
        // No local API (a deployed build): the dashboard shows chain data only.
      }
    }
    load();
    const id = setInterval(load, everyMs);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [path, everyMs]);
  return value;
}

/** Re-renders at `fps` so live numbers keep moving between polls. */
export function useNow(fps = 10): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000 / fps);
    return () => clearInterval(id);
  }, [fps]);
  return now;
}
