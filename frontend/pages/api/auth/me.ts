/**
 * pages/api/auth/me.ts
 * API endpoint for getting current user information
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { mockUsers } from "@/lib/mockData";

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
    // In a real app, you would:
    // 1. Extract JWT token from Authorization header or cookies
    // 2. Validate the token
    // 3. Get user ID from the token
    // 4. Fetch user data from database
    
    // For demo purposes, we'll simulate different users based on a query parameter
    const { userType } = req.query;
    
    let currentUser;
    if (userType === "freelancer") {
      currentUser = mockUsers["freelancer-456"];
    } else {
      currentUser = mockUsers["client-123"];
    }

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - No valid session found",
      });
    }

    return res.status(200).json({
      success: true,
      data: currentUser,
    });

  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}