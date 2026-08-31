# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| older tags | ❌ — please upgrade |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities by email to **Emmy123222** via the contact on the
[GitHub profile](https://github.com/Emmy123222). Include:

1. A concise description of the vulnerability and its potential impact.
2. Steps to reproduce or a proof-of-concept (PoC) — a minimal code snippet is ideal.
3. The version / commit hash where you observed the issue.
4. Your suggested severity (Critical / High / Medium / Low).

We will acknowledge receipt within **48 hours** and aim to provide an initial
assessment within **5 business days**.

## Scope

In-scope for this policy:

- `contracts/stellar-micropay-contract/` — the Soroban smart contract
- Backend API (`backend/`)
- Frontend (`frontend/`)
- Any dependency vulnerability that directly affects users of this project

Out of scope:

- Stellar protocol-level issues — report those to the [Stellar Bug Bounty](https://www.stellar.org/bug-bounty-program)
- Issues in third-party services (Vercel, Docker Hub, etc.)
- Theoretical vulnerabilities without a practical attack path

## Disclosure & Remediation Policy

We follow **coordinated disclosure** and adhere to defined severity SLAs:

| Severity | CVSS Score | Triage SLA | Remediation & Patch SLA |
|---|---|---|---|
| **Critical** | 9.0 – 10.0 | **24 hours** | **7 days** (48h hotfix for active exploits) |
| **High** | 7.0 – 8.9 | **48 hours** | **14 days** |
| **Medium** | 4.0 – 6.9 | **5 business days** | **30 days** |
| **Low / Info** | 0.1 – 3.9 | **10 business days** | **60–90 days** |

1. Reporter notifies us privately.
2. We investigate and develop a fix following the target SLAs above.
3. We publish a patched release and credit the reporter in the changelog (unless they prefer anonymity).
4. Reporter may publish their findings 7 days after the patch is released, or sooner by mutual agreement.

## Dependency Security & Exceptions

- **Automated Fix Policy**: As detailed in [CONTRIBUTING.md](./CONTRIBUTING.md#dependency-management--security-remediation-policy), `npm audit fix --force` is strictly prohibited to prevent silent breaking major upgrades.
- **Reviewed Lockfile Updates**: All dependency updates must be submitted via reviewed lockfile update PRs.
- **Exception Ownership**: Security waivers or deferred remediations must be approved by **Repository Maintainers** and **Security Leads**, require documented compensating controls, and have a maximum time-bound duration of **90 days**.


## Preferred Languages

Reports in **English** are preferred, though we will do our best with other languages.

## Recognition

We gratefully acknowledge security reporters in our
[CHANGELOG](./CHANGELOG.md) under the release that includes their fix.
