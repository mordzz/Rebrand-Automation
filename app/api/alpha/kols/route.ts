import { type NextRequest, NextResponse } from "next/server";

import { isGmgnConfigured } from "@/lib/gmgn/client";
import { getKolProfiles } from "@/lib/gmgn/kol-positions";
import { getTokenSocials } from "@/lib/gmgn/token-info";
import { getManyWalletStats, type WalletStats } from "@/lib/gmgn/wallet-stats";
import { getManyWalletTokenBalances } from "@/lib/gmgn/wallet-holdings";
import { getTokenMarkets } from "@/lib/sniper/token-market";

/** A KOL identity can span several wallets (see lib/gmgn/kol-positions.ts);
 * GMGN's wallet_stats is per-wallet, so this combines them into one figure
 * per identity - weighted by each wallet's own token count where a plain
 * average would let an inactive wallet's win rate distort an active one's. */
function aggregateWalletStats(
  wallets: string[],
  statsByWallet: Map<string, WalletStats>
) {
  const stats = wallets.map((w) => statsByWallet.get(w)).filter((s): s is WalletStats => !!s);

  const weighted = stats.filter((s) => s.winRate != null && s.tokenCount != null);
  const totalWeight = weighted.reduce((sum, s) => sum + (s.tokenCount ?? 0), 0);
  const winRate =
    weighted.length > 0 && totalWeight > 0
      ? weighted.reduce((sum, s) => sum + (s.winRate ?? 0) * (s.tokenCount ?? 0), 0) / totalWeight
      : (stats.find((s) => s.winRate != null)?.winRate ?? null);

  const realizedProfits = stats.map((s) => s.realizedProfitUsd).filter((v): v is number => v != null);
  const realizedProfitUsd =
    realizedProfits.length > 0 ? realizedProfits.reduce((a, b) => a + b, 0) : null;

  const tokenCounts = stats.map((s) => s.tokenCount).filter((v): v is number => v != null);
  const tokenCount = tokenCounts.length > 0 ? tokenCounts.reduce((a, b) => a + b, 0) : null;

  // Same X profile regardless of which wallet reported it.
  const followersCount = stats.find((s) => s.followersCount != null)?.followersCount ?? null;

  return { winRate, realizedProfitUsd, tokenCount, followersCount };
}

// Tracked wallets trade continuously - never cache this route.
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 25;

function positiveInt(raw: string | null, fallback: number, max?: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  const floored = Math.floor(n);
  return max ? Math.min(floored, max) : floored;
}

/** Every tracked KOL, one row per account (not per position - see
 * lib/gmgn/kol-positions.ts), each with their own win rate and realized
 * PnL from GMGN's own wallet_stats (7d, GMGN's computed figure across
 * that wallet's full history - not re-derived from the trade window this
 * page also uses for the position list), plus the tokens they've bought
 * in that window. GMGN's `/v1/user/kol` is a recent-activity feed with a
 * hard 100-row cap, not a directory of every KOL it has ever tagged, so
 * "how many KOLs" here is bounded by how many distinct accounts show up
 * in that recent window - not the full roster GMGN maintains internally. */
export async function GET(request: NextRequest) {
  if (!isGmgnConfigured()) {
    return NextResponse.json({
      configured: false,
      data: [],
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 0,
    });
  }

  const params = request.nextUrl.searchParams;
  const pageSize = positiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const requestedPage = positiveInt(params.get("page"), 1);

  const all = await getKolProfiles();
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const kols = all.slice((page - 1) * pageSize, page * pageSize);

  const mints = [...new Set(kols.flatMap((k) => k.positions.map((p) => p.mint)))];
  const allWallets = kols.flatMap((k) => k.wallets);
  // Every position's own wallet, not just each KOL's primary one - a
  // multi-wallet KOL's second wallet holds this position, not the first.
  const walletMintPairs = kols.flatMap((k) =>
    k.positions.map((p) => ({ wallet: p.wallet, mint: p.mint }))
  );

  const [socials, currentMarkets, walletStats, balances] = await Promise.all([
    getTokenSocials(mints),
    // Priced for every mint on the page, not just open ones: a "closed"
    // cycle can still be a partial exit with a real balance left, and
    // that leftover needs a current price to value - see holdingValueUsd
    // below.
    getTokenMarkets(mints),
    getManyWalletStats(allWallets),
    getManyWalletTokenBalances(walletMintPairs),
  ]);

  const data = kols.map((k) => {
    const stats = aggregateWalletStats(k.wallets, walletStats);
    return {
      wallets: k.wallets,
      traderName: k.traderName,
      traderHandle: k.traderHandle,
      avatarUrl: k.traderHandle
        ? `https://unavatar.io/x/${encodeURIComponent(k.traderHandle)}`
        : null,
      lastActiveAt: k.lastActiveAt,
      // GMGN's own 7d record, combined across every wallet this identity
      // trades from - deliberately separate from anything derived from
      // `positions` below, which is only this page's visible window.
      winRate: stats.winRate,
      realizedProfitUsd7d: stats.realizedProfitUsd,
      tokenCount7d: stats.tokenCount,
      followersCount: stats.followersCount,
      positions: k.positions.map((p) => {
        const social = socials.get(p.mint);
        const market = currentMarkets.get(p.mint) ?? null;
        const currentMarketCapUsd = p.status === "open" ? market?.marketCapUsd ?? null : null;
        const unrealizedPnlUsd =
          p.status === "open" && p.investedUsd != null && p.entryMarketCapUsd && currentMarketCapUsd
            ? p.investedUsd * (currentMarketCapUsd / p.entryMarketCapUsd - 1)
            : null;

        // What this position's own wallet actually holds right now - a
        // live on-chain fact, not something the trade window implies. A
        // "closed" cycle with balance > 0 here is a partial exit our own
        // pairing had no way to see.
        const balance = balances.get(`${p.wallet}:${p.mint}`)?.balance ?? null;
        const supplyPct =
          balance != null && p.totalSupply ? (balance / p.totalSupply) * 100 : null;
        const holdingValueUsd =
          balance != null && market?.priceUsd != null ? balance * market.priceUsd : null;

        return {
          id: p.id,
          mint: p.mint,
          symbol: p.symbol,
          // Jupiter's icon index was Solana-only; TokenIcon renders a
          // monogram fallback on Robinhood Chain (PR16).
          tokenLogo: null,
          tokenTwitter: social?.twitter ?? null,
          tokenWebsite: social?.website ?? null,
          tokenTelegram: social?.telegram ?? null,
          status: p.status,
          enteredAt: p.enteredAt,
          exitedAt: p.exitedAt,
          entryMarketCapUsd: p.entryMarketCapUsd,
          exitMarketCapUsd: p.status === "open" ? currentMarketCapUsd : p.exitMarketCapUsd,
          pnlUsd: p.status === "open" ? unrealizedPnlUsd : p.realizedPnlUsd,
          supplyPct,
          holdingValueUsd,
        };
      }),
    };
  });

  return NextResponse.json({ configured: true, data, page, pageSize, total, totalPages });
}
