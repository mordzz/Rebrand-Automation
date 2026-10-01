// Inert stand-in for @privy-io/react-auth's OPTIONAL Solana peer deps
// (@solana/kit, @solana-program/*, @farcaster/mini-app-solana).
//
// The Solana runtime was retired in PR09A and Privy is configured
// `walletChainType: "ethereum-only"`, so Privy's Solana wallet chunks never
// execute — but the bundler still has to resolve their static imports.
// Aliased in next.config.ts. Every export is undefined, so any accidental call
// fails closed with a TypeError instead of performing Solana behaviour.
module.exports = {};
