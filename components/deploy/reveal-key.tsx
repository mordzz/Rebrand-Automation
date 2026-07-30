"use client";

import { AlertTriangle, Check, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { useSignMessage, useWallets } from "@privy-io/react-auth/solana";

import { Button } from "@/components/ui/button";

/** Bytes → base64, without pulling in a base58 library just for this.
 * The server decodes the same way; base58 would mean depending on `bs58`,
 * which is only a transitive dependency here. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Exports the agent wallet's private key for import into Phantom.
 *
 * Gated behind a wallet signature rather than a confirm dialog: the API
 * this calls trusts nothing from the browser, so a click alone cannot
 * unlock it. The operator proves ownership by signing a single-use
 * challenge with the same Phantom wallet that owns the bot.
 */
export function RevealKey({
  walletQuery,
  ownerAddress,
  agentAddress,
}: {
  walletQuery: string;
  ownerAddress: string;
  agentAddress: string;
}) {
  const { signMessage } = useSignMessage();
  const { wallets } = useWallets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      /* Sign with the wallet that actually owns this bot. Falling back to
         the first connected wallet would produce a signature the server
         correctly rejects, with a confusing error. */
      const wallet =
        wallets.find((w) => w.address === ownerAddress) ?? wallets[0];
      if (!wallet) {
        setError("No connected Solana wallet to sign with.");
        return;
      }

      const challengeRes = await fetch(`/api/my-bot/reveal-key?${walletQuery}`);
      const challenge = await challengeRes.json();
      if (!challengeRes.ok) {
        setError(challenge.error ?? "Could not start the request.");
        return;
      }

      // Phantom renders this text verbatim, so the operator sees exactly
      // what they are authorising before approving.
      const { signature } = await signMessage({
        message: new TextEncoder().encode(challenge.message),
        wallet,
      });

      const res = await fetch(`/api/my-bot/reveal-key?${walletQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nonce: challenge.nonce,
          signature: toBase64(signature),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not reveal the key.");
        return;
      }
      setSecret(json.privateKey);
      setShown(false);
    } catch {
      setError("Signature was cancelled or failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <div className="border-t border-white/5 px-4 py-4">
      <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
        Export private key
      </p>

      {!secret ? (
        <>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            This wallet is yours — you can import it into Phantom and hold it
            directly. You&apos;ll be asked to sign a message with{" "}
            <span className="font-mono">
              {ownerAddress.slice(0, 4)}…{ownerAddress.slice(-4)}
            </span>{" "}
            to prove the wallet is yours. Nothing is spent by signing.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={reveal}
            disabled={busy}
            className="mt-3"
          >
            {busy ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Eye className="mr-1.5 size-3.5" />
            )}
            Reveal private key
          </Button>
        </>
      ) : (
        <>
          <div className="text-destructive mt-2 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Anyone with this key can take everything in the wallet. Never
              paste it into a website, a chat, or a support message. The agent
              keeps trading with this same key, so import it — don&apos;t
              treat it as a one-time export.
            </span>
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-secondary px-3 py-2 font-mono text-xs">
              {shown ? secret : "•".repeat(44)}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShown((v) => !v)}
              title={shown ? "Hide" : "Show"}
            >
              {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
            <Button variant="outline" size="sm" onClick={copyKey}>
              {copied ? (
                <Check className="text-sol-green-ink mr-1.5 size-3.5" />
              ) : (
                <Copy className="mr-1.5 size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <p className="mt-2.5 text-[0.7rem] text-muted-foreground/70">
            Agent wallet {agentAddress.slice(0, 4)}…{agentAddress.slice(-4)} · In
            Phantom: Add / Connect wallet → Import private key → paste.
          </p>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSecret(null);
              setShown(false);
            }}
            className="mt-2"
          >
            Done — hide it
          </Button>
        </>
      )}

      {error && <p className="text-destructive mt-2.5 text-xs">{error}</p>}
    </div>
  );
}
