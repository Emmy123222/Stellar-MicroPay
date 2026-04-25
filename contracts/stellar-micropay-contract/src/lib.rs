// contracts/stellar-micropay-contract/src/lib.rs
//
// Stellar MicroPay — Soroban Smart Contract
//
// Functionality:
//   - Initialize the contract with an admin
//   - Record tips sent between accounts
//   - Query tip totals per recipient
//   - Time-locked escrow: create, release, cancel
//   - Invoice payments: create, claim, cancel
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

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol,
};

// ─── Storage keys ─────────────────────────────────────────────────────────────

// ─── Data types ───────────────────────────────────────────────────────────────

/// A single tip event recorded on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TipRecord {
    pub from: Address,
    pub to: Address,
    /// Amount in stroops (1 XLM = 10_000_000 stroops)
    pub amount: i128,
    pub ledger: u32,
}

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

/// An invoice payment record.
///
/// A client locks `amount` of XLM (or any SAC token) when creating the invoice.
/// The `recipient` claims the funds by presenting `invoice_id`. The `client`
/// can cancel and receive a full refund as long as the invoice is unclaimed.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Invoice {
    /// Unique invoice identifier (sequential u64)
    pub id: u64,
    /// The party who owes payment and locked the funds
    pub client: Address,
    /// The party who should receive the payment
    pub recipient: Address,
    /// Amount locked, in the token's smallest unit
    pub amount: i128,
    /// The SAC address of the token being held
    pub token: Address,
    /// True once the recipient has successfully claimed
    pub claimed: bool,
    /// True if the client cancelled before the invoice was claimed
    pub cancelled: bool,
    /// Ledger sequence number at the time of creation
    pub created_at: u32,
}

/// Storage keys for all contract state
#[contracttype]
pub enum DataKey {
    Admin,
    TipTotal(Address),
    TipCount(Address),
    Escrow(u64),
    EscrowCount,
    Invoice(u64),
    InvoiceCount,
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

    // ─── Invoice Payments ─────────────────────────────────────────────────────

    /// Create an invoice and lock `amount` of `token` from `client` into the
    /// contract. The funds remain locked until either:
    ///   - `recipient` calls `claim_invoice`, or
    ///   - `client` calls `cancel_invoice`.
    ///
    /// Returns the unique invoice ID.
    pub fn create_invoice(
        env: Env,
        token: Address,
        client: Address,
        recipient: Address,
        amount: i128,
    ) -> u64 {
        client.require_auth();

        if amount <= 0 {
            panic!("Invoice amount must be positive");
        }

        // Pull funds from the client into this contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&client, &env.current_contract_address(), &amount);

        // Assign sequential invoice ID
        let invoice_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::InvoiceCount)
            .unwrap_or(0u64);

        let invoice = Invoice {
            id: invoice_id,
            client: client.clone(),
            recipient: recipient.clone(),
            amount,
            token,
            claimed: false,
            cancelled: false,
            created_at: env.ledger().sequence(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Invoice(invoice_id), &invoice);

        env.storage()
            .instance()
            .set(&DataKey::InvoiceCount, &(invoice_id + 1));

        env.events().publish(
            (Symbol::new(&env, "invoice_create"), client, recipient),
            (invoice_id, amount),
        );

        invoice_id
    }

    /// Claim an invoice and release locked funds to the recipient.
    ///
    /// Only the `recipient` recorded on the invoice may claim it.
    /// Panics if the invoice has already been claimed or cancelled.
    pub fn claim_invoice(env: Env, invoice_id: u64, recipient: Address) {
        recipient.require_auth();

        let mut invoice: Invoice = env
            .storage()
            .persistent()
            .get(&DataKey::Invoice(invoice_id))
            .expect("Invoice not found");

        // Verify the caller is the intended recipient
        if invoice.recipient != recipient {
            panic!("Only the intended recipient may claim this invoice");
        }

        if invoice.cancelled {
            panic!("Invoice has been cancelled");
        }

        if invoice.claimed {
            panic!("Invoice already claimed");
        }

        // Transfer funds from contract to recipient
        let token_client = token::Client::new(&env, &invoice.token);
        token_client.transfer(
            &env.current_contract_address(),
            &invoice.recipient,
            &invoice.amount,
        );

        let claimed_amount = invoice.amount;
        invoice.claimed = true;
        invoice.amount = 0;

        env.storage()
            .persistent()
            .set(&DataKey::Invoice(invoice_id), &invoice);

        env.events().publish(
            (Symbol::new(&env, "invoice_claim"), invoice.recipient.clone()),
            (invoice_id, claimed_amount),
        );
    }

    /// Cancel an invoice and refund locked funds to the client.
    ///
    /// Only the `client` who created the invoice may cancel it, and only
    /// while it remains unclaimed.
    pub fn cancel_invoice(env: Env, invoice_id: u64, client: Address) {
        client.require_auth();

        let mut invoice: Invoice = env
            .storage()
            .persistent()
            .get(&DataKey::Invoice(invoice_id))
            .expect("Invoice not found");

        // Verify the caller is the client who created this invoice
        if invoice.client != client {
            panic!("Only the client may cancel this invoice");
        }

        if invoice.claimed {
            panic!("Invoice already claimed; cannot cancel");
        }

        if invoice.cancelled {
            panic!("Invoice already cancelled");
        }

        // Refund to the client
        let token_client = token::Client::new(&env, &invoice.token);
        token_client.transfer(
            &env.current_contract_address(),
            &invoice.client,
            &invoice.amount,
        );

        let refunded_amount = invoice.amount;
        invoice.cancelled = true;
        invoice.amount = 0;

        env.storage()
            .persistent()
            .set(&DataKey::Invoice(invoice_id), &invoice);

        env.events().publish(
            (Symbol::new(&env, "invoice_cancel"), invoice.client.clone()),
            (invoice_id, refunded_amount),
        );
    }

    /// Return the full state of an invoice by ID.
    pub fn get_invoice(env: Env, invoice_id: u64) -> Invoice {
        env.storage()
            .persistent()
            .get(&DataKey::Invoice(invoice_id))
            .expect("Invoice not found")
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    pub fn get_tip_total(env: Env, recipient: Address) -> i128 {
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

    // ─── Invoice: create ──────────────────────────────────────────────────────

    #[test]
    fn test_create_invoice() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        assert_eq!(invoice_id, 0);

        let invoice = client.get_invoice(&invoice_id);
        assert_eq!(invoice.id, 0);
        assert_eq!(invoice.client, payer);
        assert_eq!(invoice.recipient, vendor);
        assert_eq!(invoice.amount, 2_000_000);
        assert!(!invoice.claimed);
        assert!(!invoice.cancelled);

        // Funds should be deducted from payer
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&payer), 3_000_000);
    }

    #[test]
    #[should_panic(expected = "Invoice amount must be positive")]
    fn test_create_invoice_zero_amount_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);
        client.create_invoice(&token, &payer, &vendor, &0);
    }

    #[test]
    #[should_panic(expected = "Invoice amount must be positive")]
    fn test_create_invoice_negative_amount_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);
        client.create_invoice(&token, &payer, &vendor, &-1);
    }

    // ─── Invoice: claim ───────────────────────────────────────────────────────

    #[test]
    fn test_claim_invoice_full_lifecycle() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);

        client.claim_invoice(&invoice_id, &vendor);

        // Vendor receives the funds
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&vendor), 2_000_000);

        // Invoice reflects claimed state
        let invoice = client.get_invoice(&invoice_id);
        assert!(invoice.claimed);
        assert_eq!(invoice.amount, 0);
        assert!(!invoice.cancelled);
    }

    #[test]
    #[should_panic(expected = "Invoice already claimed")]
    fn test_claim_invoice_twice_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        client.claim_invoice(&invoice_id, &vendor);
        // Second claim must panic
        client.claim_invoice(&invoice_id, &vendor);
    }

    #[test]
    #[should_panic(expected = "Only the intended recipient may claim this invoice")]
    fn test_claim_invoice_wrong_recipient_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let impostor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        // Impostor tries to claim
        client.claim_invoice(&invoice_id, &impostor);
    }

    #[test]
    #[should_panic(expected = "Invoice has been cancelled")]
    fn test_claim_cancelled_invoice_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        client.cancel_invoice(&invoice_id, &payer);
        // Vendor tries to claim after cancellation
        client.claim_invoice(&invoice_id, &vendor);
    }

    // ─── Invoice: cancel ──────────────────────────────────────────────────────

    #[test]
    fn test_cancel_invoice_refunds_client() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);

        client.cancel_invoice(&invoice_id, &payer);

        // Full balance restored to payer
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&payer), 5_000_000);

        let invoice = client.get_invoice(&invoice_id);
        assert!(invoice.cancelled);
        assert!(!invoice.claimed);
        assert_eq!(invoice.amount, 0);
    }

    #[test]
    #[should_panic(expected = "Invoice already cancelled")]
    fn test_cancel_invoice_twice_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        client.cancel_invoice(&invoice_id, &payer);
        client.cancel_invoice(&invoice_id, &payer); // must panic
    }

    #[test]
    #[should_panic(expected = "Only the client may cancel this invoice")]
    fn test_cancel_invoice_wrong_client_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let stranger = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        // A stranger attempts cancellation
        client.cancel_invoice(&invoice_id, &stranger);
    }

    #[test]
    #[should_panic(expected = "Invoice already claimed; cannot cancel")]
    fn test_cancel_after_claim_fails() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 5_000_000);

        let invoice_id = client.create_invoice(&token, &payer, &vendor, &2_000_000);
        client.claim_invoice(&invoice_id, &vendor);
        // Payer tries to cancel after vendor already claimed
        client.cancel_invoice(&invoice_id, &payer);
    }

    // ─── Invoice: get_invoice ─────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Invoice not found")]
    fn test_get_nonexistent_invoice_fails() {
        let (_, client, _) = setup();
        client.get_invoice(&999);
    }

    // ─── Invoice: sequential IDs and independence ─────────────────────────────

    #[test]
    fn test_multiple_invoices_sequential_ids() {
        let (env, client, admin) = setup();
        let payer = Address::generate(&env);
        let vendor_a = Address::generate(&env);
        let vendor_b = Address::generate(&env);
        let token = create_token(&env, &admin, &payer, 10_000_000);

        let id0 = client.create_invoice(&token, &payer, &vendor_a, &1_000_000);
        let id1 = client.create_invoice(&token, &payer, &vendor_b, &2_000_000);
        let id2 = client.create_invoice(&token, &payer, &vendor_a, &3_000_000);

        assert_eq!(id0, 0);
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);

        // Claim the second invoice; others remain untouched
        client.claim_invoice(&id1, &vendor_b);

        let inv0 = client.get_invoice(&id0);
        let inv1 = client.get_invoice(&id1);
        let inv2 = client.get_invoice(&id2);

        assert!(!inv0.claimed && !inv0.cancelled);
        assert!(inv1.claimed && !inv1.cancelled);
        assert!(!inv2.claimed && !inv2.cancelled);
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