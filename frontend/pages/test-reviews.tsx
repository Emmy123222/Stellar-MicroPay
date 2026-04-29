/**
 * pages/test-reviews.tsx
 * Test page to verify the review components work correctly
 */

import { useState } from "react";
import LeaveReviewModal from "@/components/reviews/LeaveReviewModal";
import ReviewResponse from "@/components/reviews/ReviewResponse";

const mockReview = {
  id: "review-1",
  clientId: "client-123",
  clientName: "Alice Johnson",
  rating: 5,
  text: "Excellent work! The freelancer delivered exactly what I needed on time and with great attention to detail. Highly recommended!",
  createdAt: "2024-01-15T10:30:00Z",
  orderId: "order-1",
};

const mockReviewWithResponse = {
  ...mockReview,
  id: "review-2",
  response: {
    text: "Thank you so much for the kind words! It was a pleasure working with you on this project.",
    createdAt: "2024-01-15T14:20:00Z",
  },
};

export default function TestReviewsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("client-123");
  const [userRole, setUserRole] = useState<"client" | "freelancer">("client");

  const handleSuccess = () => {
    console.log("Review submitted successfully!");
    setIsModalOpen(false);
  };

  const handleResponseAdded = () => {
    console.log("Response added successfully!");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Review Components Test</h1>

        {/* User Role Switcher */}
        <div className="mb-6 p-4 bg-slate-800 rounded-lg">
          <h2 className="text-lg font-semibold mb-3">Test as Different User Types</h2>
          <div className="flex gap-4">
            <button
              onClick={() => {
                setUserRole("client");
                setCurrentUserId("client-123");
              }}
              className={`px-4 py-2 rounded ${
                userRole === "client"
                  ? "bg-stellar-500 text-white"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              Client View
            </button>
            <button
              onClick={() => {
                setUserRole("freelancer");
                setCurrentUserId("freelancer-456");
              }}
              className={`px-4 py-2 rounded ${
                userRole === "freelancer"
                  ? "bg-stellar-500 text-white"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              Freelancer View
            </button>
          </div>
          <p className="text-sm text-slate-400 mt-2">
            Current user: {userRole} ({currentUserId})
          </p>
        </div>

        {/* Leave Review Modal Test */}
        <div className="mb-8 p-4 bg-slate-800 rounded-lg">
          <h2 className="text-lg font-semibold mb-3">Leave Review Modal</h2>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-stellar-500 hover:bg-stellar-600 text-white rounded transition-colors"
          >
            Open Leave Review Modal
          </button>
        </div>

        {/* Review Response Test */}
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Review Response Component Tests</h2>
          
          {/* Review without response */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-2">Review without Response</h3>
            <div className="flex items-center gap-1 mb-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <StarIcon
                  key={star}
                  className={`w-4 h-4 ${
                    star <= mockReview.rating
                      ? "text-yellow-400 fill-current"
                      : "text-slate-600"
                  }`}
                />
              ))}
            </div>
            <p className="text-slate-300 mb-4">{mockReview.text}</p>
            <ReviewResponse
              review={mockReview}
              currentUserId={currentUserId}
              freelancerId="freelancer-456"
              onResponseAdded={handleResponseAdded}
            />
          </div>

          {/* Review with response */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
            <h3 className="font-semibold text-white mb-2">Review with Response</h3>
            <div className="flex items-center gap-1 mb-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <StarIcon
                  key={star}
                  className={`w-4 h-4 ${
                    star <= mockReviewWithResponse.rating
                      ? "text-yellow-400 fill-current"
                      : "text-slate-600"
                  }`}
                />
              ))}
            </div>
            <p className="text-slate-300 mb-4">{mockReviewWithResponse.text}</p>
            <ReviewResponse
              review={mockReviewWithResponse}
              currentUserId={currentUserId}
              freelancerId="freelancer-456"
              onResponseAdded={handleResponseAdded}
            />
          </div>
        </div>

        {/* Leave Review Modal */}
        <LeaveReviewModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          freelancerId="freelancer-456"
          orderId="order-1"
          onSuccess={handleSuccess}
        />
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