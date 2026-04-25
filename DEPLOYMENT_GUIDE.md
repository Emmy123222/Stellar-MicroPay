# Deployment Guide for Stellar-MicroPay Streaming Payment Contract

## Overview

This guide provides step-by-step instructions for deploying the Stellar-MicroPay streaming payment contract to the Stellar network and creating a pull request to the forked repository.

## Prerequisites

1. **Rust and Soroban SDK**: Install Rust and add Soroban target
   ```bash
   rustup target add wasm32-unknown-unknown
   cargo install soroban-cli
   ```

2. **Stellar Account**: Have a funded Stellar account for deployment
3. **Git**: For version control and PR creation

## Build Instructions

### 1. Build the Contract

```bash
# Navigate to project directory
cd Stellar-MicroPay

# Build for WebAssembly target
cargo build --release --target wasm32-unknown-unknown

# The contract will be available at:
# target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm
```

### 2. Run Tests

```bash
# Run all tests to verify implementation
cargo test

# Run specific test
cargo test test_open_stream
```

## Contract Deployment

### 1. Setup Environment

```bash
# Set network (testnet or mainnet)
export STELLAR_NETWORK="testnet"

# Set contract parameters
export SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

### 2. Deploy Contract

```bash
# Deploy the contract
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_micropay_contract.wasm \
  --source <YOUR_STELLAR_SECRET_KEY> \
  --network $STELLAR_NETWORK

# Note the contract ID for future use
```

### 3. Initialize Contract (if needed)

```bash
# Initialize contract with any required parameters
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <YOUR_STELLAR_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  -- function_name \
  --args ...
```

## Usage Examples

### Opening a Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <PAYER_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  open_stream \
  --args \
    "<PAYER_ADDRESS>" \
    "<RECIPIENT_ADDRESS>" \
    "1000" \
    "1000000"
```

### Claiming from a Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <RECIPIENT_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  claim_stream \
  --args \
    "1" \
    "<RECIPIENT_ADDRESS>"
```

### Topping Up a Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <PAYER_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  top_up_stream \
  --args \
    "1" \
    "<PAYER_ADDRESS>" \
    "500000"
```

### Closing a Stream

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <PAYER_SECRET_KEY> \
  --network $STELLAR_NETWORK \
  close_stream \
  --args \
    "1" \
    "<PAYER_ADDRESS>"
```

## Creating a Pull Request

### 1. Fork the Repository

1. Go to the original repository: https://github.com/omolobamoyinoluwa-max/Stellar-MicroPay
2. Click "Fork" to create your own copy
3. Clone your fork locally:
   ```bash
   git clone https://github.com/<YOUR_USERNAME>/Stellar-MicroPay.git
   cd Stellar-MicroPay
   ```

### 2. Add Your Changes

1. Copy the implementation files to your local repository
2. Stage and commit your changes:
   ```bash
   git add .
   git commit -m "Implement streaming payment channels using Soroban"
   ```

### 3. Create Pull Request

1. Push to your fork:
   ```bash
   git push origin main
   ```

2. Create a pull request on GitHub with:
   - **Title**: "Implement streaming payment channels using Soroban"
   - **Description**: 
     ```
     This PR implements streaming payment channels using Soroban smart contracts.
     
     ## Features Implemented
     - ✅ Stream struct with all required fields (payer, recipient, rate_per_ledger, deposited, claimed, start_ledger)
     - ✅ open_stream function for creating new payment streams
     - ✅ claim_stream function for recipients to claim available funds
     - ✅ top_up_stream function for adding more funds to existing streams
     - ✅ close_stream function for stopping streams and refunding unstreamed portions
     - ✅ Comprehensive test suite covering all functionality
     - ✅ Proper authorization and validation checks
     - ✅ Accurate claim calculations at any ledger offset
     
     ## Acceptance Criteria Met
     - ✅ cargo test passes for all streaming tests
     - ✅ Claim amount calculated correctly at any ledger offset
     - ✅ Top-up increases the stream duration
     - ✅ Close refunds the correct unclaimed amount
     - ✅ Only the recipient can claim, only the payer can close
     
     ## Testing
     All tests pass and cover edge cases including:
     - Basic stream operations
     - Multiple claims over time
     - Deposit limits and overflow handling
     - Authorization validation
     - Error conditions
     
     ## Files Modified
     - `contracts/stellar-micropay-contract/src/lib.rs` - Main contract implementation
     - `Cargo.toml` - Workspace configuration
     - `contracts/stellar-micropay-contract/Cargo.toml` - Contract dependencies
     - `README.md` - Documentation
     - `DEPLOYMENT_GUIDE.md` - Deployment instructions
     ```

## Contract Features Summary

### Core Functionality
- **Stream Creation**: Create payment streams with custom rates and deposits
- **Claim Payments**: Recipients can claim available funds based on ledger progression
- **Stream Management**: Top-up existing streams or close them for refunds
- **Query Functions**: Get stream information and calculate claimable amounts

### Security Features
- **Authorization**: Only designated recipients can claim, only payers can manage streams
- **Input Validation**: Positive rates and deposits required
- **Overflow Protection**: Safe arithmetic operations
- **Access Control**: Proper authentication for all operations

### Mathematical Accuracy
- **Ledger-based Calculation**: Claims calculated using ledger progression
- **Deposit Limits**: Cannot claim more than deposited amount
- **Refund Logic**: Accurate refund calculations for unstreamed portions
- **Multiple Claims**: Proper tracking of claimed amounts over time

## Testing Coverage

The implementation includes 13 comprehensive test functions:

1. **test_open_stream** - Basic stream creation
2. **test_claim_stream_basic** - Single claim operation
3. **test_claim_stream_multiple_times** - Multiple claims over time
4. **test_claim_stream_exceeds_deposit** - Deposit limit enforcement
5. **test_top_up_stream** - Stream top-up functionality
6. **test_close_stream_with_refund** - Stream closure with refund
7. **test_close_stream_after_claims** - Closure after partial claims
8. **test_get_claimable** - Query claimable amount
9. **test_claim_nonexistent_stream** - Error handling for invalid streams
10. **test_unauthorized_claim** - Authorization for claims
11. **test_unauthorized_close** - Authorization for closures
12. **test_invalid_rate** - Input validation for rates
13. **test_invalid_deposit** - Input validation for deposits

## Next Steps

1. **Deploy to Testnet**: Test the contract on Stellar testnet
2. **Integration Testing**: Test with real Stellar accounts
3. **Security Audit**: Review for potential vulnerabilities
4. **Mainnet Deployment**: Deploy to production after testing
5. **Documentation**: Create user guides and API documentation

## Support

For questions or issues:
- Review the contract implementation in `lib.rs`
- Check the test cases for usage examples
- Refer to Soroban documentation: https://docs.rs/soroban-sdk/latest/soroban_sdk/
- Stellar documentation: https://developers.stellar.org/
