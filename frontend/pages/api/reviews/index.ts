/**
 * pages/api/reviews/index.ts
 * API endpoint for creating reviews
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { mockReviews, mockUsers, mockOrders, addReview } from "@/lib/mockData";

interface CreateReviewRequest {
  freelancerId: string;
  orderId: string;
  rating: number;
  text: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// Mock function to get current user - In a real app, this would validate JWT/session
const getCurrentUser = (req: NextApiRequest) => {
  // For demo purposes, return a mock user
  // In production, this would validate the session/JWT token
  return mockUsers["client-123"];
};

// Mock function to validate order - In a real app, this would check the database
const validateOrder = async (orderId: string, clientId: string, freelancerId: string) => {
  // Mock validation - In production, check if:
  // 1. Order exists
  // 2. Order belongs to the client
  // 3. Order is completed
  // 4. Order is with the specified freelancer
  // 5. No review exists for this order yet
  return {
    isValid: true,
    order: {
      id: orderId,
      clientId,
      freelancerId,
      status: "completed" as const,
    },
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed",
    });
  }

  try {
    const { freelancerId, orderId, rating, text }: CreateReviewRequest = req.body;

    // Validate required fields
    if (!freelancerId || !orderId || !rating || !text) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Validate rating
    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      return res.status(400).json({
        success: false,
        message: "Rating must be an integer between 1 and 5",
      });
    }

    // Validate text length
    if (text.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Review text must be at least 10 characters long",
      });
    }

    // Get current user
    const currentUser = getCurrentUser(req);
    if (!currentUser || currentUser.role !== "client") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - Only clients can leave reviews",
      });
    }

    // Validate the order
    const orderValidation = await validateOrder(orderId, currentUser.id, freelancerId);
    if (!orderValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid order or you don't have permission to review this order",
      });
    }

    // Check if review already exists for this order
    const existingReview = mockReviews.find(r => r.orderId === orderId);
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "A review already exists for this order",
      });
    }

    // Create the review
    const newReview = {
      id: `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      freelancerId,
      orderId,
      clientId: currentUser.id,
      clientName: currentUser.name,
      rating,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };

    addReview(newReview);

    return res.status(201).json({
      success: true,
      data: newReview,
      message: "Review created successfully",
    });

  } catch (error) {
    console.error("Error creating review:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}