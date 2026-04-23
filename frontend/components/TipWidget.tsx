import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import SendPaymentForm from "@/components/SendPaymentForm";
import WalletConnect from "@/components/WalletConnect";
import { getXLMBalance, shortenAddress } from "@/lib/stellar";
import { formatXLM } from "@/utils/format";

interface TipWidgetProps {
  creatorUsername: string;
  destination: string;
  publicKey: string | null;
  onConnect: (publicKey: string) => void;
}

const PRESET_TIPS = [
  { label: "$1", amount: "0.5" },
  { label: "$5", amount: "2" },
  { label: "$20", amount: "10" },
] as const;

const MIN_TIP_AMOUNT = 0.0000001;

export default function TipWidget({
  creatorUsername,
  destination,
  publicKey,
  onConnect,
}: TipWidgetProps) {
  const [amount, setAmount] = useState<string>(PRESET_TIPS[0].amount);
  const [showConnectPrompt, setShowConnectPrompt] = useState(false);
  const [xlmBalance, setXlmBalance] = useState("0");
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const connectPromptRef = useRef<HTMLDivElement | null>(null);

  const parsedAmount = parseFloat(amount);
  const hasValidAmount = !Number.isNaN(parsedAmount) && parsedAmount >= MIN_TIP_AMOUNT;
  const selectedPreset = PRESET_TIPS.find((tip) => tip.amount === amount)?.amount ?? null;

  useEffect(() => {
    if (!publicKey) {
      setXlmBalance("0");
      return;
    }

    let isActive = true;
    setIsBalanceLoading(true);

    getXLMBalance(publicKey)
      .then((balance) => {
        if (isActive) setXlmBalance(balance);
      })
      .catch(() => {
        if (isActive) setXlmBalance("0");
      })
      .finally(() => {
        if (isActive) setIsBalanceLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [publicKey]);

  useEffect(() => {
    if (!showConnectPrompt) return;
    if (typeof connectPromptRef.current?.scrollIntoView === "function") {
      connectPromptRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showConnectPrompt]);

  const handlePresetClick = (presetAmount: string) => {
    setAmount(presetAmount);
  };

  const handleCustomAmountChange = (value: string) => {
    setAmount(value);
  };

  const handleTipIntent = () => {
    if (!hasValidAmount) return;
    if (!publicKey) {
      setShowConnectPrompt(true);
    }
  };

  const handleConnect = (connectedPublicKey: string) => {
    setShowConnectPrompt(false);
    onConnect(connectedPublicKey);
  };

  const handleSuccess = () => {
    setShowCelebration(true);
    setFormVersion((current) => current + 1);
    window.setTimeout(() => setShowCelebration(false), 4200);
  };

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-cosmos-900/80 shadow-2xl shadow-stellar-950/30">
      {showCelebration && <ConfettiBurst />}

      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-stellar-500/15 to-transparent pointer-events-none" />

      <div className="relative p-6 sm:p-8 space-y-8">
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stellar-300/80">
                Public tip page
              </p>
              <h1 className="mt-3 font-display text-3xl font-bold text-white">
                Tip @{creatorUsername}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-7 text-slate-300">
                Send a fast XLM tip straight to this creator&apos;s Stellar wallet. Pick a preset or
                choose your own amount, then confirm in Freighter.
              </p>
            </div>

            <div className="rounded-2xl border border-stellar-500/20 bg-stellar-500/10 px-4 py-3 text-sm text-stellar-100">
              <p className="text-xs uppercase tracking-[0.2em] text-stellar-300/80">Wallet</p>
              <p className="mt-1 font-mono text-sm text-white" title={destination}>
                {shortenAddress(destination)}
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold text-white">Choose a tip</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Fixed presets from the issue spec, plus any custom XLM amount you want.
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
                <SparkIcon className="h-3.5 w-3.5" />
                No account required to view
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {PRESET_TIPS.map((tip) => {
                const isActive = selectedPreset === tip.amount;

                return (
                  <button
                    key={tip.amount}
                    type="button"
                    onClick={() => handlePresetClick(tip.amount)}
                    className={clsx(
                      "rounded-2xl border px-4 py-4 text-left transition-all",
                      isActive
                        ? "border-stellar-400 bg-stellar-500/15 text-white shadow-lg shadow-stellar-950/20"
                        : "border-white/10 bg-cosmos-950/40 text-slate-200 hover:border-stellar-400/50 hover:bg-white/[0.05]"
                    )}
                  >
                    <span className="block text-sm font-semibold">{tip.label} tip</span>
                    <span className="mt-1 block font-display text-2xl text-white">
                      {tip.amount}
                      <span className="ml-1 text-base text-stellar-300">XLM</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-6">
              <label htmlFor="tip-amount" className="label">
                Custom amount
              </label>
              <div className="relative mt-2">
                <input
                  id="tip-amount"
                  type="number"
                  value={amount}
                  onChange={(event) => handleCustomAmountChange(event.target.value)}
                  min="0.0000001"
                  step="0.0000001"
                  placeholder="0.5000000"
                  className="input-field pr-16"
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-medium text-stellar-300">
                  XLM
                </span>
              </div>
              {!hasValidAmount && (
                <p className="mt-2 text-sm text-amber-300">
                  Enter at least 0.0000001 XLM to continue.
                </p>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-cosmos-950/50 px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Selected tip</p>
                  <p className="mt-2 font-display text-3xl font-semibold text-white">
                    {hasValidAmount ? formatXLM(parsedAmount) : "0 XLM"}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Recipient: <span className="font-semibold text-slate-200">@{creatorUsername}</span>
                  </p>
                </div>

                {publicKey ? (
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Connected wallet</p>
                    <p className="mt-2 font-mono text-sm text-slate-200">{shortenAddress(publicKey)}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {isBalanceLoading ? "Checking balance..." : `Balance: ${formatXLM(xlmBalance)}`}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-right text-xs text-amber-200">
                    Connect only when you are ready to send
                  </div>
                )}
              </div>
            </div>

            {!publicKey && (
              <button
                type="button"
                onClick={handleTipIntent}
                disabled={!hasValidAmount}
                className="btn-primary mt-6 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <WalletIcon className="h-4 w-4" />
                {hasValidAmount ? `Connect wallet to tip ${formatXLM(parsedAmount)}` : "Enter an amount"}
              </button>
            )}
          </div>

          <div className="space-y-5">
            {showCelebration && (
              <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 text-emerald-100 animate-slide-up">
                <p className="font-display text-lg font-semibold">Tip sent to @{creatorUsername}</p>
                <p className="mt-1 text-sm text-emerald-100/80">
                  Your support is on the way, and the confetti is doing its job.
                </p>
              </div>
            )}

            {!publicKey && showConnectPrompt && (
              <div ref={connectPromptRef} className="rounded-3xl border border-stellar-500/20 bg-white/[0.03] p-1">
                <div className="rounded-[22px] border border-white/10 bg-cosmos-950/50 p-5">
                  <p className="text-sm text-slate-400 mb-4">
                    Connect your wallet to send {hasValidAmount ? formatXLM(parsedAmount) : "this tip"} to
                    {" "}@{creatorUsername}.
                  </p>
                  <WalletConnect onConnect={handleConnect} />
                </div>
              </div>
            )}

            {publicKey && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
                  <p className="text-sm text-slate-300">
                    You are tipping <span className="font-semibold text-white">@{creatorUsername}</span> at{" "}
                    <span className="font-mono text-slate-200">{shortenAddress(destination)}</span>.
                  </p>
                </div>

                <SendPaymentForm
                  key={`${destination}-${amount}-${formVersion}`}
                  publicKey={publicKey}
                  xlmBalance={xlmBalance}
                  onSuccess={handleSuccess}
                  prefill={{ destination, amount }}
                  title={`Send a tip to @${creatorUsername}`}
                  submitLabel={hasValidAmount ? `Send ${formatXLM(parsedAmount)} tip` : "Send tip"}
                  successTitle={`Tip sent to @${creatorUsername}!`}
                  successMessage={hasValidAmount ? `${formatXLM(parsedAmount)} is on the way.` : undefined}
                  assetOptions={["XLM"]}
                  hideAssetSelector
                  hideDestinationField
                  hideAmountField
                  hideMemoField
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ConfettiBurst() {
  const pieces = [
    { left: "8%", delay: 0, duration: 1800, rotate: -18, color: "#34d399" },
    { left: "14%", delay: 90, duration: 1600, rotate: 22, color: "#38bdf8" },
    { left: "22%", delay: 140, duration: 1750, rotate: -12, color: "#f59e0b" },
    { left: "31%", delay: 50, duration: 1650, rotate: 28, color: "#a78bfa" },
    { left: "39%", delay: 180, duration: 1700, rotate: -25, color: "#fb7185" },
    { left: "47%", delay: 30, duration: 1500, rotate: 12, color: "#facc15" },
    { left: "54%", delay: 120, duration: 1850, rotate: -30, color: "#22c55e" },
    { left: "61%", delay: 70, duration: 1580, rotate: 18, color: "#60a5fa" },
    { left: "69%", delay: 150, duration: 1780, rotate: -20, color: "#f97316" },
    { left: "76%", delay: 110, duration: 1680, rotate: 26, color: "#2dd4bf" },
    { left: "84%", delay: 40, duration: 1720, rotate: -16, color: "#f472b6" },
    { left: "91%", delay: 130, duration: 1620, rotate: 20, color: "#eab308" },
  ];

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((piece, index) => (
        <span
          key={`${piece.left}-${index}`}
          className="absolute top-0 h-3 w-2 rounded-full opacity-90"
          style={{
            left: piece.left,
            backgroundColor: piece.color,
            animation: `tip-confetti-fall ${piece.duration}ms ease-out ${piece.delay}ms forwards`,
            transform: `translateY(-20px) rotate(${piece.rotate}deg)`,
          }}
        />
      ))}

      <style>{`
        @keyframes tip-confetti-fall {
          0% {
            opacity: 0;
            transform: translateY(-18px) scale(0.8) rotate(0deg);
          }
          12% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translateY(420px) scale(1) rotate(260deg);
          }
        }
      `}</style>
    </div>
  );
}

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 7.5A2.5 2.5 0 015.5 5h11A2.5 2.5 0 0119 7.5V9H7.75A2.75 2.75 0 005 11.75v.5A2.75 2.75 0 007.75 15H19v1.5A2.5 2.5 0 0116.5 19h-11A2.5 2.5 0 013 16.5v-9zm16 1.5h1.25A1.75 1.75 0 0122 10.75v2.5A1.75 1.75 0 0120.25 15H19V9zm-9 3h.01"
      />
    </svg>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3zM18.5 16l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3zM5.5 15l.9 2.8 2.8.9-2.8.9-.9 2.8-.9-2.8-2.8-.9 2.8-.9.9-2.8z" />
    </svg>
  );
}
