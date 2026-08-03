/**
 * Generates the Kit-native TypeScript client for the Perpspad Anchor
 * program from its IDL.
 *
 * Kit-native (Codama) rather than the Anchor TS client on purpose: this
 * app is already `@solana/kit` + `@solana-program/*` end to end, and
 * pulling in `@coral-xyz/anchor` would drag legacy web3.js types across
 * the whole client boundary for no benefit.
 *
 * Run after any `anchor build` that changes the program's interface:
 *   npm run gen:perpspad
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rootNodeFromAnchor, type AnchorIdl } from "@codama/nodes-from-anchor";
// v2 of the renderer exports `renderVisitor`; the older
// `renderJavaScriptVisitor` name no longer exists.
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";

const ROOT = process.cwd();
const IDL_PATH = join(ROOT, "target", "idl", "perpspad.json");
const OUT_DIR = join(ROOT, "lib", "perps", "generated");

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(IDL_PATH, "utf8");
  } catch {
    console.error(
      `No IDL at ${IDL_PATH}. Run \`anchor build\` first — the client is generated from it, never hand-written.`
    );
    process.exit(1);
  }

  const idl = JSON.parse(raw) as AnchorIdl;
  const codama = createFromRoot(rootNodeFromAnchor(idl));

  // The renderer emits a whole package layout (`<out>/src/generated/…`
  // plus its own package.json). Rendering straight into lib/ would leave
  // a nested manifest inside the Next app, which changes how the
  // bundler resolves that subtree — so render to a temp dir and lift
  // just the generated sources into place.
  const staging = mkdtempSync(join(tmpdir(), "perpspad-client-"));
  try {
    // The visitor writes asynchronously — without awaiting, the copy
    // below races an empty directory.
    await codama.accept(renderVisitor(staging));
    rmSync(OUT_DIR, { recursive: true, force: true });
    cpSync(join(staging, "src", "generated"), OUT_DIR, { recursive: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  console.log(`Perpspad client written to ${OUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
