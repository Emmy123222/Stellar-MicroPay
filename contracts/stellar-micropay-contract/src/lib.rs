#![no_std]

use soroban_sdk::{ 
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum ContractError {
    AlreadyInitialized = 1,
    SchemaAlreadyCurrent = 2,
    SchemaDowngrade = 3,
    InvalidWeight = 4,
    ZeroTotalWeight = 5,
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

fn find_recipient(recipients: &Vec<StreamRecipient>, addr: &Address) -> Option<u32> {
    for i in 0..recipients.len() {
        if &recipients.get(i).unwrap().recipient == addr {
            return Some(i);
        }
    }
    None
}

fn total_weight(recipients: &Vec<StreamRecipient>) -> Result<u32, ContractError> {
    let mut total: u32 = 0;
    for i in 0..recipients.len() {
        let w = recipients.get(i).unwrap().weight;
        if w == 0 { return Err(ContractError::InvalidWeight); }
        total = total.checked_add(w).ok_or(ContractError::InvalidWeight)?;
    }
    if total == 0 { return Err(ContractError::ZeroTotalWeight); }
    Ok(total)
}

fn total_claimed(recipients: &Vec<StreamRecipient>) -> i128 {
    let mut total: i128 = 0;
    for i in 0..recipients.len() {
        total += recipients.get(i).unwrap().claimed;
    }
    total
}

fn paused_ledgers_total(stream: &Stream, current_ledger: u32) -> u32 {
    if stream.paused {
        let ongoing = current_ledger.saturating_sub(stream.paused_at_ledger);
        stream.paused_ledgers.saturating_add(ongoing)
    } else {
        stream.paused_ledgers
    }
}

fn total_streamed_amount(stream: &Stream, current_ledger: u32) -> i128 {
    let paused = paused_ledgers_total(stream, current_ledger);
    let elapsed_ledgers = current_ledger.saturating_sub(stream.start_ledger).saturating_sub(paused);
    let funded_ledgers = stream.deposited / stream.rate_per_ledger;
    let elapsed_ledgers = if i128::from(elapsed_ledgers) > funded_ledgers {
        funded_ledgers as u32
    } else {
        elapsed_ledgers
    };
    stream.rate_per_ledger * elapsed_ledgers as i128
}

#[contract]
pub struct MicroPayContract;

#[contractimpl]
impl MicroPayContract {
    pub fn open_stream(env: Env, token: Address, payer: Address, recipients: Vec<Address>, weights: Vec<u32>, rate_per_ledger: i128, deposited: i128) -> u32 {
        assert!(recipients.len() > 0 && recipients.len() == weights.len());
        let mut stream_recipients = Vec::new(&env);
        for i in 0..recipients.len() {
            stream_recipients.push_back(StreamRecipient { recipient: recipients.get(i).unwrap(), weight: weights.get(i).unwrap(), claimed: 0 });
        }
        let _ = total_weight(&stream_recipients).expect("Weight validation failed");
        // Stream logic implementation follows...
        0 
    }

    pub fn initialize(_env: Env, _admin: Address) {}
    pub fn get_stream(_env: Env, _id: u32) -> Stream { todo!() }
    pub fn claim_stream(_env: Env, _id: u32, _addr: Address) -> i128 { todo!() }
    pub fn top_up_stream(_env: Env, _id: u32, _payer: Address, _amount: i128) { todo!() }
    pub fn close_stream(_env: Env, _id: u32, _payer: Address) { todo!() }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, Vec};

    #[test]
    fn test_zero_weight_rejected() {
        let env = Env::default();
        let mut recs = Vec::new(&env);
        let addr = Address::generate(&env);
        recs.push_back(StreamRecipient { recipient: addr, weight: 0, claimed: 0 });
        assert!(total_weight(&recs).is_err());
    }

    #[test]
    fn test_max_weight_overflow() {
        let env = Env::default();
        let mut recs = Vec::new(&env);
        let addr = Address::generate(&env);
        recs.push_back(StreamRecipient { recipient: addr.clone(), weight: u32::MAX, claimed: 0 });
        recs.push_back(StreamRecipient { recipient: addr, weight: 1, claimed: 0 });
        assert!(total_weight(&recs).is_err());
    }
}