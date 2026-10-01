"use client";

import { Loader2, RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAuthedFetch } from "@/lib/auth/use-privy-authed-fetch";

/** Mirrors lib/sniper/config.ts#SniperConfig - kept as a plain type here
 * (not imported) since this file is a client component and the source
 * type lives in server-only code that also touches the DB driver. */
type TakeProfitTier = { atPct: number; sellPortionPct: number };

type SniperConfigValue = {
  requireMintAuthorityRenounced: boolean;
  requireFreezeAuthorityRenounced: boolean;
  /* Robinhood/EVM safety + risk fields (PR06.5/PR07) - the ones the active
     Robinhood runtime actually reads. The Solana fields above stay in the
     type only so a save round-trips them untouched. */
  requireOwnerRenounced: boolean;
  requireNoBlacklistCapability: boolean;
  maxCreatorHoldPct: number | null;
  maxNativePerSnipe: number | null;
  maxNativeDeployed: number | null;
  maxDailyDrawdownNative: number | null;
  nativeSymbol: string | null;
  requireSocialLink: boolean;
  requireAlphaWalletBuy: boolean;
  alphaWallets: string[];
  maxCreatorBuyPct: number;
  minTokenAgeSec: number;
  maxTokenAgeSec: number | null;
  blockedKeywords: string[];
  maxSolPerSnipe: number;
  maxConcurrentPositions: number;
  maxTotalDeployedSol: number;
  exitMode: "fixed" | "tiered";
  takeProfitPct: number;
  stopLossPct: number;
  takeProfitTiers: TakeProfitTier[];
  trailingStopEnabled: boolean;
  trailingStopActivationPct: number;
  trailingStopPct: number;
  breakevenAfterPct: number | null;
  maxHoldTimeSec: number | null;
  crashDropPct: number;
  exitCheckIntervalMs: number;
  maxConsecutiveLosses: number;
  maxDailyDrawdownSol: number;
  cooldownAfterLossSec: number;
  metadataFetchTimeoutMs: number;
};

function usePolledJson<T>(url: string, intervalMs: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (!disposed) setData(json);
      } catch {
        // keep whatever we already have
      }
    }
    load();
    const interval = setInterval(load, intervalMs);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [url, intervalMs]);
  return data;
}

/** Display a slider value at its step's precision (no float noise such as
 * 0.0022104315514197086). */
function formatStepValue(value: number, step: number): string {
  const decimals = Math.min(8, Math.max(0, (String(step).split(".")[1] ?? "").length));
  return Number(value.toFixed(decimals)).toString();
}

function Field({
  label,
  hint,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-sm font-normal">{label}</Label>
        <span className="text-sm font-medium tabular-nums">
          {formatStepValue(value, step)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        min={min}
        max={max}
        step={step}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NullableField({
  label,
  hint,
  value,
  unit,
  min,
  max,
  step,
  fallback,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | null;
  unit?: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
  onChange: (v: number | null) => void;
}) {
  const enabled = value != null;
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label className="text-sm font-normal">{label}</Label>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onChange(checked ? fallback : null)}
        />
      </div>
      {enabled && (
        <div className="flex items-baseline justify-between">
          <Slider
            value={[value]}
            onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
            min={min}
            max={max}
            step={step}
            className="flex-1"
          />
          <span className="ml-4 w-24 shrink-0 text-right text-sm font-medium tabular-nums">
            {formatStepValue(value, step)}
            {unit ? ` ${unit}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

function SwitchField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label className="text-sm font-normal">{label}</Label>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function SniperConfigPanel({
  endpoint = "/api/sniper/config",
  title = "The Raven · Live Config",
  description = "Changes take effect on the daemon's next cycle - no restart needed.",
  saveFetch,
}: {
  endpoint?: string;
  title?: string;
  description?: string;
  /** Used for the PATCH only. Defaults to the app-wide authed fetch
   * (lib/auth/use-privy-authed-fetch.ts) - both the per-bot and the house
   * config PATCH routes require a verified Privy user. */
  saveFetch?: typeof fetch;
}) {
  const contextFetch = useAuthedFetch();
  const doFetch = saveFetch ?? contextFetch;
  const response = usePolledJson<{ configured: boolean; config: SniperConfigValue | null }>(
    endpoint,
    10_000
  );
  const [draft, setDraft] = useState<SniperConfigValue | null>(null);
  const [keywordsInput, setKeywordsInput] = useState("");
  const [alphaWalletsInput, setAlphaWalletsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the draft once from the first fetched config, adjusting state
  // during render (React's documented pattern for this) rather than an
  // effect - `!draft` means this only ever fires once, so a later poll
  // tick never clobbers in-progress edits.
  if (response?.config && !draft) {
    setDraft(response.config);
    setKeywordsInput(response.config.blockedKeywords.join(", "));
    setAlphaWalletsInput(response.config.alphaWallets.join(", "));
  }

  const dirty = useMemo(() => {
    if (!draft || !response?.config) return false;
    return JSON.stringify(draft) !== JSON.stringify(response.config);
  }, [draft, response]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await doFetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => ({}))) as { config?: SniperConfigValue; error?: string };
      if (res.ok && json.config) {
        setDraft(json.config);
        setSavedAt(Date.now());
      } else {
        // Surface the failure instead of silently leaving the draft unsaved.
        setSaveError(json.error ?? `Couldn't save (HTTP ${res.status}). Your changes are still here - try again.`);
      }
    } catch {
      setSaveError("Couldn't reach the server. Your changes are still here - try again.");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    if (response?.config) {
      setDraft(response.config);
      setKeywordsInput(response.config.blockedKeywords.join(", "));
      setAlphaWalletsInput(response.config.alphaWallets.join(", "));
    }
  }

  function set<K extends keyof SniperConfigValue>(key: K, value: SniperConfigValue[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  /** Robinhood risk limits are only trusted with nativeSymbol="ETH"
   * (lib/sniper/risk-limits-robinhood.ts), so setting one records it. */
  function setNative(
    key: "maxNativePerSnipe" | "maxNativeDeployed" | "maxDailyDrawdownNative",
    value: number | null,
  ) {
    setDraft((prev) => (prev ? { ...prev, [key]: value, nativeSymbol: value == null ? prev.nativeSymbol : "ETH" } : prev));
  }

  function updateTier(index: number, patch: Partial<TakeProfitTier>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const tiers = prev.takeProfitTiers.map((t, i) => (i === index ? { ...t, ...patch } : t));
      return { ...prev, takeProfitTiers: tiers };
    });
  }

  function addTier() {
    setDraft((prev) =>
      prev
        ? { ...prev, takeProfitTiers: [...prev.takeProfitTiers, { atPct: 50, sellPortionPct: 25 }] }
        : prev
    );
  }

  function removeTier(index: number) {
    setDraft((prev) =>
      prev
        ? { ...prev, takeProfitTiers: prev.takeProfitTiers.filter((_, i) => i !== index) }
        : prev
    );
  }

  if (response && !response.configured) {
    return (
      <div className="rounded-2xl bg-card p-5 text-sm text-muted-foreground">
        Connect DATABASE_URL to configure the Raven - trading behavior lives
        in Postgres so it can change without a restart.
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-card p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading Raven configuration…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            {title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {saveError ? (
            <span role="alert" className="max-w-xs text-right text-xs text-destructive">
              {saveError}
            </span>
          ) : (
            savedAt && !dirty && <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {dirty && (
            <Button variant="ghost" size="sm" onClick={reset} className="text-xs text-muted-foreground">
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty || saving} className="h-8">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-8 p-6 lg:grid-cols-2">
        {/* Entry filters */}
        <div className="space-y-5">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Entry filters
          </p>
          <SwitchField
            label="Require contract ownership renounced"
            hint="ERC-20 owner must be renounced - the EVM stand-in for Solana's mint/freeze authority checks."
            checked={draft.requireOwnerRenounced}
            onChange={(v) => set("requireOwnerRenounced", v)}
          />
          <SwitchField
            label="Require no blacklist capability"
            hint="Reject tokens whose contract can blacklist holders."
            checked={draft.requireNoBlacklistCapability}
            onChange={(v) => set("requireNoBlacklistCapability", v)}
          />
          <SwitchField
            label="Require a social link"
            hint="Reject tokens with no website/X/Telegram in their metadata."
            checked={draft.requireSocialLink}
            onChange={(v) => set("requireSocialLink", v)}
          />
          <NullableField
            label="Max creator holding"
            hint="Reject if the creator currently holds more than this % of supply. Off = not configured: Robinhood entries are refused until it is set."
            value={draft.maxCreatorHoldPct}
            unit="%"
            min={1}
            max={50}
            step={1}
            fallback={10}
            onChange={(v) => set("maxCreatorHoldPct", v)}
          />
          <Field
            label="Minimum token age before evaluating"
            hint="Delay entry this long after a launch is first observed - 0 = evaluate immediately."
            value={draft.minTokenAgeSec}
            unit="s"
            min={0}
            max={60}
            step={1}
            onChange={(v) => set("minTokenAgeSec", v)}
          />
          <NullableField
            label="Max age before skipping"
            hint="Skip a queued snipe if it's been waiting longer than this (processing backlog)."
            value={draft.maxTokenAgeSec}
            unit="s"
            min={5}
            max={300}
            step={5}
            fallback={120}
            onChange={(v) => set("maxTokenAgeSec", v)}
          />
          <div className="space-y-2">
            <Label className="text-sm font-normal">Blocked keywords</Label>
            <input
              value={keywordsInput}
              onChange={(e) => {
                setKeywordsInput(e.target.value);
                set(
                  "blockedKeywords",
                  e.target.value
                    .split(",")
                    .map((k) => k.trim())
                    .filter(Boolean)
                );
              }}
              placeholder="e.g. test, airdrop, elon"
              className="w-full rounded-lg bg-secondary px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Reject if the token&apos;s name or symbol contains any of these.
            </p>
          </div>
          <SwitchField
            label="Require a tracked alpha wallet to have bought in"
            hint="Checks on-chain whether any wallet below currently holds the token. Only fires once you add at least one address - empty list is a no-op."
            checked={draft.requireAlphaWalletBuy}
            onChange={(v) => set("requireAlphaWalletBuy", v)}
          />
          <div className="space-y-2">
            <Label className="text-sm font-normal">Alpha wallets</Label>
            <input
              value={alphaWalletsInput}
              onChange={(e) => {
                setAlphaWalletsInput(e.target.value);
                set(
                  "alphaWallets",
                  e.target.value
                    .split(",")
                    .map((k) => k.trim())
                    .filter(Boolean)
                );
              }}
              placeholder="e.g. known smart-money wallet addresses, comma-separated"
              className="w-full rounded-lg bg-secondary px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated wallet addresses to track. Detected via live RPC balance checks, not a paid trade-stream API.
            </p>
          </div>
        </div>

        {/* Sizing + circuit breaker */}
        <div className="space-y-5">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Sizing
          </p>
          <NullableField
            label="Position size per snipe"
            hint="Off = not configured: the agent refuses every entry until sizing is set."
            value={draft.maxNativePerSnipe}
            unit="ETH"
            min={0.001}
            max={0.5}
            step={0.001}
            fallback={0.01}
            onChange={(v) => setNative("maxNativePerSnipe", v)}
          />
          <Field
            label="Max concurrent positions"
            value={draft.maxConcurrentPositions}
            min={1}
            max={10}
            step={1}
            onChange={(v) => set("maxConcurrentPositions", v)}
          />
          <NullableField
            label="Max total deployed"
            hint="Off = not configured: entries are refused."
            value={draft.maxNativeDeployed}
            unit="ETH"
            min={0.005}
            max={5}
            step={0.005}
            fallback={0.05}
            onChange={(v) => setNative("maxNativeDeployed", v)}
          />

          <p className="pt-2 text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Circuit breaker
          </p>
          <Field
            label="Max consecutive losses"
            hint="Pauses trading without a restart once hit."
            value={draft.maxConsecutiveLosses}
            min={1}
            max={10}
            step={1}
            onChange={(v) => set("maxConsecutiveLosses", v)}
          />
          <NullableField
            label="Max daily drawdown"
            hint="Off = not configured: entries are refused."
            value={draft.maxDailyDrawdownNative}
            unit="ETH"
            min={0.002}
            max={2}
            step={0.001}
            fallback={0.02}
            onChange={(v) => setNative("maxDailyDrawdownNative", v)}
          />
          <Field
            label="Cooldown after a loss"
            hint="No new entries for this long after any closed loss."
            value={draft.cooldownAfterLossSec}
            unit="s"
            min={0}
            max={600}
            step={10}
            onChange={(v) => set("cooldownAfterLossSec", v)}
          />
        </div>
      </div>

      {/* Exit strategy - full width, it's the richest section */}
      <div className="m-1 mt-0 rounded-2xl bg-secondary p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Exit strategy
          </p>
          <div className="flex items-center gap-2">
            <Label className="text-sm font-normal">Mode</Label>
            <Select
              value={draft.exitMode}
              onValueChange={(v) => set("exitMode", v as "fixed" | "tiered")}
            >
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="tiered">Tiered</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-5 grid gap-8 lg:grid-cols-2">
          <div className="space-y-5">
            {draft.exitMode === "fixed" ? (
              <Field
                label="Take-profit target"
                value={draft.takeProfitPct}
                unit="%"
                min={10}
                max={500}
                step={5}
                onChange={(v) => set("takeProfitPct", v)}
              />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-normal">Take-profit tiers</Label>
                  <Button variant="ghost" size="sm" onClick={addTier} className="h-7 text-xs">
                    Add tier
                  </Button>
                </div>
                {draft.takeProfitTiers.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No tiers yet - falls back to the fixed take-profit target above.
                  </p>
                )}
                {draft.takeProfitTiers.map((tier, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-card p-2">
                    <Badge variant="secondary" className="shrink-0">
                      Tier {i + 1}
                    </Badge>
                    <div className="flex flex-1 items-center gap-1 text-sm">
                      <span className="text-muted-foreground">at</span>
                      <input
                        type="number"
                        value={tier.atPct}
                        onChange={(e) => updateTier(i, { atPct: Number(e.target.value) })}
                        className="w-16 rounded bg-secondary px-2 py-1 text-center outline-none"
                      />
                      <span className="text-muted-foreground">% sell</span>
                      <input
                        type="number"
                        value={tier.sellPortionPct}
                        onChange={(e) =>
                          updateTier(i, { sellPortionPct: Number(e.target.value) })
                        }
                        className="w-16 rounded bg-secondary px-2 py-1 text-center outline-none"
                      />
                      <span className="text-muted-foreground">% of remainder</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeTier(i)}
                      className="h-7 shrink-0 text-xs text-muted-foreground"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Field
              label="Stop-loss distance"
              hint="Applies in both modes as a safety net."
              value={draft.stopLossPct}
              unit="%"
              min={5}
              max={90}
              step={5}
              onChange={(v) => set("stopLossPct", v)}
            />
            <Field
              label="Crash-detect drop"
              hint="Emergency exit if price falls this much in a single check, regardless of the rules above."
              value={draft.crashDropPct}
              unit="%"
              min={5}
              max={50}
              step={5}
              onChange={(v) => set("crashDropPct", v)}
            />
            <Field
              label="Exit check interval"
              value={draft.exitCheckIntervalMs}
              unit="ms"
              min={1000}
              max={30000}
              step={500}
              onChange={(v) => set("exitCheckIntervalMs", v)}
            />
          </div>

          <div className="space-y-5">
            <SwitchField
              label="Trailing stop"
              hint="Once armed, exits if price falls off its peak - locks in gains instead of riding a fixed target down."
              checked={draft.trailingStopEnabled}
              onChange={(v) => set("trailingStopEnabled", v)}
            />
            {draft.trailingStopEnabled && (
              <>
                <Field
                  label="Arms after gain of"
                  value={draft.trailingStopActivationPct}
                  unit="%"
                  min={5}
                  max={200}
                  step={5}
                  onChange={(v) => set("trailingStopActivationPct", v)}
                />
                <Field
                  label="Trail distance"
                  value={draft.trailingStopPct}
                  unit="%"
                  min={3}
                  max={50}
                  step={1}
                  onChange={(v) => set("trailingStopPct", v)}
                />
              </>
            )}
            <NullableField
              label="Breakeven lock"
              hint="Once price ever reaches this gain, the stop floor moves to entry price - guarantees no loss from there on."
              value={draft.breakevenAfterPct}
              unit="%"
              min={5}
              max={200}
              step={5}
              fallback={30}
              onChange={(v) => set("breakevenAfterPct", v)}
            />
            <NullableField
              label="Force time-exit"
              hint="Exit after holding this long, regardless of P&L - the direct fix for 'stayed too long even though profitable.'"
              value={draft.maxHoldTimeSec}
              unit="s"
              min={30}
              max={3600}
              step={30}
              fallback={600}
              onChange={(v) => set("maxHoldTimeSec", v)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
