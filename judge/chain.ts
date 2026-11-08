import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
export const WS_URL = process.env.WS_URL ?? RPC_URL.replace(/^http/, "ws");

export const rpc = createSolanaRpc(RPC_URL);
export const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

export const JUDGE_DIR = dirname(new URL(import.meta.url).pathname);
export const KEYS_DIR = join(JUDGE_DIR, "keys");
export const STREAM_FILE = join(JUDGE_DIR, "stream.json");

/** Reads a Solana CLI keypair file (JSON array of 64 bytes). */
export async function loadKeypair(path: string): Promise<KeyPairSigner> {
  const bytes = new Uint8Array(JSON.parse(readFileSync(path, "utf8")));
  return createKeyPairSignerFromBytes(bytes);
}

/** Loads a keypair, creating it in Solana CLI format first if it does not exist. */
export async function loadOrCreateKeypair(path: string): Promise<KeyPairSigner> {
  if (!existsSync(path)) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const d = Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url");
    const x = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([...d, ...x]), { mode: 0o600 });
    console.log(`created keypair ${path}`);
  }
  return loadKeypair(path);
}

export function loadPayer(): Promise<KeyPairSigner> {
  return loadKeypair(process.env.PAYER_KEYPAIR ?? join(homedir(), ".config/solana/id.json"));
}

export function loadJudgeKeys(): Promise<[KeyPairSigner, KeyPairSigner]> {
  return Promise.all([
    loadOrCreateKeypair(join(KEYS_DIR, "judge-a.json")),
    loadOrCreateKeypair(join(KEYS_DIR, "judge-b.json")),
  ]);
}

/** Builds, signs (every signer referenced by the instruction) and confirms one transaction. */
export async function send(feePayer: KeyPairSigner, ix: Instruction): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction(ix, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirm(signed, { commitment: "confirmed" });
  return getSignatureFromTransaction(signed);
}

export type StreamInfo = {
  stream: string;
  vault: string;
  mint: string;
  payer: string;
  worker: string;
  judgeA: string;
  judgeB: string;
  id: string;
};

export function readStreamInfo(): StreamInfo {
  if (!existsSync(STREAM_FILE)) {
    throw new Error(`${STREAM_FILE} not found: run pnpm judge:create-stream first`);
  }
  return JSON.parse(readFileSync(STREAM_FILE, "utf8"));
}
