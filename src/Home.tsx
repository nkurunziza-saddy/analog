import { useState } from "react";
import { address as toAddress, type Address } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";
import { short, since, tokens } from "./format";
import { useMintInfo, useStreams, type StreamRow } from "./platform";
import { Link } from "./router";
import { isStale, projectEarned, STATUS_CANCELLED, useNow } from "./stream";
import { buttonClass, Card, Empty, Heading, IconPulse, Pill, Segmented, type Tone } from "./ui";

export function Home() {
  const { wallet, status } = useWalletConnection();
  const me = status === "connected" && wallet ? toAddress(wallet.account.address.toString()) : null;
  return me ? <YourStreams me={me} /> : <Landing />;
}

// ---------------------------------------------------------------- signed in

function YourStreams({ me }: { me: Address }) {
  const [role, setRole] = useState<"payer" | "worker">("payer");
  const { rows, error } = useStreams({ who: me, role });

  return (
    <div className="flex flex-col gap-8">
      <Heading
        size="page"
        title="Your streams"
        subtitle="Money that follows the work"
        action={
          <Link href="/new" className={buttonClass({ size: "md" })}>
            New stream
          </Link>
        }
      />

      <section>
          <div className="mb-3 w-64">
            <Segmented
              size="sm"
              value={role}
              onChange={setRole}
              options={[
                { value: "payer", label: "Paying" },
                { value: "worker", label: "Earning" },
              ]}
            />
          </div>
          {error ? (
            <Empty icon={<IconPulse />} title="Couldn't load your streams">
              {error}
            </Empty>
          ) : rows === null ? (
            <Empty icon={<IconPulse />} title="Reading devnet">
              Looking up streams for {short(me, 4, 4)}.
            </Empty>
          ) : rows.length === 0 ? (
            <Empty
              icon={<IconPulse />}
              title={role === "payer" ? "You aren't paying anyone yet" : "Nothing streaming to you yet"}
            >
              {role === "payer"
                ? "Fund a stream for a piece of work. It pays by the second, at the rate the judges believe the work is on spec."
                : "When someone streams to this wallet, it shows up here and you can claim what you've earned at any time."}
            </Empty>
          ) : (
            <StreamList rows={rows} me={me} />
          )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- signed out

function Landing() {
  const { rows } = useStreams(null, 15_000);
  return (
    <div className="flex flex-col gap-24 md:gap-32">
      <section className="flex max-w-[880px] flex-col gap-6 pt-6 md:pt-14">
        <Heading size="hero" title="Meet Analog" subtitle="Contracts that pay by the second, as the work is judged" />
        <p className="max-w-[52ch] text-[16px] leading-[1.55] text-pretty text-fg-muted">
          Contracts were all or nothing because judging work was expensive. Now two AI judges score the work every few
          seconds, and money flows at the rate they believe it's on spec. Live on Solana devnet.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/new" className={buttonClass({ size: "lg" })}>
            Start a stream
          </Link>
          {rows && rows[0] && (
            <Link href={`/s/${rows[0].address}`} className={buttonClass({ size: "lg", variant: "outline" })}>
              Watch a live stream
            </Link>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <Heading size="page" as="h2" title="How it works" subtitle="One promise, judged continuously" />
        <HowItWorks />
      </section>

      <section className="flex flex-col gap-4">
        <Heading size="page" as="h2" title="Streams on devnet" subtitle="Every stream on the program, live" />
        {rows === null ? (
          <Empty icon={<IconPulse />} title="Reading devnet">
            Looking up every stream on the program.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty icon={<IconPulse />} title="No streams yet">
            Be the first: start a stream and it appears here.
          </Empty>
        ) : (
          <StreamList rows={rows} />
        )}
      </section>
    </div>
  );
}

const STEPS = [
  {
    title: "Fund a stream",
    body: "The payer deposits tokens and sets a maximum rate. Nothing moves until the judges say the work is on track.",
  },
  {
    title: "Two judges score it",
    body: "Every few seconds two decision models read measured evidence, like test results, and post the probability the promise is kept. Both must sign.",
  },
  {
    title: "Money follows the score",
    body: "The program pays max rate × p per second, never past the deposit. If the judges go quiet, it stops. The worker claims any time.",
  },
];

function HowItWorks() {
  return (
    <ol className="grid gap-2 md:grid-cols-3">
      {STEPS.map((s, i) => (
        <li key={s.title}>
          <Card className="h-full" surfaceClassName="h-full p-5">
            <span className="nums grid size-7 place-items-center rounded-full bg-surface-2 text-[13px] font-medium text-fg-muted">
              {i + 1}
            </span>
            <p className="mt-3 text-[15px] font-medium">{s.title}</p>
            <p className="mt-1 text-[14px] leading-[1.5] text-fg-muted">{s.body}</p>
          </Card>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- list

function StreamList({ rows, me }: { rows: StreamRow[]; me?: Address }) {
  const now = useNow(4);
  return (
    <Card padded={false} surfaceClassName="px-4 py-1">
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <StreamListRow key={r.address} row={r} me={me} now={now} />
        ))}
      </ul>
    </Card>
  );
}

function StreamListRow({ row, me, now }: { row: StreamRow; me?: Address; now: number }) {
  const { data } = row;
  const mint = useMintInfo(data.mint);
  const decimals = mint?.decimals ?? 6;
  const earned = projectEarned(data, now);
  const share = Number(data.deposit) > 0 ? earned / Number(data.deposit) : 0;
  const cancelled = data.status === STATUS_CANCELLED;
  const stale = isStale(data, now);
  const finished = Number(data.earned) >= Number(data.deposit);

  const state: { label: string; tone: Tone; live?: boolean } = cancelled
    ? { label: "Cancelled", tone: "subtle" }
    : finished
      ? { label: "Fully paid", tone: "positive" }
      : stale
        ? { label: "Paused", tone: "neutral" }
        : { label: "Streaming", tone: "accent", live: true };

  const counterpart =
    me === data.payer ? `To ${short(data.worker)}` : me === data.worker ? `From ${short(data.payer)}` : `${short(data.payer)} → ${short(data.worker)}`;

  return (
    <li>
      <Link
        href={`/s/${row.address}`}
        className="-mx-2 flex items-center gap-4 rounded-xl px-2 py-3.5 transition-colors duration-150 hover:bg-surface"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px]">{counterpart}</span>
            <Pill tone={state.tone} live={state.live} className="h-5 px-2 text-[11px]">
              {state.label}
            </Pill>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, share * 100)}%` }} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="nums text-[15px] font-medium">{tokens(earned, decimals, 2)}</span>
          <span className="nums text-[12px] text-fg-subtle">
            of {tokens(Number(data.deposit), decimals, 0)} · p {(data.lastP / 10_000).toFixed(2)}
            {stale && !cancelled ? ` · ${since(now - Number(data.lastTickTs))} ago` : ""}
          </span>
        </div>
      </Link>
    </li>
  );
}
