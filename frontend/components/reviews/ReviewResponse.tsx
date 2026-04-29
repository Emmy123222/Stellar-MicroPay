/**
 * components/reviews/ReviewResponse.tsx
 * Component for displaying and managing review responses
 */

import { useState } from "react";
import clsx from "clsx";

interface Review {
  id: string;
  response?: {
    text: string;
    createdAt: string;
  };
}

interface ReviewResponseProps {
  review: Review;
  currentUserId: string;
  freelancerId: string;
  onResponseAdded?: () => void;
}

type SubmitState = "idle" | "loading" | "success" | "error";

export default function ReviewResponse({
  review,
  currentUserId,
  freelancerId,
  onResponseAdded,
}: ReviewResponseProps) {
  const [isReplyFormOpen, setIsReplyFormOpen] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Check if current user can reply (must be the freelancer and no existing response)
  const canReply = currentUserId === freelancerId && !review.response;

  const validateResponse = () => {
    if (responseText.trim().length < 10) {
      setValidationError("Response must be at least 10 characters long");
      return false;
    }
    setValidationError(null);
    return true;
  };

  const handleReplyClick = () => {
    setIsReplyFormOpen(true);
    setResponseText("");
    setError(null);
    setValidationError(null);
    setSubmitState("idle");
  };

  const handleCancel = () => {
    if (submitState === "loading") return;
    setIsReplyFormOpen(false);
    setResponseText("");
    setError(null);
    setValidationError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateResponse()) {
      return;
    }

    setSubmitState("loading");
    setError(null);

    try {
      const response = await fetch(`/api/reviews/${review.id}/response`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: responseText.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to submit response");
      }

      setSubmitState("success");
      setIsReplyFormOpen(false);
      
      // Call the callback to refresh the reviews
      if (onResponseAdded) {
        onResponseAdded();
      }

    } catch (err) {
      setSubmitState("error");
      setError(err instanceof Error ? err.message : "Failed to submit response");
    }
  };

  return (
    <div className="mt-4">
      {/* Existing Response Display */}
      {review.response && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 bg-stellar-500 rounded-full flex items-center justify-center">
              <ReplyIcon className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm font-medium text-stellar-300">Freelancer Response</span>
            <span className="text-xs text-slate-500">
              {new Date(review.response.createdAt).toLocaleDateString()}
            </span>
          </div>
          <p className="text-slate-300 text-sm pl-8">{review.response.text}</p>
        </div>
      )}

      {/* Reply Button - Only show to freelancer if no response exists */}
      {canReply && !isReplyFormOpen && (
        <button
          onClick={handleReplyClick}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-stellar-300 hover:text-stellar-200 transition-colors"
        >
          <ReplyIcon className="w-4 h-4" />
          Reply
        </button>
      )}

      {/* Reply Form */}
      {isReplyFormOpen && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div>
            <textarea
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              placeholder="Write your response..."
              rows={3}
              className={clsx(
                "w-full px-3 py-2 bg-slate-800 border rounded-lg text-white placeholder-slate-500 transition-colors resize-none text-sm",
                validationError
                  ? "border-red-500 focus:border-red-400"
                  : "border-slate-600 focus:border-stellar-500"
              )}
              disabled={submitState === "loading"}
            />
            <div className="flex items-center justify-between mt-1">
              <div>
                {validationError && (
                  <p className="text-xs text-red-400">{validationError}</p>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {responseText.length}/500 characters
              </p>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitState === "loading"}
              className="px-3 py-1.5 text-sm font-medium text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitState === "loading"}
              className={clsx(
                "px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-1.5",
                "bg-stellar-500 hover:bg-stellar-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {submitState === "loading" && (
                <Spinner className="w-3 h-3" />
              )}
              Submit Reply
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ReplyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
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