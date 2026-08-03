use anchor_lang::prelude::*;

use crate::errors::PerpspadError;
use crate::state::{assert_valid_fee_split, Config};

#[derive(Accounts)]
pub struct UpdateFeeSplit<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin @ PerpspadError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

pub fn handler(
    ctx: Context<UpdateFeeSplit>,
    fee_split_collateral_bps: u16,
    fee_split_token_burn_bps: u16,
    fee_split_gov_burn_bps: u16,
) -> Result<()> {
    assert_valid_fee_split(
        fee_split_collateral_bps,
        fee_split_token_burn_bps,
        fee_split_gov_burn_bps,
    )?;

    let config = &mut ctx.accounts.config;
    config.fee_split_collateral_bps = fee_split_collateral_bps;
    config.fee_split_token_burn_bps = fee_split_token_burn_bps;
    config.fee_split_gov_burn_bps = fee_split_gov_burn_bps;

    Ok(())
}
