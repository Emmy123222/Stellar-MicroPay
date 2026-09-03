import { validateSecurityHeaders } from './security-headers.mjs';

const target = process.argv[2] || process.env.SECURITY_HEADERS_URL;
if (!target) {
  console.error('Usage: npm run check:security-headers -- https://example.com');
  process.exit(2);
}

let url;
try {
  url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
} catch {
  console.error(`Invalid deployment URL: ${target}`);
  process.exit(2);
}

try {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`response status ${response.status}`);
  const failures = validateSecurityHeaders(response.headers);
  if (failures.length) {
    console.error(`Security header check failed for ${response.url}:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Security headers verified at ${response.url}`);
  }
} catch (error) {
  console.error(`Could not verify ${url}: ${error.message}`);
  process.exitCode = 1;
}
