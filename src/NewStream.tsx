import { useState, type ReactNode } from "react";
import { address as toAddress, isAddress, type Address } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { short } from "./format";
import { createStreamInstruction, DEFAULT_MINT, PLATFORM_JUDGES, useTokenBalance } from "./platform";
import { navigate } from "./router";
import { Button, Card, cn, Detail, DetailList, Empty, fieldClass, Heading, IconPlus, IconWallet, SectionTitle } from "./ui";

export function NewStream() {
  const { wallet, status } = useWalletConnection();
  const me = status === "connected" && wallet ? toAddress(wallet.account.address.toString()) : null;

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6">
      <Heading size="page" title="New stream" subtitle="Pay a worker by the second, as the work is judged" />
      {me ? (
        <Form me={me} />
      ) : (
        <Empty icon={<IconWallet />} title="Connect a wallet to fund a stream">
          Use the button in the top bar. The wallet that connects pays for the stream and can cancel it.
        </Empty>
      )}
    </div>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-[13px] text-negative">{error}</span>
      ) : (
        hint && <span className="text-[13px] text-fg-muted">{hint}</span>
      )}
    </label>
  );
}

function Form({ me }: { me: Address }) {
  const { send, isSending } = useSendTransaction();
  const [worker, setWorker] = useState("");
  const [mintText, setMintText] = useState<string>(DEFAULT_MINT);
  const [deposit, setDeposit] = useState("20");
  const [rate, setRate] = useState("0.1");
  const [stale, setStale] = useState("15");
  const [submitted, setSubmitted] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const mint = isAddress(mintText.trim()) ? toAddress(mintText.trim()) : null;
  const { balance, mint: mintInfo, error: mintError } = useTokenBalance(me, mint);

  const depositN = Number(deposit);
  const rateN = Number(rate);
  const staleN = Number(stale);
  const errors = {
    worker: !isAddress(worker.trim())
      ? "Enter the worker's Solana address"
      : worker.trim() === me
        ? "The worker can't be your own wallet"
        : null,
    mint: !mint ? "Enter a token mint address" : mintError,
    deposit:
      !(depositN > 0)
        ? "Enter an amount above 0"
        : balance !== null && depositN > balance
          ? `You hold ${balance.toLocaleString()} of this token`
          : null,
    rate: !(rateN > 0) ? "Enter a rate above 0" : rateN > depositN ? "The rate can't exceed the deposit" : null,
    stale: !(staleN >= 5 && staleN <= 3600) ? "Between 5 and 3,600 seconds" : null,
  };
  const valid = Object.values(errors).every((e) => !e) && !!mintInfo;
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  const fullRunMinutes = rateN > 0 && depositN > 0 ? depositN / rateN / 60 : null;

  async function submit() {
    setSubmitted(true);
    setTxError(null);
    if (!valid || !mint || !mintInfo) return;
    try {
      const unit = 10 ** mintInfo.decimals;
      const { instruction, stream } = await createStreamInstruction({
        payer: me,
        worker: toAddress(worker.trim()),
        mint,
        mintInfo,
        deposit: BigInt(Math.round(depositN * unit)),
        rateMax: BigInt(Math.round(rateN * unit)),
        staleAfter: BigInt(Math.round(staleN)),
      });
      await send({ instructions: [instruction] });
      navigate(`/s/${stream}`);
    } catch (err) {
      setTxError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <Card surfaceClassName="flex flex-col gap-5 p-5">
        <Field label="Worker" hint="The wallet that gets paid. It claims whenever it likes." error={show("worker")}>
          <input
            value={worker}
            onChange={(e) => setWorker(e.target.value)}
            placeholder="Worker's address"
            spellCheck={false}
            className={cn(fieldClass, "font-mono text-[13px]")}
          />
        </Field>

        <Field
          label="Token"
          hint={
            balance !== null && mintInfo
              ? `You hold ${balance.toLocaleString()}${mint === DEFAULT_MINT ? " of the devnet test token" : ""}`
              : mint === DEFAULT_MINT
                ? "The devnet test token"
                : undefined
          }
          error={show("mint")}
        >
          <input
            value={mintText}
            onChange={(e) => setMintText(e.target.value)}
            spellCheck={false}
            className={cn(fieldClass, "font-mono text-[13px]")}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Deposit" hint="The most this stream can pay" error={show("deposit")}>
            <input
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              inputMode="decimal"
              className={cn(fieldClass, "nums")}
            />
          </Field>
          <Field label="Max rate per second" hint="Paid when the judges are certain" error={show("rate")}>
            <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={cn(fieldClass, "nums")} />
          </Field>
        </div>

        <Field
          label="Pause after silence"
          hint="Seconds without a tick before payment stops"
          error={show("stale")}
        >
          <input value={stale} onChange={(e) => setStale(e.target.value)} inputMode="numeric" className={cn(fieldClass, "nums")} />
        </Field>

        {fullRunMinutes !== null && (
          <p className="nums rounded-xl bg-surface px-3 py-2.5 text-[13px] text-fg-muted">
            At full rate the deposit lasts {fullRunMinutes < 120 ? `${fullRunMinutes.toFixed(1)} min` : `${(fullRunMinutes / 60).toFixed(1)} h`}.
            At p = 0.5 it lasts twice as long.
          </p>
        )}
      </Card>

      <section>
        <SectionTitle subtitle="Both sign every tick; the lower score is paid">Who judges</SectionTitle>
        <DetailList>
          <Detail label="Evidence">Test-suite results from CI</Detail>
          <Detail label="Judge A" mono>
            {short(PLATFORM_JUDGES.a, 6, 6)}
          </Detail>
          <Detail label="Judge B" mono>
            {short(PLATFORM_JUDGES.b, 6, 6)}
          </Detail>
        </DetailList>
      </section>

      <div className="flex flex-col gap-2">
        <Button type="submit" variant="accent" size="lg" full loading={isSending}>
          <IconPlus />
          Fund stream{depositN > 0 ? ` with ${depositN.toLocaleString()} tokens` : ""}
        </Button>
        {txError && <p className="text-[13px] text-negative">{txError}</p>}
        <p className="text-center text-[12px] text-fg-subtle">
          You can cancel any time. The worker keeps what they've earned; the rest comes back to you.
        </p>
      </div>
    </form>
  );
}
