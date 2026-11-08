import type { ReactNode } from "react";
import { IconExternal } from "./ui";

export const EXPLORER = "https://explorer.solana.com";

export function short(s: string, head = 4, tail = 4) {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function since(seconds: number) {
  if (seconds < 90) return `${Math.max(0, Math.floor(seconds))}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} days`;
}

export function tokens(units: number, decimals: number, digits = 4) {
  return (units / 10 ** decimals).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function ExplorerLink({ kind, value, children }: { kind: "tx" | "address"; value: string; children: ReactNode }) {
  return (
    <a
      href={`${EXPLORER}/${kind}/${value}?cluster=devnet`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-fg hover:text-accent"
    >
      {children}
      <IconExternal className="size-3.5 text-fg-subtle" />
    </a>
  );
}
