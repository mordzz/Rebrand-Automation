// One-time, idempotent setup script. Run via `npm run provision-official-bot`.
//
// Creates the single public "Noah" agent shown on /dashboard with no
// login — a real user_bots row, provisioned through the exact same
// agent-wallet generator a normal /deploy uses, so it's picked up by
// the already-running scripts/paper-daemon.ts roster loop (unconditional
// `select * from user_bots`, refreshed every 20s) with zero daemon
// changes. See drizzle/schema/bots.ts#userBots.isOfficial for why this needs
// its own flag rather than just being another row: its wallet address is
// permanently public, so every mutating /api/my-bot route refuses to
// touch it (lib/db/official-bot.ts#assertNotOfficial) and a database
// CHECK constraint independently guarantees it can never go live.
//
// walletAddress and agentPublicKey are deliberately the SAME generated
// key here (unlike a normal deploy, where walletAddress is the human
// operator's own Phantom address). Noah has no human operator, and
// agentPublicKey is only ever read for real signing when tradingMode is
// "live" — which this bot can never reach — so a second identity key
// would add nothing but a confusing second address on the public page.
import "dotenv/config";

import { getDb } from "@/lib/db";
import { userBots } from "@/drizzle/schema";
import { generateRobinhoodAgentWallet, isAgentWalletConfigured } from "@/lib/chain/robinhood-agent-wallet";
import { getOfficialBot } from "@/lib/db/official-bot";

async function main() {
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL is not set — nothing to provision against.");
    process.exit(1);
  }

  if (!isAgentWalletConfigured()) {
    console.error(
      "AGENT_WALLET_ENCRYPTION_KEY is not set — refusing to provision a bot with no way to encrypt its wallet secret."
    );
    process.exit(1);
  }

  const existing = await getOfficialBot();
  if (existing) {
    console.log(`Noah is already provisioned: ${existing.walletAddress}`);
    return;
  }

  // PR09A: Solana agent wallets are retired; Noah gets a Robinhood/EVM
  // agent wallet tagged with chain/network metadata like any new bot.
  const wallet = await generateRobinhoodAgentWallet();

  try {
    await db.insert(userBots).values({
      walletAddress: wallet.address,
      agentPublicKey: wallet.address,
      agentSecretEnc: wallet.secretEnc,
      agentChain: wallet.chain,
      agentNetwork: wallet.network,
      agentNativeSymbol: wallet.nativeSymbol,
      name: "Noah",
      characterType: "3d",
      characterSrc: null,
      config: {},
      tradingMode: "paper",
      active: true,
      isOfficial: true,
    });
  } catch (err) {
    // Backstop for a provisioning race (two runs at once) — the partial
    // unique index on isOfficial is the real guarantee here, this just
    // turns that into a friendly message instead of a crash.
    const again = await getOfficialBot();
    if (again) {
      console.log(`Noah is already provisioned: ${again.walletAddress}`);
      return;
    }
    throw err;
  }

  console.log(`Provisioned Noah: ${wallet.address}`);
  console.log(
    "This address is now public (shown on /dashboard). It stays paper-mode permanently — do not fund it expecting live execution."
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
