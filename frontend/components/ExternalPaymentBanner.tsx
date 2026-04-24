/**
 * components/ExternalPaymentBanner.tsx
 * Banner shown when a payment request comes from an external URI
 */

interface ExternalPaymentBannerProps {
  message?: string;
  originDomain?: string;
  onDismiss: () => void;
}

export default function ExternalPaymentBanner({ 
  message, 
  originDomain, 
  onDismiss 
}: ExternalPaymentBannerProps) {
  return (
    <div className="bg-stellar-500/10 border border-stellar-500/20 rounded-lg p-4 mb-6 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-stellar-500/20 flex items-center justify-center">
            <ExternalLinkIcon className="w-4 h-4 text-stellar-400" />
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-stellar-300 mb-1">
            Payment request from external app
          </h3>
          <p className="text-xs text-slate-400 mb-2">
            {message || 'Send a payment using the pre-filled form below.'}
          </p>
          {originDomain && (
            <p className="text-xs text-slate-500">
              Origin: <span className="font-mono">{originDomain}</span>
            </p>
          )}
        </div>
        
        <button
          onClick={onDismiss}
          className="flex-shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-300 hover:bg-white/5 transition-colors"
          aria-label="Dismiss"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}
