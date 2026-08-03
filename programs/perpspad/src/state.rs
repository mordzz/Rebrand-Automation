use anchor_lang::prelude::*;

use crate::errors::PerpspadError;

/// Token decimals for every Perpspad-launched token. Fixed rather than
/// caller-supplied so a launch can't ship a mint whose supply maths the
/// off-chain keeper and UI disagree about.
pub const TOKEN_DECIMALS: u8 = 6;

/// Full supply, minted once at `register_token` and never again — the
/// program exposes no second mint instruction, so this is the permanent
/// cap. 1,000,000,000 whole tokens.
pub const TOTAL_SUPPLY: u64 = 1_000_000_000 * 10u64.pow(TOKEN_DECIMALS as u32);

pub const MAX_LEVERAGE: u8 = 20;
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;

pub const BPS_DENOMINATOR: u16 = 10_000;

/// The Rust half of the belt-and-suspenders the rest of this codebase
/// already uses (an app-level guard plus an independent DB `CHECK` — see
/// `assertNotOfficial` / `user_bots_official_never_live`). The DB's
/// `perpspad_config_fee_split_sums_to_10000` constraint enforces the same
/// invariant off-chain; this one enforces it where it actually governs
/// money.
pub fn assert_valid_fee_split(
    collateral_bps: u16,
    token_burn_bps: u16,
    gov_burn_bps: u16,
) -> Result<()> {
    let total = (collateral_bps as u32)
        .checked_add(token_burn_bps as u32)
        .and_then(|s| s.checked_add(gov_burn_bps as u32))
        .ok_or(PerpspadError::InvalidFeeSplit)?;
    require!(
        total == BPS_DENOMINATOR as u32,
        PerpspadError::InvalidFeeSplit
    );
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Direction {
    Long,
    Short,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TokenStatus {
    /// Registered and minted, but no Drift position opened yet. Every
    /// token sits here until the Phase 2 Drift CPI instructions land.
    Pending,
    Active,
    LowHealth,
    Liquidated,
    /// Position was liquidated; keeper is banking fees until there's
    /// enough collateral to re-open.
    Accumulating,
}

/// Singleton protocol config. Once this account exists it is the source
/// of truth for the fee split — the `perpspad_config` DB row becomes a
/// read-cache synced *from* here, never independently editable, or the
/// split triplication bug just moves on-chain.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Governance token ($PERPSPAD) whose buyback+burn is the third fee
    /// leg. `Pubkey::default()` until that token exists.
    pub perpspad_mint: Pubkey,
    pub fee_split_collateral_bps: u16,
    pub fee_split_token_burn_bps: u16,
    pub fee_split_gov_burn_bps: u16,
    /// On-chain kill switch. Lives here rather than only in an admin
    /// panel so a compromised off-chain surface alone can't keep
    /// launches running.
    pub paused: bool,
    pub token_count: u64,
    pub bump: u8,
}

/// One per launched token, PDA'd on the mint so each token gets its own
/// distinct account — never a shared registry row.
#[account]
#[derive(InitSpace)]
pub struct PerpToken {
    pub mint: Pubkey,
    pub creator: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    /// Drift's own numeric perp market index — the real on-chain
    /// identifier, not a symbol string.
    pub underlying_market_index: u16,
    pub direction: Direction,
    pub target_leverage: u8,
    pub status: TokenStatus,
    /// Bump for *this token's own* `[b"drift_authority", perp_token]`
    /// PDA. Stored at registration so Phase 2's CPIs can sign without
    /// re-deriving. Deliberately per-token: a bug reachable through one
    /// token's Drift CPI then structurally cannot touch another token's
    /// Drift account, because they are different authorities entirely.
    pub drift_authority_bump: u8,
    pub total_fees_collected: u64,
    pub total_topped_up: u64,
    pub total_token_burned: u64,
    pub total_gov_burned: u64,
    pub created_at: i64,
    pub bump: u8,
}
