# Stellar MicroPay Environment Variables Reference

This file documents all environment variables used by the Stellar MicroPay system. The system consists of an Express-based backend API service and a Next.js-based frontend web application.

---

## Backend Services (`backend/.env`)

These environment variables configure the backend Express application. Several variables are validated at startup to ensure service integrity.

| Variable Name | Default Value | Required | Read By | Purpose & Description |
| :--- | :--- | :---: | :--- | :--- |
| `PORT` | `4000` | No | Backend | The local port number the Express server runs on. |
| `NODE_ENV` | `development` | No | Backend | Environment mode (`development`, `production`, `test`). |
| `STELLAR_NETWORK` | `testnet` | **Yes** | Backend | Target Stellar network passphrase (`testnet` or `mainnet`). Verified at startup. |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | **Yes** | Backend | URL of the Horizon HTTP API server to interact with the Stellar blockchain. Verified at startup. |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | No | Backend | Comma-separated list of allowed CORS origins. |
| `FEDERATION_DOMAIN` | `stellarmicropay.io` | No | Backend | The domain used for Stellar Federation (SEP-0001 / SEP-0002) lookups. |
| `FEDERATION_DOMAINS` | `stellarmicropay.io,stellarmicropay.com` | No | Backend | Comma-separated list of secondary domains allowed for federation lookups. |
| `FEDERATION_SERVER_URL`| *Derived* | No | Backend | Optional override URL of the federation server. Defaults to `https://<FEDERATION_DOMAIN>/federation`. |
| `SENTRY_DSN` | *None* | No | Backend | Data Source Name for Sentry error tracking integration in the backend service. |

---

## Frontend Services (`frontend/.env`)

These environment variables configure the Next.js React application. Client-exposed variables are prefixed with `NEXT_PUBLIC_`.

| Variable Name | Default Value | Required | Read By | Purpose & Description |
| :--- | :--- | :---: | :--- | :--- |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` | **Yes** | Frontend | Target Stellar network passphrase (`testnet` or `mainnet`) for client wallet interactions. Verified at startup. |
| `NEXT_PUBLIC_HORIZON_URL` | `https://horizon-testnet.stellar.org` | **Yes** | Frontend | URL of the Horizon HTTP API server for frontend ledger queries. Verified at startup. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | **Yes** | Frontend | The backend API server base URL where frontend requests are routed. Verified at startup. |
| `NEXT_PUBLIC_CONTRACT_ID` | *None* | No | Frontend | Deployed Soroban Smart Contract ID used for recording client-side creator tips. |
| `ANTHROPIC_API_KEY` | `your_anthropic_api_key_here` | No | Frontend | API Key for Anthropic Claude, powering the frontend AI Payment Assistant feature. |
| `NEXT_PUBLIC_SENTRY_DSN` | *None* | No | Frontend | Client-side Sentry error tracking integration DSN. |
| `SENTRY_AUTH_TOKEN` | *None* | No | Frontend | Sentry build-time auth token used for uploading source maps. |

---

## Cross-Reference & Correspondence

The table below describes how variables in the frontend correspond to or cross-reference variables in the backend:

| Frontend Variable | Backend Variable | Alignment Requirement |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `STELLAR_NETWORK` | **Must align** (e.g., both set to `testnet` or `mainnet`) to ensure correct client-server blockchain synchronization. |
| `NEXT_PUBLIC_HORIZON_URL` | `HORIZON_URL` | **Must align** to guarantee that both frontend operations and backend lookups query the same Horizon nodes. |
| `NEXT_PUBLIC_API_URL` | `PORT` / Host | The frontend `NEXT_PUBLIC_API_URL` must point to the backend server URL (e.g., `http://localhost:4000` when backend `PORT` is `4000`). |
| `NEXT_PUBLIC_SENTRY_DSN` | `SENTRY_DSN` | Should be linked to the same Sentry project or team workspace to centralize issue monitoring. |
