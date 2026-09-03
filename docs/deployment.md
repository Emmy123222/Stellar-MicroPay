# Production Deployment Guide

This document describes how to deploy the Stellar-MicroPay application in a production environment using Docker and Nginx.

## Prerequisites

- Docker and Docker Compose installed
- Domain name pointed to your server (optional, for production)
- Stellar network credentials (mainnet/testnet)

## Deployment Architecture

The deployment consists of three main containers:
1. **Frontend**: A Next.js application exported as static files, served via Nginx.
2. **Backend**: A Node.js API server.
3. **Nginx Reverse Proxy**: The main entry point that handles SSL (if configured), serves static files directly, and proxies API requests to the backend.

## Step-by-Step Deployment

1. **Clone the repository**:
   ```bash
   git clone https://github.com/devkayazumi/Stellar-MicroPay.git
   cd Stellar-MicroPay
   ```

2. **Configure Environment Variables**:
   Create `.env` files in `frontend/` and `backend/` based on the `.env.example` files provided.

3. **Build and Start Containers**:
   ```bash
   docker compose -f docker-compose.prod.yml up --build -d
   ```

4. **Verify Deployment**:
   - Frontend: `http://localhost`
   - Backend Health: `http://localhost/api/health` (proxied) or `http://localhost:4000/health` (internal)

## Configuration Details

### Nginx (`nginx/nginx.conf`)
- **Gzip Compression**: Enabled for text, css, and javascript.
- **Security Headers**: Includes X-Frame-Options, X-XSS-Protection, and Content-Security-Policy.
- **Reverse Proxy**: Proxies `/api/` to the backend service.

### Dockerfiles
- **Frontend**: Multi-stage build using `node:20-alpine` for building and `nginx:alpine` for serving.
- **Backend**: Uses `node:20-alpine` for a lightweight production image.

## Troubleshooting

- **Check Logs**:
  ```bash
  docker compose -f docker-compose.prod.yml logs -f
  ```
- **Health Checks**:
  Monitor container health using `docker ps`.
