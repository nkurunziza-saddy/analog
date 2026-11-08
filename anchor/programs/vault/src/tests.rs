#[cfg(test)]
mod tests {
    use crate::ID as PROGRAM_ID;
    use anchor_lang::{system_program, InstructionData};
    use litesvm::LiteSVM;
    use solana_sdk::{
        account::Account,
        clock::Clock,
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        signature::Keypair,
        signer::Signer,
        transaction::Transaction,
    };

    const SOL: u64 = 1_000_000_000;
    const DECIMALS: u8 = 6;
    const RATE_MAX: u64 = 1_000_000; // 1 token per second at p = 1.0
    const DEPOSIT: u64 = 20_000_000; // 20 tokens
    const STALE: i64 = 15;

    fn token_program() -> Pubkey {
        anchor_spl::token::ID
    }

    // ---- raw SPL Token account layouts, written straight into the SVM ----

    fn mint_data(authority: &Pubkey) -> Vec<u8> {
        let mut d = vec![0u8; 82];
        d[0..4].copy_from_slice(&1u32.to_le_bytes()); // COption::Some
        d[4..36].copy_from_slice(authority.as_ref());
        d[36..44].copy_from_slice(&u64::MAX.to_le_bytes()); // supply (unused by transfers)
        d[44] = DECIMALS;
        d[45] = 1; // is_initialized
        d
    }

    fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
        let mut d = vec![0u8; 165];
        d[0..32].copy_from_slice(mint.as_ref());
        d[32..64].copy_from_slice(owner.as_ref());
        d[64..72].copy_from_slice(&amount.to_le_bytes());
        d[108] = 1; // AccountState::Initialized
        d
    }

    fn token_amount(svm: &LiteSVM, account: &Pubkey) -> u64 {
        let a = svm.get_account(account).unwrap();
        u64::from_le_bytes(a.data[64..72].try_into().unwrap())
    }

    fn put(svm: &mut LiteSVM, key: Pubkey, data: Vec<u8>) {
        svm.set_account(
            key,
            Account {
                lamports: SOL,
                data,
                owner: token_program(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    }

    // ---- stream account reads ----

    struct StreamView {
        earned: u64,
        claimed: u64,
        last_p: u16,
        status: u8,
    }

    fn read_stream(svm: &LiteSVM, stream: &Pubkey) -> StreamView {
        let a = svm.get_account(stream).unwrap();
        // 8 discriminator + payer, worker, mint (3 × 32) + id, rate_max, deposit (3 × 8)
        let base = 8 + 96 + 24;
        let earned = u64::from_le_bytes(a.data[base..base + 8].try_into().unwrap());
        let claimed = u64::from_le_bytes(a.data[base + 8..base + 16].try_into().unwrap());
        let last_p = u16::from_le_bytes(a.data[base + 16..base + 18].try_into().unwrap());
        // last_p, last_tick_ts, accrued_until, judge_a, judge_b, stale_after
        let status_at = base + 18 + 8 + 8 + 64 + 8;
        StreamView {
            earned,
            claimed,
            last_p,
            status: a.data[status_at],
        }
    }

    // ---- fixture ----

    struct Env {
        svm: LiteSVM,
        payer: Keypair,
        worker: Keypair,
        judge_a: Keypair,
        judge_b: Keypair,
        mint: Pubkey,
        payer_token: Pubkey,
        worker_token: Pubkey,
        stream: Pubkey,
        vault: Pubkey,
    }

    fn warp(svm: &mut LiteSVM, secs: i64) {
        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp += secs;
        clock.slot += 1;
        svm.set_sysvar(&clock);
    }

    fn send(svm: &mut LiteSVM, ix: Instruction, signers: &[&Keypair]) -> bool {
        svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&signers[0].pubkey()),
            signers,
            svm.latest_blockhash(),
        );
        let res = svm.send_transaction(tx);
        if let Err(e) = &res {
            println!("tx failed: {:?}", e.err);
        }
        res.is_ok()
    }

    fn setup() -> Env {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/vault.so");
        svm.add_program(PROGRAM_ID, program_bytes).unwrap();

        let payer = Keypair::new();
        let worker = Keypair::new();
        let judge_a = Keypair::new();
        let judge_b = Keypair::new();
        for k in [&payer, &worker, &judge_a, &judge_b] {
            svm.airdrop(&k.pubkey(), 10 * SOL).unwrap();
        }

        let mint = Pubkey::new_unique();
        let payer_token = Pubkey::new_unique();
        let worker_token = Pubkey::new_unique();
        put(&mut svm, mint, mint_data(&payer.pubkey()));
        put(
            &mut svm,
            payer_token,
            token_account_data(&mint, &payer.pubkey(), 100_000_000),
        );
        put(
            &mut svm,
            worker_token,
            token_account_data(&mint, &worker.pubkey(), 0),
        );

        let id: u64 = 1;
        let (stream, _) = Pubkey::find_program_address(
            &[
                b"stream",
                payer.pubkey().as_ref(),
                worker.pubkey().as_ref(),
                &id.to_le_bytes(),
            ],
            &PROGRAM_ID,
        );
        let (vault, _) = Pubkey::find_program_address(&[b"vault", stream.as_ref()], &PROGRAM_ID);

        let mut env = Env {
            svm,
            payer,
            worker,
            judge_a,
            judge_b,
            mint,
            payer_token,
            worker_token,
            stream,
            vault,
        };

        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(env.payer.pubkey(), true),
                AccountMeta::new_readonly(env.worker.pubkey(), false),
                AccountMeta::new_readonly(env.mint, false),
                AccountMeta::new(env.payer_token, false),
                AccountMeta::new(env.stream, false),
                AccountMeta::new(env.vault, false),
                AccountMeta::new_readonly(token_program(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data: crate::instruction::CreateStream {
                id,
                rate_max: RATE_MAX,
                deposit: DEPOSIT,
                stale_after: STALE,
                judge_a: env.judge_a.pubkey(),
                judge_b: env.judge_b.pubkey(),
            }
            .data(),
        };
        let payer = env.payer.insecure_clone();
        assert!(send(&mut env.svm, ix, &[&payer]), "create_stream should succeed");
        env
    }

    fn tick_ix(env: &Env, judge_a: &Pubkey, judge_b: &Pubkey, p_bps: u16) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(env.stream, false),
                AccountMeta::new_readonly(*judge_a, true),
                AccountMeta::new_readonly(*judge_b, true),
            ],
            data: crate::instruction::PostTick {
                p_bps,
                input_hash: [7u8; 32],
            }
            .data(),
        }
    }

    fn tick(env: &mut Env, p_bps: u16) -> bool {
        let ix = tick_ix(env, &env.judge_a.pubkey(), &env.judge_b.pubkey(), p_bps);
        let (a, b) = (env.judge_a.insecure_clone(), env.judge_b.insecure_clone());
        send(&mut env.svm, ix, &[&a, &b])
    }

    fn claim(env: &mut Env) -> bool {
        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(env.worker.pubkey(), true),
                AccountMeta::new(env.stream, false),
                AccountMeta::new_readonly(env.mint, false),
                AccountMeta::new(env.vault, false),
                AccountMeta::new(env.worker_token, false),
                AccountMeta::new_readonly(token_program(), false),
            ],
            data: crate::instruction::Claim {}.data(),
        };
        let w = env.worker.insecure_clone();
        send(&mut env.svm, ix, &[&w])
    }

    fn cancel(env: &mut Env) -> bool {
        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(env.payer.pubkey(), true),
                AccountMeta::new(env.stream, false),
                AccountMeta::new_readonly(env.mint, false),
                AccountMeta::new(env.vault, false),
                AccountMeta::new(env.payer_token, false),
                AccountMeta::new_readonly(token_program(), false),
            ],
            data: crate::instruction::Cancel {}.data(),
        };
        let p = env.payer.insecure_clone();
        send(&mut env.svm, ix, &[&p])
    }

    // ---- tests ----

    #[test]
    fn create_funds_vault() {
        let env = setup();
        assert_eq!(token_amount(&env.svm, &env.vault), DEPOSIT);
        let s = read_stream(&env.svm, &env.stream);
        assert_eq!(s.earned, 0);
        assert_eq!(s.status, crate::STATUS_ACTIVE);
    }

    #[test]
    fn accrues_rate_times_p() {
        let mut env = setup();
        assert!(tick(&mut env, 5_000)); // p = 0.5, nothing earned yet (previous p was 0)
        warp(&mut env.svm, 4);
        assert!(tick(&mut env, 10_000)); // credits 4 s at 0.5
        assert_eq!(read_stream(&env.svm, &env.stream).earned, 2_000_000);
        warp(&mut env.svm, 3);
        assert!(tick(&mut env, 0)); // credits 3 s at 1.0
        let s = read_stream(&env.svm, &env.stream);
        assert_eq!(s.earned, 5_000_000);
        assert_eq!(s.last_p, 0);
        warp(&mut env.svm, 10);
        assert!(tick(&mut env, 0)); // p = 0 pays nothing
        assert_eq!(read_stream(&env.svm, &env.stream).earned, 5_000_000);
    }

    #[test]
    fn earned_never_exceeds_deposit() {
        let mut env = setup();
        assert!(tick(&mut env, 10_000));
        for _ in 0..3 {
            warp(&mut env.svm, 10);
            assert!(tick(&mut env, 10_000));
        }
        // 30 s × 1 token/s = 30 tokens, capped at the 20-token deposit
        assert_eq!(read_stream(&env.svm, &env.stream).earned, DEPOSIT);
    }

    #[test]
    fn stale_judge_stops_accrual() {
        let mut env = setup();
        assert!(tick(&mut env, 10_000));
        warp(&mut env.svm, 100); // judge silent far past the 15 s window
        assert!(claim(&mut env));
        assert_eq!(token_amount(&env.svm, &env.worker_token), 15_000_000);
        // A second claim must not credit the silent period again.
        warp(&mut env.svm, 30);
        assert!(!claim(&mut env), "nothing new should be claimable");
        assert_eq!(token_amount(&env.svm, &env.worker_token), 15_000_000);
    }

    #[test]
    fn rejects_tick_without_both_judges() {
        let mut env = setup();
        let stranger = Keypair::new();
        env.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
        let a = env.judge_a.insecure_clone();

        // judge A + a stranger in judge B's slot
        let ix = tick_ix(&env, &a.pubkey(), &stranger.pubkey(), 10_000);
        assert!(!send(&mut env.svm, ix, &[&a, &stranger]));

        // judge A twice
        let ix = tick_ix(&env, &a.pubkey(), &a.pubkey(), 10_000);
        assert!(!send(&mut env.svm, ix, &[&a]));

        assert_eq!(read_stream(&env.svm, &env.stream).last_p, 0);
    }

    #[test]
    fn rejects_p_above_one() {
        let mut env = setup();
        assert!(!tick(&mut env, 10_001));
    }

    #[test]
    fn claim_then_cancel_splits_funds() {
        let mut env = setup();
        assert!(tick(&mut env, 10_000));
        warp(&mut env.svm, 5);
        assert!(claim(&mut env)); // 5 tokens
        assert_eq!(token_amount(&env.svm, &env.worker_token), 5_000_000);

        warp(&mut env.svm, 3);
        assert!(cancel(&mut env)); // 3 more earned, 12 refunded
        let s = read_stream(&env.svm, &env.stream);
        assert_eq!(s.status, crate::STATUS_CANCELLED);
        assert_eq!(s.earned, 8_000_000);
        assert_eq!(token_amount(&env.svm, &env.payer_token), 100_000_000 - 8_000_000);

        // Worker still gets what was earned; ticks no longer land.
        assert!(claim(&mut env));
        assert_eq!(token_amount(&env.svm, &env.worker_token), 8_000_000);
        assert_eq!(read_stream(&env.svm, &env.stream).claimed, 8_000_000);
        assert_eq!(token_amount(&env.svm, &env.vault), 0);
        warp(&mut env.svm, 1);
        assert!(!tick(&mut env, 10_000));
    }
}
