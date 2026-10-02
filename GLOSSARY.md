# 📖 Stellar & Soroban Glossary

Welcome to the Stellar MicroPay terminology guide! If you are new to the Stellar ecosystem or decentralized application (dApp) development, some concepts and acronyms might be unfamiliar. This glossary provides plain-English explanations, context for how each term applies to Stellar MicroPay, and direct links to the official documentation.

---

## 📑 Table of Contents

- [Core Currency & Units](#core-currency--units)
  - [XLM (Lumens)](#xlm-lumens)
  - [Stroop](#stroop)
- [Network & State Architecture](#network--state-architecture)
  - [Ledger](#ledger)
  - [Sequence Number](#sequence-number)
  - [Stellar Consensus Protocol (SCP)](#stellar-consensus-protocol-scp)
- [Smart Contracts & Runtime](#smart-contracts--runtime)
  - [Soroban](#soroban)
  - [WebAssembly (WASM)](#webassembly-wasm)
- [APIs & Infrastructure](#apis--infrastructure)
  - [Horizon](#horizon)
  - [Soroban RPC](#soroban-rpc)
- [Serialization & Data Formats](#serialization--data-formats)
  - [XDR (External Data Representation)](#xdr-external-data-representation)
- [Wallets & Key Management](#wallets--key-management)
  - [Freighter](#freighter)
  - [Ledger (Hardware Wallet)](#ledger-hardware-wallet)
- [Stellar Ecosystem Proposals (SEPs)](#stellar-ecosystem-proposals-seps)
  - [SEP-0007 (Delegated Signing URIs)](#sep-0007-delegated-signing-uris)
  - [SEP-0010 (Stellar Web Authentication)](#sep-0010-stellar-web-authentication)
- [Accounts & Asset Management](#accounts--asset-management)
  - [Trustline](#trustline)
  - [Federation](#federation)
- [Off-Chain Execution & Oracles](#off-chain-execution--oracles)
  - [Turrets (Stellar Turrets)](#turrets-stellar-turrets)
- [Stellar MicroPay Specific Terms](#stellar-micropay-specific-terms)
  - [Payment Stream](#payment-stream)
  - [Rate Per Ledger](#rate-per-ledger)

---

## Core Currency & Units

### XLM (Lumens)
- **Plain English**: The native cryptocurrency token of the Stellar network. Lumens are used to pay network transaction fees and fund base account reserve balances that prevent ledger spam.
- **In Stellar MicroPay**: The default currency used to open payment streams, claim streaming funds, and refund unspent deposits.
- **Official Documentation**: [Stellar Lumens Fundamentals](https://developers.stellar.org/docs/learn/fundamentals/lumens)

### Stroop
- **Plain English**: The smallest indivisible unit of an XLM, named after computer scientist and Stellar co-founder David Mazières' dog. One XLM equals 10,000,000 stroops (`1 XLM = 10^7 stroops` or `0.0000001 XLM = 1 stroop`).
- **In Stellar MicroPay**: Smart contract math (e.g., `rate_per_ledger`, `deposited`, and `claimed`) operates strictly in stroops (`i128`) to prevent fractional rounding errors that could occur with floating-point calculations.
- **Official Documentation**: [Stellar Fees & Metering (Stroops)](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering#stroops) | [Lumens & Stroops](https://developers.stellar.org/docs/learn/fundamentals/lumens#stroop)

---

## Network & State Architecture

### Ledger
- **Plain English**: A record of the entire state of the Stellar blockchain at a specific point in time—comparable to a "block" in Bitcoin or Ethereum. Every ~5 seconds, network validators reach consensus and close a new ledger containing all verified transactions and balance updates. Each ledger is identified by an incrementing sequence number (ledger height).
- **In Stellar MicroPay**: Streaming payments are tied to ledger progression. Since ledgers close at a predictable ~5-second cadence, payment rates are configured as "stroops per ledger" to determine how much a recipient can claim at any point in time.
- **Official Documentation**: [Stellar Ledgers](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/ledgers)

### Sequence Number
- **Plain English**: An incremental counter associated with every Stellar account. When an account submits a transaction, the transaction must include a sequence number exactly one higher than the account's current sequence number. This acts as a nonce preventing transaction replay attacks and guaranteeing execution ordering.
- **In Stellar MicroPay**: Required whenever preparing and signing transactions (via Freighter or backend services) so the network executes actions in sequential order.
- **Official Documentation**: [Stellar Account Sequence Numbers](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#sequence-number) | [Operations & Transactions](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions#sequence-number)

### Stellar Consensus Protocol (SCP)
- **Plain English**: The federated Byzantine agreement (FBA) consensus mechanism used by Stellar. Unlike Proof of Work (mining) or Proof of Stake (bonding), nodes select which other nodes they trust (quorum slices), reaching decentralized consensus in 3 to 5 seconds with negligible energy consumption.
- **Official Documentation**: [Stellar Consensus Protocol (SCP)](https://developers.stellar.org/docs/learn/fundamentals/stellar-consensus-protocol)

---

## Smart Contracts & Runtime

### Soroban
- **Plain English**: The native smart contract platform built into the Stellar blockchain. Soroban allows developers to write performant, secure, Turing-complete programs deployed on Stellar, utilizing WebAssembly (WASM) and a developer-friendly Rust SDK.
- **In Stellar MicroPay**: The streaming channel engine is implemented as a Soroban contract located in `contracts/stellar-micropay-contract/`. It manages channel state, deposits, and on-chain claims.
- **Official Documentation**: [Soroban Documentation](https://developers.stellar.org/docs/smart-contracts) | [Soroban Architecture & Overview](https://soroban.stellar.org/docs)

### WebAssembly (WASM)
- **Plain English**: A portable, low-level binary format designed for safe, fast code execution. Soroban contracts are compiled from Rust into `.wasm` bytecode before being uploaded and executed on the Stellar network.
- **In Stellar MicroPay**: Contracts are compiled with `cargo build --target wasm32-unknown-unknown --release` to produce the deployable WASM binary.
- **Official Documentation**: [Soroban Contract Compilation](https://developers.stellar.org/docs/smart-contracts/getting-started/deploy-increment-contract)

---

## APIs & Infrastructure

### Horizon
- **Plain English**: The client-facing RESTful API server for the Stellar network. Horizon translates raw ledger state from Stellar Core into convenient HTTP endpoints for querying accounts, payments, transactions, and trade offers, as well as streaming live events via Server-Sent Events (SSE).
- **In Stellar MicroPay**: Used by both the frontend and backend to look up account balances, verify payment histories, and inspect base network state.
- **Official Documentation**: [Horizon API Reference](https://developers.stellar.org/docs/data/apis/horizon) | [Horizon Overview](https://developers.stellar.org/docs/tools/horizon)

### Soroban RPC
- **Plain English**: A JSON-RPC service designed specifically for interacting with Soroban smart contracts. It provides methods to simulate contract calls (`simulateTransaction`), fetch ledger entries (`getLedgerEntries`), and submit contract invocations (`sendTransaction`).
- **In Stellar MicroPay**: Used by the frontend client to simulate streaming payment claims, read contract storage, and broadcast contract transactions.
- **Official Documentation**: [Soroban RPC Methods](https://developers.stellar.org/docs/data/apis/rpc)

---

## Serialization & Data Formats

### XDR (External Data Representation)
- **Plain English**: An open standard binary serialization format (RFC 4506) used throughout Stellar to represent transactions, ledger entries, operations, and signatures in a deterministic, compact byte representation. In developer tools and JavaScript SDKs, binary XDR is typically encoded as a base64 string.
- **In Stellar MicroPay**: When users sign payment authorization or smart contract calls, the transaction is formatted as an XDR envelope passed between the frontend, Freighter, and the Stellar network.
- **Official Documentation**: [Stellar Data Structures & XDR](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/xdr) | [Stellar Laboratory XDR Viewer](https://laboratory.stellar.org/#xdr-viewer)

---

## Wallets & Key Management

### Freighter
- **Plain English**: A popular non-custodial browser extension and mobile wallet for the Stellar and Soroban ecosystems developed by the Stellar Development Foundation. Freighter securely stores user keypairs locally, allowing users to sign transactions without giving decentralized applications direct access to their private keys.
- **In Stellar MicroPay**: The primary browser wallet integration used for connecting an account, initiating streams, and claiming earnings.
- **Official Documentation**: [Freighter Developer Guide](https://developers.stellar.org/docs/tools/developer-tools/wallets/freighter) | [Freighter Official Website](https://www.freighter.app/)

### Ledger (Hardware Wallet)
- **Plain English**: A physical hardware device (manufactured by Ledger SAS) that stores private keys offline in a secure element chip. Note: Distinguish between **Ledger hardware wallet** (the physical device) and a **Stellar ledger** (the network block/state).
- **In Stellar MicroPay**: Supported via WebHID (`@ledgerhq/hw-app-stellar`) as an alternative to browser extension wallets for high-security transactions.
- **Official Documentation**: [Stellar Hardware Wallet Guide](https://developers.stellar.org/docs/tools/developer-tools/wallets) | [Stellar MicroPay Ledger Docs](docs/ledger.md)

---

## Stellar Ecosystem Proposals (SEPs)

SEPs are formal open-source specifications that describe standards and protocols adopted by the Stellar developer community.

### SEP-0007 (SEP-7)
- **Plain English**: A standard URI scheme (`web+stellar:...`) for delegating transaction signing and payment operations. It allows a website or QR code to prompt a user's wallet application (desktop or mobile) to sign a pre-configured transaction or make a payment without manual data entry.
- **In Stellar MicroPay**: Used to power mobile payment deep links and QR codes for payment channel onboarding.
- **Official Documentation**: [SEP-0007 Specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md) | [Stellar Ecosystem SEPs Overview](https://developers.stellar.org/docs/tokens/sep-0007)

### SEP-0010 (SEP-10)
- **Plain English**: A standard for cryptographic web authentication on Stellar. A server sends a challenge transaction containing a cryptographically random nonce; the client signs the transaction with their Stellar private key and returns it. Once verified, the server issues a session token (such as a JSON Web Token / JWT), proving wallet ownership without passwords.
- **In Stellar MicroPay**: Used to securely authenticate users to backend services, verify identity for turret deployments, and protect user settings.
- **Official Documentation**: [SEP-0010 Specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md) | [Stellar Web Authentication Guide](https://developers.stellar.org/docs/tokens/sep-0010)

---

## Accounts & Asset Management

### Trustline
- **Plain English**: An explicit line of trust an account must establish before it can hold or transact any non-native token (such as USDC, EURC, or custom project tokens). Trustlines prevent spam tokens from being deposited into user accounts without consent. Opening a trustline locks a small amount of XLM as a reserve requirement.
- **In Stellar MicroPay**: Necessary when streaming or accepting non-XLM token payments; the recipient account must have a trustline open for the asset.
- **Official Documentation**: [Stellar Trustlines](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines) | [Trustline Glossary Entry](https://developers.stellar.org/docs/learn/glossary#trustline)

### Federation
- **Plain English**: A protocol defined in SEP-0002 that maps human-readable addresses (e.g., `alice*stellar-micropay.org`) to 56-character Stellar public keys (`G...`) and optional memo IDs. This eliminates the risk of copy-pasting wrong wallet addresses.
- **In Stellar MicroPay**: Enables easy recipient lookup so payers can open streams using readable names instead of lengthy public keys.
- **Official Documentation**: [SEP-0002 Federation Protocol](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0002.md) | [Stellar Federation Guide](https://developers.stellar.org/docs/learn/glossary#federation)

---

## Off-Chain Execution & Oracles

### Turrets (Stellar Turrets)
- **Plain English**: A decentralized off-chain smart contract and oracle execution protocol for Stellar. Turrets are independent servers that run deterministic JavaScript functions (called `txFunctions`) in sandboxed environments. When external conditions (e.g., off-chain API prices, scheduled intervals, or multi-party authorizations) are fulfilled, the turrets co-sign a Stellar transaction using their private keys, which can then be submitted to the network.
- **In Stellar MicroPay**: Used to automate complex payment strategies like Dollar-Cost Averaging (DCA), recurring subscriptions, and stop-loss payments based on price feeds.
- **Official Documentation**: [Stellar Turrets (TSS)](https://tss.stellar.org/) | [Stellar Turrets Reference GitHub](https://github.com/tyvdh/stellar-turrets) | [Stellar MicroPay Turrets Guide](docs/turrets.md)

---

## Stellar MicroPay Specific Terms

### Payment Stream
- **Plain English**: An active payment channel between a payer and a recipient where funds accrue continuously in real time. The payer locks up an initial deposit, and the recipient can withdraw accrued funds whenever desired without interrupting the stream.
- **Reference**: [README.md](README.md#contract-structure) | [Contract Implementation](contracts/stellar-micropay-contract/)

### Rate Per Ledger
- **Plain English**: The velocity at which funds transfer from payer to recipient, expressed in stroops per closed ledger (~5 seconds). For example, a rate of 100 stroops per ledger transfers 1,200 stroops every minute.
- **Formula**:
  $$\text{claimable} = \min((\text{current\_ledger} - \text{start\_ledger}) \times \text{rate\_per\_ledger} - \text{claimed}, \text{deposited} - \text{claimed})$$
- **Reference**: [README.md Mathematical Calculations](README.md#mathematical-calculations)
