/**
 * components/reviews/LeaveReviewModal.tsx
 * Modal for leaving a review for a freelancer
 */

import { useState, useEffect } from "react";
import clsx from "clsx";

interface LeaveReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  freelancerId: string;
  orderId: string;
  onSuccess: () => void;
}

type SubmitState = "idle" | "loading" | "success" | "error";

export default function LeaveReviewModal({
  isOpen,
  onClose,
  freelancerId,
  orderId,
  onSuccess,
}: LeaveReviewModalProps) {
  const [rating, setRating] = useState<number>(0);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  const [reviewText, setReviewText] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    rating?: string;
    text?: string;
  }>({});

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setRating(0);
      setHoveredRating(0);
      setReviewText("");
      setSubmitState("idle");
      setError(null);
      setValidationErrors({});
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const validateForm = () => {
    const errors: { rating?: string; text?: string } = {};

    if (rating === 0) {
      errors.rating = "Please select a rating";
    }

    if (reviewText.trim().length < 10) {
      errors.text = "Review must be at least 10 characters long";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setSubmitState("loading");
    setError(null);

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          freelancerId,
          orderId,
          rating,
          text: reviewText.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to submit review");
      }

      setSubmitState("success");
      
      // Show success briefly, then close and call onSuccess
      setTimeout(() => {
        onSuccess();
      }, 1000);

    } catch (err) {
      setSubmitState("error");
      setError(err instanceof Error ? err.message : "Failed to submit review");
    }
  };

  const handleCancel = () => {
    if (submitState === "loading") return;
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-review-title"
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 id="leave-review-title" className="text-xl font-semibold text-white">
            Leave a Review
          </h2>
          <button
            onClick={handleCancel}
            disabled={submitState === "loading"}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800 disabled:opacity-50"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Star Rating */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-3">
              Rating <span className="text-red-400">*</span>
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  className="p-1 rounded transition-colors hover:bg-slate-800"
                >
                  <StarIcon
                    className={clsx(
                      "w-8 h-8 transition-colors",
                      star <= (hoveredRating || rating)
                        ? "text-yellow-400 fill-current"
                        : "text-slate-600"
                    )}
                  />
                </button>
              ))}
            </div>
            {validationErrors.rating && (
              <p className="mt-2 text-sm text-red-400">{validationErrors.rating}</p>
            )}
          </div>

          {/* Review Text */}
          <div>
            <label htmlFor="review-text" className="block text-sm font-medium text-slate-300 mb-2">
              Your Review <span className="text-red-400">*</span>
            </label>
            <textarea
              id="review-text"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Share your experience working with this freelancer..."
              rows={4}
              className={clsx(
                "w-full px-3 py-2 bg-slate-800 border rounded-lg text-white placeholder-slate-500 transition-colors resize-none",
                validationErrors.text
                  ? "border-red-500 focus:border-red-400"
                  : "border-slate-600 focus:border-stellar-500"
              )}
              disabled={submitState === "loading"}
            />
            <div className="flex items-center justify-between mt-2">
              <div>
                {validationErrors.text && (
                  <p className="text-sm text-red-400">{validationErrors.text}</p>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {reviewText.length}/500 characters
              </p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {submitState === "success" && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <p className="text-sm text-emerald-400">Review submitted successfully!</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitState === "loading"}
              className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitState === "loading" || submitState === "success"}
              className={clsx(
                "flex-1 px-4 py-2.5 font-medium rounded-lg transition-colors flex items-center justify-center gap-2",
                submitState === "success"
                  ? "bg-emerald-600 text-white"
                  : "bg-stellar-500 hover:bg-stellar-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {submitState === "loading" && (
                <Spinner className="w-4 h-4" />
              )}
              {submitState === "success" ? "Submitted!" : "Submit Review"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`${className ?? ""} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
    </svg>
  );
}