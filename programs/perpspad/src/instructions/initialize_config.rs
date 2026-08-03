use anchor_lang::prelude::*;

use crate::state::{assert_valid_fee_split, Config};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeConfig>,
    fee_split_collateral_bps: u16,
    fee_split_token_burn_bps: u16,
    fee_split_gov_burn_bps: u16,
    perpspad_mint: Pubkey,
) -> Result<()> {
    assert_valid_fee_split(
        fee_split_collateral_bps,
        fee_split_token_burn_bps,
        fee_split_gov_burn_bps,
    )?;

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.perpspad_mint = perpspad_mint;
    config.fee_split_collateral_bps = fee_split_collateral_bps;
    config.fee_split_token_burn_bps = fee_split_token_burn_bps;
    config.fee_split_gov_burn_bps = fee_split_gov_burn_bps;
    config.paused = false;
    config.token_count = 0;
    config.bump = ctx.bumps.config;

    Ok(())
}
