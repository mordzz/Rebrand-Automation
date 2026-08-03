use anchor_lang::prelude::*;

use crate::errors::PerpspadError;
use crate::state::Config;

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin @ PerpspadError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}
