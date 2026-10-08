# Security Policy

## Supported versions

Security fixes land on `develop` and are released from `main`. Older release lines are not patched — please upgrade to the latest release before reporting an issue that only affects an old version.

| Version | Supported |
| --- | --- |
| `develop` / latest `main` | ✅ |
| Previous release | ❌ |
| Anything older | ❌ |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Machine-readable contact details are published at
[`/.well-known/security.txt`](./frontend/public/.well-known/security.txt).

1. Use GitHub's private vulnerability reporting on this repository (**Security** → **Advisories** → **Report a vulnerability**) so the report is only visible to the maintainers.
2. If private reporting is unavailable, contact the maintainers through their GitHub profiles first and agree on a disclosure date before anything is made public. You can also report by email to **emmanuelogheneovo17@gmail.com**.
3. Include the affected component (`frontend/`, `backend/`, or `contracts/stellar-micropay-contract/`), reproduction steps, and the impact you observed.

Please give the maintainers a reasonable window to ship a fix before disclosing. We will acknowledge a report and confirm the fix once it is released.

When reporting, please include:

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

## Disclosure Policy

We follow **coordinated disclosure**:

1. Reporter notifies us privately.
2. We investigate and develop a fix, targeting a patch release within **14 days** for
   Critical/High issues and **30 days** for Medium/Low.
3. We publish a patched release and credit the reporter in the changelog (unless
   they prefer anonymity).
4. Reporter may publish their findings 7 days after the patch is released, or sooner
   by mutual agreement.

## Preferred Languages

Reports in **English** are preferred, though we will do our best with other languages.

## Recognition

We gratefully acknowledge security reporters in our
[CHANGELOG](./CHANGELOG.md) under the release that includes their fix.

## Automated vulnerability scanning

Dependency scanning runs automatically on every push and pull request, and no step is allowed to be skipped:

| Check | Command | Runs in | Fails on |
| --- | --- | --- | --- |
| Frontend audit | `npm audit --audit-level=high` | `.github/workflows/ci.yml` → `frontend` job | HIGH or CRITICAL |
| Backend audit | `npm audit --audit-level=high` | `.github/workflows/ci.yml` → `backend` job | HIGH or CRITICAL |
| Contract audit | `cargo audit` (via [`rustsec/audit-check`](https://github.com/rustsec/audit-check)) | `.github/workflows/ci.yml` → `contracts` job | any vulnerability advisory |

`cargo audit` has no severity threshold, so it is not scoped the way the npm checks are: it fails the build on any *vulnerability* advisory, whatever the severity. Advisories that only flag an unmaintained or informational crate — for example `RUSTSEC-2024-0436` for `paste`, pulled in transitively by the Soroban SDK's build dependencies — are printed as warnings and do not fail the build. The same three checks also run on a weekly schedule in [`.github/workflows/security-audit.yml`](.github/workflows/security-audit.yml) to catch advisories published after a dependency was last touched.

Static analysis runs alongside these: [CodeQL](.github/workflows/codeql.yml) for JavaScript/TypeScript and Rust, and [Gitleaks](.github/workflows/gitleaks.yml) for committed secrets.

Reproduce the audit locally before pushing:

```bash
cd frontend && npm ci && npm audit --audit-level=high
cd backend  && npm ci && npm audit --audit-level=high
cargo install cargo-audit        # first run only
cargo audit                      # from the repo root; reads the workspace Cargo.lock