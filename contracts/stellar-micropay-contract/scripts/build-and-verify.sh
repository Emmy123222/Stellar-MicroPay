#!/usr/bin/env bash
# ==============================================================================
# build-and-verify.sh — Reproducible WASM Build & Size Ceiling Enforcement (#806)
# ==============================================================================
# Builds the Soroban contract WASM binary twice from clean target directories,
# verifies bit-for-bit SHA-256 hash reproducibility, and enforces a strict
# size ceiling budget (default: 64 KB / 65,536 bytes).
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Configuration
TARGET="${TARGET:-wasm32v1-none}"
MAX_SIZE_BYTES="${MAX_SIZE_BYTES:-65536}" # 64 KB ceiling
CONTRACT_NAME="stellar_micropay_contract"
FINAL_TARGET_DIR="${CONTRACT_DIR}/target"
FINAL_OUTPUT_DIR="${FINAL_TARGET_DIR}/${TARGET}/release"

cd "${CONTRACT_DIR}"

echo "======================================================================"
echo " Stellar MicroPay Contract — Reproducible WASM Build & Size Verifier"
echo "======================================================================"
echo " Contract Directory : ${CONTRACT_DIR}"
echo " Target Architecture: ${TARGET}"
echo " Size Ceiling Budget: ${MAX_SIZE_BYTES} bytes ($((MAX_SIZE_BYTES / 1024)) KB)"
echo " Toolchain Version  : $(rustc --version)"
echo "======================================================================"

# Create isolated temporary build directories
BUILD1_DIR="$(mktemp -d /tmp/wasm_build1_XXXXXX)"
BUILD2_DIR="$(mktemp -d /tmp/wasm_build2_XXXXXX)"

cleanup() {
  rm -rf "${BUILD1_DIR}" "${BUILD2_DIR}"
}
trap cleanup EXIT

echo "--> [1/4] Running Build 1..."
cargo build --target "${TARGET}" --release --target-dir "${BUILD1_DIR}" --quiet
WASM1="${BUILD1_DIR}/${TARGET}/release/${CONTRACT_NAME}.wasm"

if [ ! -f "${WASM1}" ]; then
  echo "[-] ERROR: Build 1 failed to produce ${WASM1}" >&2
  exit 1
fi

HASH1="$(shasum -a 256 "${WASM1}" | awk '{print $1}')"
SIZE1="$(wc -c < "${WASM1}" | tr -d ' ')"
echo "    Build 1 WASM Size: ${SIZE1} bytes ($((SIZE1 / 1024)) KB)"
echo "    Build 1 SHA-256  : ${HASH1}"

echo "--> [2/4] Running Build 2 (clean independent target)..."
cargo build --target "${TARGET}" --release --target-dir "${BUILD2_DIR}" --quiet
WASM2="${BUILD2_DIR}/${TARGET}/release/${CONTRACT_NAME}.wasm"

if [ ! -f "${WASM2}" ]; then
  echo "[-] ERROR: Build 2 failed to produce ${WASM2}" >&2
  exit 1
fi

HASH2="$(shasum -a 256 "${WASM2}" | awk '{print $1}')"
SIZE2="$(wc -c < "${WASM2}" | tr -d ' ')"
echo "    Build 2 WASM Size: ${SIZE2} bytes ($((SIZE2 / 1024)) KB)"
echo "    Build 2 SHA-256  : ${HASH2}"

echo "--> [3/4] Verifying Deterministic Reproducibility..."
if [ "${HASH1}" != "${HASH2}" ]; then
  echo "[-] ERROR: Non-deterministic build detected!" >&2
  echo "    Build 1 Hash: ${HASH1}" >&2
  echo "    Build 2 Hash: ${HASH2}" >&2
  exit 1
fi

if [ "${SIZE1}" != "${SIZE2}" ]; then
  echo "[-] ERROR: Build size mismatch detected (${SIZE1} vs ${SIZE2} bytes)!" >&2
  exit 1
fi
echo "    [+] PASSED: Both independent builds produced identical SHA-256 hashes."

echo "--> [4/4] Enforcing Size Ceiling..."
if [ "${SIZE1}" -gt "${MAX_SIZE_BYTES}" ]; then
  echo "[-] ERROR: WASM size (${SIZE1} bytes) exceeds ceiling limit of ${MAX_SIZE_BYTES} bytes ($((MAX_SIZE_BYTES / 1024)) KB)!" >&2
  echo "    Overage: $((SIZE1 - MAX_SIZE_BYTES)) bytes" >&2
  exit 1
fi
echo "    [+] PASSED: WASM size (${SIZE1} bytes) is within ${MAX_SIZE_BYTES} byte budget ($((MAX_SIZE_BYTES - SIZE1)) bytes headroom)."

# Copy artifacts to final destination
mkdir -p "${FINAL_OUTPUT_DIR}"
cp "${WASM1}" "${FINAL_OUTPUT_DIR}/${CONTRACT_NAME}.wasm"
echo "${HASH1}  ${CONTRACT_NAME}.wasm" > "${FINAL_OUTPUT_DIR}/${CONTRACT_NAME}.wasm.sha256"

# Generate structured JSON report
REPORT_FILE="${FINAL_TARGET_DIR}/wasm_build_report.json"
cat <<EOF > "${REPORT_FILE}"
{
  "contract": "${CONTRACT_NAME}",
  "target": "${TARGET}",
  "sha256": "${HASH1}",
  "size_bytes": ${SIZE1},
  "size_ceiling_bytes": ${MAX_SIZE_BYTES},
  "headroom_bytes": $((MAX_SIZE_BYTES - SIZE1)),
  "reproducible": true,
  "size_passed": true,
  "rustc_version": "$(rustc --version)",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "======================================================================"
echo " [SUCCESS] Reproducible WASM Build & Size Verification Completed"
echo "======================================================================"
echo " Output Artifact : ${FINAL_OUTPUT_DIR}/${CONTRACT_NAME}.wasm"
echo " Checksum File   : ${FINAL_OUTPUT_DIR}/${CONTRACT_NAME}.wasm.sha256"
echo " Build Report    : ${REPORT_FILE}"
echo " Final SHA-256   : ${HASH1}"
echo " Final Size      : ${SIZE1} bytes ($((SIZE1 / 1024)) KB)"
echo "======================================================================"

# If running in GitHub Actions, emit job summary
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  cat <<EOF >> "${GITHUB_STEP_SUMMARY}"
### 📦 Soroban WASM Build & Size Attestation (#806)

| Metric | Value |
| :--- | :--- |
| **Contract** | \`${CONTRACT_NAME}\` |
| **Target** | \`${TARGET}\` |
| **SHA-256 Hash** | \`${HASH1}\` |
| **Size** | **${SIZE1} bytes** ($((SIZE1 / 1024)) KB) |
| **Size Ceiling** | **${MAX_SIZE_BYTES} bytes** ($((MAX_SIZE_BYTES / 1024)) KB) |
| **Headroom** | **$((MAX_SIZE_BYTES - SIZE1)) bytes** |
| **Reproducibility** | ✅ Verified (Deterministic double-build match) |
| **Budget Status** | ✅ Passed |
EOF
fi
