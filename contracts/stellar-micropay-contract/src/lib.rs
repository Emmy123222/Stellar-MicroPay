#![no_std]

use soroban_sdk::{ 
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol, Vec
};

#[contractevent]
#[derive(Clone, Debug)]
pub struct InitEvent { pub admin: Address }

#[contractevent]
#[derive(Clone, Debug)]
pub struct TipEvent { pub from: Address, pub to: Address, pub amount: i128 }

#[contractevent]
#[derive(Clone, Debug)]
pub struct ReceiptEvent { pub from: Address, pub index: u32 }

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum ContractError {
    AlreadyInitialized = 1,
    SchemaAlreadyCurrent = 2,
    SchemaDowngrade = 3,
}

const PERSISTENT_LIFETIME_THRESHOLD: u32 = 100_000;
const PERSISTENT_BUMP_AMOUNT: u32 = 500_000;

pub const SCHEMA_VERSION: u32 = 3;

pub const MIN_STREAM_DEPOSIT: i128 = 10_000;

pub const MIN_STREAM_DURATION_LEDGERS: u32 = 60;

#[contracttype]
#[derive(Clone, Debug)]
pub struct TipRecord {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ReceiptMetadata {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub memo: Symbol,
    pub ledger: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    TipTotal(Address),
    TipCount(Address),
    TipRecord(Address, u32),
    ReceiptCount(Address),
    ReceiptRecord(Address, u32),
    EscrowCount,
    Escrow(u32),
    StreamCount,
    Stream(u32),
    SchemaVersion,
    EscrowSenderCount(Address),
    EscrowSenderIndex(Address, u32),
    EscrowRecipientCount(Address),
    EscrowRecipientIndex(Address, u32),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    Pending,
    Released,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    pub id: u32,
    pub from: Address,
    pub to: Address,
    pub token: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub status: EscrowStatus,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamRecipient {
    pub recipient: Address,
    pub weight: u32,
    pub claimed: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Stream {
    pub payer: Address,
    pub recipients: Vec<StreamRecipient>,
    pub rate_per_ledger: i128,
    pub deposited: i128,
    pub start_ledger: u32,
    pub token: Address,
    pub paused: bool,
    pub paused_at_ledger: u32,
    pub paused_ledgers: u32,
    pub closed: bool,
}

#[contract]
pub struct MicroPayContract;

#[contractimpl]
impl MicroPayContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.events().publish((Symbol::new(&env, "init"),), InitEvent { admin: admin.clone() });
    }

    pub fn send_tip(env: Env, token_address: Address, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let token = token::Client::new(&env, &token_address);
        token.transfer(&from, &env.current_contract_address(), &amount);

        let count = env.storage().persistent().get::<_, u32>(&DataKey::TipCount(to.clone())).unwrap_or(0);
        let record = TipRecord { from: from.clone(), to: to.clone(), amount, ledger: env.ledger().sequence() };
        env.storage().persistent().set(&DataKey::TipRecord(to.clone(), count), &record);
        env.storage().persistent().set(&DataKey::TipCount(to.clone()), &(count + 1));
        
        let total = env.storage().persistent().get::<_, i128>(&DataKey::TipTotal(to.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::TipTotal(to.clone()), &(total + amount));

        env.events().publish((Symbol::new(&env, "tip"), from.clone(), to.clone()), TipEvent { from, to, amount });
    }

    pub fn mint_receipt(env: Env, from: Address, to: Address, amount: i128, memo: Symbol) -> u32 {
        from.require_auth();
        let count = env.storage().persistent().get::<_, u32>(&DataKey::ReceiptCount(from.clone())).unwrap_or(0);
        let receipt = ReceiptMetadata { from: from.clone(), to, amount, timestamp: env.ledger().timestamp(), memo, ledger: env.ledger().sequence() };
        
        env.storage().persistent().set(&DataKey::ReceiptRecord(from.clone(), count), &receipt);
        env.storage().persistent().set(&DataKey::ReceiptCount(from.clone()), &(count + 1));
        
        env.events().publish((Symbol::new(&env, "receipt"), from.clone()), ReceiptEvent { from, index: count });
        count
    }
    
    // Other methods truncated for brevity but follow the same pattern
}
