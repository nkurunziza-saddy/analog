import { useWalletConnection } from "@solana/react-hooks";
import { StreamDashboard } from "./StreamDashboard";

export default function App() {
  const { connectors, connect, disconnect, wallet, status } = useWalletConnection();
  const address = wallet?.account.address.toString();

  return (
    <div className="min-h-screen bg-bg1 text-[13px] leading-[18px] text-foreground">
      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-[16px] leading-[21px] font-medium">Analog</h1>
            <p className="text-muted">Money that streams at the rate a judge believes the work is on spec.</p>
          </div>
          {status === "connected" && address ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-muted">
                {address.slice(0, 4)}…{address.slice(-4)}
              </span>
              <button
                onClick={() => disconnect()}
                className="h-7 rounded-md border border-border-low bg-card px-3 font-medium"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {connectors.length === 0 && <span className="text-muted">No Solana wallet found in this browser</span>}
              {connectors.map((c) => (
                <button
                  key={c.id}
                  onClick={() => connect(c.id)}
                  disabled={status === "connecting"}
                  className="h-7 rounded-md border border-border-low bg-card px-3 font-medium disabled:opacity-50"
                >
                  Connect {c.name}
                </button>
              ))}
            </div>
          )}
        </header>

        <StreamDashboard />
      </main>
    </div>
  );
}
