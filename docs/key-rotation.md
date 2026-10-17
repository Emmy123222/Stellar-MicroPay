# Backend Secret Rotation Guide

This guide explains how to safely rotate long-lived secrets used by the Stellar MicroPay backend without downtime or data loss. Each secret has different rotation consequences — understand them before rotating.

---

## Overview of Secrets

The backend holds three categories of long-lived secrets:

| Secret | Used For | Impact on Active Sessions | Rollback Difficulty |
| --- | --- | --- | --- |
| `JWT_SECRET` | Signing authentication tokens | Sessions invalidated immediately | Easy (revert env var) |
| `SERVER_PRIVATE_KEY` | SEP-10 challenge signing, federation identity | Challenge flow breaks; published via stellar.toml | Hard (clients must update config) |
| `PAYMENT_SIGNING_SECRET` | HMAC request signing for replay protection | All in-flight signed requests fail | Hard (clients must be updated simultaneously) |

---

## JWT_SECRET Rotation

**Purpose**: Validates authentication tokens issued during login.

**Impact**: Invalidates all active JWT sessions immediately. Clients must re-authenticate.

**Downtime**: None for the server, but users' sessions end and they are forced to log in again.

### Procedure

1. **Generate a new secret**:
   ```bash
   openssl rand -base64 48
   ```

2. **Plan the window**: Schedule rotation during low-traffic hours and notify users in advance (via in-app alert or email) that they may be logged out.

3. **Update the environment variable**:
   - Staging: Deploy and test first.
   - Production: Set the new `JWT_SECRET` and redeploy.

4. **Verification**:
   - Old tokens are immediately invalid; new logins receive new tokens.
   - Users on the site see a 401 error and are redirected to login.
   - Monitor error logs for unexpected 401 spikes.

### Rollback

Revert `JWT_SECRET` to the previous value and redeploy. Old tokens become valid again within seconds.

### Dual Secret Support (Zero-Session Loss)

To rotate `JWT_SECRET` *without* invalidating active sessions:

1. Store both the old and new secrets in environment (e.g., `JWT_SECRET_CURRENT` and `JWT_SECRET_PREVIOUS`).
2. Update `backend/src/middleware/auth.js` to verify tokens against both secrets:
   ```javascript
   const decoded = jwt.verify(token, JWT_SECRET_CURRENT)
     .catch(() => jwt.verify(token, JWT_SECRET_PREVIOUS));
   ```
3. Deploy the updated auth middleware with both secrets active.
4. Wait for all old sessions to expire naturally (default: 24 hours per `expiresIn: "24h"` in `src/routes/auth.js`).
5. Remove `JWT_SECRET_PREVIOUS` and redeploy.

This avoids forced re-authentication but requires code changes to the verifier before the rotation.

---

## SERVER_PRIVATE_KEY Rotation

**Purpose**: Generates SEP-10 challenge transactions and serves as the server's Stellar identity. Published as `SIGNING_KEY` in `stellar.toml`.

**Impact**: Challenge requests fail until clients update their config to the new public key. The server becomes unrecognizable to clients until `stellar.toml` is updated and propagated.

**Downtime**: Potential service disruption if clients' `stellar.toml` caches are stale or if clients hardcode the old public key.

### Procedure

1. **Generate a new Stellar keypair**:
   ```bash
   stellar keys generate --format json | jq '.public_key'
   ```
   or
   ```bash
   openssl rand -base64 32 | head -c 32 | base64 | xargs -I {} echo "SECRET_KEY: {}"
   ```
   (Use a proper Stellar key generator; do not use raw random bytes.)

2. **Update stellar.toml**:
   - Locate `.well-known/stellar.toml` on your web server.
   - Update the `SIGNING_KEY` field to the new public key.
   - Verify the old `SIGNING_KEY` is accessible during the transition (see step 5).

3. **Deploy the new secret**:
   - Set `SERVER_PRIVATE_KEY` in backend environment to the new private key.
   - Do NOT restart the server yet.

4. **Update DNS/HTTP cache**:
   - Ensure `stellar.toml` is served with low `Cache-Control` TTL (e.g., `max-age=300`).
   - Monitor DNS propagation for secondary federation domains if any.

5. **Restart the backend**:
   - Restart the backend process to cache the new keypair (`getServerKeypair()` in `src/routes/auth.js`).
   - Wait ~10 minutes for clients' `stellar.toml` caches to expire.

6. **Verification**:
   - New challenge requests are signed with the new key.
   - Fetch `stellar.toml` and confirm the `SIGNING_KEY` matches the public key of the new private key.
   - Test SEP-10 auth flow with a test wallet (e.g., Albedo, Freighter).

### Rollback

If clients report authentication failures:

1. Revert `SERVER_PRIVATE_KEY` to the old value.
2. Restart the backend.
3. Revert `stellar.toml` to the old `SIGNING_KEY`.
4. Confirm challenge signing works with the old key.

Rollback takes ~10 minutes (client cache expiration) plus restart time.

### Coordination with Clients

- **Direct clients** (your own frontend, mobile apps): Update them *after* `stellar.toml` and the backend are ready. Test in staging.
- **Third-party clients** (other services using your federation): Announce the rotation in advance. Provide a grace period in which both old and new keys are accepted (see dual-key support below).

### Dual Public Key Support (Grace Period)

To allow clients time to update their config without breaking mid-request:

1. Keep the old `SERVER_PRIVATE_KEY` deployed and skip step 3 (deploy new secret) initially.
2. Update `stellar.toml` to list *both* the old and new `SIGNING_KEY` values in a comment or separate field (if your toml allows it), or coordinate via federation documentation.
3. Wait 24+ hours for client-side caches to expire and clients to fetch the new `stellar.toml`.
4. *Then* deploy the new `SERVER_PRIVATE_KEY` and restart.
5. After another 24+ hours, remove the old public key from `stellar.toml`.

This eliminates the need for simultaneous client updates and allows third-party integrations to migrate at their own pace.

---

## PAYMENT_SIGNING_SECRET Rotation

**Purpose**: HMAC key for signing outbound requests (e.g., payment notifications to clients). Also validates inbound signed webhook requests.

**Impact**: All in-flight signed requests using the old secret are rejected. Clients and webhooks fail until they receive and use the new secret.

**Downtime**: Potential service disruption if clients or webhook subscribers are not updated simultaneously.

### Procedure

1. **Generate a new secret**:
   ```bash
   openssl rand -base64 48
   ```

2. **Plan a maintenance window**:
   - Coordinate with all clients and webhook subscribers.
   - Provide them with the new secret in advance (via secure channel, not in PRs or public docs).
   - Announce the rotation date and window (e.g., "2025-03-15 02:00–02:10 UTC").

3. **Distribute the new secret**:
   - Email or securely share the new secret with all integrators.
   - Give them time to update their configuration (at least 24 hours).

4. **Update the backend**:
   - Deploy a version of the backend that accepts *both* old and new `PAYMENT_SIGNING_SECRET`.
   - See dual-secret support below; implement it before rotation.

5. **Verify dual-secret acceptance**:
   - Test a webhook or payment request signed with the old secret; it should succeed.
   - Test with the new secret; it should also succeed.

6. **Notify clients**:
   - Send a reminder: "New secret is live. Old secret will be disabled on [date]."

7. **Disable the old secret**:
   - After 7–14 days (or your SLA window), update the backend to accept *only* the new secret.
   - Remove the old secret from the environment.
   - Redeploy and verify.

### Request Signing Flow

The backend signs outbound requests with `PAYMENT_SIGNING_SECRET` (see `src/utils/requestSignature.js`):

```javascript
const secret = process.env.PAYMENT_SIGNING_SECRET || DEFAULT_SECRET;
const signature = generateRequestSignature(
  { timestamp: Date.now(), method: "POST", path: "/webhook", body: JSON.stringify(payload) },
  secret
);
// Outbound request carries X-Signature and X-Timestamp headers
```

Clients verify the signature using the same secret. If the secret changes, their verification fails.

### Dual Secret Support

Update `src/utils/requestSignature.js` to try both secrets:

```javascript
function verifyRequestSignature(parts, options = {}) {
  const { secret = getSigningSecret(), ... } = options;
  const { secret_previous = process.env.PAYMENT_SIGNING_SECRET_PREVIOUS } = options;
  
  // Try current secret
  let result = attemptVerify(parts, secret);
  if (result.ok) return result;
  
  // Try previous secret if current fails
  if (secret_previous && secret_previous !== secret) {
    result = attemptVerify(parts, secret_previous);
    if (result.ok) return result;
  }
  
  return { ok: false, reason: "Invalid request signature", code: "invalid_signature" };
}
```

This allows the server to accept both old and new secrets for the duration of the rotation window.

### Rollback

If webhook subscribers report signature verification failures:

1. Verify the new secret was delivered correctly (check your email/notification logs).
2. Revert `PAYMENT_SIGNING_SECRET` to the old value and redeploy.
3. Confirm webhooks are signed with the old secret again.
4. Contact integrators to troubleshoot their configuration.

Rollback takes a few minutes plus verification.

---

## Checklist for Safe Rotation

### Before Any Rotation

- [ ] Notify stakeholders (users, integrators, support team).
- [ ] Schedule during low-traffic hours.
- [ ] Have a rollback procedure ready.
- [ ] Test in staging with the new secret.
- [ ] Ensure you can access the old secret if rollback is needed.

### JWT_SECRET

- [ ] Generate new secret: `openssl rand -base64 48`
- [ ] Update environment variable.
- [ ] Redeploy backend.
- [ ] Verify new logins receive valid tokens.
- [ ] Monitor error logs for 401 spikes.

### SERVER_PRIVATE_KEY

- [ ] Generate new keypair using a proper Stellar key generator.
- [ ] Update `.well-known/stellar.toml` with new public key.
- [ ] Verify `stellar.toml` is served with low cache TTL.
- [ ] Set `SERVER_PRIVATE_KEY` in backend environment.
- [ ] Restart backend.
- [ ] Wait 10+ minutes for client caches to expire.
- [ ] Test SEP-10 auth flow.
- [ ] Coordinate with third-party clients; provide grace period if possible.

### PAYMENT_SIGNING_SECRET

- [ ] Generate new secret: `openssl rand -base64 48`
- [ ] Implement dual-secret support (optional but recommended).
- [ ] Distribute new secret to all clients and webhook subscribers.
- [ ] Update environment variable.
- [ ] Redeploy backend with dual-secret support active.
- [ ] Verify both old and new secrets are accepted.
- [ ] After grace period, disable old secret and redeploy.

---

## Incident Response

### Scenario: JWT tokens stop validating (rollback needed)

1. Revert `JWT_SECRET` to the previous value.
2. Redeploy backend.
3. Confirm new logins succeed.
4. Users re-authenticate automatically.

**Time to recovery**: ~2 minutes.

### Scenario: Challenge signing fails (SERVER_PRIVATE_KEY issue)

1. Check `getServerKeypair()` in `src/routes/auth.js` — is the cache valid?
2. Verify `SERVER_PRIVATE_KEY` is set and is a valid Stellar secret key.
3. Check `.well-known/stellar.toml` — does `SIGNING_KEY` match the public key?
4. Revert `SERVER_PRIVATE_KEY` to the old value if uncertain.
5. Restart the backend.

**Time to recovery**: ~5 minutes + cache expiration.

### Scenario: Webhook requests are rejected (PAYMENT_SIGNING_SECRET issue)

1. Verify webhook subscriber is using the *current* secret from their config.
2. Check backend logs for signature mismatch errors.
3. If the old secret is still expected, deploy dual-secret support immediately.
4. Confirm webhook subscriber receives the new secret via their secure channel.

**Time to recovery**: ~5 minutes (dual support) or hours (coordination with subscriber).

---

## Automation & Monitoring

### Logging

Add logs when secrets are accessed or verified:

```javascript
// In auth.js
console.info(`JWT verification attempt for ${req.ip}`);

// In requestSignature.js
if (!result.ok) {
  console.warn(`Signature verification failed: ${result.reason}`);
}
```

Monitor for:
- Sudden spikes in 401 errors (JWT rotation gone wrong).
- Signature verification failures on webhook endpoints (PAYMENT_SIGNING_SECRET mismatch).

### Alerts

Set up alerts for:
- `>N` 401 errors in M minutes → potential JWT issue.
- `>N` signature verification failures in M minutes → potential secret issue.

### Testing

Add integration tests that verify:
- JWT token verification with current secret.
- Challenge signing with current SERVER_PRIVATE_KEY.
- Request signature verification with current PAYMENT_SIGNING_SECRET.

Rotate secrets in staging (point env to a dummy secret, then back) to verify rollback procedures work.

---

## References

- [Stellar SEP-0010: Stellar Web Authentication](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0021.md)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [HMAC-based Signatures](https://tools.ietf.org/html/rfc2104)
- Backend implementation: `backend/src/middleware/auth.js`, `backend/src/utils/requestSignature.js`, `backend/src/routes/auth.js`
