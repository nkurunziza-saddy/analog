use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

#[cfg(test)]
mod tests;

declare_id!("9TDQyQt9AHQVDbM1qACAD6igWBn1UFzfksuxX5GXoELj");

/// p is posted in basis points: 0 = promise broken, 10_000 = fully kept.
pub const BPS: u64 = 10_000;

pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_CANCELLED: u8 = 1;

#[program]
pub mod vault {
    use super::*;

    /// Payer funds the vault and fixes the rate cap, the two judges and the stale window.
    pub fn create_stream(
        ctx: Context<CreateStream>,
        id: u64,
        rate_max: u64,
        deposit: u64,
        stale_after: i64,
        judge_a: Pubkey,
        judge_b: Pubkey,
    ) -> Result<()> {
        require!(rate_max > 0, StreamError::InvalidAmount);
        require!(deposit > 0, StreamError::InvalidAmount);
        require!(stale_after > 0, StreamError::InvalidStaleWindow);
        require_keys_neq!(judge_a, judge_b, StreamError::SameJudge);

        let now = Clock::get()?.unix_timestamp;
        let stream = &mut ctx.accounts.stream;
        stream.payer = ctx.accounts.payer.key();
        stream.worker = ctx.accounts.worker.key();
        stream.mint = ctx.accounts.mint.key();
        stream.id = id;
        stream.rate_max = rate_max;
        stream.deposit = deposit;
        stream.earned = 0;
        stream.claimed = 0;
        stream.last_p = 0;
        stream.last_tick_ts = now;
        stream.accrued_until = now;
        stream.judge_a = judge_a;
        stream.judge_b = judge_b;
        stream.stale_after = stale_after;
        stream.status = STATUS_ACTIVE;
        stream.bump = ctx.bumps.stream;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.payer_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            deposit,
            ctx.accounts.mint.decimals,
        )?;

        emit!(StreamCreated {
            stream: stream.key(),
            payer: stream.payer,
            worker: stream.worker,
            rate_max,
            deposit,
        });
        Ok(())
    }

    /// Both judges co-sign. Credits time since the last tick at the previous p, then stores the new p.
    pub fn post_tick(ctx: Context<PostTick>, p_bps: u16, input_hash: [u8; 32]) -> Result<()> {
        require!(u64::from(p_bps) <= BPS, StreamError::InvalidProbability);
        let now = Clock::get()?.unix_timestamp;
        let stream = &mut ctx.accounts.stream;
        require!(stream.status == STATUS_ACTIVE, StreamError::NotActive);

        stream.accrue(now)?;
        stream.last_p = p_bps;
        stream.last_tick_ts = now;
        // A gap longer than the stale window is never credited.
        stream.accrued_until = now;

        emit!(TickPosted {
            stream: stream.key(),
            p_bps,
            input_hash,
            earned: stream.earned,
            ts: now,
        });
        Ok(())
    }

    /// Worker withdraws earned − claimed. Works after cancel too.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let stream = &mut ctx.accounts.stream;
        stream.accrue(now)?;

        let amount = stream
            .earned
            .checked_sub(stream.claimed)
            .ok_or(StreamError::MathOverflow)?;
        require!(amount > 0, StreamError::NothingToClaim);
        stream.claimed = stream.earned;

        let payer = stream.payer;
        let worker = stream.worker;
        let id_bytes = stream.id.to_le_bytes();
        let bump = [stream.bump];
        let seeds: &[&[&[u8]]] = &[&[
            b"stream",
            payer.as_ref(),
            worker.as_ref(),
            id_bytes.as_ref(),
            bump.as_ref(),
        ]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.worker_token.to_account_info(),
                    authority: ctx.accounts.stream.to_account_info(),
                },
                seeds,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(Claimed {
            stream: ctx.accounts.stream.key(),
            amount,
        });
        Ok(())
    }

    /// Payer stops the stream. Earned funds stay claimable by the worker; the rest returns to the payer.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let stream = &mut ctx.accounts.stream;
        require!(stream.status == STATUS_ACTIVE, StreamError::NotActive);
        stream.accrue(now)?;
        stream.status = STATUS_CANCELLED;

        let refund = stream
            .deposit
            .checked_sub(stream.earned)
            .ok_or(StreamError::MathOverflow)?;

        let payer = stream.payer;
        let worker = stream.worker;
        let id_bytes = stream.id.to_le_bytes();
        let bump = [stream.bump];
        let seeds: &[&[&[u8]]] = &[&[
            b"stream",
            payer.as_ref(),
            worker.as_ref(),
            id_bytes.as_ref(),
            bump.as_ref(),
        ]];

        if refund > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.payer_token.to_account_info(),
                        authority: ctx.accounts.stream.to_account_info(),
                    },
                    seeds,
                ),
                refund,
                ctx.accounts.mint.decimals,
            )?;
        }

        emit!(Cancelled {
            stream: ctx.accounts.stream.key(),
            refund,
        });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Stream {
    pub payer: Pubkey,
    pub worker: Pubkey,
    pub mint: Pubkey,
    pub id: u64,
    /// Maximum base units per second, paid when p = 10_000.
    pub rate_max: u64,
    pub deposit: u64,
    pub earned: u64,
    pub claimed: u64,
    /// Last posted p in basis points.
    pub last_p: u16,
    pub last_tick_ts: i64,
    /// Time up to which `earned` has been credited.
    pub accrued_until: i64,
    pub judge_a: Pubkey,
    pub judge_b: Pubkey,
    /// Seconds after the last tick during which the old p keeps paying.
    pub stale_after: i64,
    pub status: u8,
    pub bump: u8,
}

impl Stream {
    /// Credit rate_max × last_p over [accrued_until, min(now, last_tick_ts + stale_after)], capped at deposit.
    pub fn accrue(&mut self, now: i64) -> Result<()> {
        if self.status != STATUS_ACTIVE {
            return Ok(());
        }
        let stale_at = self
            .last_tick_ts
            .checked_add(self.stale_after)
            .ok_or(StreamError::MathOverflow)?;
        let end = now.min(stale_at);
        if end <= self.accrued_until {
            return Ok(());
        }
        let dt = (end - self.accrued_until) as u128;
        let credit = (self.rate_max as u128)
            .checked_mul(self.last_p as u128)
            .and_then(|v| v.checked_mul(dt))
            .ok_or(StreamError::MathOverflow)?
            / BPS as u128;
        let earned = (self.earned as u128)
            .saturating_add(credit)
            .min(self.deposit as u128);
        self.earned = earned as u64;
        self.accrued_until = end;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateStream<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only stored as the stream's recipient.
    pub worker: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = payer,
        token::token_program = token_program,
    )]
    pub payer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        space = 8 + Stream::INIT_SPACE,
        seeds = [b"stream", payer.key().as_ref(), worker.key().as_ref(), id.to_le_bytes().as_ref()],
        bump,
    )]
    pub stream: Account<'info, Stream>,
    #[account(
        init,
        payer = payer,
        seeds = [b"vault", stream.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = stream,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PostTick<'info> {
    #[account(mut, has_one = judge_a, has_one = judge_b)]
    pub stream: Account<'info, Stream>,
    pub judge_a: Signer<'info>,
    pub judge_b: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    pub worker: Signer<'info>,
    #[account(mut, has_one = worker, has_one = mint)]
    pub stream: Account<'info, Stream>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", stream.key().as_ref()],
        bump,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = worker,
        token::token_program = token_program,
    )]
    pub worker_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    pub payer: Signer<'info>,
    #[account(mut, has_one = payer, has_one = mint)]
    pub stream: Account<'info, Stream>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", stream.key().as_ref()],
        bump,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = payer,
        token::token_program = token_program,
    )]
    pub payer_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct StreamCreated {
    pub stream: Pubkey,
    pub payer: Pubkey,
    pub worker: Pubkey,
    pub rate_max: u64,
    pub deposit: u64,
}

#[event]
pub struct TickPosted {
    pub stream: Pubkey,
    pub p_bps: u16,
    pub input_hash: [u8; 32],
    pub earned: u64,
    pub ts: i64,
}

#[event]
pub struct Claimed {
    pub stream: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Cancelled {
    pub stream: Pubkey,
    pub refund: u64,
}

#[error_code]
pub enum StreamError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Stale window must be greater than zero")]
    InvalidStaleWindow,
    #[msg("The two judges must be different keys")]
    SameJudge,
    #[msg("p must be between 0 and 10000 basis points")]
    InvalidProbability,
    #[msg("Stream is not active")]
    NotActive,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Math overflow")]
    MathOverflow,
}
