"use client";

import { Zap } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal";

/**
 * Confirms the switch from paper to live.
 *
 * Shows the actual figures rather than a generic "are you sure": the
 * point of the step is that the operator sees what this agent will
 * spend, from which wallet, at what size, before it can spend anything.
 * A confirmation nobody reads is worth nothing.
 */
export function GoLiveModal({
  balanceSol,
  sizeSol,
  address,
  busy,
  onConfirm,
  onCancel,
}: {
  balanceSol: number | null;
  sizeSol: number | null;
  address: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [understood, setUnderstood] = useState(false);

  return (
    <ModalShell
      tone="danger"
      icon={<Zap className="size-4" />}
      onClose={busy ? () => {} : onCancel}
      title={
        <>
          <p className="text-sm font-medium">Switch to live trading?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            From here the agent buys and sells with real SOL, on its own,
            with no further prompt per trade.
          </p>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-1 border-t border-white/5 p-1">
        <div className="rounded-xl bg-secondary px-4 py-3">
          <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
            Wallet balance
          </p>
          <p className="mt-1.5 text-lg font-medium tabular-nums">
            {balanceSol == null ? "—" : `${balanceSol.toFixed(4)} SOL`}
          </p>
        </div>
        <div className="rounded-xl bg-secondary px-4 py-3">
          <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
            Size per trade
          </p>
          <p className="mt-1.5 text-lg font-medium tabular-nums">
            {sizeSol == null ? "—" : `${sizeSol.toFixed(4)} SOL`}
          </p>
        </div>
      </div>

      <div className="border-t border-white/5 px-5 py-4">
        <ul className="space-y-2 text-xs text-muted-foreground">
          <li className="flex gap-2">
            <span aria-hidden className="text-destructive">
              &bull;
            </span>
            <span>
              Trades are irreversible. A meme coin can lose most of its value
              in the time it takes to read this.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-destructive">
              &bull;
            </span>
            <span>
              It spends only from the agent wallet
              {address ? (
                <>
                  {" "}
                  <span className="font-mono text-foreground">
                    {address.slice(0, 4)}…{address.slice(-4)}
                  </span>
                </>
              ) : null}
              , never from your own. Keep in it only what you can lose.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-destructive">
              &bull;
            </span>
            <span>
              Live keeps running on the server after you close this page.
              Stop is the only thing that halts it.
            </span>
          </li>
        </ul>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-xs">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-current"
          />
          <span className="text-muted-foreground">
            I understand this agent will trade real funds without asking me
            again.
          </span>
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Stay on paper
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={!understood || busy}
          >
            {busy ? "Switching…" : "Go live"}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
