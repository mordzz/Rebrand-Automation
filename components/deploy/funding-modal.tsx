"use client";

import { AlertTriangle, Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal";

/**
 * Warns when a live agent cannot afford to trade.
 *
 * The failure this prevents is a quiet one: a bot switched to live with an
 * empty wallet looks like it is working - it is started, it is scanning,
 * it likes candidates - and simply never fills, logging a rejection each
 * time. Without this the operator would have to read the console to find
 * out why nothing happened.
 *
 * Only raised for live bots. A paper bot spends nothing, so an empty
 * wallet is not a problem there and nagging about it would train the
 * operator to dismiss this without reading it.
 */
export function FundingModal({
  address,
  balance,
  required,
  symbol,
  onClose,
}: {
  address: string;
  balance: number;
  required: number;
  /** Native unit of the agent wallet (Robinhood: ETH). */
  symbol: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  const shortfall = Math.max(0, required - balance);

  return (
    <ModalShell
      tone="danger"
      icon={<AlertTriangle className="size-4" />}
      onClose={onClose}
      title={
        <>
          <p className="text-sm font-medium">Fund the agent wallet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This agent can&apos;t afford a trade, so it will keep passing on
            everything it finds.
          </p>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-1 border-t border-white/5 p-1">
        <div className="rounded-xl bg-secondary px-4 py-3">
          <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
            Balance
          </p>
          <p className="text-destructive mt-1.5 text-lg font-medium tabular-nums">
            {balance.toFixed(5)} {symbol}
          </p>
        </div>
        <div className="rounded-xl bg-secondary px-4 py-3">
          <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
            Needed per trade
          </p>
          <p className="mt-1.5 text-lg font-medium tabular-nums">
            {required.toFixed(5)} {symbol}
          </p>
        </div>
      </div>

      <div className="border-t border-white/5 px-5 py-4">
        <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
          Deposit address
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-secondary px-3 py-2 font-mono text-xs">
            {address}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? (
              <Check className="text-sol-green-ink mr-1.5 size-3.5" />
            ) : (
              <Copy className="mr-1.5 size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Send at least{" "}
          <span className="text-foreground font-medium">
            {shortfall.toFixed(5)} {symbol}
          </span>{" "}
          more to this address. The figure covers one position at your
          configured size plus the network fee, so the agent can always
          afford to sell back out of what it buys.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            I&apos;ll fund it later
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
