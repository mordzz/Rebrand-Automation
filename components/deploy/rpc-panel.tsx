"use client";

import { Check, Loader2, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { usePrivyAuthedFetch } from "@/lib/auth/use-privy-authed-fetch";
import { cn } from "@/lib/utils";

type RpcResponse = {
  configured: boolean;
  rpc: { masked: string } | null;
};

/**
 * Per-bot RPC endpoint.
 *
 * The value is write-only from the browser's side: once saved, the server
 * only ever hands back a masked host, because provider URLs carry an API
 * key and this endpoint trusts a client-asserted wallet. Re-entering the
 * full URL is the only way to change it — that's deliberate, not an
 * oversight.
 */
export function RpcPanel({ walletQuery }: { walletQuery: string }) {
  const [current, setCurrent] = useState<{ masked: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const authedFetch = usePrivyAuthedFetch();

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch(`/api/my-bot/rpc?${walletQuery}`);
        const json = (await res.json()) as RpcResponse;
        if (!disposed) setCurrent(json.rpc);
      } catch {
        // leave as-is
      } finally {
        if (!disposed) setLoaded(true);
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, [walletQuery]);

  async function save() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authedFetch(`/api/my-bot/rpc?${walletQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: draft }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save that endpoint.");
        return;
      }
      setCurrent(json.rpc);
      setDraft("");
      setSuccess(
        `Connected in ${json.latencyMs}ms${json.version ? ` · solana-core ${json.version}` : ""}`
      );
    } catch {
      setError("Could not save that endpoint.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await authedFetch(`/api/my-bot/rpc?${walletQuery}`, { method: "DELETE" });
      setCurrent(null);
    } catch {
      setError("Could not clear that endpoint.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Zap className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Private RPC
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your own Solana endpoint for this bot&apos;s on-chain checks.
          </p>
        </div>
      </div>

      <div className="border-t border-white/5 px-4 py-4">
        {/* The honest pitch: this is about not being rate-limited, not
            about transaction speed — paper mode sends none. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          The shared public endpoint gets rate-limited. When that happens the
          mint-authority check can&apos;t complete, and a check that
          can&apos;t complete is treated as failed, so the token is refused.
          A private endpoint removes that failure, which means fewer entries
          missed for reasons that had nothing to do with the token.
        </p>

        {loaded && current && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary px-3.5 py-2.5">
            <span className="flex items-center gap-2 text-sm">
              <Check className="text-sol-green-ink size-4 shrink-0" />
              <span className="font-mono text-xs">{current.masked}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={clear} disabled={busy}>
              <Trash2 className="mr-1.5 size-3.5" />
              Remove
            </Button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://your-endpoint.example/?api-key=…"
            spellCheck={false}
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-lg bg-secondary px-3 font-mono text-xs outline-none placeholder:text-muted-foreground/60"
          />
          <Button size="sm" onClick={save} disabled={busy || !draft.trim()}>
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            {current ? "Replace" : "Save & test"}
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
          Saved endpoints are never shown again in full — the URL carries your
          API key, so only a masked form is returned.
        </p>
      </div>
    </div>
  );
}
