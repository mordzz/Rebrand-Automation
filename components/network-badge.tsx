import { ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { cn } from "@/lib/utils";

/** Which Robinhood Chain network this app is pointed at. Testnet is called
 * out in amber so no one mistakes simulated/testnet state for mainnet. */
export function NetworkBadge({ className }: { className?: string }) {
  const testnet = ROBINHOOD_NETWORK === "testnet";
  return (
    <span
      title={`Robinhood Chain ${ROBINHOOD_NETWORK}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold tracking-[0.12em] uppercase",
        testnet ? "bg-amber-400/10 text-amber-300" : "bg-white/10 text-foreground/80",
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", testnet ? "bg-amber-300" : "bg-foreground/60")} />
      Robinhood · {ROBINHOOD_NETWORK}
    </span>
  );
}
