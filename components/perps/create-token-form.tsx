"use client";

import { usePrivy } from "@privy-io/react-auth";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { MarketSelector } from "./market-selector";
import { useFeeSplit } from "./use-fee-split";

import type { PerpsDirection } from "@/lib/perps/perpspad-types";

const LEVERAGE_OPTIONS = [2, 3, 5, 10, 20];

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "error"; message: string }
  | { phase: "done"; symbol: string };

export function CreateTokenForm() {
  const { ready, authenticated, user, login } = usePrivy();
  const address = user?.wallet?.address ?? null;

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
    if (!authenticated || !address) {
      login();
      return;
    }
    if (!isValid || submit.phase === "submitting") return;

    setSubmit({ phase: "submitting" });
    try {
      const res = await fetch("/api/perps/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          underlying,
          direction,
          targetLeverage: leverage,
          creatorWallet: address,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmit({ phase: "error", message: json.error ?? "Something went wrong." });
        return;
      }
      setSubmit({ phase: "done", symbol: json.token.symbol });
    } catch {
      setSubmit({ phase: "error", message: "Connection trouble — try again." });
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
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-center">
              <p className="text-sm font-semibold text-foreground">
                Request received for ${submit.symbol}.
              </p>
              {/* Honest, not a fake "your token is live" — no on-chain
                  program exists yet in this phase, see the Perpspad plan. */}
              <p className="mt-1 text-xs text-muted-foreground">
                On-chain launch opens once the devnet program ships. We&apos;ll
                keep this request on file.
              </p>
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
                Submit another
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!ready || submit.phase === "submitting" || (authenticated && !isValid)}
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
                    : submit.phase === "submitting"
                      ? "Submitting…"
                      : isValid
                        ? `Launch ${symbol || "Token"} — ${direction} ${underlying} ${leverage}×`
                        : "Fill in all fields to continue"}
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
