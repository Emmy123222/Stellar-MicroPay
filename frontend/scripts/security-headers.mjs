export const REQUIRED_SECURITY_HEADERS = {
  'content-security-policy': ["default-src 'self'", "object-src 'none'", "frame-ancestors 'self'"],
  'x-content-type-options': ['nosniff'],
  'x-frame-options': ['SAMEORIGIN'],
  'referrer-policy': ['strict-origin-when-cross-origin'],
  'permissions-policy': ['camera=()', 'microphone=()', 'geolocation=()'],
  'cross-origin-opener-policy': ['same-origin'],
};

export function validateSecurityHeaders(headers) {
  const failures = [];
  for (const [name, expectedParts] of Object.entries(REQUIRED_SECURITY_HEADERS)) {
    const value = headers.get(name);
    if (!value) {
      failures.push(`${name}: missing`);
      continue;
    }
    for (const expected of expectedParts) {
      if (!value.includes(expected)) failures.push(`${name}: missing ${expected}`);
    }
  }
  return failures;
}
