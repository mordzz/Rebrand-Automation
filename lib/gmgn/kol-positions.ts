import { getKolTrades, type TrackedTrade } from "./track";

/** Quote-currency mints, not alpha plays — a KOL's wallet "buying WSOL"
 * is the quote leg of some other swap, not a position they're taking.
 * Included defensively because GMGN's `total_supply` figure for
 * established SPL tokens like this doesn't follow the same
 * already-decimal-adjusted convention pump.fun mints do (verified live:
 * WSOL priced out to a five-digit-billion market cap), not just because
 * it's an uninteresting row. */
const EXCLUDED_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

/**
 * Turns the flat KOL trade feed into individual buy-in/exit cycles per
 * (wallet, token) — the thing lib/gmgn/track.ts's chronological feed
 * can't answer on its own, since it shows individual events rather than
 * "when did they get in, when did they get out, what did they make."
 *
 * Windowed, not ground truth: this only sees the last `getKolTrades()`
 * rows across every tracked KOL combined. A sell with no buy in that
 * window is dropped rather than shown with a fabricated entry — see
 * `pairTrades` — and an open cycle at the end of the window may already
 * have been exited outside it. It is only as complete as the window is
 * deep.
 */

export type KolPositionCycle = {
  id: string;
  wallet: string;
  traderName: string;
  traderHandle: string | null;
  /** GMGN's own avatar URL — 403s outside gmgn.ai, resolve via
   * unavatar.io at the API route instead (see app/api/alpha/kols/route.ts). */
  gmgnAvatarUrl: string | null;
  mint: string;
  symbol: string | null;
  /** Raw GMGN URL — resolve via lib/jupiter/token-icons.ts before
   * rendering, same as every other GMGN-sourced token logo here. */
  tokenLogo: string | null;
  /** Circulating supply as reported alongside the trade — pump.fun mints
   * are fixed-supply, so this doesn't drift between entry and exit for
   * the vast majority of tokens here. Combined with a live balance (see
   * lib/gmgn/wallet-holdings.ts, fetched at the API route) to show what
   * share of the token this position's wallet actually holds right now. */
  totalSupply: number | null;
  status: "open" | "closed";
  enteredAt: number;
  exitedAt: number | null;
  /** From the entry trade's own price × supply — the cap at the moment
   * they actually bought, not whatever it is now. */
  entryMarketCapUsd: number | null;
  /** Same, from the exit trade, when closed. Left null while open — the
   * API route fills this with a *current* market cap for unrealized PnL,
   * a distinct enough number (as-of-now vs as-of-exit) that conflating
   * them here would misrepresent a still-open position as already priced. */
  exitMarketCapUsd: number | null;
  investedUsd: number | null;
  /** GMGN's own cost-basis-vs-proceeds figure from the closing sell —
   * realized only. Never set for an open cycle; unrealized PnL needs a
   * current price this module has no access to (see the route). */
  realizedPnlUsd: number | null;
};

function marketCap(trade: TrackedTrade): number | null {
  if (trade.priceUsd == null || trade.totalSupply == null) return null;
  const mc = trade.priceUsd * trade.totalSupply;
  return Number.isFinite(mc) && mc > 0 ? mc : null;
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** One (wallet, token) trade history → its buy-in/exit cycles, oldest
 * first internally (chronological pairing needs that order), returned
 * newest-activity-first to match every other list on this page. */
function pairTrades(trades: TrackedTrade[]): KolPositionCycle[] {
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const cycles: KolPositionCycle[] = [];

  let open: {
    enteredAt: number;
    entryMarketCapUsd: number | null;
    investedUsd: number;
  } | null = null;

  for (const trade of sorted) {
    if (trade.side === "buy") {
      if (!open) {
        open = {
          enteredAt: trade.timestamp,
          entryMarketCapUsd: marketCap(trade),
          investedUsd: trade.amountUsd ?? 0,
        };
      } else {
        open.investedUsd += trade.amountUsd ?? 0;
      }
      continue;
    }

    // A sell with nothing open means the entry happened before our
    // window starts — there is no honest "entered at" to show, so this
    // trade is dropped rather than displayed half-populated.
    if (!open) continue;

    const first = sorted[0];
    cycles.push({
      id: `${trade.wallet}:${trade.token}:${open.enteredAt}`,
      wallet: trade.wallet,
      traderName: first.traderName,
      traderHandle: first.traderHandle,
      gmgnAvatarUrl: first.traderAvatar,
      mint: trade.token,
      symbol: trade.symbol,
      tokenLogo: trade.tokenLogo,
      totalSupply: trade.totalSupply,
      status: "closed",
      enteredAt: open.enteredAt,
      exitedAt: trade.timestamp,
      entryMarketCapUsd: open.entryMarketCapUsd,
      exitMarketCapUsd: marketCap(trade),
      investedUsd: open.investedUsd,
      // GMGN's own cost basis for what this sell closed out — trusted
      // over re-deriving it from investedUsd, which only reflects buys
      // our own window happened to see.
      realizedPnlUsd:
        trade.buyCostUsd != null && trade.amountUsd != null
          ? trade.amountUsd - trade.buyCostUsd
          : null,
    });
    open = null;
  }

  if (open) {
    const last = sorted[sorted.length - 1];
    cycles.push({
      id: `${last.wallet}:${last.token}:${open.enteredAt}`,
      wallet: last.wallet,
      traderName: last.traderName,
      traderHandle: last.traderHandle,
      gmgnAvatarUrl: last.traderAvatar,
      mint: last.token,
      symbol: last.symbol,
      tokenLogo: last.tokenLogo,
      totalSupply: last.totalSupply,
      status: "open",
      enteredAt: open.enteredAt,
      exitedAt: null,
      entryMarketCapUsd: open.entryMarketCapUsd,
      exitMarketCapUsd: null,
      investedUsd: open.investedUsd,
      realizedPnlUsd: null,
    });
  }

  return cycles;
}

export type KolProfile = {
  /** Every wallet address seen trading under this identity — a KOL with
   * an X handle can (and in practice does) trade from more than one
   * wallet, and GMGN tags all of them with the same identity. Grouping
   * by wallet alone would show that one person as several rows; this is
   * what fixes that. */
  wallets: string[];
  traderName: string;
  traderHandle: string | null;
  gmgnAvatarUrl: string | null;
  /** Most recent activity across every position — what the KOL list
   * itself sorts by, so an account active a minute ago outranks one
   * whose only visible trade is from an hour ago. */
  lastActiveAt: number;
  /** Newest-activity-first, merged across every wallet above. */
  positions: KolPositionCycle[];
};

/** Every tracked KOL, one row each — identified by X handle where GMGN
 * gives one (so the same person's several wallets collapse into a single
 * row), falling back to wallet address for the rare anonymous-handle
 * case where there is nothing else to key identity on. Buy-in/exit
 * cycles nested underneath, most recently active KOL first. */
export async function getKolProfiles(): Promise<KolProfile[]> {
  const trades = (await getKolTrades()).filter((t) => !EXCLUDED_MINTS.has(t.token));
  const byWalletToken = groupBy(trades, (t) => `${t.wallet}:${t.token}`);

  const cycles = [...byWalletToken.values()].flatMap(pairTrades);
  const byIdentity = groupBy(cycles, (c) => c.traderHandle ?? `wallet:${c.wallet}`);

  const profiles: KolProfile[] = [];
  for (const [, identityCycles] of byIdentity) {
    const positions = [...identityCycles].sort(
      (a, b) => (b.exitedAt ?? b.enteredAt) - (a.exitedAt ?? a.enteredAt)
    );
    const wallets = [...new Set(identityCycles.map((c) => c.wallet))];
    const first = positions[0];
    profiles.push({
      wallets,
      traderName: first.traderName,
      traderHandle: first.traderHandle,
      gmgnAvatarUrl: first.gmgnAvatarUrl,
      lastActiveAt: first.exitedAt ?? first.enteredAt,
      positions,
    });
  }

  return profiles.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
