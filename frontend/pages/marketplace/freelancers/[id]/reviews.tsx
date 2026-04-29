/**
 * pages/marketplace/freelancers/[id]/reviews.tsx
 * Reviews page for a specific freelancer
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import LeaveReviewModal from "@/components/reviews/LeaveReviewModal";
import ReviewResponse from "@/components/reviews/ReviewResponse";

interface Review {
  id: string;
  clientId: string;
  clientName: string;
  rating: number;
  text: string;
  createdAt: string;
  orderId: string;
  response?: {
    text: string;
    createdAt: string;
  };
}

interface User {
  id: string;
  role: "client" | "freelancer";
}

interface CompletedOrder {
  id: string;
  freelancerId: string;
  clientId: string;
  status: "completed";
}

export default function FreelancerReviewsPage() {
  const router = useRouter();
  const { id: freelancerId } = router.query;
  
  const [reviews, setReviews] = useState<Review[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [completedOrders, setCompletedOrders] = useState<CompletedOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLeaveReviewModalOpen, setIsLeaveReviewModalOpen] = useState(false);

  // Fetch reviews, user data, and completed orders
  useEffect(() => {
    if (!freelancerId) return;

    const fetchData = async () => {
      try {
        setIsLoading(true);
        
        // Fetch reviews
        const reviewsResponse = await fetch(`/api/freelancers/${freelancerId}/reviews`);
        if (!reviewsResponse.ok) throw new Error("Failed to fetch reviews");
        const reviewsData = await reviewsResponse.json();
        setReviews(reviewsData.data || []);

        // Fetch current user (for demo, we'll use query param to simulate different users)
        const userType = router.query.userType || "client";
        const userResponse = await fetch(`/api/auth/me?userType=${userType}`);
        if (userResponse.ok) {
          const userData = await userResponse.json();
          setCurrentUser(userData.data);

          // If user is a client, fetch their completed orders with this freelancer
          if (userData.data?.role === "client") {
            const ordersResponse = await fetch(`/api/orders?freelancerId=${freelancerId}&status=completed&clientId=${userData.data.id}`);
            if (ordersResponse.ok) {
              const ordersData = await ordersResponse.json();
              setCompletedOrders(ordersData.data || []);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [freelancerId, router.query.userType]);

  const refreshReviews = async () => {
    if (!freelancerId) return;
    
    try {
      const response = await fetch(`/api/freelancers/${freelancerId}/reviews`);
      if (!response.ok) throw new Error("Failed to refresh reviews");
      const data = await response.json();
      setReviews(data.data || []);
    } catch (err) {
      console.error("Failed to refresh reviews:", err);
    }
  };

  // Check if current user can leave a review
  const canLeaveReview = () => {
    if (!currentUser || currentUser.role !== "client") return false;
    
    // Check if user has completed orders with this freelancer
    const hasCompletedOrder = completedOrders.some(order => 
      order.freelancerId === freelancerId && order.clientId === currentUser.id
    );
    
    if (!hasCompletedOrder) return false;

    // Check if user already left a review for any of their completed orders
    const hasExistingReview = reviews.some(review => 
      review.clientId === currentUser.id &&
      completedOrders.some(order => order.id === review.orderId)
    );

    return !hasExistingReview;
  };

  // Get available order for review
  const getAvailableOrderForReview = () => {
    if (!currentUser || currentUser.role !== "client") return null;
    
    // Find a completed order that doesn't have a review yet
    return completedOrders.find(order => 
      order.freelancerId === freelancerId && 
      order.clientId === currentUser.id &&
      !reviews.some(review => review.orderId === order.id)
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-slate-800 rounded w-1/3 mb-6"></div>
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-32 bg-slate-800 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12">
            <p className="text-red-400 mb-4">{error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-stellar-500 hover:bg-stellar-600 rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const availableOrder = getAvailableOrderForReview();

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header with user type switcher for demo */}
        <div className="mb-4 p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400 mb-2">Demo: Switch user type to test different views</p>
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`${router.asPath.split('?')[0]}?userType=client`)}
              className={`px-3 py-1 text-sm rounded ${
                (router.query.userType || "client") === "client"
                  ? "bg-stellar-500 text-white"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              View as Client
            </button>
            <button
              onClick={() => router.push(`${router.asPath.split('?')[0]}?userType=freelancer`)}
              className={`px-3 py-1 text-sm rounded ${
                router.query.userType === "freelancer"
                  ? "bg-stellar-500 text-white"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              View as Freelancer
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Reviews</h1>
          
          {/* Leave Review Button - Only show to eligible clients */}
          {canLeaveReview() && availableOrder && (
            <button
              onClick={() => setIsLeaveReviewModalOpen(true)}
              className="px-6 py-3 bg-stellar-500 hover:bg-stellar-600 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              <StarIcon className="w-5 h-5" />
              Leave a Review
            </button>
          )}
        </div>

        {/* Current user info for demo */}
        {currentUser && (
          <div className="mb-6 p-3 bg-slate-800/50 rounded-lg text-sm text-slate-400">
            Logged in as: <span className="text-white">{currentUser.role}</span> ({currentUser.id})
          </div>
        )}

        {/* Reviews List */}
        <div className="space-y-6">
          {reviews.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center">
                <StarIcon className="w-8 h-8 text-slate-600" />
              </div>
              <p className="text-slate-400 text-lg">No reviews yet</p>
              <p className="text-slate-500 text-sm mt-2">
                Be the first to leave a review for this freelancer
              </p>
            </div>
          ) : (
            reviews.map((review) => (
              <div key={review.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                {/* Review Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-white">{review.clientName}</h3>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <StarIcon
                            key={star}
                            className={`w-4 h-4 ${
                              star <= review.rating
                                ? "text-yellow-400 fill-current"
                                : "text-slate-600"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-slate-400">
                      {new Date(review.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Review Text */}
                <p className="text-slate-300 mb-4">{review.text}</p>

                {/* Review Response Component */}
                <ReviewResponse
                  review={review}
                  currentUserId={currentUser?.id || ""}
                  freelancerId={freelancerId as string}
                  onResponseAdded={refreshReviews}
                />
              </div>
            ))
          )}
        </div>

        {/* Leave Review Modal */}
        <LeaveReviewModal
          isOpen={isLeaveReviewModalOpen}
          onClose={() => setIsLeaveReviewModalOpen(false)}
          freelancerId={freelancerId as string}
          orderId={availableOrder?.id || ""}
          onSuccess={() => {
            setIsLeaveReviewModalOpen(false);
            refreshReviews();
          }}
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