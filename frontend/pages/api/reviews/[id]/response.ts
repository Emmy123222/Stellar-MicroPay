/**
 * pages/api/reviews/[id]/response.ts
 * API endpoint for adding responses to reviews
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { mockReviews, mockUsers, updateReview } from "@/lib/mockData";

interface CreateResponseRequest {
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
  // For demo purposes, return a mock freelancer user
  // In production, this would validate the session/JWT token
  return mockUsers["freelancer-456"];
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
    const { id: reviewId } = req.query;
    const { text }: CreateResponseRequest = req.body;

    // Validate required fields
    if (!reviewId || typeof reviewId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID",
      });
    }

    if (!text || typeof text !== "string") {
      return res.status(400).json({
        success: false,
        message: "Response text is required",
      });
    }

    // Validate text length
    if (text.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Response text must be at least 10 characters long",
      });
    }

    // Get current user
    const currentUser = getCurrentUser(req);
    if (!currentUser || currentUser.role !== "freelancer") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - Only freelancers can respond to reviews",
      });
    }

    // Find the review
    const review = mockReviews.find(r => r.id === reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // Check if current user is the freelancer for this review
    if (review.freelancerId !== currentUser.id) {
      return res.status(403).json({
        success: false,
        message: "You can only respond to reviews for your own services",
      });
    }

    // Check if response already exists
    if (review.response) {
      return res.status(400).json({
        success: false,
        message: "A response already exists for this review",
      });
    }

    // Add the response
    const response = {
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };

    updateReview(reviewId, { response });

    return res.status(201).json({
      success: true,
      data: response,
      message: "Response added successfully",
    });

  } catch (error) {
    console.error("Error adding review response:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}