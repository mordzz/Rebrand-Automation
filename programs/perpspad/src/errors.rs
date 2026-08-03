use anchor_lang::prelude::*;

#[error_code]
pub enum PerpspadError {
    #[msg("Fee split must sum to exactly 10000 bps")]
    InvalidFeeSplit,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Target leverage must be between 1 and 20")]
    InvalidLeverage,
    #[msg("Token name or symbol is empty or too long")]
    InvalidMetadata,
    #[msg("Only the config admin may perform this action")]
    Unauthorized,
}
