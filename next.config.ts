import type { NextConfig } from "next";

// Optional Solana peers of @privy-io/react-auth. The app is EVM-only (Robinhood
// Chain) and these packages are not installed; alias them to an inert stub so
// Privy's never-executed Solana chunks still resolve at build time.
const PRIVY_SOLANA_PEER_STUB = "./lib/chain/privy-solana-peer-stub.cjs";
const privySolanaPeers = [
  "@solana/kit",
  "@solana-program/system",
  "@solana-program/token",
  "@solana-program/memo",
  "@farcaster/mini-app-solana",
];

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: Object.fromEntries(
      privySolanaPeers.map((pkg) => [pkg, PRIVY_SOLANA_PEER_STUB]),
    ),
  },
};

export default nextConfig;
