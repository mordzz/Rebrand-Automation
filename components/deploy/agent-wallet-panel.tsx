"use client";

import { ArrowUpRight, Check, Copy, Loader2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { RevealKey } from "@/components/deploy/reveal-key";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type WalletInfo = {
  address: string;
  balanceSol: number | null;
  balanceUsd: number | null;
  error: string | null;
};

type WalletResponse = {
  configured: boolean;
  wallet: WalletInfo | null;
  reason?: "not_generated" | "encryption_key_missing";
};

/**
 * The agent's own trading wallet: where the operator deposits, and where
 * they withdraw from.
 *
 * Separate from the connected Phantom wallet on purpose — that one is only
 * an identity here and its keys are never held. Only what is deposited
 * into this address is ever at risk, which is the whole reason the agent
 * gets a wallet of its own rather than borrowing the operator's.
 */
export function AgentWalletPanel({
  walletQuery,
  ownerAddress,
}: {
  walletQuery: string;
  /** The operator's connected Phantom address — needed to pick the right
   * wallet when proving ownership to export the agent key. */
  ownerAddress: string;
}) {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /* Bumped after a withdrawal so the balance refreshes immediately rather
     than waiting out the poll. Fetching inside the effect (rather than via
     a useCallback the effect calls) matches usePolledJson elsewhere in
     this file's siblings and keeps the state update out of the effect body. */
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch(`/api/my-bot/wallet?${walletQuery}`);
        const json = (await res.json()) as WalletResponse;
        if (!disposed) setData(json);
      } catch {
        // keep the last good value
      }
    }
    load();
    const interval = setInterval(load, 20_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [walletQuery, refreshTick]);

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  async function withdraw() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/my-bot/wallet?${walletQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, amountSol: Number(amount) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Withdrawal failed.");
        return;
      }
      setSuccess(`Sent ${json.amountSol} SOL · ${json.signature.slice(0, 8)}…`);
      setAmount("");
      setDestination("");
      setRefreshTick((t) => t + 1);
    } catch {
      setError("Withdrawal failed.");
    } finally {
      setBusy(false);
    }
  }

  const wallet = data?.wallet ?? null;
  const balance = wallet?.balanceSol ?? null;

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Wallet className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Agent Wallet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Its own wallet. Deposit here; your Phantom keys are never held.
          </p>
        </div>
      </div>

      {data && !wallet ? (
        <p className="border-t border-white/5 px-4 py-8 text-center text-sm text-muted-foreground">
          {data.reason === "encryption_key_missing"
            ? "Set AGENT_WALLET_ENCRYPTION_KEY to enable agent wallets — a secret key is never stored unencrypted."
            : "No wallet yet. Refit this agent once to generate one."}
        </p>
      ) : !wallet ? (
        <p className="border-t border-white/5 px-4 py-8 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-1 border-t border-white/5 p-1 sm:grid-cols-2">
            <div className="rounded-xl bg-secondary px-4 py-3.5">
              <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
                Deposit address
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="min-w-0 truncate font-mono text-xs">
                  {wallet.address}
                </span>
                <button
                  type="button"
                  onClick={() => copyAddress(wallet.address)}
                  title="Copy address"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-accent"
                >
                  {copied ? (
                    <Check className="text-sol-green-ink size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[0.7rem] text-muted-foreground">
                Send SOL here to fund the agent.
              </p>
            </div>

            <div className="rounded-xl bg-secondary px-4 py-3.5">
              <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
                Balance
              </p>
              <p className="mt-2 text-2xl font-medium tabular-nums">
                {balance != null ? `${balance.toFixed(4)} SOL` : "—"}
              </p>
              <p className="mt-1 text-[0.7rem] text-muted-foreground">
                {wallet.error
                  ? "RPC unavailable — try again shortly"
                  : wallet.balanceUsd != null
                    ? `≈ $${wallet.balanceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                    : "Live balance"}
              </p>
            </div>
          </div>

          <div className="border-t border-white/5 px-4 py-4">
            <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
              Withdraw
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Destination address"
                spellCheck={false}
                autoComplete="off"
                className="h-9 min-w-0 flex-1 rounded-lg bg-secondary px-3 font-mono text-xs outline-none placeholder:text-muted-foreground/60"
              />
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                className="h-9 w-24 rounded-lg bg-secondary px-3 text-right font-mono text-xs outline-none placeholder:text-muted-foreground/60"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setAmount(
                    balance != null ? Math.max(0, balance - 0.00001).toFixed(5) : ""
                  )
                }
                disabled={balance == null || balance <= 0}
                title="Leaves a little behind for the network fee"
              >
                Max
              </Button>
              <Button
                size="sm"
                onClick={withdraw}
                disabled={busy || !destination.trim() || !amount.trim()}
              >
                {busy ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <ArrowUpRight className="mr-1.5 size-3.5" />
                )}
                Send
              </Button>
            </div>

            {(error || success) && (
              <p
                className={cn(
                  "mt-2.5 text-xs",
                  error ? "text-destructive" : "text-sol-green-ink"
                )}
              >
                {error ?? success}
              </p>
            )}

            <p className="mt-3 text-[0.7rem] text-muted-foreground/70">
              Withdrawals are real, on-chain and irreversible. Only deposit what
              you are willing to put at risk.
            </p>
          </div>

          <RevealKey
            walletQuery={walletQuery}
            ownerAddress={ownerAddress}
            agentAddress={wallet.address}
          />
        </>
      )}
    </div>
  );
}
