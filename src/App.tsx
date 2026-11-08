import { useWalletConnection } from "@solana/react-hooks";
import type { ReactNode } from "react";
import { DevPage } from "./DevPage";
import { Home } from "./Home";
import { NewStream } from "./NewStream";
import { Link, usePath } from "./router";
import { StreamPage } from "./StreamPage";
import { Button, cn, IconWallet, Mark } from "./ui";

const TABS = [
  { href: "/", label: "Streams" },
  // The dev console drives local processes, so it only exists under `pnpm dev`.
  ...(import.meta.env.DEV ? [{ href: "/dev", label: "Dev console" }] : []),
];

export default function App() {
  const path = usePath();
  const streamId = path.match(/^\/s\/([^/]+)/)?.[1];

  let page: ReactNode;
  let tab = "/";
  if (import.meta.env.DEV && path.startsWith("/dev")) {
    page = <DevPage />;
    tab = "/dev";
  } else if (path === "/new") page = <NewStream />;
  else if (streamId) page = <StreamPage id={streamId} />;
  else page = <Home />;

  return (
    <div className="min-h-svh">
      <TopBar path={tab} />
      <main className="page py-8 md:py-10">{page}</main>
    </div>
  );
}

function TopBar({ path }: { path: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="page relative flex h-14 items-center justify-between gap-3">
        <Link href="/" className="inline-flex h-9 items-center gap-2 rounded-full pr-2 text-[17px] font-semibold tracking-tighter">
          <Mark />
          analog
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:absolute sm:left-1/2 sm:-translate-x-1/2">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={path === t.href ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150",
                path === t.href ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Wallet />
      </div>
    </header>
  );
}

function Wallet() {
  const { connectors, connect, disconnect, wallet, status } = useWalletConnection();
  const address = wallet?.account.address.toString();

  if (status === "connected" && address) {
    return (
      <WalletChip>
        <span className="font-mono text-[13px]">
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>
        <Button variant="ghost" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </WalletChip>
    );
  }
  if (connectors.length === 0) {
    return <span className="hidden text-[13px] text-fg-subtle sm:inline">No Solana wallet found</span>;
  }
  return (
    <div className="flex items-center gap-2">
      {connectors.slice(0, 2).map((c) => (
        <Button
          key={c.id}
          size="sm"
          variant={c === connectors[0] ? "primary" : "outline"}
          loading={status === "connecting"}
          onClick={() => connect(c.id)}
        >
          <IconWallet />
          {connectors.length === 1 ? `Connect ${c.name}` : c.name}
        </Button>
      ))}
    </div>
  );
}

function WalletChip({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-0.5 pl-3">{children}</div>;
}
