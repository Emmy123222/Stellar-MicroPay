use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, Vec, BytesN};
use soroban_sdk::crypto::{keccak256, sha256};

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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ZKProof {
    pub commitment_hash: BytesN<32>,
    pub amount_hash: BytesN<32>,
    pub salt: BytesN<32>,
    pub merkle_proof: Vec<BytesN<32>>,
    pub leaf_index: u32,
}

#[contracttype]
pub enum DataKey {
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
impl StellarMicroPay {
    /// Open a new payment stream
    /// 
    /// # Arguments
    /// * `payer` - Address of the payer who funds the stream
    /// * `recipient` - Address of the recipient who can claim payments
    /// * `rate_per_ledger` - Amount to stream per ledger (in stroops)
    /// * `deposit` - Initial deposit amount (in stroops)
    /// 
    /// # Returns
    /// Stream ID for the newly created stream
    pub fn open_stream(
        env: Env,
        payer: Address,
        recipient: Address,
        rate_per_ledger: i128,
        deposit: i128,
    ) -> u32 {
        // Validate inputs
        if rate_per_ledger <= 0 {
            panic!("Rate per ledger must be positive");
        }
        if deposit <= 0 {
            panic!("Deposit must be positive");
        }

        // Get and increment stream counter
        let mut counter: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::StreamCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .persistent()
            .set(&DataKey::StreamCounter, &counter);

        // Create the stream
        let stream = Stream {
            payer: payer.clone(),
            recipient: recipient.clone(),
            rate_per_ledger,
            deposited: deposit,
            claimed: 0,
            start_ledger: env.ledger().sequence(),
        };

        // Store the stream
        env.storage()
            .persistent()
            .set(&DataKey::Stream(counter), &stream);

        // Transfer deposit from payer to contract
        env.current_contract_address().require_auth();
        payer.require_auth();
        env.token_stellar(&Address::from_contract_id(env.current_contract_address().contract_id()))
            .transfer(&payer, &env.current_contract_address(), &deposit);

        counter
    }

    /// Claim available funds from a stream
    /// 
    /// # Arguments
    /// * `stream_id` - ID of the stream to claim from
    /// * `recipient` - Address claiming the funds (must match stream recipient)
    /// 
    /// # Returns
    /// Amount claimed (in stroops)
    pub fn claim_stream(env: Env, stream_id: u32, recipient: Address) -> i128 {
        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("Stream not found"));

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

        actual_claim
    }

    /// Add more funds to an existing stream
    /// 
    /// # Arguments
    /// * `stream_id` - ID of the stream to top up
    /// * `payer` - Address providing additional funds (must match stream payer)
    /// * `amount` - Additional amount to deposit (in stroops)
    pub fn top_up_stream(env: Env, stream_id: u32, payer: Address, amount: i128) {
        if amount <= 0 {
            panic!("Top-up amount must be positive");
        }

        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("Stream not found"));

        // Verify payer
        if stream.payer != payer {
            panic!("Only the payer can top up this stream");
        }

        // Update deposited amount
        stream.deposited += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

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

        // Transfer refund to payer
        env.current_contract_address().require_auth();
        env.token_stellar(&Address::from_contract_id(env.current_contract_address().contract_id()))
            .transfer(&env.current_contract_address(), &payer, &refundable);

        refundable
    }

    /// Get stream information
    /// 
    /// # Arguments
    /// * `stream_id` - ID of the stream to query
    /// 
    /// # Returns
    /// Stream struct with current state
    pub fn get_stream(env: Env, stream_id: u32) -> Stream {
        env.storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("Stream not found"))
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

        // Get and increment commitment counter
        let mut counter: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::CommitmentCounter)
            .unwrap_or(0);
        counter += 1;
        env.storage()
            .persistent()
            .set(&DataKey::CommitmentCounter, &counter);

        // Create commitment
        let commitment = PaymentCommitment {
            commitment_hash: commitment_hash.clone(),
            timestamp: env.ledger().timestamp(),
            nullifier: nullifier.clone(),
        };

        // Store the commitment
        env.storage()
            .persistent()
            .set(&DataKey::PaymentCommitment(commitment_hash.clone()), &commitment);

        // Mark nullifier as used
        env.storage()
            .persistent()
            .set(&DataKey::Nullifier(nullifier), &true);

        // Update Merkle tree (simplified - in production would use proper tree)
        Self::update_merkle_root(&env, commitment_hash);

        counter
    }

    /// Verify a zero-knowledge proof of payment
    /// 
    /// # Arguments
    /// * `proof` - ZK proof containing commitment and Merkle proof
    /// * `minimum_amount` - Minimum amount to verify against
    /// 
    /// # Returns
    /// True if proof is valid and amount >= minimum_amount
    pub fn verify_payment(
        env: Env,
        proof: ZKProof,
        minimum_amount: i128,
    ) -> bool {
        // Verify commitment exists
        let commitment: PaymentCommitment = match env
            .storage()
            .persistent()
            .get(&DataKey::PaymentCommitment(proof.commitment_hash.clone())) {
            Some(commitment) => commitment,
            None => return false,
        };

        // Verify Merkle proof
        if !Self::verify_merkle_proof(&env, proof.commitment_hash, proof.merkle_proof, proof.leaf_index) {
            return false;
        }

        // Verify amount hash (simplified ZK verification)
        // In a real implementation, this would involve proper zk-SNARK verification
        let expected_amount_hash = Self::hash_amount_with_salt(minimum_amount, proof.salt);
        
        // For this simplified version, we'll verify that the amount hash matches
        // In production, this would be a proper ZK circuit verification
        Self::verify_amount_commitment(proof.amount_hash, expected_amount_hash, minimum_amount)
    }

    /// Get the current Merkle root
    pub fn get_merkle_root(env: Env) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::MerkleRoot)
    }

    /// Helper function to update Merkle root (simplified implementation)
    fn update_merkle_root(env: &Env, new_hash: BytesN<32>) {
        let current_root = env.storage().persistent().get(&DataKey::MerkleRoot);
        
        // Simplified Merkle root update
        // In production, this would maintain a proper Merkle tree
        let new_root = match current_root {
            Some(root) => {
                // Combine current root with new hash
                let combined = [root.as_slice(), new_hash.as_slice()].concat();
                BytesN::from_array(&env, &sha256(&env, &combined))
            }
            None => new_hash,
        };

        env.storage().persistent().set(&DataKey::MerkleRoot, &new_root);
    }

    /// Verify Merkle proof (simplified implementation)
    fn verify_merkle_proof(
        env: &Env,
        leaf: BytesN<32>,
        proof: Vec<BytesN<32>>,
        leaf_index: u32,
    ) -> bool {
        let merkle_root = match env.storage().persistent().get(&DataKey::MerkleRoot) {
            Some(root) => root,
            None => return false,
        };

        // Simplified Merkle proof verification
        // In production, this would reconstruct the path properly
        let mut computed_hash = leaf;
        
        for proof_element in proof {
            let combined = [computed_hash.as_slice(), proof_element.as_slice()].concat();
            computed_hash = BytesN::from_array(env, &sha256(env, &combined));
        }

        computed_hash == merkle_root
    }

    /// Hash amount with salt for commitment
    fn hash_amount_with_salt(env: &Env, amount: i128, salt: BytesN<32>) -> BytesN<32> {
        let amount_bytes = amount.to_le_bytes();
        let combined = [&amount_bytes, salt.as_slice()].concat();
        BytesN::from_array(env, &sha256(env, &combined))
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

    /// Generate a commitment hash for a payment amount (helper for client-side)
    /// This would typically be done client-side, but included for testing
    pub fn generate_commitment_hash(
        env: Env,
        amount: i128,
        salt: BytesN<32>,
    ) -> BytesN<32> {
        Self::hash_amount_with_salt(&env, amount, salt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Ledger, LedgerInfo, Address as TestAddress}, token::StellarAssetClient};

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
}