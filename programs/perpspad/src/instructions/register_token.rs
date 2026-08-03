use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{mint_to, Mint, MintTo, Token, TokenAccount},
};

use crate::errors::PerpspadError;
use crate::state::{
    Config, Direction, PerpToken, TokenStatus, MAX_LEVERAGE, MAX_NAME_LEN, MAX_SYMBOL_LEN,
    TOKEN_DECIMALS, TOTAL_SUPPLY,
};

#[derive(Accounts)]
pub struct RegisterToken<'info> {
    /// The token's creator. Pays for every account this instruction
    /// opens — registration spends the creator's own money, never pooled
    /// protocol funds, which is why this is the signer rather than a
    /// keeper key.
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// Fresh mint keypair supplied by the client. Authority is set to
    /// this token's own `PerpToken` PDA, and the program exposes no
    /// second mint instruction, so `TOTAL_SUPPLY` below is a permanent
    /// cap rather than a starting point.
    #[account(
        init,
        payer = creator,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = perp_token,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = 8 + PerpToken::INIT_SPACE,
        seeds = [b"perp_token", mint.key().as_ref()],
        bump
    )]
    pub perp_token: Account<'info, PerpToken>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// CHECK: PDA derived here only so its bump can be recorded on the
    /// `PerpToken` for Phase 2's Drift CPIs to sign with. Never read or
    /// written, and never given lamports in this instruction.
    #[account(
        seeds = [b"drift_authority", perp_token.key().as_ref()],
        bump
    )]
    pub drift_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<RegisterToken>,
    name: String,
    symbol: String,
    underlying_market_index: u16,
    direction: Direction,
    target_leverage: u8,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, PerpspadError::ProtocolPaused);
    require!(
        target_leverage >= 1 && target_leverage <= MAX_LEVERAGE,
        PerpspadError::InvalidLeverage
    );
    require!(
        !name.is_empty()
            && name.len() <= MAX_NAME_LEN
            && !symbol.is_empty()
            && symbol.len() <= MAX_SYMBOL_LEN,
        PerpspadError::InvalidMetadata
    );

    let mint_key = ctx.accounts.mint.key();

    {
        let perp_token = &mut ctx.accounts.perp_token;
        perp_token.mint = mint_key;
        perp_token.creator = ctx.accounts.creator.key();
        perp_token.name = name;
        perp_token.symbol = symbol;
        perp_token.underlying_market_index = underlying_market_index;
        perp_token.direction = direction;
        perp_token.target_leverage = target_leverage;
        // Pending, not Active: a token is registered and minted here, but
        // nothing has opened a Drift position yet — that's Phase 2. Saying
        // Active would be a lie the UI would faithfully repeat.
        perp_token.status = TokenStatus::Pending;
        perp_token.drift_authority_bump = ctx.bumps.drift_authority;
        perp_token.total_fees_collected = 0;
        perp_token.total_topped_up = 0;
        perp_token.total_token_burned = 0;
        perp_token.total_gov_burned = 0;
        perp_token.created_at = Clock::get()?.unix_timestamp;
        perp_token.bump = ctx.bumps.perp_token;
    }

    // Mint the entire supply to the creator, signed by the token's own
    // PerpToken PDA (which is the mint authority).
    let perp_token_bump = ctx.accounts.perp_token.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"perp_token", mint_key.as_ref(), &[perp_token_bump]]];

    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.creator_token_account.to_account_info(),
                authority: ctx.accounts.perp_token.to_account_info(),
            },
            signer_seeds,
        ),
        TOTAL_SUPPLY,
    )?;

    let config = &mut ctx.accounts.config;
    config.token_count = config.token_count.saturating_add(1);

    Ok(())
}
