# Deployment Guide for Stellar-MicroPay Streaming Payment Contract

## Overview

This guide provides step-by-step instructions for deploying the Stellar-MicroPay streaming payment contract to the Stellar network and creating a pull request to the forked repository.

## Deploy the web application

The frontend is a static Next.js export and the API is an Express service. Deploy
them separately so the frontend can be served from a CDN while API secrets remain
on the server.

### Vercel (frontend)

1. Import this repository in Vercel, or use the [one-click flow](https://vercel.com/new/clone?repository-url=https://github.com/Emmy123222/Stellar-MicroPay).
2. Set **Root Directory** to `frontend`, use the Next.js framework, and set the build command to `npm run build`.
3. Configure these production variables:
   - `NEXT_PUBLIC_API_URL` — public HTTPS URL of the Railway API.
   - `NEXT_PUBLIC_STELLAR_NETWORK` — `testnet`, `mainnet`, or `custom`.
   - `NEXT_PUBLIC_HORIZON_URL` and `NEXT_PUBLIC_SOROBAN_RPC_URL` — network endpoints.
   - `NEXT_PUBLIC_CONTRACT_ID` — deployed MicroPay contract ID, if contract features are enabled.
4. Deploy and verify `/tip/<username>` and `/dashboard` from the Vercel URL.

### Railway (backend)

1. Create a Railway service from this repository and set its root directory to `backend`.
2. Use `npm start` as the start command and let Railway provide `PORT`.
3. Configure these production variables (never commit them):
   - `PORT` and `JWT_SECRET` (use a long random secret).
   - `ALLOWED_ORIGINS` — the Vercel origin, without a trailing slash.
   - `STELLAR_NETWORK`, `HORIZON_URL`, `SOROBAN_RPC_URL`, and `CONTRACT_ID`.
   - `DATABASE_URL` when a managed persistent store is enabled.
   - `LOG_LEVEL=info` and `DOMAIN` for federation discovery.
4. Add `/health` as the Railway health check. After deployment, verify `/api/docs`.
5. Set the Railway URL as `NEXT_PUBLIC_API_URL` in Vercel and redeploy the frontend.

For local verification, copy `frontend/.env.example` and `backend/.env.example`,
run `npm run dev --prefix backend`, then `npm run dev --prefix frontend`.

## Prerequisites

1. **Rust and Soroban SDK**: Install Rust and add Soroban target
   ```bash
   rustup target add wasm32-unknown-unknown
   cargo install soroban-cli
   ```

2. **Stellar Account**: Have a funded Stellar account for deployment
3. **Git**: For version control and PR creation
4. **JWT Secret**: Generate a strong random secret for JWT token signing
   ```bash
   openssl rand -base64 48
   ```
   Add this value to your `.env` file as `JWT_SECRET=<generated_value>`

## Backend Configuration

### Required Environment Variables

Before deploying the backend, you must configure the following environment variables:

1. **JWT_SECRET** (REQUIRED): Generate a secure secret for JWT token signing
   ```bash
   # Generate a cryptographically secure random secret
   openssl rand -base64 48
   ```

   Add this to your `.env` file or environment:
   ```bash
   JWT_SECRET=<generated_secret_here>
   ```

   **IMPORTANT**:
   - NEVER commit the JWT_SECRET to version control
   - Use a different secret for each environment (dev, staging, production)
   - The application will refuse to start if JWT_SECRET is not set

## Backend Configuration

### Required Environment Variables

Before deploying the backend, you must configure the following environment variables:

1. **JWT_SECRET** (REQUIRED): Generate a secure secret for JWT token signing
   ```bash
   # Generate a cryptographically secure random secret
   openssl rand -base64 48
   ```

   Add this to your `.env` file or environment:
   ```bash
   JWT_SECRET=<generated_secret_here>
   ```

   **IMPORTANT**:
   - NEVER commit the JWT_SECRET to version control
   - Use a different secret for each environment (dev, staging, production)
   - The application will refuse to start if JWT_SECRET is not set

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
