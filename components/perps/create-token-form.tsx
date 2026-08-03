"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { getBase58Decoder } from "@solana/kit";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { MarketSelector } from "./market-selector";
import { useFeeSplit } from "./use-fee-split";

import { buildRegisterTokenTransaction } from "@/lib/perps/launch";
import { getMarketBySymbol } from "@/lib/perps/markets";
import { explorerUrl, PERPSPAD_CHAIN } from "@/lib/perps/program";
import type { PerpsDirection } from "@/lib/perps/perpspad-types";

import { PRIVY_APP_ID } from "@/components/providers";

const LEVERAGE_OPTIONS = [2, 3, 5, 10, 20];

type SubmitState =
  | { phase: "idle" }
  | { phase: "building" }
  | { phase: "signing" }
  | { phase: "recording" }
  | { phase: "error"; message: string }
  | { phase: "done"; symbol: string; mint: string; signature: string };

const BUSY_PHASES = new Set(["building", "signing", "recording"]);

const PHASE_LABEL: Record<string, string> = {
  building: "Preparing transaction…",
  signing: "Confirm in your wallet…",
  recording: "Recording launch…",
};

/** Privy hands back raw signature bytes; explorers want base58. Kit's
 * own codec rather than a hand-rolled loop — it already handles the
 * leading-zero rule that trips up naive implementations. */
function toBase58Signature(sig: Uint8Array): string {
  return getBase58Decoder().decode(sig);
}

function CreateTokenFormInner() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  // The Solana wallet specifically — `user.wallet` is Privy's primary
  // wallet, which on a multi-chain account can be an EVM one whose
  // address would never resolve as a Solana signer.
  const solanaWallet = wallets[0] ?? null;
  const address = solanaWallet?.address ?? null;

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [underlying, setUnderlying] = useState("SOL");
  const [direction, setDirection] = useState<PerpsDirection>("LONG");
  const [leverage, setLeverage] = useState(5);
  const [collateral, setCollateral] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle" });
  const feeSplit = useFeeSplit();

  const collateralNum = parseFloat(collateral) || 0;
  const notional = collateralNum * leverage;
  const isValid =
    name.trim().length > 0 &&
    symbol.trim().length > 0 &&
    collateralNum >= 10;

  async function handleSubmit() {
    if (!authenticated || !address || !solanaWallet) {
      login();
      return;
    }
    if (!isValid || BUSY_PHASES.has(submit.phase)) return;

    const market = getMarketBySymbol(underlying);
    if (!market) {
      setSubmit({ phase: "error", message: `Unsupported market: ${underlying}` });
      return;
    }

    try {
      setSubmit({ phase: "building" });
      const { transactionBytes, mint } = await buildRegisterTokenTransaction({
        creatorWallet: address,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        underlyingMarketIndex: market.marketIndex,
        direction,
        targetLeverage: leverage,
      });

      setSubmit({ phase: "signing" });
      const { signature } = await signAndSendTransaction({
        transaction: transactionBytes,
        wallet: solanaWallet,
        chain: PERPSPAD_CHAIN,
      });

      // The launch is real the moment that lands. Recording it in our
      // own table is bookkeeping, so a failure here must not be reported
      // as a failed launch — the token exists either way.
      setSubmit({ phase: "recording" });
      try {
        await fetch("/api/perps/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mint }),
        });
      } catch {
        // fall through — the on-chain launch already succeeded
      }

      setSubmit({
        phase: "done",
        symbol: symbol.trim().toUpperCase(),
        mint,
        signature: toBase58Signature(signature),
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = /user rejected|declined|cancel/i.test(raw)
        ? "Transaction cancelled."
        : raw || "Launch failed — nothing was sent.";
      setSubmit({ phase: "error", message });
    }
  }

  return (
    <section
      id="create"
      className="scroll-mt-24 border-t border-white/6 py-14"
    >
      <div>
        <p className="text-primary text-[10px] tracking-[0.3em] uppercase sm:text-xs">
          Create
        </p>
        <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">
          Launch your{" "}
          <em className="font-instrument font-normal italic text-foreground/60">
            perp-backed token.
          </em>
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose an underlying market, direction, and leverage. Your token will
          be backed by a real perpetual futures position on Drift Protocol.
        </p>

        <div className="mt-8 space-y-6 rounded-2xl border border-white/8 bg-white/[0.02] p-6">
          {/* Token identity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="token-name"
                className="text-xs tracking-wider text-muted-foreground uppercase"
              >
                Token Name
              </label>
              <input
                id="token-name"
                type="text"
                placeholder="e.g. Long Bitcoin"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary/40 focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="token-symbol"
                className="text-xs tracking-wider text-muted-foreground uppercase"
              >
                Token Symbol
              </label>
              <input
                id="token-symbol"
                type="text"
                placeholder="e.g. LONGBTC"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                maxLength={10}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary/40 focus:outline-none"
              />
            </div>
          </div>

          {/* Market selector */}
          <MarketSelector value={underlying} onChange={setUnderlying} />

          {/* Direction toggle */}
          <div className="space-y-2">
            <label className="text-xs tracking-wider text-muted-foreground uppercase">
              Direction
            </label>
            <div className="flex gap-2">
              {(["LONG", "SHORT"] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => setDirection(dir)}
                  className={cn(
                    "flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-all duration-200",
                    direction === dir
                      ? dir === "LONG"
                        ? "border-[#5ed29c]/40 bg-[#5ed29c]/10 text-[#5ed29c]"
                        : "border-[#e2603f]/40 bg-[#e2603f]/10 text-[#e2603f]"
                      : "border-white/8 bg-white/[0.02] text-foreground/40 hover:border-white/15",
                  )}
                >
                  {dir === "LONG" ? "↑ " : "↓ "}
                  {dir}
                </button>
              ))}
            </div>
          </div>

          {/* Leverage selector */}
          <div className="space-y-2">
            <label className="text-xs tracking-wider text-muted-foreground uppercase">
              Target Leverage
            </label>
            <div className="flex gap-2">
              {LEVERAGE_OPTIONS.map((lev) => (
                <button
                  key={lev}
                  type="button"
                  onClick={() => setLeverage(lev)}
                  className={cn(
                    "flex-1 rounded-xl border py-2.5 text-sm font-semibold tabular-nums transition-all duration-200",
                    leverage === lev
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-white/8 bg-white/[0.02] text-foreground/40 hover:border-white/15",
                  )}
                >
                  {lev}×
                </button>
              ))}
            </div>
          </div>

          {/* Collateral input */}
          <div className="space-y-1.5">
            <label
              htmlFor="collateral"
              className="text-xs tracking-wider text-muted-foreground uppercase"
            >
              Initial Collateral (USDC)
            </label>
            <div className="relative">
              <input
                id="collateral"
                type="number"
                min={10}
                step={1}
                placeholder="Min. 10 USDC"
                value={collateral}
                onChange={(e) => setCollateral(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 pr-16 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary/40 focus:outline-none"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                USDC
              </span>
            </div>
          </div>

          {/* Preview panel */}
          {collateralNum > 0 && (
            <div className="rounded-xl border border-white/6 bg-white/[0.015] p-4">
              <p className="mb-3 text-[10px] tracking-wider text-muted-foreground uppercase">
                Position Preview
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  {
                    label: "Direction",
                    value: `${direction} ${underlying}`,
                    color:
                      direction === "LONG"
                        ? "text-[#5ed29c]"
                        : "text-[#e2603f]",
                  },
                  {
                    label: "Leverage",
                    value: `${leverage}×`,
                    color: "text-foreground",
                  },
                  {
                    label: "Notional",
                    value: `$${notional.toLocaleString()}`,
                    color: "text-foreground",
                  },
                  {
                    label: "Collateral",
                    value: `$${collateralNum.toLocaleString()}`,
                    color: "text-foreground",
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-[10px] text-muted-foreground">
                      {item.label}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-sm font-semibold tabular-nums",
                        item.color,
                      )}
                    >
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Fee split preview */}
              <div className="mt-3 border-t border-white/6 pt-3">
                <p className="mb-2 text-[10px] text-muted-foreground">
                  Fee Distribution
                </p>
                <div className="flex h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-primary/70"
                    style={{ width: `${feeSplit.collateralTopUp}%` }}
                    title={`${feeSplit.collateralTopUp}% Collateral Top-up`}
                  />
                  <div
                    className="bg-[#5ed29c]/70"
                    style={{ width: `${feeSplit.tokenBuybackBurn}%` }}
                    title={`${feeSplit.tokenBuybackBurn}% Token Buyback & Burn`}
                  />
                  <div
                    className="bg-[#e2603f]/70"
                    style={{ width: `${feeSplit.governanceBuybackBurn}%` }}
                    title={`${feeSplit.governanceBuybackBurn}% $PERPSPAD Buyback & Burn`}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[9px] text-muted-foreground">
                  <span>{feeSplit.collateralTopUp}% Collateral</span>
                  <span>{feeSplit.tokenBuybackBurn}% Token Burn</span>
                  <span>{feeSplit.governanceBuybackBurn}% Gov Burn</span>
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          {submit.phase === "done" ? (
            <div className="rounded-xl border border-[#5ed29c]/25 bg-[#5ed29c]/5 p-4 text-center">
              <p className="text-sm font-semibold text-foreground">
                ${submit.symbol} is live on devnet.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The mint is created and its full supply is in your wallet. The
                backing Drift position opens once the perp instructions ship —
                the token shows as{" "}
                <span className="text-foreground/70">Pending</span> until then.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                <a
                  href={explorerUrl("address", submit.mint)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] text-primary underline-offset-2 hover:underline"
                >
                  View mint ↗
                </a>
                <a
                  href={explorerUrl("tx", submit.signature)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] text-primary underline-offset-2 hover:underline"
                >
                  View transaction ↗
                </a>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSubmit({ phase: "idle" });
                  setName("");
                  setSymbol("");
                  setCollateral("");
                }}
                className="mt-3 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                Launch another
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  !ready || BUSY_PHASES.has(submit.phase) || (authenticated && !isValid)
                }
                className={cn(
                  "w-full rounded-xl py-3 text-sm font-semibold transition-all duration-200",
                  !authenticated || isValid
                    ? "cursor-pointer text-black hover:shadow-[0_0_24px_rgba(222,219,200,0.2)]"
                    : "cursor-not-allowed border border-white/8 bg-white/[0.03] text-foreground/30",
                )}
                style={
                  !authenticated || isValid
                    ? {
                        background: "#DEDBC8",
                        boxShadow: "0 0 16px rgba(222,219,200,0.12)",
                      }
                    : undefined
                }
              >
                {!ready
                  ? "Loading…"
                  : !authenticated
                    ? "Connect wallet to launch"
                    : (PHASE_LABEL[submit.phase] ??
                      (isValid
                        ? `Launch ${symbol || "Token"} — ${direction} ${underlying} ${leverage}×`
                        : "Fill in all fields to continue"))}
              </button>
              {submit.phase === "error" && (
                <p className="mt-2 text-center text-xs text-[#e2603f]">
                  {submit.message}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CreateTokenFormNoPrivy() {
  return (
    <section className="relative mt-8 rounded-2xl border border-white/8 bg-black/40 p-8 backdrop-blur-xl">
      <div className="mx-auto max-w-md text-center">
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Privy Wallet Required
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">
          To launch a perpetual-backed token, connect your Solana wallet.
          Please add your <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-foreground">NEXT_PUBLIC_PRIVY_APP_ID</code> to your <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-foreground">.env</code> file.
        </p>
      </div>
    </section>
  );
}

export function CreateTokenForm() {
  if (!PRIVY_APP_ID) {
    return <CreateTokenFormNoPrivy />;
  }
  return <CreateTokenFormInner />;
}
