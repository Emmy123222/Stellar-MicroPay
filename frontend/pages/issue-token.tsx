/**
 * pages/issue-token.tsx
 * Five-step wizard for issuing a custom Stellar asset.
 *
 *   1. Asset code       — validated 1–12 uppercase A–Z / 0–9 characters
 *   2. Issuer           — defaults to the connected wallet
 *   3. Distribute       — distributor creates a trustline for the asset
 *   4. Issue            — issuer sends the asset to the distributor
 *   5. Finalise         — optional home domain + stellar.toml, then a summary
 *
 * Steps 3, 4 and 5 each build and sign their own transaction through Freighter.
 */

import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import type { Transaction } from "@stellar/stellar-sdk";
import WalletConnect from "@/components/WalletConnect";
import {
  ASSET_CODE_MAX_LENGTH,
  NETWORK,
  assetExplorerUrl,
  buildAssetIssueTransaction,
  buildChangeTrustTransaction,
  buildHomeDomainTransaction,
  buildStellarToml,
  explorerUrl,
  isValidStellarAddress,
  shortenAddress,
  stellarTomlUrl,
  submitTransaction,
  validateAssetCode,
  validateHomeDomain,
} from "@/lib/stellar";
import { getConnectedPublicKey, signTransactionWithWallet } from "@/lib/wallet";
import { useWallet } from "@/lib/useWallet";
import { copyToClipboard } from "@/utils/format";

const WIZARD_STEPS = [
  { id: 1, title: "Asset code", hint: "1–12 uppercase characters" },
  { id: 2, title: "Issuer", hint: "Account that issues the asset" },
  { id: 3, title: "Distribute", hint: "Distributor trustline" },
  { id: 4, title: "Issue", hint: "Send the asset" },
  { id: 5, title: "Finalise", hint: "Home domain and summary" },
] as const;

type StepId = (typeof WIZARD_STEPS)[number]["id"];

interface IssuanceTransactions {
  trustline?: string;
  issue?: string;
  homeDomain?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export default function IssueTokenPage() {
  const { publicKey } = useWallet();

  const [step, setStep] = useState<StepId>(1);
  const [assetCode, setAssetCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const [distributor, setDistributor] = useState("");
  const [amount, setAmount] = useState("1000");
  const [homeDomain, setHomeDomain] = useState("");
  const [trustlineSkipped, setTrustlineSkipped] = useState(false);
  const [transactions, setTransactions] = useState<IssuanceTransactions>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Default the issuer to the connected wallet (issue #1147 step 2).
  useEffect(() => {
    if (publicKey && !issuer) setIssuer(publicKey);
  }, [publicKey, issuer]);

  const codeError = useMemo(
    () => (assetCode ? validateAssetCode(assetCode) : null),
    [assetCode]
  );
  const issuerError =
    issuer && !isValidStellarAddress(issuer)
      ? "Enter a valid Stellar public key (G…)."
      : null;
  const distributorError = distributor
    ? !isValidStellarAddress(distributor)
      ? "Enter a valid Stellar public key (G…)."
      : distributor === issuer
      ? "The distributor must be a different account than the issuer."
      : null
    : null;
  const amountError =
    amount && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
      ? "Enter an amount greater than 0."
      : null;
  const homeDomainError = validateHomeDomain(homeDomain);

  const canContinue = (() => {
    switch (step) {
      case 1:
        return validateAssetCode(assetCode) === null;
      case 2:
        return isValidStellarAddress(issuer);
      case 3:
        return (
          isValidStellarAddress(distributor) &&
          distributor !== issuer &&
          (Boolean(transactions.trustline) || trustlineSkipped)
        );
      case 4:
        return (
          Number.isFinite(Number(amount)) &&
          Number(amount) > 0 &&
          Boolean(transactions.issue)
        );
      default:
        return homeDomainError === null;
    }
  })();

  const toml = useMemo(
    () =>
      buildStellarToml({
        homeDomain,
        assetCode: assetCode || "ASSET",
        issuerPublicKey: issuer || "G…",
        network: NETWORK === "mainnet" ? "mainnet" : "testnet",
      }),
    [homeDomain, assetCode, issuer]
  );

  /** Sign with Freighter (verifying the active account) and submit. */
  const signAndSubmit = async (
    build: () => Promise<Transaction>,
    expectedSigner: string
  ): Promise<string> => {
    const transaction = await build();

    const activeAccount = await getConnectedPublicKey();
    if (activeAccount && activeAccount !== expectedSigner) {
      throw new Error(
        `Freighter is currently on ${shortenAddress(activeAccount)}. Switch it to ${shortenAddress(expectedSigner)} and try again.`
      );
    }

    const { signedXDR, error: signError } = await signTransactionWithWallet(
      transaction.toXDR()
    );
    if (signError || !signedXDR) {
      throw new Error(signError || "Transaction signing was cancelled.");
    }

    const result = await submitTransaction(signedXDR);
    return result.hash;
  };

  const runStep = async (action: () => Promise<string>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(successMessage);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTrustline = () =>
    runStep(async () => {
      const hash = await signAndSubmit(
        () =>
          buildChangeTrustTransaction({
            fromPublicKey: distributor.trim(),
            assetCode,
            issuer: issuer.trim(),
          }),
        distributor.trim()
      );
      setTransactions((current) => ({ ...current, trustline: hash }));
      return hash;
    }, "Distributor trustline created.");

  const handleIssue = () =>
    runStep(async () => {
      const hash = await signAndSubmit(
        () =>
          buildAssetIssueTransaction({
            issuerPublicKey: issuer.trim(),
            distributorPublicKey: distributor.trim(),
            assetCode,
            amount: Number(amount).toFixed(7),
          }),
        issuer.trim()
      );
      setTransactions((current) => ({ ...current, issue: hash }));
      return hash;
    }, "Asset issued to the distributor.");

  const handleSetHomeDomain = () =>
    runStep(async () => {
      const domain = homeDomain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
      const hash = await signAndSubmit(
        () => buildHomeDomainTransaction({ publicKey: issuer.trim(), homeDomain: domain }),
        issuer.trim()
      );
      setTransactions((current) => ({ ...current, homeDomain: hash }));
      return hash;
    }, "Home domain set on the issuer account.");

  const handleCopyToml = async () => {
    const ok = await copyToClipboard(toml);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  if (!publicKey) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">
            Issue a Token
          </h1>
          <p className="text-slate-400">
            Connect your wallet to issue a custom Stellar asset.
          </p>
        </div>
        <WalletConnect />
      </div>
    );
  }

  const currentStep = WIZARD_STEPS.find((entry) => entry.id === step)!;

  return (
    <>
      <Head>
        <title>Issue a Token | Stellar-MicroPay</title>
        <meta
          name="description"
          content="Issue a custom Stellar asset: pick an asset code, set the issuer and distributor, create a trustline, issue the asset and publish a stellar.toml."
        />
      </Head>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-white mb-1">
            Issue a Token
          </h1>
          <p className="text-slate-400 text-sm">
            Create your own Stellar asset in five steps on{" "}
            <span className="font-mono text-slate-300">{NETWORK}</span>.
          </p>
        </div>

        {/* Step indicator */}
        <ol
          className="mb-8 grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs"
          aria-label="Issuance progress"
        >
          {WIZARD_STEPS.map((entry) => {
            const isCurrent = entry.id === step;
            const isDone = entry.id < step;
            return (
              <li
                key={entry.id}
                aria-current={isCurrent ? "step" : undefined}
                className={`rounded-lg border px-3 py-2 ${
                  isCurrent
                    ? "border-stellar-500/40 bg-stellar-500/10 text-stellar-200"
                    : isDone
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                    : "border-white/10 bg-white/5 text-slate-400"
                }`}
              >
                <span className="block font-medium">
                  {entry.id}. {entry.title}
                </span>
                <span className="block text-[11px] text-slate-500">
                  {entry.hint}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="card">
          <h2 className="font-display text-xl font-semibold text-white mb-1">
            Step {currentStep.id} of {WIZARD_STEPS.length}: {currentStep.title}
          </h2>
          <p className="text-sm text-slate-400 mb-6">{currentStep.hint}</p>

          {error && (
            <p
              className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              role="alert"
            >
              {error}
            </p>
          )}
          {success && (
            <p
              className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
              role="status"
            >
              {success}
            </p>
          )}

          {/* ── Step 1: asset code ─────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-3">
              <label
                htmlFor="asset-code"
                className="block text-sm font-medium text-slate-300"
              >
                Asset code
              </label>
              <input
                id="asset-code"
                value={assetCode}
                onChange={(event) => setAssetCode(event.target.value.toUpperCase())}
                maxLength={ASSET_CODE_MAX_LENGTH}
                placeholder="COOL"
                aria-invalid={Boolean(codeError)}
                aria-describedby="asset-code-help"
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white font-mono uppercase focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              />
              <p id="asset-code-help" className="text-xs text-slate-500">
                1–{ASSET_CODE_MAX_LENGTH} characters, uppercase letters and numbers
                only. No spaces. <span className="font-mono">XLM</span> is reserved.
              </p>
              {codeError && (
                <p className="text-xs text-red-400" role="alert">
                  {codeError}
                </p>
              )}
            </div>
          )}

          {/* ── Step 2: issuer ─────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3">
              <label
                htmlFor="issuer"
                className="block text-sm font-medium text-slate-300"
              >
                Issuer account
              </label>
              <input
                id="issuer"
                value={issuer}
                onChange={(event) => setIssuer(event.target.value.trim())}
                aria-invalid={Boolean(issuerError)}
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white font-mono text-sm focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              />
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setIssuer(publicKey)}
                  className="text-stellar-400 hover:text-stellar-300"
                >
                  Use connected wallet
                </button>
                <span className="text-slate-500">
                  {issuer === publicKey
                    ? "Using your connected wallet."
                    : "Signing steps 4 and 5 requires Freighter on this account."}
                </span>
              </div>
              {issuerError && (
                <p className="text-xs text-red-400" role="alert">
                  {issuerError}
                </p>
              )}
            </div>
          )}

          {/* ── Step 3: distribute ─────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-3">
                <label
                  htmlFor="distributor"
                  className="block text-sm font-medium text-slate-300"
                >
                  Distributor account
                </label>
                <input
                  id="distributor"
                  value={distributor}
                  onChange={(event) => setDistributor(event.target.value.trim())}
                  aria-invalid={Boolean(distributorError)}
                  placeholder="G…"
                  className="w-full px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white font-mono text-sm focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
                />
                {distributorError && (
                  <p className="text-xs text-red-400" role="alert">
                    {distributorError}
                  </p>
                )}
              </div>

              <p className="text-xs text-slate-500">
                The distributor must sign this trustline itself, so switch
                Freighter to the distributor account before signing. You can
                import a second account into Freighter for this.
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleCreateTrustline}
                  disabled={busy || !distributor || Boolean(distributorError)}
                  className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy ? "Waiting for signature…" : "Create trustline"}
                </button>
                <button
                  type="button"
                  onClick={() => setTrustlineSkipped(true)}
                  className="btn-secondary"
                >
                  Distributor already trusts {assetCode || "this asset"}
                </button>
              </div>

              {transactions.trustline && (
                <p className="text-xs text-emerald-300">
                  Trustline transaction:{" "}
                  <a
                    href={explorerUrl(transactions.trustline)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono underline underline-offset-2"
                  >
                    {transactions.trustline.slice(0, 12)}…
                  </a>
                </p>
              )}
            </div>
          )}

          {/* ── Step 4: issue ─────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-3">
              <label
                htmlFor="issue-amount"
                className="block text-sm font-medium text-slate-300"
              >
                Amount of {assetCode} to issue
              </label>
              <input
                id="issue-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                aria-invalid={Boolean(amountError)}
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white font-mono focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
              />
              {amountError && (
                <p className="text-xs text-red-400" role="alert">
                  {amountError}
                </p>
              )}
              <p className="text-xs text-slate-500">
                This payment moves {assetCode || "the asset"} from{" "}
                <span className="font-mono">{shortenAddress(issuer)}</span> to{" "}
                <span className="font-mono">{shortenAddress(distributor)}</span>.
              </p>

              <button
                type="button"
                onClick={handleIssue}
                disabled={busy || Boolean(amountError)}
                className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? "Waiting for signature…" : `Issue ${assetCode}`}
              </button>

              {transactions.issue && (
                <p className="text-xs text-emerald-300">
                  Issuance transaction:{" "}
                  <a
                    href={explorerUrl(transactions.issue)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono underline underline-offset-2"
                  >
                    {transactions.issue.slice(0, 12)}…
                  </a>
                </p>
              )}
            </div>
          )}

          {/* ── Step 5: finalise ──────────────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-6">
              <div className="space-y-3">
                <label
                  htmlFor="home-domain"
                  className="block text-sm font-medium text-slate-300"
                >
                  Home domain (optional)
                </label>
                <div className="flex flex-wrap gap-3">
                  <input
                    id="home-domain"
                    value={homeDomain}
                    onChange={(event) => setHomeDomain(event.target.value.trim())}
                    placeholder="example.com"
                    aria-invalid={Boolean(homeDomainError)}
                    className="flex-1 min-w-[12rem] px-3 py-2 rounded-lg border border-white/10 bg-cosmos-900 text-white focus:ring-2 focus:ring-stellar-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={handleSetHomeDomain}
                    disabled={busy || Boolean(homeDomainError) || !homeDomain}
                    className="btn-secondary disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {busy ? "Waiting for signature…" : "Set home domain"}
                  </button>
                </div>
                {homeDomainError && (
                  <p className="text-xs text-red-400" role="alert">
                    {homeDomainError}
                  </p>
                )}
                {transactions.homeDomain && (
                  <p className="text-xs text-emerald-300">
                    Home domain set:{" "}
                    <a
                      href={explorerUrl(transactions.homeDomain)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono underline underline-offset-2"
                    >
                      {transactions.homeDomain.slice(0, 12)}…
                    </a>
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="font-display text-base font-semibold text-white mb-3">
                  stellar.toml
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  Publish this file at{" "}
                  <span className="font-mono text-slate-300">
                    {stellarTomlUrl(homeDomain || "yourdomain.com")}
                  </span>{" "}
                  so wallets and explorers can discover the asset.
                </p>
                <pre className="max-h-56 overflow-auto rounded-lg bg-cosmos-900 p-3 text-[11px] leading-relaxed text-slate-300">
                  {toml}
                </pre>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" onClick={handleCopyToml} className="btn-secondary">
                    {copied ? "Copied!" : "Copy stellar.toml"}
                  </button>
                  <a
                    href={`data:text/plain;charset=utf-8,${encodeURIComponent(toml)}`}
                    download="stellar.toml"
                    className="btn-secondary"
                  >
                    Download stellar.toml
                  </a>
                </div>
              </div>

              {/* Asset summary */}
              <div className="rounded-xl border border-stellar-500/20 bg-stellar-500/5 p-4">
                <h3 className="font-display text-base font-semibold text-white mb-3">
                  {assetCode} issued
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Asset code
                    </dt>
                    <dd className="font-mono text-white">{assetCode}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Network
                    </dt>
                    <dd className="font-mono text-white">{NETWORK}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Issuer
                    </dt>
                    <dd className="font-mono text-white break-all">{issuer}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Distributor
                    </dt>
                    <dd className="font-mono text-white break-all">{distributor}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Amount issued
                    </dt>
                    <dd className="font-mono text-white">
                      {Number(amount).toLocaleString("en-US")} {assetCode}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Home domain
                    </dt>
                    <dd className="font-mono text-white">{homeDomain || "—"}</dd>
                  </div>
                </dl>

                <a
                  href={assetExplorerUrl(assetCode, issuer)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary mt-4 inline-flex"
                >
                  View {assetCode} on Stellar Expert ↗
                </a>
              </div>
            </div>
          )}

          {/* ── Navigation ────────────────────────────────────────────── */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-white/10 pt-5">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuccess(null);
                setStep((current) => (current > 1 ? ((current - 1) as StepId) : current));
              }}
              disabled={step === 1 || busy}
              className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Back
            </button>

            {step < 5 ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                  setStep((current) => ((current + 1) as StepId));
                }}
                disabled={!canContinue || busy}
                className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            ) : (
              <Link href="/dashboard" className="btn-primary">
                Back to dashboard
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
