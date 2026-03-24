import React, { useState } from 'react';
import clsx from 'clsx';

export default function PaymentLinkGenerator() {
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    if (!destination || !amount) return;

    // 1. Create the data object
    const paymentData = {
      destination: destination.trim(),
      amount: amount.toString(),
      memo: memo.trim() || undefined,
    };

    // 2. Encode to Base64
    // btoa() works great for simple JSON strings in the browser
    const base64Data = btoa(JSON.stringify(paymentData));
    
    // 3. Construct the final URL pointing to your new /pay page
    const url = `${window.location.origin}/pay?data=${base64Data}`;
    setGeneratedLink(url);
    setCopied(false);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy!', err);
    }
  };

  return (
    <div className="card animate-fade-in border-stellar-400/20">
      <h2 className="font-display text-lg font-semibold text-white mb-6 flex items-center gap-2">
        <LinkIcon className="w-5 h-5 text-stellar-400" />
        Generate Payment Link
      </h2>

      <div className="space-y-4">
        <div>
          <label className="label">Recipient Address</label>
          <input
            type="text"
            className="input-field"
            placeholder="G..."
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Amount (XLM)</label>
            <input
              type="number"
              className="input-field"
              placeholder="1.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Memo (Optional)</label>
            <input
              type="text"
              className="input-field"
              placeholder="ID: 123"
              maxLength={28}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={!destination || !amount}
          className="btn-primary w-full py-2.5"
        >
          Create Link
        </button>

        {generatedLink && (
          <div className="mt-4 p-3 rounded-xl bg-stellar-400/5 border border-stellar-400/20 animate-slide-up">
            <p className="text-[10px] uppercase tracking-wider text-stellar-400 font-bold mb-2">Generated URL</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={generatedLink}
                className="bg-black/40 border-none text-xs text-slate-300 w-full rounded p-2 focus:ring-0"
              />
              <button
                onClick={copyToClipboard}
                className={clsx(
                  "px-3 rounded font-medium text-xs transition-all",
                  copied ? "bg-emerald-500 text-white" : "bg-stellar-400 text-black hover:bg-stellar-300"
                )}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  );
}