import fs from "fs/promises";
import path from "path";

const DRIFT_PERP_MARKETS_URL =
  "https://raw.githubusercontent.com/drift-labs/protocol-v2/master/sdk/src/constants/perpMarkets.ts";

async function main() {
  console.log("Fetching Drift perpMarkets.ts from github...");
  const res = await fetch(DRIFT_PERP_MARKETS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.statusText}`);
  }
  const text = await res.text();

  // Extract the DevnetPerpMarkets array block
  const devnetStart = text.indexOf("export const DevnetPerpMarkets");
  if (devnetStart === -1) throw new Error("Could not find DevnetPerpMarkets");
  
  // Find the end of DevnetPerpMarkets block (it ends right before PerpMarkets or end of file)
  const mainnetStart = text.indexOf("export const PerpMarkets", devnetStart);
  const block = mainnetStart !== -1 ? text.substring(devnetStart, mainnetStart) : text.substring(devnetStart);

  // We will parse market objects using regex
  // Each object is wrapped in { ... }
  
  const markets = [];
  const objectRegex = /\{[^}]+fullName:[^}]+\}/g;
  const matches = block.match(objectRegex);
  
  if (!matches) {
    console.error("No markets found by regex!");
    process.exit(1);
  }

  for (const match of matches) {
    const symbolMatch = match.match(/symbol:\s*'([^']+)'/);
    const baseMatch = match.match(/baseAssetSymbol:\s*'([^']+)'/);
    const nameMatch = match.match(/fullName:\s*'([^']+)'/);
    const indexMatch = match.match(/marketIndex:\s*(\d+)/);
    
    // Pyth feed can sometimes be broken over lines, let's make it robust:
    const pythRobustMatch = match.replace(/\n|\r|\t|\s/g, '').match(/pythFeedId:'0x([a-f0-9]+)'/);

    if (symbolMatch && baseMatch && nameMatch && indexMatch) {
      let baseAssetSymbol = baseMatch[1];
      
      // Handle WIF specially for icon
      let logoUri = `https://drift-public.s3.eu-central-1.amazonaws.com/assets/icons/markets/${baseAssetSymbol.toLowerCase()}.svg`;
      if (baseAssetSymbol === 'WIF') {
        logoUri = "https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link";
      }

      // Handle 1MBONK to base BONK
      if (baseAssetSymbol === '1MBONK') {
          baseAssetSymbol = 'BONK';
      }

      markets.push({
        symbol: baseAssetSymbol,
        name: nameMatch[1],
        marketIndex: parseInt(indexMatch[1], 10),
        logoUri,
        pythFeedId: pythRobustMatch ? pythRobustMatch[1] : null,
      });
    }
  }

  // Filter out those without Pyth feeds and deduplicate by symbol
  const seenSymbols = new Set<string>();
  const finalMarkets = markets.filter(m => {
    if (m.pythFeedId === null) return false;
    if (seenSymbols.has(m.symbol)) return false;
    seenSymbols.add(m.symbol);
    return true;
  });

  console.log(`Extracted ${finalMarkets.length} unique markets with Pyth feeds.`);

  const outDir = path.join(process.cwd(), "lib", "perps", "generated");
  await fs.mkdir(outDir, { recursive: true });
  
  const outPath = path.join(outDir, "drift-markets.json");
  await fs.writeFile(outPath, JSON.stringify(finalMarkets, null, 2), "utf8");
  
  console.log(`Saved to ${outPath}`);
}

main().catch(console.error);
