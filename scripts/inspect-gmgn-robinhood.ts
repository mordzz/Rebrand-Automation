/**
 * Manual, human-in-the-loop inspection tool for GMGN's Robinhood-chain
 * trenches payload — the "mandatory first step" PR05 was asked to
 * complete but could not, because GMGN_API_KEY is unset in this
 * environment. Run this yourself once you have a real key.
 *
 * Deliberately queries WITHOUT a launchpad_platform filter (i.e. GMGN's
 * own default allow-list applies) — this is diagnostic/raw-payload
 * inspection, not the production discovery adapter, which requires an
 * explicit approved allow-list and fails closed without one (see
 * lib/gmgn/discovery-robinhood.ts#resolveLaunchpadAllowlist). Querying
 * broadly here is intentional: you need to see what launchpads and
 * fields actually come back before anyone can approve a production list.
 *
 * This does NOT feed into any automated test — its job is to print the
 * raw response so a human can compare it against
 * lib/gmgn/discovery-robinhood.ts's normalizeRobinhoodToken() and update
 * both that function and GMGN_ROBINHOOD_FIELD_MAP.md from what actually
 * comes back, not from the Solana-adapter-derived guess this PR shipped
 * with.
 *
 * Run: npm run inspect:gmgn-robinhood
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { gmgnRequest } from "@/lib/gmgn/client";

async function main() {
  if (!process.env.GMGN_API_KEY?.trim()) {
    console.error(
      "GMGN_API_KEY is not set — this is exactly the blocker documented in " +
        "lib/gmgn/discovery-robinhood.ts and the PR05 report. Set it in .env.local and re-run."
    );
    process.exitCode = 1;
    return;
  }

  console.log("Requesting chain=robinhood, new_creation, no launchpad filter (diagnostic only)\n");

  const result = await gmgnRequest<Record<string, unknown[]>>(
    "/v1/trenches",
    { chain: "robinhood" },
    {
      method: "POST",
      body: {
        version: "v2",
        new_creation: {
          filters: ["offchain", "onchain"],
          launchpad_platform_v2: true,
          limit: 10,
        },
      },
    }
  );

  if (!result.ok) {
    console.error("Request failed:", result);
    process.exitCode = 1;
    return;
  }

  const list = result.data.new_creation ?? [];
  console.log(`Got ${Array.isArray(list) ? list.length : "non-array"} item(s).\n`);
  console.log(JSON.stringify(list, null, 2));

  if (Array.isArray(list) && list.length > 0) {
    console.log("\nField names on the first item (compare against normalizeRobinhoodToken):");
    console.log(Object.keys(list[0] as Record<string, unknown>).sort().join("\n"));

    console.log("\nDistinct launchpad_platform values seen (for choosing the production allow-list):");
    const platforms = new Set(
      (list as Record<string, unknown>[])
        .map((item) => item.launchpad_platform ?? item.launchpad)
        .filter((v) => typeof v === "string")
    );
    console.log([...platforms].join("\n"));
  }
}

main().catch((error) => {
  console.error("Inspection failed:", error);
  process.exitCode = 1;
});
