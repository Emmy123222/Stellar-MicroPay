/**
 * pages/api/orders.ts
 * API endpoint for fetching orders
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { mockOrders } from "@/lib/mockData";

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
    const { freelancerId, clientId, status } = req.query;

    let filteredOrders = [...mockOrders];

    // Filter by freelancer ID
    if (freelancerId && typeof freelancerId === "string") {
      filteredOrders = filteredOrders.filter(order => order.freelancerId === freelancerId);
    }

    // Filter by client ID
    if (clientId && typeof clientId === "string") {
      filteredOrders = filteredOrders.filter(order => order.clientId === clientId);
    }

    // Filter by status
    if (status && typeof status === "string") {
      filteredOrders = filteredOrders.filter(order => order.status === status);
    }

    // Sort by creation date (newest first)
    filteredOrders.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return res.status(200).json({
      success: true,
      data: filteredOrders,
      meta: {
        total: filteredOrders.length,
        filters: {
          freelancerId: freelancerId || null,
          clientId: clientId || null,
          status: status || null,
        },
      },
    });

  } catch (error) {
    console.error("Error fetching orders:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}