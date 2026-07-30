/**
 * Token icons by mint, via Jupiter's public token API.
 *
 * Needed because the icon URLs GMGN ships with its own payloads point at
 * `gmgn.ai/external-res/...`, which sits behind Cloudflare and answers
 * 403 to anything that isn't their site — verified directly, including
 * with a full browser header set. Those URLs are unusable in our pages
 * and there is no legitimate way around that; it's their access decision.
 *
 * Jupiter's API is public and intended for exactly this, and the icons it
 * returns are the token's own metadata image (IPFS and similar), which is
 * the same kind of URL the Alpha table already loads successfully.
 */

const ENDPOINT = "https://lite-api.jup.ag/tokens/v2/search";
/** Mints per request. Jupiter takes a comma-separated query; kept modest
 * so one slow lookup can't stall a whole page's worth of rows. */
const BATCH_SIZE = 30;
const TIMEOUT_MS = 6000;

/* A mint's icon never changes, so this only ever grows toward the set of
   tokens we've seen. Capped anyway: a long-running server watching a
   permissionless launchpad would otherwise accumulate without bound.
   Negative results are cached too — a token with no icon should not be
   re-requested on every poll. */
const MAX_CACHE_ENTRIES = 5000;
const cache = new Map<string, string | null>();

function remember(mint: string, icon: string | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest != null) cache.delete(oldest);
  }
  cache.set(mint, icon);
}

type JupToken = { id?: unknown; icon?: unknown };

async function fetchBatch(mints: string[]): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?query=${mints.join(",")}`, {
      signal: controller.signal,
    });
    if (!res.ok) return;

    const json = (await res.json()) as JupToken[];
    if (!Array.isArray(json)) return;

    for (const token of json) {
      const id = typeof token.id === "string" ? token.id : null;
      if (!id) continue;
      const icon =
        typeof token.icon === "string" && /^https?:\/\//.test(token.icon)
          ? token.icon
          : null;
      remember(id, icon);
    }
    // Anything the response omitted genuinely has no entry — record that so
    // it isn't re-requested every cycle.
    for (const mint of mints) {
      if (!cache.has(mint)) remember(mint, null);
    }
  } catch {
    // Leave uncached on failure so a transient error gets retried later,
    // rather than poisoning the cache with a false "no icon".
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Icon URL per mint. Mints with no known icon map to null — callers should
 * fall back to something local (see components/token-icon.tsx) rather than
 * rendering a broken image.
 */
export async function getTokenIcons(
  mints: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(mints)].filter(Boolean);
  const missing = unique.filter((m) => !cache.has(m));

  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    batches.push(missing.slice(i, i + BATCH_SIZE));
  }
  await Promise.all(batches.map(fetchBatch));

  const out = new Map<string, string | null>();
  for (const mint of unique) out.set(mint, cache.get(mint) ?? null);
  return out;
}
