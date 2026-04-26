// contracts/stellar-micropay-contract/src/lib.rs
//
// Stellar MicroPay — Soroban Smart Contract
//
// Functionality:
//   - Initialize the contract with an admin
//   - Record tips sent between accounts
//   - Query tip totals per recipient
//   - Time-locked escrow: create, release, cancel
//
// Build:
//   cargo build --target wasm32-unknown-unknown --release
//
// Deploy (Stellar CLI):
//   stellar contract deploy \
//     --wasm target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm \
//     --source YOUR_SECRET_KEY \
//     --network testnet

#![no_std]

use soroban_sdk::{ contract, contractimpl, contracttype, token, Address, Env, Symbol, BytesN };

// ─── Storage keys ─────────────────────────────────────────────────────────────

// ─── Data types ───────────────────────────────────────────────────────────────

/// A single tip event recorded on-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stream {
    pub payer: Address,
    pub recipient: Address,
    pub rate_per_ledger: i128,
    pub deposited: i128,
    pub claimed: i128,
    pub start_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentCommitment {
    pub commitment_hash: BytesN<32>,
    pub timestamp: u64,
    pub nullifier: BytesN<32>,
}

/// A Pedersen commitment representing a shielded amount
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Commitment {
    /// The commitment value (C = G*amount + H*blinding_factor)
    pub value: BytesN<32>,
}

/// Shielded balance for a user
#[contracttype]
#[derive(Clone, Debug)]
pub struct ShieldedBalance {
    /// The commitment to the user's balance
    pub commitment: Commitment,
    /// The user's address
    pub owner: Address,
}

// Merged from a botched merge that left two `DataKey` enums (#153). Both
// enums were referenced by different contract methods, so the contract
// failed to compile and `stellar contract deploy` had nothing to deploy.
#[contracttype]
pub enum DataKey {
    Admin,
    TipTotal(Address),
    TipCount(Address),
    Escrow(u64),
    EscrowCount,
    ShieldedBalance(Address),
    Stream(u32),
    StreamCounter,
    PaymentCommitment(BytesN<32>),
    MerkleRoot,
    CommitmentCounter,
    Nullifier(BytesN<32>),
}

#[contract]
pub struct StellarMicroPay;

#[contractimpl]
impl MicroPayContract {
    // ─── Initialization ──────────────────────────────────────────────────────

        // Transfer deposit from payer to contract
        env.current_contract_address().require_auth();
        payer.require_auth();
        env.token_stellar(&Address::from_contract_id(env.current_contract_address().contract_id()))
            .transfer(&payer, &env.current_contract_address(), &deposit);

        counter
    }

    /// Send a tip from `from` to `to` using a Stellar token (SAC).
    pub fn send_tip(env: Env, token_address: Address, from: Address, to: Address, amount: i128) {
        from.require_auth();

        // Verify recipient
        if stream.recipient != recipient {
            panic!("Only the recipient can claim from this stream");
        }

        // Calculate claimable amount
        let current_ledger = env.ledger().sequence();
        let elapsed_ledgers = current_ledger.saturating_sub(stream.start_ledger);
        let total_streamed = stream.rate_per_ledger * elapsed_ledgers as i128;
        let claimable = total_streamed - stream.claimed;

        if claimable <= 0 {
            return 0;
        }

        // Ensure we don't claim more than deposited
        let actual_claim = claimable.min(stream.deposited - stream.claimed);
        
        if actual_claim <= 0 {
            return 0;
        }

        // Update claimed amount
        stream.claimed += actual_claim;
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        // Transfer funds to recipient
        env.current_contract_address().require_auth();
        env.token_stellar(&Address::from_contract_id(env.current_contract_address().contract_id()))
            .transfer(&env.current_contract_address(), &recipient, &actual_claim);

        env.events().publish((Symbol::new(&env, "tip"), from, to.clone()), amount);
    }

    // ─── Escrow ───────────────────────────────────────────────────────────────

    /// Create a time-locked escrow. Transfers `amount` of `token` from `from`
    /// into the contract. Funds can be released to `to` once the current ledger
    /// reaches `release_ledger`, or cancelled by `from` before that.
    ///
    /// Returns the unique escrow ID.
    pub fn create_escrow(
        env: Env,
        token: Address,
        from: Address,
        to: Address,
        amount: i128,
        release_ledger: u32
    ) -> u64 {
        from.require_auth();

        if amount <= 0 {
            panic!("Top-up amount must be positive");
        }

        // Transfer funds from sender into this contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Assign a unique ID
        let escrow_id: u64 = env.storage().instance().get(&DataKey::EscrowCount).unwrap_or(0u64);

        let escrow = Escrow {
            from: from.clone(),
            to: to.clone(),
            amount,
            token,
            release_ledger,
            cancelled: false,
        };

        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        // Verify payer
        if stream.payer != payer {
            panic!("Only the payer can top up this stream");
        }

        env.events().publish(
            (Symbol::new(&env, "escrow_create"), from, to),
            (escrow_id, amount, release_ledger)
        );

        // Transfer additional funds from payer to contract
        env.current_contract_address().require_auth();
        payer.require_auth();
        env.token_stellar(&Address::from_contract_id(env.current_contract_address().contract_id()))
            .transfer(&payer, &env.current_contract_address(), &amount);
    }

    /// Close a stream and refund unstreamed portion to payer
    /// 
    /// # Arguments
    /// * `stream_id` - ID of the stream to close
    /// * `payer` - Address closing the stream (must match stream payer)
    /// 
    /// # Returns
    /// Amount refunded to payer (in stroops)
    pub fn close_stream(env: Env, stream_id: u32, payer: Address) -> i128 {
        let stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("Stream not found"));

        // Verify payer
        if stream.payer != payer {
            panic!("Only the payer can close this stream");
        }

        // Calculate refundable amount
        let current_ledger = env.ledger().sequence();
        let elapsed_ledgers = current_ledger.saturating_sub(stream.start_ledger);
        let total_streamed = stream.rate_per_ledger * elapsed_ledgers as i128;
        let refundable = stream.deposited - total_streamed.max(stream.claimed);

        if refundable <= 0 {
            // Remove the stream even if no refund
            env.storage()
                .persistent()
                .remove(&DataKey::Stream(stream_id));
            return 0;
        }

        // Remove the stream
        env.storage()
            .persistent()
            .remove(&DataKey::Stream(stream_id));

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.to, &escrow.amount);

        // Mark as released by zeroing the amount (funds gone)
        let released_amount = escrow.amount;
        escrow.amount = 0;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        env.events().publish(
            (Symbol::new(&env, "escrow_release"), escrow.to.clone()),
            (escrow_id, released_amount)
        );
    }

    /// Calculate claimable amount for a stream without claiming
    /// 
    /// # Arguments
    /// * `stream_id` - ID of the stream to query
    /// 
    /// # Returns
    /// Amount currently claimable (in stroops)
    pub fn get_claimable(env: Env, stream_id: u32) -> i128 {
        let stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("Stream not found"));

        let current_ledger = env.ledger().sequence();
        let elapsed_ledgers = current_ledger.saturating_sub(stream.start_ledger);
        let total_streamed = stream.rate_per_ledger * elapsed_ledgers as i128;
        let claimable = total_streamed - stream.claimed;

        claimable.min(stream.deposited - stream.claimed).max(0)
    }

    /// Commit a payment hash to the blockchain for zero-knowledge proof verification
    /// 
    /// # Arguments
    /// * `commitment_hash` - Hash of the payment commitment (amount + salt)
    /// * `nullifier` - Unique identifier to prevent double-spending
    /// 
    /// # Returns
    /// Commitment ID for tracking
    pub fn commit_payment(
        env: Env,
        commitment_hash: BytesN<32>,
        nullifier: BytesN<32>,
    ) -> u32 {
        // Check if nullifier already exists (prevent double-spending)
        if env.storage().persistent().has(&DataKey::Nullifier(nullifier.clone())) {
            panic!("Nullifier already used");
        }

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.from, &escrow.amount);

        let refunded_amount = escrow.amount;
        escrow.cancelled = true;
        escrow.amount = 0;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        env.events().publish(
            (Symbol::new(&env, "escrow_cancel"), escrow.from.clone()),
            (escrow_id, refunded_amount)
        );
    }

    /// Get the current state of an escrow by ID.
    pub fn get_escrow(env: Env, escrow_id: u64) -> Escrow {
        env.storage().persistent().get(&DataKey::Escrow(escrow_id)).expect("Escrow not found")
    }

    /// Get the current Merkle root
    pub fn get_merkle_root(env: Env) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::MerkleRoot)
    }

    pub fn get_tip_total(env: Env, recipient: Address) -> i128 {
        env.storage().instance().get(&DataKey::TipTotal(recipient)).unwrap_or(0)
    }

    pub fn get_tip_count(env: Env, recipient: Address) -> u32 {
        env.storage().instance().get(&DataKey::TipCount(recipient)).unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("Contract not initialized")
    }

    // ─── Confidential Transactions ─────────────────────────────────────────────

    /// Create a Pedersen commitment for an amount with a blinding factor.
    /// Returns the commitment value as a 32-byte hash.
    pub fn create_commitment(env: Env, amount: i128, blinding_factor: BytesN<32>) -> BytesN<32> {
        let mut payload = soroban_sdk::Bytes::new(&env);
        payload.append(&soroban_sdk::Bytes::from_slice(&env, &amount.to_be_bytes()));
        payload.append(
            &soroban_sdk::Bytes::from_slice(&env, blinding_factor.to_array().as_slice())
        );
        env.crypto().sha256(&payload).into()
    }

    /// Shield a payment amount by creating a commitment and storing it.
    /// The blinding factor must be kept secret by the user.
    pub fn shield_payment(env: Env, owner: Address, amount: i128, blinding_factor: BytesN<32>) {
        owner.require_auth();

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let commitment_value = Self::create_commitment(env.clone(), amount, blinding_factor);
        let commitment = Commitment {
            value: commitment_value.clone(),
        };

        let shielded_balance = ShieldedBalance {
            commitment,
            owner: owner.clone(),
        };

        env.storage().instance().set(&DataKey::ShieldedBalance(owner.clone()), &shielded_balance);

        env.events().publish((Symbol::new(&env, "shield"), owner), commitment_value);
    }

    /// Unshield a payment by revealing the amount with the correct blinding factor.
    /// Returns the amount if the blinding factor matches the stored commitment.
    pub fn unshield_payment(
        env: Env,
        owner: Address,
        amount: i128,
        blinding_factor: BytesN<32>
    ) -> i128 {
        owner.require_auth();

        let shielded_balance: ShieldedBalance = env
            .storage()
            .instance()
            .get(&DataKey::ShieldedBalance(owner.clone()))
            .expect("No shielded balance found");

        let expected_commitment = Self::create_commitment(env.clone(), amount, blinding_factor);

        if shielded_balance.commitment.value != expected_commitment {
            panic!("Invalid blinding factor or amount");
        }

        env.storage().instance().remove(&DataKey::ShieldedBalance(owner.clone()));

        env.events().publish((Symbol::new(&env, "unshield"), owner), amount);

        amount
    }

    /// Transfer shielded balance from one user to another.
    /// Verifies the transfer without revealing amounts using commitment arithmetic.
    /// The proof is the sender's blinding factor to verify their commitment.
    pub fn transfer_shielded(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
        from_blinding_factor: BytesN<32>,
        to_blinding_factor: BytesN<32>
    ) {
        from.require_auth();

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let from_balance: ShieldedBalance = env
            .storage()
            .instance()
            .get(&DataKey::ShieldedBalance(from.clone()))
            .expect("Sender has no shielded balance");

        let from_commitment_expected = Self::create_commitment(
            env.clone(),
            amount,
            from_blinding_factor
        );

        if from_balance.commitment.value != from_commitment_expected {
            panic!("Invalid sender blinding factor or amount");
        }

        let to_commitment_value = Self::create_commitment(env.clone(), amount, to_blinding_factor);
        let to_commitment = Commitment {
            value: to_commitment_value.clone(),
        };

        let to_shielded_balance = ShieldedBalance {
            commitment: to_commitment,
            owner: to.clone(),
        };

        env.storage().instance().set(&DataKey::ShieldedBalance(to.clone()), &to_shielded_balance);

        env.storage().instance().remove(&DataKey::ShieldedBalance(from.clone()));

        env.events().publish(
            (Symbol::new(&env, "transfer_shielded"), from, to),
            to_commitment_value
        );
    }

    /// Get the shielded commitment for a user (publicly visible but amount is hidden).
    pub fn get_shielded_commitment(env: Env, owner: Address) -> BytesN<32> {
        let shielded_balance: ShieldedBalance = env
            .storage()
            .instance()
            .get(&DataKey::ShieldedBalance(owner.clone()))
            .expect("No shielded balance found");
        shielded_balance.commitment.value
    }

    /// Verify amount commitment (simplified ZK verification)
    fn verify_amount_commitment(
        amount_hash: BytesN<32>,
        expected_hash: BytesN<32>,
        minimum_amount: i128,
    ) -> bool {
        // Simplified verification - just check if hashes match
        // In production, this would involve proper range proofs
        amount_hash == expected_hash
    }

    /// [PLACEHOLDER] Batch multiple micro-payments in a single transaction.
    /// See ROADMAP.md v2.0 — Multi-Currency Payments.
    pub fn batch_send(
        _env: Env,
        _from: Address,
        _recipients: soroban_sdk::Vec<Address>,
        _amounts: soroban_sdk::Vec<i128>
    ) {
        panic!("Batch payments coming in v2.0 — see ROADMAP.md");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{ testutils::{ Address as _, Ledger, LedgerInfo }, Address, Env };
    use soroban_sdk::token::{ Client as TokenClient, StellarAssetClient };

    /// Helper: deploy the contract and return (env, client, admin)
    fn setup() -> (Env, MicroPayContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MicroPayContract);
        let client = MicroPayContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    fn setup_contract() -> (Env, Address, Address, Address) {
        let env = Env::new();
        env.mock_all_auths();
        
        let payer = TestAddress::random(&env);
        let recipient = TestAddress::random(&env);
        let contract_id = TestAddress::random(&env);
        
        // Set up token contract
        let token_contract = env.register_stellar_asset_contract(payer.clone());
        let token_client = StellarAssetClient::new(&env, &token_contract);
        
        // Mint tokens to payer
        token_client.mint(&payer, &1000000000); // 10,000 XLM in stroops
        
        (env, payer, recipient, contract_id)
    }

    #[test]
    fn test_open_stream() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000, // 0.00001 XLM per ledger
            1000000, // 0.01 XLM deposit
        );
        
        assert_eq!(stream_id, 1);
        
        let stream = StellarMicroPay::get_stream(&env, stream_id);
        assert_eq!(stream.payer, payer);
        assert_eq!(stream.recipient, recipient);
        assert_eq!(stream.rate_per_ledger, 1000);
        assert_eq!(stream.deposited, 1000000);
        assert_eq!(stream.claimed, 0);
    }

    #[test]
    fn test_claim_stream_basic() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000, // 0.00001 XLM per ledger
            1000000, // 0.01 XLM deposit
        );
        
        // Advance ledger by 10
        env.ledger().set(LedgerInfo {
            protocol_version: 20,
            sequence_number: 10,
            timestamp: 0,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3110400,
        });
        
        let claimed = StellarMicroPay::claim_stream(&env, stream_id, recipient.clone());
        assert_eq!(claimed, 10000); // 10 ledgers * 1000 stroops
        
        let stream = StellarMicroPay::get_stream(&env, stream_id);
        assert_eq!(stream.claimed, 10000);
    }

    #[test]
    fn test_claim_stream_multiple_times() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000,
            1000000,
        );
        
        // Advance ledger by 5
        env.ledger().set(LedgerInfo {
            protocol_version: 20,
            sequence_number: 5,
            timestamp: 0,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3110400,
        });
        
        let first_claim = StellarMicroPay::claim_stream(&env, stream_id, recipient.clone());
        assert_eq!(first_claim, 5000); // 5 ledgers * 1000 stroops
        
        // Advance ledger by 3 more
        env.ledger().set(LedgerInfo {
            protocol_version: 20,
            sequence_number: 8,
            timestamp: 0,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3110400,
        });
        
        let second_claim = StellarMicroPay::claim_stream(&env, stream_id, recipient.clone());
        assert_eq!(second_claim, 3000); // 3 more ledgers * 1000 stroops
        
        let stream = StellarMicroPay::get_stream(&env, stream_id);
        assert_eq!(stream.claimed, 8000); // 5000 + 3000
    }

    #[test]
    fn test_claim_stream_exceeds_deposit() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000,
            5000, // Small deposit
        );
        
        // Advance ledger by 10 (should exceed deposit)
        env.ledger().set(LedgerInfo {
            protocol_version: 20,
            sequence_number: 10,
            timestamp: 0,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3110400,
        });
        
        let claimed = StellarMicroPay::claim_stream(&env, stream_id, recipient.clone());
        assert_eq!(claimed, 5000); // Can only claim what was deposited
    }

    #[test]
    fn test_top_up_stream() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000,
            1000000,
        );
        
        // Advance ledger by 5
        env.ledger().set(LedgerInfo {
            protocol_version: 20,
            sequence_number: 5,
            timestamp: 0,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3110400,
        });
        
        StellarMicroPay::top_up_stream(&env, stream_id, payer.clone(), 500000);
        
        let stream = StellarMicroPay::get_stream(&env, stream_id);
        assert_eq!(stream.deposited, 1500000); // 1000000 + 500000
    }

    #[test]
    fn test_close_stream_with_refund() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000,
            1000000,
        );
        
        // Advance ledger by 5
        env.ledger().set(LedgerInfo {
            protocol_version: 20,
            sequence_number: 5,
            timestamp: 0,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3110400,
        });
        
        let refund = StellarMicroPay::close_stream(&env, stream_id, payer.clone());
        
        // 1000000 deposited - 5000 streamed = 995000 refund
        assert_eq!(refund, 995000);
    }

    #[test]
    fn test_close_stream_after_claims() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000,
            1000000,
        );
        
        // Advance ledger by 5
        env.ledger().set(LedgerInfo {
            protocol_version: 20,
            sequence_number: 5,
            timestamp: 0,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3110400,
        });
        
        // Claim some amount
        StellarMicroPay::claim_stream(&env, stream_id, recipient.clone());
        
        // Advance ledger by 3 more
        env.ledger().set(LedgerInfo {
            protocol_version: 20,
            sequence_number: 8,
            timestamp: 0,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3110400,
        });
        
        let refund = StellarMicroPay::close_stream(&env, stream_id, payer.clone());
        
        // 1000000 deposited - 8000 streamed = 992000 refund
        assert_eq!(refund, 992000);
    }

    #[test]
    fn test_get_claimable() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000,
            1000000,
        );
        
        // Advance ledger by 5
        env.ledger().set(LedgerInfo {
            protocol_version: 20,
            sequence_number: 5,
            timestamp: 0,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 10,
            min_persistent_entry_ttl: 10,
            max_entry_ttl: 3110400,
        });
        
        let claimable = StellarMicroPay::get_claimable(&env, stream_id);
        assert_eq!(claimable, 5000); // 5 ledgers * 1000 stroops
    }

    #[test]
    #[should_panic(expected = "Stream not found")]
    fn test_claim_nonexistent_stream() {
        let (env, _payer, recipient, _contract_id) = setup_contract();
        
        StellarMicroPay::claim_stream(&env, 999, recipient);
    }

    #[test]
    #[should_panic(expected = "Only the recipient can claim from this stream")]
    fn test_unauthorized_claim() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        let unauthorized = TestAddress::random(&env);
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000,
            1000000,
        );
        
        StellarMicroPay::claim_stream(&env, stream_id, unauthorized);
    }

    #[test]
    #[should_panic(expected = "Only the payer can close this stream")]
    fn test_unauthorized_close() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        let unauthorized = TestAddress::random(&env);
        
        let stream_id = StellarMicroPay::open_stream(
            &env,
            payer.clone(),
            recipient.clone(),
            1000,
            1000000,
        );
        
        StellarMicroPay::close_stream(&env, stream_id, unauthorized);
    }

    #[test]
    #[should_panic(expected = "Rate per ledger must be positive")]
    fn test_invalid_rate() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        StellarMicroPay::open_stream(&env, payer, recipient, 0, 1000000);
    }

    #[test]
    #[should_panic(expected = "Deposit must be positive")]
    fn test_invalid_deposit() {
        let (env, payer, recipient, _contract_id) = setup_contract();
        
        StellarMicroPay::open_stream(&env, payer, recipient, 1000, 0);
    }

    // Zero-Knowledge Proof Tests

    #[test]
    fn test_commit_payment() {
        let env = Env::new();
        env.mock_all_auths();
        
        let amount = 1000000i128; // 0.01 XLM in stroops
        let salt = BytesN::from_array(&env, &[1u8; 32]);
        let commitment_hash = StellarMicroPay::generate_commitment_hash(env.clone(), amount, salt);
        let nullifier = BytesN::from_array(&env, &[2u8; 32]);
        
        let commitment_id = StellarMicroPay::commit_payment(env.clone(), commitment_hash, nullifier);
        
        assert_eq!(commitment_id, 1);
        
        // Verify commitment was stored
        let stored_commitment: PaymentCommitment = env
            .storage()
            .persistent()
            .get(&DataKey::PaymentCommitment(commitment_hash))
            .unwrap();
        
        assert_eq!(stored_commitment.commitment_hash, commitment_hash);
        assert_eq!(stored_commitment.nullifier, nullifier);
    }

    #[test]
    #[should_panic(expected = "Nullifier already used")]
    fn test_commit_payment_double_nullifier() {
        let env = Env::new();
        env.mock_all_auths();
        
        let amount = 1000000i128;
        let salt = BytesN::from_array(&env, &[1u8; 32]);
        let commitment_hash = StellarMicroPay::generate_commitment_hash(env.clone(), amount, salt);
        let nullifier = BytesN::from_array(&env, &[2u8; 32]);
        
        // First commitment should succeed
        StellarMicroPay::commit_payment(env.clone(), commitment_hash, nullifier);
        
        // Second commitment with same nullifier should fail
        let amount2 = 2000000i128;
        let salt2 = BytesN::from_array(&env, &[3u8; 32]);
        let commitment_hash2 = StellarMicroPay::generate_commitment_hash(env.clone(), amount2, salt2);
        StellarMicroPay::commit_payment(env.clone(), commitment_hash2, nullifier);
    }

    #[test]
    fn test_verify_payment_valid_proof() {
        let env = Env::new();
        env.mock_all_auths();
        
        let amount = 1000000i128;
        let minimum_amount = 500000i128;
        let salt = BytesN::from_array(&env, &[1u8; 32]);
        
        // Create commitment
        let commitment_hash = StellarMicroPay::generate_commitment_hash(env.clone(), amount, salt);
        let nullifier = BytesN::from_array(&env, &[2u8; 32]);
        StellarMicroPay::commit_payment(env.clone(), commitment_hash, nullifier);
        
        // Create proof
        let amount_hash = StellarMicroPay::hash_amount_with_salt(&env, minimum_amount, salt);
        let proof = ZKProof {
            commitment_hash,
            amount_hash,
            salt,
            merkle_proof: Vec::new(&env),
            leaf_index: 0,
        };
        
        // Verify proof
        let is_valid = StellarMicroPay::verify_payment(env, proof, minimum_amount);
        assert!(is_valid);
    }

    #[test]
    fn test_verify_payment_invalid_commitment() {
        let env = Env::new();
        env.mock_all_auths();
        
        let amount = 1000000i128;
        let minimum_amount = 500000i128;
        let salt = BytesN::from_array(&env, &[1u8; 32]);
        
        // Don't create commitment - use non-existent hash
        let fake_commitment_hash = BytesN::from_array(&env, &[99u8; 32]);
        let amount_hash = StellarMicroPay::hash_amount_with_salt(&env, minimum_amount, salt);
        
        let proof = ZKProof {
            commitment_hash: fake_commitment_hash,
            amount_hash,
            salt,
            merkle_proof: Vec::new(&env),
            leaf_index: 0,
        };
        
        // Verify proof should fail
        let is_valid = StellarMicroPay::verify_payment(env, proof, minimum_amount);
        assert!(!is_valid);
    }

    #[test]
    fn test_verify_payment_invalid_amount_hash() {
        let env = Env::new();
        env.mock_all_auths();
        
        let amount = 1000000i128;
        let minimum_amount = 500000i128;
        let salt = BytesN::from_array(&env, &[1u8; 32]);
        
        // Create commitment
        let commitment_hash = StellarMicroPay::generate_commitment_hash(env.clone(), amount, salt);
        let nullifier = BytesN::from_array(&env, &[2u8; 32]);
        StellarMicroPay::commit_payment(env.clone(), commitment_hash, nullifier);
        
        // Create proof with wrong amount hash
        let wrong_salt = BytesN::from_array(&env, &[99u8; 32]);
        let wrong_amount_hash = StellarMicroPay::hash_amount_with_salt(&env, minimum_amount, wrong_salt);
        
        let proof = ZKProof {
            commitment_hash,
            amount_hash: wrong_amount_hash,
            salt: wrong_salt,
            merkle_proof: Vec::new(&env),
            leaf_index: 0,
        };
        
        // Verify proof should fail
        let is_valid = StellarMicroPay::verify_payment(env, proof, minimum_amount);
        assert!(!is_valid);
    }

    #[test]
    fn test_generate_commitment_hash() {
        let env = Env::new();
        
        let amount = 1000000i128;
        let salt = BytesN::from_array(&env, &[1u8; 32]);
        
        let hash1 = StellarMicroPay::generate_commitment_hash(env.clone(), amount, salt);
        let hash2 = StellarMicroPay::generate_commitment_hash(env.clone(), amount, salt);
        
        // Same inputs should produce same hash
        assert_eq!(hash1, hash2);
        
        // Different salt should produce different hash
        let different_salt = BytesN::from_array(&env, &[2u8; 32]);
        let hash3 = StellarMicroPay::generate_commitment_hash(env.clone(), amount, different_salt);
        assert_ne!(hash1, hash3);
        
        // Different amount should produce different hash
        let different_amount = 2000000i128;
        let hash4 = StellarMicroPay::generate_commitment_hash(env.clone(), different_amount, salt);
        assert_ne!(hash1, hash4);
    }

    // ─── Invoice: sequential IDs and independence ─────────────────────────────

    #[test]
    fn test_merkle_root_update() {
        let env = Env::new();
        env.mock_all_auths();
        
        let amount = 1000000i128;
        let salt = BytesN::from_array(&env, &[1u8; 32]);
        let commitment_hash = StellarMicroPay::generate_commitment_hash(env.clone(), amount, salt);
        let nullifier = BytesN::from_array(&env, &[2u8; 32]);
        
        // Initially no Merkle root
        assert_eq!(StellarMicroPay::get_merkle_root(env.clone()), None);
        
        // Commit payment should create Merkle root
        StellarMicroPay::commit_payment(env.clone(), commitment_hash, nullifier);
        
        let merkle_root = StellarMicroPay::get_merkle_root(env.clone());
        assert!(merkle_root.is_some());
        assert_eq!(merkle_root.unwrap(), commitment_hash);
    }

    #[test]
    fn test_multiple_commitments_merkle_root() {
        let env = Env::new();
        env.mock_all_auths();
        
        let amount1 = 1000000i128;
        let salt1 = BytesN::from_array(&env, &[1u8; 32]);
        let commitment_hash1 = StellarMicroPay::generate_commitment_hash(env.clone(), amount1, salt1);
        let nullifier1 = BytesN::from_array(&env, &[2u8; 32]);
        
        let amount2 = 2000000i128;
        let salt2 = BytesN::from_array(&env, &[3u8; 32]);
        let commitment_hash2 = StellarMicroPay::generate_commitment_hash(env.clone(), amount2, salt2);
        let nullifier2 = BytesN::from_array(&env, &[4u8; 32]);
        
        // First commitment
        StellarMicroPay::commit_payment(env.clone(), commitment_hash1, nullifier1);
        let root1 = StellarMicroPay::get_merkle_root(env.clone()).unwrap();
        
        // Second commitment should update root
        StellarMicroPay::commit_payment(env.clone(), commitment_hash2, nullifier2);
        let root2 = StellarMicroPay::get_merkle_root(env.clone()).unwrap();
        
        // Roots should be different
        assert_ne!(root1, root2);
    }

    #[test]
    fn test_commitment_counter() {
        let env = Env::new();
        env.mock_all_auths();
        
        let amount = 1000000i128;
        let salt1 = BytesN::from_array(&env, &[1u8; 32]);
        let commitment_hash1 = StellarMicroPay::generate_commitment_hash(env.clone(), amount, salt1);
        let nullifier1 = BytesN::from_array(&env, &[2u8; 32]);
        
        let salt2 = BytesN::from_array(&env, &[3u8; 32]);
        let commitment_hash2 = StellarMicroPay::generate_commitment_hash(env.clone(), amount, salt2);
        let nullifier2 = BytesN::from_array(&env, &[4u8; 32]);
        
        // First commitment
        let id1 = StellarMicroPay::commit_payment(env.clone(), commitment_hash1, nullifier1);
        assert_eq!(id1, 1);
        
        // Second commitment
        let id2 = StellarMicroPay::commit_payment(env.clone(), commitment_hash2, nullifier2);
        assert_eq!(id2, 2);
    }

    #[test]
    fn test_invoice_and_escrow_ids_independent() {
        // Invoice counter and escrow counter are separate — both start at 0
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        let other = Address::generate(&env);
        let token = create_token(&env, &admin, &user, 5_000_000);

        let escrow_id = client.create_escrow(&token, &user, &other, &1_000_000, &50);
        let invoice_id = client.create_invoice(&token, &user, &other, &1_000_000);

        // Both start from 0 independently
        assert_eq!(escrow_id, 0);
        assert_eq!(invoice_id, 0);

        // Each can be retrieved without interference
        let _ = client.get_escrow(&escrow_id);
        let _ = client.get_invoice(&invoice_id);
    }

    // ─── Confidential Transactions tests ───────────────────────────────────────

    #[test]
    fn test_create_commitment() {
        let (env, client, _) = setup();
        let amount: i128 = 1000;
        let blinding_factor = BytesN::from_array(&env, &[1u8; 32]);

        let commitment = client.create_commitment(&amount, &blinding_factor);
        assert_eq!(commitment.len(), 32);

        // Same inputs should produce same commitment
        let commitment2 = client.create_commitment(&amount, &blinding_factor);
        assert_eq!(commitment, commitment2);

        // Different blinding factor should produce different commitment
        let blinding_factor2 = BytesN::from_array(&env, &[2u8; 32]);
        let commitment3 = client.create_commitment(&amount, &blinding_factor2);
        assert_ne!(commitment, commitment3);
    }

    #[test]
    fn test_shield_payment() {
        let (env, client, _) = setup();
        let owner = Address::generate(&env);
        let amount: i128 = 5000;
        let blinding_factor = BytesN::from_array(&env, &[1u8; 32]);

        client.shield_payment(&owner, &amount, &blinding_factor);

        // Verify commitment is stored
        let commitment = client.get_shielded_commitment(&owner);
        assert_eq!(commitment.len(), 32);

        // Verify it matches the expected commitment
        let expected_commitment = client.create_commitment(&amount, &blinding_factor);
        assert_eq!(commitment, expected_commitment);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_shield_payment_zero_amount_fails() {
        let (env, client, _) = setup();
        let owner = Address::generate(&env);
        let blinding_factor = BytesN::from_array(&env, &[1u8; 32]);

        client.shield_payment(&owner, &0, &blinding_factor);
    }

    #[test]
    fn test_unshield_payment() {
        let (env, client, _) = setup();
        let owner = Address::generate(&env);
        let amount: i128 = 5000;
        let blinding_factor = BytesN::from_array(&env, &[1u8; 32]);

        client.shield_payment(&owner, &amount, &blinding_factor);

        let revealed_amount = client.unshield_payment(&owner, &amount, &blinding_factor);
        assert_eq!(revealed_amount, amount);
    }

    #[test]
    #[should_panic(expected = "No shielded balance found")]
    fn test_unshield_payment_removes_balance() {
        let (env, client, _) = setup();
        let owner = Address::generate(&env);
        let amount: i128 = 5000;
        let blinding_factor = BytesN::from_array(&env, &[1u8; 32]);

        client.shield_payment(&owner, &amount, &blinding_factor);
        client.unshield_payment(&owner, &amount, &blinding_factor);

        // This should panic since balance was removed
        client.get_shielded_commitment(&owner);
    }

    #[test]
    #[should_panic(expected = "Invalid blinding factor or amount")]
    fn test_unshield_payment_wrong_blinding_factor_fails() {
        let (env, client, _) = setup();
        let owner = Address::generate(&env);
        let amount: i128 = 5000;
        let blinding_factor = BytesN::from_array(&env, &[1u8; 32]);

        client.shield_payment(&owner, &amount, &blinding_factor);

        let wrong_blinding_factor = BytesN::from_array(&env, &[2u8; 32]);
        client.unshield_payment(&owner, &amount, &wrong_blinding_factor);
    }

    #[test]
    #[should_panic(expected = "Invalid blinding factor or amount")]
    fn test_unshield_payment_wrong_amount_fails() {
        let (env, client, _) = setup();
        let owner = Address::generate(&env);
        let amount: i128 = 5000;
        let blinding_factor = BytesN::from_array(&env, &[1u8; 32]);

        client.shield_payment(&owner, &amount, &blinding_factor);

        let wrong_amount: i128 = 6000;
        client.unshield_payment(&owner, &wrong_amount, &blinding_factor);
    }

    #[test]
    fn test_transfer_shielded() {
        let (env, client, _) = setup();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount: i128 = 5000;
        let from_blinding_factor = BytesN::from_array(&env, &[1u8; 32]);
        let to_blinding_factor = BytesN::from_array(&env, &[2u8; 32]);

        client.shield_payment(&from, &amount, &from_blinding_factor);

        client.transfer_shielded(&from, &to, &amount, &from_blinding_factor, &to_blinding_factor);

        // To should have balance with new commitment
        let to_commitment = client.get_shielded_commitment(&to);
        let expected_commitment = client.create_commitment(&amount, &to_blinding_factor);
        assert_eq!(to_commitment, expected_commitment);
    }

    #[test]
    #[should_panic(expected = "No shielded balance found")]
    fn test_transfer_shielded_removes_from_balance() {
        let (env, client, _) = setup();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount: i128 = 5000;
        let from_blinding_factor = BytesN::from_array(&env, &[1u8; 32]);
        let to_blinding_factor = BytesN::from_array(&env, &[2u8; 32]);

        client.shield_payment(&from, &amount, &from_blinding_factor);
        client.transfer_shielded(&from, &to, &amount, &from_blinding_factor, &to_blinding_factor);

        // This should panic since from balance was removed
        client.get_shielded_commitment(&from);
    }

    #[test]
    #[should_panic(expected = "Invalid sender blinding factor or amount")]
    fn test_transfer_shielded_wrong_blinding_factor_fails() {
        let (env, client, _) = setup();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let amount: i128 = 5000;
        let from_blinding_factor = BytesN::from_array(&env, &[1u8; 32]);
        let to_blinding_factor = BytesN::from_array(&env, &[2u8; 32]);

        client.shield_payment(&from, &amount, &from_blinding_factor);

        let wrong_blinding_factor = BytesN::from_array(&env, &[3u8; 32]);
        client.transfer_shielded(&from, &to, &amount, &wrong_blinding_factor, &to_blinding_factor);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_transfer_shielded_zero_amount_fails() {
        let (env, client, _) = setup();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        let from_blinding_factor = BytesN::from_array(&env, &[1u8; 32]);
        let to_blinding_factor = BytesN::from_array(&env, &[2u8; 32]);

        client.shield_payment(&from, &5000, &from_blinding_factor);

        client.transfer_shielded(&from, &to, &0, &from_blinding_factor, &to_blinding_factor);
    }

    #[test]
    fn test_commitment_hides_amount() {
        let (env, client, _) = setup();
        let amount1: i128 = 1000;
        let amount2: i128 = 2000;
        let blinding_factor1 = BytesN::from_array(&env, &[1u8; 32]);
        let blinding_factor2 = BytesN::from_array(&env, &[2u8; 32]);

        let commitment1 = client.create_commitment(&amount1, &blinding_factor1);
        let commitment2 = client.create_commitment(&amount2, &blinding_factor2);

        // Different amounts with different blinding factors produce different commitments
        assert_ne!(commitment1, commitment2);

        // Same amount with different blinding factors produces different commitments
        let commitment3 = client.create_commitment(&amount1, &blinding_factor2);
        assert_ne!(commitment1, commitment3);

        // Different amounts can potentially produce same-looking commitment (collision resistance)
        // but with different blinding factors they should be different
        assert_ne!(commitment2, commitment3);
    }
}
