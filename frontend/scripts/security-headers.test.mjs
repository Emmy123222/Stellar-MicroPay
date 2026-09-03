import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSecurityHeaders } from './security-headers.mjs';

const valid = {
  'content-security-policy': "default-src 'self'; object-src 'none'; frame-ancestors 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
};

test('accepts a complete deployed header policy', () => {
  assert.deepEqual(validateSecurityHeaders(new Headers(valid)), []);
});

test('reports missing headers', () => {
  assert.deepEqual(validateSecurityHeaders(new Headers()), Object.keys(valid).map((name) => `${name}: missing`));
});

test('reports incomplete CSP and permissions policies', () => {
  const headers = new Headers(valid);
  headers.set('content-security-policy', "default-src 'self'");
  headers.set('permissions-policy', 'camera=()');
  const failures = validateSecurityHeaders(headers);
  assert.ok(failures.includes("content-security-policy: missing object-src 'none'"));
  assert.ok(failures.includes('permissions-policy: missing microphone=()'));
});
