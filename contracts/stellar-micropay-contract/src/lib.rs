use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, Vec};

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
pub enum DataKey {
    Stream(u32),
    StreamCounter,
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
}
