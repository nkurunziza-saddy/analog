// Chain reads and writes for the platform pages: every stream on the program, a stream's activity
// (read from its transactions), token balances, and the create_stream instruction.
import { useEffect, useRef, useState } from "react";
import {
  address,
  getBase58Encoder,
  getBase64Encoder,
  type Address,
  type Base58EncodedBytes,
  type Base64EncodedBytes,
} from "@solana/kit";
import {
  CANCEL_DISCRIMINATOR,
  CLAIM_DISCRIMINATOR,
  CREATE_STREAM_DISCRIMINATOR,
  findStreamPda,
  findVaultPda,
  getCreateStreamInstructionDataEncoder,
  getPostTickInstructionDataDecoder,
  getStreamDecoder,
  getStreamSize,
  POST_TICK_DISCRIMINATOR,
  VAULT_PROGRAM_ADDRESS,
  type Stream,
} from "./generated/vault";
import { findAta, rpc } from "./stream";

/** The judges this deployment runs. A stream names its two judges when it's created. */
export const PLATFORM_JUDGES = {
  a: address(import.meta.env.VITE_JUDGE_A ?? "LeaR2dwNDW2FurMCnW1Uc2XCNPpZJiDUvrkQJJDNha8"),
  b: address(import.meta.env.VITE_JUDGE_B ?? "9ZxbxPfJ2Luabu1SLxmcUEitKqrT6Gnz1wJwkKaYijrG"),
};

/** The devnet test token streams default to. Any SPL token works. */
export const DEFAULT_MINT = address(import.meta.env.VITE_DEFAULT_MINT ?? "5jgzAdR8rv1ME3nyikWa13GztbopzafTCweTVpGF9sub");

export type StreamRow = { address: Address; data: Stream };

const PAYER_OFFSET = 8;
const WORKER_OFFSET = 8 + 32;

/** Streams on the program, optionally only those where `who` is the payer or the worker. Polls. */
export function useStreams(filter?: { who: Address; role: "payer" | "worker" } | null, everyMs = 10_000) {
  const [rows, setRows] = useState<StreamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = filter ? `${filter.role}:${filter.who}` : "all";

  useEffect(() => {
    let stopped = false;
    setRows(null);
    async function load() {
      try {
        const filters = [
          { dataSize: BigInt(getStreamSize()) },
          ...(filter
            ? [
                {
                  memcmp: {
                    offset: BigInt(filter.role === "payer" ? PAYER_OFFSET : WORKER_OFFSET),
                    bytes: filter.who as unknown as Base58EncodedBytes,
                    encoding: "base58" as const,
                  },
                },
              ]
            : []),
        ];
        const res = await rpc
          .getProgramAccounts(VAULT_PROGRAM_ADDRESS, { encoding: "base64", filters })
          .send();
        const decoder = getStreamDecoder();
        const b64 = getBase64Encoder();
        const list = res
          .map((r) => ({
            address: r.pubkey,
            data: decoder.decode(b64.encode(r.account.data[0] as Base64EncodedBytes)),
          }))
          .sort((x, y) => Number(y.data.id - x.data.id));
        if (!stopped) {
          setRows(list);
          setError(null);
        }
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
    // `key` captures the filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, everyMs]);

  return { rows, error };
}

export type Activity =
  | { kind: "tick"; sig: string; time: number | null; pBps: number; hash: string; failed: boolean }
  | { kind: "claim" | "cancel" | "create"; sig: string; time: number | null; failed: boolean };

function startsWith(data: Uint8Array, prefix: Uint8Array) {
  return prefix.every((b, i) => data[i] === b);
}

/** A stream's activity, newest first, read from its program instructions on devnet. */
export function useActivity(stream: Address | null, everyMs = 4_000) {
  const [items, setItems] = useState<Activity[] | null>(null);
  const cache = useRef(new Map<string, Activity | null>());

  useEffect(() => {
    let stopped = false;
    setItems(null);
    cache.current = new Map();
    if (!stream) return;
    const b58 = getBase58Encoder();
    const tickDecoder = getPostTickInstructionDataDecoder();

    async function load() {
      try {
        const sigs = await rpc.getSignaturesForAddress(stream!, { limit: 25 }).send();
        for (const s of sigs) {
          if (stopped) return;
          if (cache.current.has(s.signature)) continue;
          const tx = await rpc
            .getTransaction(s.signature, { encoding: "json", maxSupportedTransactionVersion: 0 })
            .send();
          let found: Activity | null = null;
          if (tx) {
            const keys = tx.transaction.message.accountKeys;
            for (const ix of tx.transaction.message.instructions) {
              if (keys[ix.programIdIndex] !== VAULT_PROGRAM_ADDRESS) continue;
              const data = new Uint8Array(b58.encode(ix.data));
              const base = {
                sig: s.signature,
                time: s.blockTime === null ? null : Number(s.blockTime),
                failed: s.err !== null,
              };
              if (startsWith(data, POST_TICK_DISCRIMINATOR)) {
                const d = tickDecoder.decode(data);
                found = {
                  kind: "tick",
                  ...base,
                  pBps: d.pBps,
                  hash: [...d.inputHash].map((b) => b.toString(16).padStart(2, "0")).join(""),
                };
              } else if (startsWith(data, CLAIM_DISCRIMINATOR)) found = { kind: "claim", ...base };
              else if (startsWith(data, CANCEL_DISCRIMINATOR)) found = { kind: "cancel", ...base };
              else if (startsWith(data, CREATE_STREAM_DISCRIMINATOR)) found = { kind: "create", ...base };
              if (found) break;
            }
          }
          cache.current.set(s.signature, found);
        }
        if (!stopped) {
          setItems(
            sigs.map((s) => cache.current.get(s.signature)).filter((a): a is Activity => !!a),
          );
        }
      } catch {
        // Public devnet RPC rate-limits bursts; the next poll fills in what's missing.
      }
    }
    load();
    const id = setInterval(load, everyMs);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [stream, everyMs]);

  return items;
}

export type MintInfo = { tokenProgram: Address; decimals: number };

export async function fetchMint(mint: Address): Promise<MintInfo | null> {
  const { value } = await rpc.getAccountInfo(mint, { encoding: "base64" }).send();
  if (!value || value.data[0].length === 0) return null;
  const bytes = getBase64Encoder().encode(value.data[0] as Base64EncodedBytes);
  if (bytes.length < 82) return null;
  return { tokenProgram: value.owner, decimals: bytes[44] };
}

/** The wallet's balance of `mint`, in tokens; null while unknown, 0 when it holds none. */
export function useTokenBalance(owner: Address | null, mint: Address | null) {
  const [state, setState] = useState<{ balance: number | null; mint: MintInfo | null; error: string | null }>({
    balance: null,
    mint: null,
    error: null,
  });
  useEffect(() => {
    let stopped = false;
    setState({ balance: null, mint: null, error: null });
    if (!mint) return;
    (async () => {
      try {
        const info = await fetchMint(mint);
        if (!info) {
          if (!stopped) setState({ balance: null, mint: null, error: "Not a token mint on devnet" });
          return;
        }
        let balance = 0;
        if (owner) {
          const ata = await findAta(owner, mint, info.tokenProgram);
          try {
            const res = await rpc.getTokenAccountBalance(ata).send();
            balance = Number(res.value.amount) / 10 ** info.decimals;
          } catch {
            balance = 0;
          }
        }
        if (!stopped) setState({ balance, mint: info, error: null });
      } catch (err) {
        if (!stopped) setState({ balance: null, mint: null, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [owner, mint]);
  return state;
}

/** create_stream, signed by the payer's wallet. Returns the instruction and the new stream's address. */
export async function createStreamInstruction(args: {
  payer: Address;
  worker: Address;
  mint: Address;
  mintInfo: MintInfo;
  deposit: bigint;
  rateMax: bigint;
  staleAfter: bigint;
}) {
  const id = BigInt(Math.floor(Date.now() / 1000));
  const [stream] = await findStreamPda({ payer: args.payer, worker: args.worker, id });
  const [vault] = await findVaultPda({ stream });
  const payerToken = await findAta(args.payer, args.mint, args.mintInfo.tokenProgram);
  const instruction = {
    programAddress: VAULT_PROGRAM_ADDRESS,
    accounts: [
      { address: args.payer, role: 3 },
      { address: args.worker, role: 0 },
      { address: args.mint, role: 0 },
      { address: payerToken, role: 1 },
      { address: stream, role: 1 },
      { address: vault, role: 1 },
      { address: args.mintInfo.tokenProgram, role: 0 },
      { address: address("11111111111111111111111111111111"), role: 0 },
    ],
    data: getCreateStreamInstructionDataEncoder().encode({
      id,
      rateMax: args.rateMax,
      deposit: args.deposit,
      staleAfter: args.staleAfter,
      judgeA: PLATFORM_JUDGES.a,
      judgeB: PLATFORM_JUDGES.b,
    }),
  } as const;
  return { instruction, stream };
}

const mintCache = new Map<string, Promise<MintInfo | null>>();

/** Mint info, fetched once per mint per page load. */
export function useMintInfo(mint: Address | null): MintInfo | null {
  const [info, setInfo] = useState<MintInfo | null>(null);
  useEffect(() => {
    let stopped = false;
    if (!mint) return;
    if (!mintCache.has(mint)) mintCache.set(mint, fetchMint(mint).catch(() => null));
    mintCache.get(mint)!.then((m) => {
      if (!stopped) setInfo(m);
    });
    return () => {
      stopped = true;
    };
  }, [mint]);
  return info;
}
