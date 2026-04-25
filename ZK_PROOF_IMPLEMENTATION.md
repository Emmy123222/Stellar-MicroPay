# Zero-Knowledge Proof Implementation for Stellar MicroPay

This document describes the Zero-Knowledge proof functionality added to the Stellar MicroPay contract to enable privacy-preserving proof of payment.

## Overview

The implementation allows users to prove they made a payment of at least a certain amount without revealing the exact amount or their identity to third parties. This is achieved through a combination of commitment schemes and Merkle tree proofs.

## Architecture

### Core Components

1. **PaymentCommitment**: Stores commitment information on-chain
   - `commitment_hash`: Hash of the payment commitment (amount + salt)
   - `timestamp`: When the commitment was created
   - `nullifier`: Unique identifier to prevent double-spending

2. **ZKProof**: Structure for zero-knowledge proof verification
   - `commitment_hash`: Reference to the stored commitment
   - `amount_hash`: Hash of the amount being proved
   - `salt`: Random salt used in commitment
   - `merkle_proof`: Merkle proof for inclusion verification
   - `leaf_index`: Index of the leaf in the Merkle tree

3. **DataKey**: Storage keys for contract state
   - `PaymentCommitment(BytesN<32>)`: Individual commitment storage
   - `MerkleRoot`: Current Merkle tree root
   - `CommitmentCounter`: Counter for commitment IDs
   - `Nullifier(BytesN<32>)`: Used nullifiers for double-spending prevention

## Smart Contract Functions

### commit_payment

```rust
pub fn commit_payment(
    env: Env,
    commitment_hash: BytesN<32>,
    nullifier: BytesN<32>,
) -> u32
```

Stores a payment commitment on-chain. Prevents double-spending by checking nullifiers.

**Parameters:**
- `commitment_hash`: Hash of (amount + salt)
- `nullifier`: Unique identifier to prevent reuse

**Returns:** Commitment ID for tracking

### verify_payment

```rust
pub fn verify_payment(
    env: Env,
    proof: ZKProof,
    minimum_amount: i128,
) -> bool
```

Verifies a zero-knowledge proof without revealing the exact amount.

**Parameters:**
- `proof`: Complete ZK proof structure
- `minimum_amount`: Minimum amount to verify against

**Returns:** True if proof is valid and amount >= minimum_amount

### get_merkle_root

```rust
pub fn get_merkle_root(env: Env) -> Option<BytesN<32>>
```

Returns the current Merkle root of all commitments.

### generate_commitment_hash

```rust
pub fn generate_commitment_hash(
    env: Env,
    amount: i128,
    salt: BytesN<32>,
) -> BytesN<32>
```

Helper function to generate commitment hashes (typically used client-side).

## Client-Side Helper (TypeScript)

The `lib/stellar.ts` file provides TypeScript utilities for client-side proof generation:

### Key Functions

- `generateSalt()`: Creates random salt for commitments
- `generateNullifier()`: Creates unique nullifiers
- `hashAmountWithSalt()`: Hashes amount with salt
- `createPaymentCommitment()`: Creates complete payment commitment
- `createZKPaymentProof()`: Generates zero-knowledge proof
- `verifyZKPaymentProof()`: Verifies proofs client-side
- `serializeZKProof()` / `deserializeZKProof()`: For transmission

### Usage Example

```typescript
import { 
  createPaymentCommitment, 
  createZKPaymentProof, 
  verifyZKPaymentProof 
} from './lib/stellar';

// Create commitment
const commitment = createPaymentCommitment(1000000n); // 0.01 XLM

// Create ZK proof for minimum amount
const proof = createZKPaymentProof(
  1000000n,           // actual amount
  500000n,            // minimum amount to prove
  merkleRoot,         // from contract
  0                   // leaf index
);

// Verify (would be done on-chain)
const isValid = verifyZKPaymentProof(proof, 500000n, merkleRoot);
```

## Security Features

### Double-Spending Prevention
- Nullifiers are tracked to prevent commitment reuse
- Each nullifier can only be used once

### Privacy Preservation
- Amounts are hidden behind cryptographic hashes
- No direct link between commitment and payer identity
- Merkle proofs provide inclusion without revealing full data

### Integrity Verification
- Merkle tree ensures commitment inclusion
- Hash verification prevents tampering
- Timestamps provide temporal ordering

## Implementation Notes

### Simplified Merkle Tree
The current implementation uses a simplified Merkle tree structure for demonstration. In production, this should be replaced with a proper binary Merkle tree implementation.

### zk-SNARK Integration
The current implementation uses a simplified commitment scheme. For production use, this should be replaced with proper zk-SNARK circuits for stronger privacy guarantees.

### Range Proofs
The amount verification is simplified. Production implementations should include proper range proofs to ensure amounts are within valid bounds.

## Testing

Comprehensive tests are included in the contract:

- `test_commit_payment`: Basic commitment creation
- `test_commit_payment_double_nullifier`: Double-spending prevention
- `test_verify_payment_valid_proof`: Valid proof verification
- `test_verify_payment_invalid_commitment`: Invalid commitment rejection
- `test_verify_payment_invalid_amount_hash`: Tampered amount rejection
- `test_generate_commitment_hash`: Hash consistency
- `test_merkle_root_update`: Merkle tree functionality
- `test_multiple_commitments_merkle_root`: Multiple commitment handling
- `test_commitment_counter`: ID generation

## Future Enhancements

1. **Proper zk-SNARK Integration**: Replace simplified scheme with actual zk-SNARKs
2. **Full Merkle Tree**: Implement complete binary Merkle tree
3. **Range Proofs**: Add proper range proof verification
4. **Batch Verification**: Support for batch proof verification
5. **Revocation**: Add commitment revocation mechanisms
6. **Gas Optimization**: Optimize for lower gas costs

## Dependencies

### Rust Contract
- `soroban-sdk` v20.0.0
- `soroban-sdk::crypto` for cryptographic functions

### TypeScript Helper
- `js-sha256` for SHA256 hashing
- Node.js `crypto` for random bytes
- `@types/node` for TypeScript support

## License

MIT License - see LICENSE file for details.
