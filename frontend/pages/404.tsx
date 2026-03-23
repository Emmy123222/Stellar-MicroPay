/**
 * pages/404.tsx
 * Custom 404 page — matches the app's dark cosmos theme with stellar branding.
 */

import Link from "next/link";

export default function Custom404() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-stellar-500/3 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-stellar-600/3 rounded-full blur-2xl" />
      </div>

      <div className="relative z-10 text-center max-w-md">
        {/* 404 illustration */}
        <div className="mb-8">
          <div className="relative inline-block">
            {/* Star icon with glow */}
            <div className="w-20 h-20 rounded-full bg-stellar-500/10 border border-stellar-500/20 flex items-center justify-center glow-sm">
              <svg
                className="w-10 h-10 text-stellar-400"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 2L14.09 8.26L21 9L15.5 14.14L17.18 21L12 17.77L6.82 21L8.5 14.14L3 9L9.91 8.26L12 2Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            {/* Orbiting dots */}
            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <div className="absolute -bottom-2 -left-2 w-2 h-2 rounded-full bg-stellar-400 opacity-60" />
          </div>
        </div>

        {/* 404 number */}
        <h1 className="font-display text-7xl md:text-8xl font-bold text-gradient mb-4">
          404
        </h1>

        {/* Error message */}
        <h2 className="font-display text-2xl font-semibold text-white mb-4">
          Lost in the cosmos?
        </h2>

        <p className="text-slate-400 text-base mb-8 leading-relaxed">
          The stellar path you're looking for seems to have drifted into deep space. 
          Let's get you back to safety.
        </p>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/" className="btn-primary text-base px-8 py-3.5">
            Go Home →
          </Link>
          <button
            onClick={() => window.history.back()}
            className="btn-secondary text-base px-8 py-3.5"
          >
            ← Go Back
          </button>
        </div>

        {/* Help text */}
        <div className="mt-12 pt-8 border-t border-white/5">
          <p className="text-slate-600 text-sm">
            If you think this is an error, please{" "}
            <a
              href="https://github.com/your-org/stellar-micropay/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-stellar-400 hover:text-stellar-300 transition-colors"
            >
              report an issue on GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
