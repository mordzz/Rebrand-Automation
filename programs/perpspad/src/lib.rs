//! Perpspad — a token launchpad where every launched token is backed by
//! a real perpetual futures position on Drift Protocol, funded by a
//! fixed split of that token's own Meteora pool trading fees.
//!
//! This program is the registry and the authority owner. The off-chain
//! keeper can only *trigger* instructions defined here; it never holds
//! pooled funds and cannot move more than each instruction's own
//! invariants permit. Drift CPIs land in a later phase — everything in
//! this file is deliberately Drift-free so the registry, the PDA design
//! and the fee-split invariant can be proven in isolation first.

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::Direction;

declare_id!("CUsgyc49DaWgRcRyLfKjrR5SnCRcDi4CAyuBuU692VQa");

#[program]
pub mod perpspad {
    use super::*;

    /// One-time protocol setup. The signer becomes admin.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_split_collateral_bps: u16,
        fee_split_token_burn_bps: u16,
        fee_split_gov_burn_bps: u16,
        perpspad_mint: Pubkey,
    ) -> Result<()> {
        instructions::initialize_config::handler(
            ctx,
            fee_split_collateral_bps,
            fee_split_token_burn_bps,
            fee_split_gov_burn_bps,
            perpspad_mint,
        )
    }

    /// Admin-only. Rejects any split that doesn't sum to 10000 bps.
    pub fn update_fee_split(
        ctx: Context<UpdateFeeSplit>,
        fee_split_collateral_bps: u16,
        fee_split_token_burn_bps: u16,
        fee_split_gov_burn_bps: u16,
    ) -> Result<()> {
        instructions::update_fee_split::handler(
            ctx,
            fee_split_collateral_bps,
            fee_split_token_burn_bps,
            fee_split_gov_burn_bps,
        )
    }

    /// Admin-only on-chain kill switch. Blocks new registrations.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        instructions::set_paused::handler(ctx, paused)
    }

    /// Launch a token: creates its mint, mints the full fixed supply to
    /// the creator, and opens its `PerpToken` registry account. Paid for
    /// and signed by the creator.
    pub fn register_token(
        ctx: Context<RegisterToken>,
        name: String,
        symbol: String,
        underlying_market_index: u16,
        direction: Direction,
        target_leverage: u8,
    ) -> Result<()> {
        instructions::register_token::handler(
            ctx,
            name,
            symbol,
            underlying_market_index,
            direction,
            target_leverage,
        )
    }
}
