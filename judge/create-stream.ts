// Creates a stream on devnet: the payer (Solana CLI wallet) funds the vault and names the two judge keys.
//
//   MINT=<mint> WORKER=<worker address> pnpm judge:create-stream
//
// Optional: DEPOSIT (tokens, default 20), RATE (tokens per second at p = 1, default 0.1),
//           STALE (seconds, default 15), ID (default: current unix time).
import { writeFileSync } from "node:fs";
import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { getCreateStreamInstructionAsync, findStreamPda, findVaultPda } from "../src/generated/vault";
import { loadJudgeKeys, loadPayer, rpc, send, STREAM_FILE } from "./chain";

const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

async function findAta(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [enc.encode(owner), enc.encode(tokenProgram), enc.encode(mint)],
  });
  return ata;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const mint = address(need("MINT"));
const worker = address(need("WORKER"));
const depositTokens = Number(process.env.DEPOSIT ?? 20);
const rateTokens = Number(process.env.RATE ?? 0.1);
const staleAfter = BigInt(process.env.STALE ?? 15);
const id = BigInt(process.env.ID ?? Math.floor(Date.now() / 1000));

const payer = await loadPayer();
const [judgeA, judgeB] = await loadJudgeKeys();

const { value: mintAccount } = await rpc.getAccountInfo(mint, { encoding: "jsonParsed" }).send();
if (!mintAccount) throw new Error(`mint ${mint} not found on this cluster`);
const tokenProgram = mintAccount.owner;
const decimals = (mintAccount.data as { parsed: { info: { decimals: number } } }).parsed.info.decimals;

const unit = 10 ** decimals;
const deposit = BigInt(Math.round(depositTokens * unit));
const rateMax = BigInt(Math.round(rateTokens * unit));
const payerToken = await findAta(payer.address, mint, tokenProgram);

const ix = await getCreateStreamInstructionAsync({
  payer,
  worker,
  mint,
  payerToken,
  tokenProgram,
  id,
  rateMax,
  deposit,
  staleAfter,
  judgeA: judgeA.address,
  judgeB: judgeB.address,
});

const [stream] = await findStreamPda({ payer: payer.address, worker, id });
const [vault] = await findVaultPda({ stream });

console.log(`creating stream ${stream}`);
console.log(`  deposit ${depositTokens} tokens, max rate ${rateTokens}/s, stale after ${staleAfter}s`);
const sig = await send(payer, ix);
console.log(`  confirmed ${sig}`);

writeFileSync(
  STREAM_FILE,
  JSON.stringify(
    {
      stream,
      vault,
      mint,
      payer: payer.address,
      worker,
      judgeA: judgeA.address,
      judgeB: judgeB.address,
      id: id.toString(),
    },
    null,
    2,
  ),
);
console.log(`wrote ${STREAM_FILE}`);
console.log(`judge A ${judgeA.address} pays tick fees: fund it with  solana transfer ${judgeA.address} 0.2 --allow-unfunded-recipient`);
