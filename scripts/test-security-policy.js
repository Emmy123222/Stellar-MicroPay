/**
 * Automated test suite for Security Audit & Dependency Policy compliance.
 * Validates CI workflows, CONTRIBUTING.md, and SECURITY.md against acceptance criteria:
 * 1. Define severity SLAs and exception ownership
 * 2. Use reviewed lockfile update PRs (prohibit npm audit fix --force)
 * 3. Fail CI only on actionable production findings (--omit=dev)
 * 4. Explicit Testnet/Mainnet network state requirements
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

console.log('\n🔒 Running Security Audit & Dependency Policy Test Suite...\n');

// ─── 1. CI Workflow Validation (.github/workflows/security-audit.yml) ─────────
console.log('--- CI Security Audit Workflow Tests ---');

const securityAuditPath = path.join(ROOT_DIR, '.github', 'workflows', 'security-audit.yml');
assert(fs.existsSync(securityAuditPath), 'security-audit.yml workflow must exist');
const securityAuditContent = fs.readFileSync(securityAuditPath, 'utf8');

runTest('security-audit.yml exists and is readable', () => {
  assert.ok(securityAuditContent.length > 0);
});

runTest('security-audit.yml scopes production audit with --omit=dev', () => {
  assert.match(
    securityAuditContent,
    /npm\s+audit\s+--omit=dev/i,
    'Production audit step must include --omit=dev to audit only production dependencies'
  );
});

runTest('security-audit.yml sets production audit level threshold to high', () => {
  assert.match(
    securityAuditContent,
    /--audit-level=high/,
    'Production audit step must specify --audit-level=high'
  );
});

runTest('security-audit.yml never executes --force in any npm audit command', () => {
  // Strip comments and echo strings to check actual executable command invocations
  const executableLines = securityAuditContent
    .split('\n')
    .filter((line) => !line.trim().startsWith('#') && !line.includes('echo "') && !line.includes("echo '"))
    .join('\n');
  assert.doesNotMatch(
    executableLines,
    /^\s*run:\s*.*npm\s+audit.*--force/im,
    'Workflow must never run npm audit with --force'
  );
  assert.doesNotMatch(
    executableLines,
    /npm\s+audit\s+fix\s+--force/i,
    'Workflow must never execute npm audit fix --force'
  );
});

runTest('security-audit.yml includes non-blocking dev dependencies advisory step', () => {
  assert.match(
    securityAuditContent,
    /continue-on-error:\s*true/,
    'Dev dependency advisory step must use continue-on-error: true so non-actionable dev findings do not block CI'
  );
});

// ─── 2. All Workflows Scan for Unsafe Flags ─────────────────────────────────
console.log('\n--- Global Workflow Security Scans ---');

const workflowsDir = path.join(ROOT_DIR, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

runTest('No GitHub workflow executes npm audit fix --force as a command', () => {
  for (const file of workflowFiles) {
    const filePath = path.join(workflowsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const executableLines = content
      .split('\n')
      .filter((line) => !line.trim().startsWith('#') && !line.includes('echo "') && !line.includes("echo '"))
      .join('\n');
    assert.doesNotMatch(
      executableLines,
      /npm\s+audit\s+fix\s+--force/i,
      `Workflow ${file} must not execute npm audit fix --force`
    );
  }
});

// ─── 3. CONTRIBUTING.md Policy Verification ─────────────────────────────────
console.log('\n--- CONTRIBUTING.md Policy Verification ---');

const contributingPath = path.join(ROOT_DIR, 'CONTRIBUTING.md');
assert(fs.existsSync(contributingPath), 'CONTRIBUTING.md must exist');
const contributingContent = fs.readFileSync(contributingPath, 'utf8');

runTest('CONTRIBUTING.md contains Dependency Management & Security Remediation Policy', () => {
  assert.match(
    contributingContent,
    /##\s*🛡️?\s*Dependency Management & Security Remediation Policy/i,
    'CONTRIBUTING.md must have a Dependency Management & Security Remediation Policy section'
  );
});

runTest('CONTRIBUTING.md strictly prohibits npm audit fix --force', () => {
  assert.match(
    contributingContent,
    /npm\s+audit\s+fix\s+--force/i,
    'CONTRIBUTING.md must explicitly mention npm audit fix --force prohibition'
  );
  assert.match(
    contributingContent,
    /prohibit|never run|strictly/i,
    'CONTRIBUTING.md must state that npm audit fix --force is prohibited'
  );
});

runTest('CONTRIBUTING.md defines reviewed lockfile update PR guidelines', () => {
  assert.match(
    contributingContent,
    /Reviewed Lockfile Update PRs/i,
    'CONTRIBUTING.md must have Reviewed Lockfile Update PRs section'
  );
  assert.match(
    contributingContent,
    /package-lock\.json/i,
    'CONTRIBUTING.md must mention package-lock.json review'
  );
});

runTest('CONTRIBUTING.md defines Severity SLAs table for Critical, High, Medium, and Low', () => {
  assert.match(contributingContent, /Severity SLAs/i);
  assert.match(contributingContent, /Critical/i);
  assert.match(contributingContent, /High/i);
  assert.match(contributingContent, /Medium/i);
  assert.match(contributingContent, /Low/i);
  assert.match(contributingContent, /24 hours/i, 'Critical triage SLA must be specified');
  assert.match(contributingContent, /7 days/i, 'Critical remediation SLA must be specified');
  assert.match(contributingContent, /14 days/i, 'High remediation SLA must be specified');
  assert.match(contributingContent, /30 days/i, 'Medium remediation SLA must be specified');
});

runTest('CONTRIBUTING.md defines Exception Ownership and Security Waiver process', () => {
  assert.match(contributingContent, /Exception Ownership/i);
  assert.match(contributingContent, /Repository Maintainers|Security Leads/i);
  assert.match(contributingContent, /Compensating Controls/i);
  assert.match(contributingContent, /90 days/i, 'Exceptions must be time-bound up to 90 days');
  assert.match(contributingContent, /security-exception|tracking issue/i);
});

runTest('CONTRIBUTING.md specifies explicit Testnet vs Mainnet network state behavior', () => {
  assert.match(contributingContent, /Testnet/i);
  assert.match(contributingContent, /Mainnet/i);
  assert.match(
    contributingContent,
    /Explicit Network State Behavior/i,
    'Must have section on explicit Testnet/Mainnet behavior'
  );
});

// ─── 4. SECURITY.md Verification ───────────────────────────────────────────
console.log('\n--- SECURITY.md Verification ---');

const securityPath = path.join(ROOT_DIR, 'SECURITY.md');
assert(fs.existsSync(securityPath), 'SECURITY.md must exist');
const securityContent = fs.readFileSync(securityPath, 'utf8');

runTest('SECURITY.md defines Severity Remediation SLAs', () => {
  assert.match(securityContent, /Remediation/i);
  assert.match(securityContent, /Critical/i);
  assert.match(securityContent, /High/i);
  assert.match(securityContent, /7 days/i);
  assert.match(securityContent, /14 days/i);
});

runTest('SECURITY.md references Exception Ownership and CONTRIBUTING.md policy', () => {
  assert.match(securityContent, /Exception Ownership/i);
  assert.match(securityContent, /CONTRIBUTING\.md/i);
  assert.match(securityContent, /npm audit fix --force/i);
});

// ─── Results Summary ────────────────────────────────────────────────────────
console.log('\n==================================================');
console.log(`Results: ${passedTests}/${totalTests} tests passed (${failedTests} failures)`);
console.log('==================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
