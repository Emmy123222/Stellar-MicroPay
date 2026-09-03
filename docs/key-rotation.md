# Key Rotation Procedure

This document describes the procedures for rotating cryptographic secrets (`JWT_SECRET` and `SERVER_PRIVATE_KEY`) in the Stellar MicroPay system without breaking active sessions and turret jobs.

## Overview

Stellar MicroPay uses two critical cryptographic secrets:

1. **`JWT_SECRET`**: Signs and verifies JWT tokens for SEP-10 authenticated sessions
2. **`SERVER_PRIVATE_KEY`**: Signs SEP-10 challenge transactions for Stellar Web Authentication

Both secrets are defined in `backend/.env` and are critical for system security. Regular rotation is recommended as part of security best practices.

Scheduled transaction XDRs are separately protected at rest with
`SCHEDULED_TX_ENCRYPTION_KEY`, a base64-encoded 32-byte AES-256-GCM key. Set
`SCHEDULED_TX_ENCRYPTION_KEY_PREVIOUS` during rotation; new schedules use the
current key while existing records remain decryptable with the previous key.
Remove the previous key only after records encrypted with it have been
submitted, migrated, or expired. Production startup fails closed when the
current scheduled-transaction key is missing or malformed.

---

## JWT_SECRET Rotation

### Purpose

`JWT_SECRET` is used to:
- Sign JWT access tokens issued after SEP-10 authentication
- Verify JWT tokens on protected API endpoints
- Issue refreshed tokens via `/api/auth/refresh`

### Current Behavior

- **Token TTL**: 24 hours
- **Refresh Grace Window**: 7 days (tokens can be refreshed up to 7 days after expiry)
- **Verification**: All tokens must be signed with the current `JWT_SECRET`
- **Impact of Rotation**: Changing `JWT_SECRET` immediately invalidates all existing tokens

### Rotation Procedure

#### Option 1: Graceful Rotation (Recommended)

This approach allows existing sessions to continue while new sessions use the new secret.

1. **Generate a new JWT secret**:
   ```bash
   openssl rand -hex 32
   ```

2. **Add the new secret as `JWT_SECRET_NEW`** to `backend/.env`:
   ```bash
   JWT_SECRET=old_secret_value
   JWT_SECRET_NEW=new_secret_value
   ```

3. **Update the authentication middleware** to support dual verification:
   
   Modify `backend/src/middleware/auth.js` to check both secrets during verification:
   ```javascript
   const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
   const JWT_SECRET_NEW = process.env.JWT_SECRET_NEW;
   
   function verifyJWT(req, res, next) {
     const token = extractToken(req);
     if (!token) {
       return res.status(401).json({ error: "Unauthorized: missing or invalid token" });
     }

     try {
       // Try verifying with new secret first
       const decoded = jwt.verify(token, JWT_SECRET_NEW || JWT_SECRET, VERIFY_OPTIONS);
       req.user = decoded;
       return next();
     } catch (err) {
       // Fall back to old secret if new fails
       try {
         const decoded = jwt.verify(token, JWT_SECRET, VERIFY_OPTIONS);
         req.user = decoded;
         return next();
       } catch (fallbackErr) {
         if (fallbackErr.name === "TokenExpiredError") {
           return res.status(401).json({ error: "Unauthorized: token expired", code: "token_expired" });
         }
         return res.status(401).json({ error: "Unauthorized: invalid token" });
       }
     }
   }
   ```

4. **Update token signing** to use the new secret:
   
   Modify `backend/src/routes/auth.js`:
   ```javascript
   const {
     JWT_SECRET,
     JWT_SECRET_NEW = JWT_SECRET, // Use new secret if available
     SIGN_OPTIONS,
     VERIFY_OPTIONS,
     extractToken,
   } = require("../middleware/auth");
   
   function issueToken(publicKey) {
     return jwt.sign({ publicKey }, JWT_SECRET_NEW, SIGN_OPTIONS);
   }
   ```

5. **Deploy the changes** and monitor for errors.

6. **Wait for the refresh grace window** (7 days) to allow existing sessions to naturally expire or be refreshed.

7. **Remove the old secret** from `backend/.env`:
   ```bash
   JWT_SECRET=new_secret_value
   # Remove JWT_SECRET_NEW
   ```

8. **Revert the middleware changes** to use single-secret verification (remove the fallback logic).

#### Option 2: Immediate Rotation (Forced Re-authentication)

Use this method only if there's a security compromise or immediate rotation is required.

1. **Generate a new JWT secret**:
   ```bash
   openssl rand -hex 32
   ```

2. **Replace `JWT_SECRET`** in `backend/.env`:
   ```bash
   JWT_SECRET=new_secret_value
   ```

3. **Restart the backend server**:
   ```bash
   # If using PM2
   pm2 restart stellar-micropay-backend
   
   # If using Docker
   docker-compose restart backend
   ```

4. **Impact**: All active sessions are immediately invalidated. Users must re-authenticate via SEP-10.

### Impact on Active Sessions

- **Immediate Rotation**: All active JWT tokens become invalid. Users receive 401 errors and must re-authenticate.
- **Graceful Rotation**: Existing tokens remain valid until they expire (24 hours) or are refreshed (within 7 days). New tokens use the new secret.

### Impact on Turret Jobs

- **No Direct Impact**: Turret jobs are stored in-memory and don't depend on JWT tokens for execution.
- **Indirect Impact**: API calls to manage turret jobs (deploy, pause, resume, list) require valid JWT authentication. After rotation, users must re-authenticate to manage jobs.

---

## SERVER_PRIVATE_KEY Rotation

### Purpose

`SERVER_PRIVATE_KEY` is used to:
- Sign SEP-10 challenge transactions (`/api/auth`)
- Verify signed challenges returned by clients
- Prove server identity during SEP-10 authentication

### Current Behavior

- **Caching**: The server keypair is cached at startup in `backend/src/routes/auth.js`
- **Ephemeral Mode**: If `SERVER_PRIVATE_KEY` is unset, a random keypair is generated per cold start
- **Impact of Rotation**: Changing `SERVER_PRIVATE_KEY` invalidates all pending challenge transactions

### Rotation Procedure

#### Step 1: Generate a New Stellar Keypair

```bash
# Using Stellar SDK (if available in your environment)
node -e "const {Keypair} = require('@stellar/stellar-sdk'); const kp = Keypair.random(); console.log('Public Key:', kp.publicKey()); console.log('Secret:', kp.secret());"

# Or use Freighter wallet to generate a new keypair
```

#### Step 2: Update Environment Variable

Replace `SERVER_PRIVATE_KEY` in `backend/.env`:
```bash
SERVER_PRIVATE_KEY=S<your_new_secret_key>
```

#### Step 3: Restart the Backend Server

```bash
# If using PM2
pm2 restart stellar-micropay-backend

# If using Docker
docker-compose restart backend
```

#### Step 4: Verify Rotation

Test the authentication flow:
1. Request a new challenge: `GET /api/auth?account=G<your_public_key>`
2. Sign the challenge with Freighter
3. Submit the signed challenge: `POST /api/auth`
4. Verify that a JWT token is returned successfully

### Impact on Active Sessions

- **Minimal Impact**: Existing JWT tokens remain valid. The `SERVER_PRIVATE_KEY` is only used during the initial SEP-10 challenge exchange, not for ongoing session validation.
- **Pending Challenges**: Any challenge transactions that were requested but not yet signed/verified become invalid and must be re-requested.

### Impact on Turret Jobs

- **No Impact**: Turret jobs do not depend on `SERVER_PRIVATE_KEY`. The turret signing flow uses user-signed challenges, not server-signed challenges.

---

## Combined Rotation Procedure

To rotate both secrets simultaneously with minimal disruption:

1. **Generate new secrets**:
   ```bash
   # New JWT secret
   openssl rand -hex 32
   
   # New Stellar keypair
   node -e "const {Keypair} = require('@stellar/stellar-sdk'); const kp = Keypair.random(); console.log('Secret:', kp.secret());"
   ```

2. **Perform graceful JWT rotation** (see Option 1 above) first.

3. **After the JWT grace window** (7 days), rotate `SERVER_PRIVATE_KEY` immediately.

4. **Restart the backend** after both rotations are complete.

---

## Monitoring and Validation

After rotation, monitor the following:

1. **Authentication Success Rate**: Check logs for increased 401 errors on `/api/auth` endpoints
2. **Token Refresh Errors**: Monitor `/api/auth/refresh` for failures
3. **User Complaints**: Watch for reports of authentication failures
4. **Turret Job Management**: Verify that users can still deploy, pause, and resume jobs

### Log Monitoring

```bash
# Check for authentication errors
tail -f backend/logs/app.log | grep "Unauthorized"

# Check for JWT verification failures
tail -f backend/logs/app.log | grep "JWT"
```

---

## Security Considerations

1. **Never commit secrets to version control**: Ensure `.env` files are in `.gitignore`
2. **Use strong secrets**: Generate cryptographically random secrets (minimum 32 bytes for JWT_SECRET)
3. **Limit secret access**: Restrict `.env` file access to necessary personnel only
4. **Document rotations**: Maintain a log of when secrets were rotated and by whom
5. **Test in staging**: Always test rotation procedures in a staging environment before production

---

## Emergency Rotation (Security Compromise)

If either secret is suspected to be compromised:

1. **Immediate Rotation**: Use the immediate rotation procedures (Option 2 for JWT, standard for SERVER_PRIVATE_KEY)
2. **Force Session Invalidation**: All users must re-authenticate
3. **Audit Logs**: Review authentication logs for suspicious activity
4. **Notify Users**: Communicate the security incident and recommend re-authentication
5. **Rotate Other Secrets**: Consider rotating other secrets (API keys, database credentials) as a precaution

---

## References

- [SEP-10: Stellar Web Authentication](https://stellar.org/sep-10)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [backend/.env.example](../backend/.env.example)
- [backend/src/middleware/auth.js](../backend/src/middleware/auth.js)
- [backend/src/routes/auth.js](../backend/src/routes/auth.js)
- [ENV.md](../ENV.md)
