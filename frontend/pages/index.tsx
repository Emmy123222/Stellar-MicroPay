/**
 * pages/index.tsx
 * Landing page — hero, features, connect wallet CTA.
 */

import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import WalletConnect from "@/components/WalletConnect";
import { useCountUp } from "@/lib/useCountUp";

interface HomeProps {
    publicKey: string | null;
    onConnect: (pk: string) => void;
}

const FEATURES = [
  { icon: "⚡", title: "Instant Settlement", desc: "Stellar transactions confirm in 3–5 seconds. No waiting for bank transfers." },
  { icon: "🌍", title: "Truly Global", desc: "Send XLM to anyone with a Stellar address, anywhere in the world." },
  { icon: "💰", title: "Micro Fees", desc: "Each transaction costs ~0.00001 XLM. Send $0.01 or $1,000 for the same fee." },
  { icon: "🔐", title: "Non-Custodial", desc: "Your keys, your funds. We never touch your private key." },
];

const STATS = [
  { target: 5, label: "Settlement time", suffix: "s", prefix: "3–" },
  { target: 0.00001, label: "Average fee", prefix: "$", decimals: 5 },
  { target: 100, label: "Countries supported", suffix: "+" },
];

export default function Home({ publicKey, onConnect }: HomeProps) {
  const router = useRouter();
  const [showConnect, setShowConnect] = useState(false);

  const handleWalletConnect = (pk: string) => {
    onConnect(pk);
    router.push("/dashboard");
  };

  return (
    <div className="relative overflow-hidden cursor-default select-none">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-stellar-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-20 right-0 w-[300px] h-[300px] bg-stellar-600/5 rounded-full blur-2xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div className="text-center mb-20 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-stellar-500/25 bg-stellar-500/8 text-stellar-400 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-stellar-400 animate-pulse" />
            Built on Stellar Testnet · Open Source
          </div>

          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold text-white leading-tight mb-6">
            Money moves at the{" "}
            <span className="text-gradient">speed of light</span>
          </h1>

          <p className="text-slate-400 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Stellar MicroPay lets anyone send tiny payments across borders instant — for fractions of a cent. No bank. No borders. No friction.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {publicKey ? (
              <Link href="/dashboard" className="btn-primary text-base px-8 py-3.5">
                Open Dashboard →
              </Link>
            ) : (
              <button onClick={() => setShowConnect(true)} className="btn-primary text-base px-8 py-3.5">
                Connect Wallet & Start
              </button>
            )}
            <a
              href="https://github.com/your-org/stellar-micropay"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-base px-8 py-3.5 flex items-center gap-2"
            >
              <GithubIcon className="w-4 h-4" />
              View on GitHub
            </a>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-px bg-stellar-500/10 rounded-2xl overflow-hidden mb-24 border border-stellar-500/15 cursor-default">
          {STATS.map((stat) => {
            const formatValue = () => {
              if (stat.decimals !== undefined) {
                return stat.target.toFixed(stat.decimals);
              }
              return stat.target.toString();
            };
            return (
              <div key={stat.label} className="bg-cosmos-900 text-center py-8 px-4">
                <div className="font-display text-3xl font-bold text-gradient mb-1">
                  {stat.prefix || ""}{formatValue()}{stat.suffix || ""}
                </div>
                <div className="text-slate-500 text-sm">{stat.label}</div>
              </div>
            );
          })}
        </div>

        <div className="grid sm:grid-cols-2 gap-5 mb-24">
          {FEATURES.map((f) => (
            <div key={f.title} className="card hover:border-stellar-500/30 transition-colors group cursor-default">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-display font-semibold text-white mb-2 group-hover:text-stellar-300 transition-colors">
                {f.title}
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
        </div>

        <section className="mb-24">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mb-3">What is Stellar?</h2>
              <p className="text-slate-400 text-sm sm:text-base">
                A quick explainer for newcomers, with links to the official Stellar docs.
              </p>
            </div>

            <div className="space-y-4">
              <details className="card cursor-default">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-left text-white font-semibold">
                  <span>What is Stellar?</span>
                  <span className="text-stellar-400 text-xl">+</span>
                </summary>
                <div className="mt-4 text-sm leading-relaxed text-slate-400 space-y-3">
                  <p>
                    Stellar is an open blockchain network for moving money quickly and with very low fees. It&apos;s designed for payments, remittances, and cross-border transfers that settle faster than traditional bank systems.
                  </p>
                  <p>
                    Read the official{" "}
                    <a href="https://developers.stellar.org/docs/learn/overview" target="_blank" rel="noopener noreferrer" className="text-stellar-400 hover:text-stellar-300 underline underline-offset-4">
                      Stellar overview
                    </a>
                    .
                  </p>
                </div>
              </details>

              <details className="card cursor-default">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-left text-white font-semibold">
                  <span>What is XLM?</span>
                  <span className="text-stellar-400 text-xl">+</span>
                </summary>
                <div className="mt-4 text-sm leading-relaxed text-slate-400 space-y-3">
                  <p>
                    XLM is Stellar&apos;s native asset. It&apos;s used to pay transaction fees and can also be sent directly like any other digital currency.
                  </p>
                  <p>
                    See the official{" "}
                    <a href="https://developers.stellar.org/docs/tokens" target="_blank" rel="noopener noreferrer" className="text-stellar-400 hover:text-stellar-300 underline underline-offset-4">
                      token docs
                    </a>
                    .
                  </p>
                </div>
              </details>

              <details className="card cursor-default">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-left text-white font-semibold">
                  <span>How fast is it?</span>
                  <span className="text-stellar-400 text-xl">+</span>
                </summary>
                <div className="mt-4 text-sm leading-relaxed text-slate-400 space-y-3">
                  <p>
                    Stellar transactions typically confirm in just a few seconds, which is why it feels much faster than a bank transfer.
                  </p>
                  <p>
                    Read about transaction flow in the{" "}
                    <a href="https://developers.stellar.org/docs/learn/fundamentals/transactions" target="_blank" rel="noopener noreferrer" className="text-stellar-400 hover:text-stellar-300 underline underline-offset-4">
                      official transaction docs
                    </a>
                    .
                  </p>
                </div>
              </details>

              <details className="card cursor-default">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-left text-white font-semibold">
                  <span>How much does it cost?</span>
                  <span className="text-stellar-400 text-xl">+</span>
                </summary>
                <div className="mt-4 text-sm leading-relaxed text-slate-400 space-y-3">
                  <p>
                    Fees are tiny—usually a fraction of a cent. That makes Stellar useful for small payments where a bank transfer would be expensive or too slow.
                  </p>
                  <p>
                    See the official{" "}
                    <a href="https://developers.stellar.org/docs/learn/fundamentals/transactions" target="_blank" rel="noopener noreferrer" className="text-stellar-400 hover:text-stellar-300 underline underline-offset-4">
                      fee and transaction docs
                    </a>
                    .
                  </p>
                </div>
              </details>

              <details className="card cursor-default">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-left text-white font-semibold">
                  <span>Is it safe?</span>
                  <span className="text-stellar-400 text-xl">+</span>
                </summary>
                <div className="mt-4 text-sm leading-relaxed text-slate-400 space-y-3">
                  <p>
                    Stellar uses public-key cryptography, so only the owner of a wallet can sign transactions from it. As with any blockchain app, keeping your recovery phrase and private keys secure is essential.
                  </p>
                  <p>
                    Learn more about account security and the network in the{" "}
                    <a href="https://developers.stellar.org/docs/learn/fundamentals/accounts" target="_blank" rel="noopener noreferrer" className="text-stellar-400 hover:text-stellar-300 underline underline-offset-4">
                      official account docs
                    </a>
                    {" "}and{" "}
                    <a href="https://developers.stellar.org/docs/networks" target="_blank" rel="noopener noreferrer" className="text-stellar-400 hover:text-stellar-300 underline underline-offset-4">
                      network docs
                    </a>
                    .
                  </p>
                </div>
              </details>
            </div>
          </div>
        </section>

        {showConnect && !publicKey && (
          <div className="fixed inset-0 z-50 bg-cosmos-900/90 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md">
              <WalletConnect onConnect={handleWalletConnect} />
              <button onClick={() => setShowConnect(false)} className="mt-4 w-full text-center text-sm text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="text-center pt-12 border-t border-white/5">
          <p className="text-slate-600 text-sm">
            Open source · MIT License ·{" "}
            <a href="https://github.com/your-org/stellar-micropay" target="_blank" rel="noopener noreferrer" className="hover:text-stellar-400 transition-colors cursor-pointer">
              Contribute on GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
