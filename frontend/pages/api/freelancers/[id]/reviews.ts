/**
 * pages/api/freelancers/[id]/reviews.ts
 * API endpoint for fetching reviews for a specific freelancer
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { getReviewsByFreelancer } from "@/lib/mockData";

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed",
    });
  }

  try {
    const { id: freelancerId } = req.query;

    // Validate freelancer ID
    if (!freelancerId || typeof freelancerId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid freelancer ID",
      });
    }

    // Get reviews for this freelancer
    const freelancerReviews = getReviewsByFreelancer(freelancerId);

    // Sort by creation date (newest first)
    freelancerReviews.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Calculate average rating
    const averageRating = freelancerReviews.length > 0
      ? freelancerReviews.reduce((sum, review) => sum + review.rating, 0) / freelancerReviews.length
      : 0;

    // Calculate rating distribution
    const ratingDistribution = {
      5: freelancerReviews.filter(r => r.rating === 5).length,
      4: freelancerReviews.filter(r => r.rating === 4).length,
      3: freelancerReviews.filter(r => r.rating === 3).length,
      2: freelancerReviews.filter(r => r.rating === 2).length,
      1: freelancerReviews.filter(r => r.rating === 1).length,
    };

    return res.status(200).json({
      success: true,
      data: freelancerReviews,
      meta: {
        totalReviews: freelancerReviews.length,
        averageRating: Math.round(averageRating * 10) / 10,
        ratingDistribution,
      },
    });

  } catch (error) {
    console.error("Error fetching freelancer reviews:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}