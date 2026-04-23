import React, { useState, useRef } from 'react';
import clsx from 'clsx';
import { QRCodeCanvas } from 'qrcode.react';

export default function PaymentRequestGenerator() {
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleGenerate = () => {
    if (!destination || !amount) return;

    let validUntil: number | null = null;
    const now = Date.now();
    if (expiry === '24h') validUntil = now + 24 * 60 * 60 * 1000;
    if (expiry === '7d') validUntil = now + 7 * 24 * 60 * 60 * 1000;

    const paymentData = {
      destination: destination.trim(),
      amount: amount.toString(),
      memo: memo.trim() || undefined,
      validUntil,
    };

    const base64Data = btoa(JSON.stringify(paymentData));
    const url = `${window.location.origin}/request?r=${base64Data}`;
    setGeneratedLink(url);
    setCopied(false);
    setShowQR(false);
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

  const downloadQR = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `payment-request-${destination.slice(0, 8)}.png`;
    link.href = url;
    link.click();
  };

  return (
    <div className="card animate-fade-in border-stellar-400/20">
      <h2 className="font-display text-lg font-semibold text-white mb-6 flex items-center gap-2">
        <LinkIcon className="w-5 h-5 text-stellar-400" />
        Request Payment
      </h2>

      <div className="space-y-4">
        <div>
          <label className="label">Your Stellar Address</label>
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

        <div>
          <label className="label">Link Expiry</label>
          <select 
            value={expiry} 
            onChange={(e) => setExpiry(e.target.value)}
            className="input-field bg-cosmos-950 border-stellar-400/20 text-slate-300"
          >
            <option value="never">Never Expire</option>
            <option value="24h">24 Hours</option>
            <option value="7d">7 Days</option>
          </select>
        </div>

        <button
          onClick={handleGenerate}
          disabled={!destination || !amount}
          className="btn-primary w-full py-2.5"
        >
          Create Request Link
        </button>

        {generatedLink && (
          <div className="mt-4 p-4 rounded-xl bg-stellar-400/5 border border-stellar-400/20 animate-slide-up">
            <div className="flex justify-between items-center mb-2">
              <p className="text-[10px] uppercase tracking-wider text-stellar-400 font-bold">Generated URL</p>
              <button 
                onClick={() => setShowQR(!showQR)}
                className="text-[10px] text-slate-400 hover:text-white underline"
              >
                {showQR ? 'Hide QR' : 'Show QR'}
              </button>
            </div>

            <div className="flex gap-2">
              <input
                readOnly
                value={generatedLink}
                className="bg-black/40 border-none text-xs text-slate-300 w-full rounded p-2 focus:ring-0"
              />
              <button
                onClick={copyToClipboard}
                className={clsx(
                  "px-3 rounded font-medium text-xs transition-all shrink-0",
                  copied ? "bg-emerald-500 text-white" : "bg-stellar-400 text-black hover:bg-stellar-300"
                )}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            {showQR && (
              <div className="mt-4 flex flex-col items-center bg-white p-3 rounded-lg mx-auto w-fit">
                <QRCodeCanvas value={generatedLink} size={140} ref={canvasRef} includeMargin />
                <button 
                  onClick={downloadQR} 
                  className="mt-3 text-[10px] bg-slate-100 hover:bg-slate-200 text-black px-3 py-1 rounded font-bold uppercase transition-colors"
                >
                  Download QR
                </button>
              </div>
            )}
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