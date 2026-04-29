/**
 * lib/mockData.ts
 * Shared mock data for the application
 */

export interface Review {
  id: string;
  freelancerId: string;
  orderId: string;
  clientId: string;
  clientName: string;
  rating: number;
  text: string;
  createdAt: string;
  response?: {
    text: string;
    createdAt: string;
  };
}

export interface User {
  id: string;
  role: "client" | "freelancer";
  name: string;
  email: string;
}

export interface Order {
  id: string;
  freelancerId: string;
  clientId: string;
  status: "completed" | "in_progress" | "cancelled";
  title: string;
  amount: number;
  createdAt: string;
  completedAt?: string;
}

// Mock reviews data
export const mockReviews: Review[] = [
  {
    id: "review-1",
    freelancerId: "freelancer-456",
    orderId: "order-1",
    clientId: "client-123",
    clientName: "Alice Johnson",
    rating: 5,
    text: "Excellent work! The freelancer delivered exactly what I needed on time and with great attention to detail. Highly recommended!",
    createdAt: "2024-01-15T10:30:00Z",
    response: {
      text: "Thank you so much for the kind words! It was a pleasure working with you on this project.",
      createdAt: "2024-01-15T14:20:00Z",
    },
  },
  {
    id: "review-2",
    freelancerId: "freelancer-456",
    orderId: "order-2",
    clientId: "client-789",
    clientName: "Bob Wilson",
    rating: 4,
    text: "Good quality work and professional communication. The project was completed within the agreed timeframe.",
    createdAt: "2024-01-10T16:45:00Z",
  },
  {
    id: "review-3",
    freelancerId: "freelancer-456",
    orderId: "order-3",
    clientId: "client-456",
    clientName: "Carol Davis",
    rating: 5,
    text: "Outstanding freelancer! Very skilled and easy to work with. Will definitely hire again for future projects.",
    createdAt: "2024-01-05T09:15:00Z",
    response: {
      text: "Thank you Carol! Looking forward to working together again soon.",
      createdAt: "2024-01-05T11:30:00Z",
    },
  },
];

// Mock users data
export const mockUsers: Record<string, User> = {
  "client-123": {
    id: "client-123",
    role: "client",
    name: "John Doe",
    email: "john@example.com",
  },
  "freelancer-456": {
    id: "freelancer-456",
    role: "freelancer",
    name: "Jane Smith",
    email: "jane@example.com",
  },
};

// Mock orders data
export const mockOrders: Order[] = [
  {
    id: "order-1",
    freelancerId: "freelancer-456",
    clientId: "client-123",
    status: "completed",
    title: "Website Design Project",
    amount: 500,
    createdAt: "2024-01-10T10:00:00Z",
    completedAt: "2024-01-15T15:30:00Z",
  },
  {
    id: "order-2",
    freelancerId: "freelancer-456",
    clientId: "client-123",
    status: "completed",
    title: "Logo Design",
    amount: 200,
    createdAt: "2024-01-05T14:20:00Z",
    completedAt: "2024-01-10T11:45:00Z",
  },
  {
    id: "order-3",
    freelancerId: "freelancer-456",
    clientId: "client-789",
    status: "completed",
    title: "Mobile App UI",
    amount: 800,
    createdAt: "2024-01-01T09:15:00Z",
    completedAt: "2024-01-08T16:20:00Z",
  },
  {
    id: "order-4",
    freelancerId: "freelancer-456",
    clientId: "client-123",
    status: "in_progress",
    title: "E-commerce Platform",
    amount: 1200,
    createdAt: "2024-01-20T12:00:00Z",
  },
];

// Helper functions to simulate database operations
export const addReview = (review: Review) => {
  mockReviews.push(review);
};

export const updateReview = (reviewId: string, updates: Partial<Review>) => {
  const index = mockReviews.findIndex(r => r.id === reviewId);
  if (index !== -1) {
    mockReviews[index] = { ...mockReviews[index], ...updates };
  }
};

export const getReviewsByFreelancer = (freelancerId: string) => {
  return mockReviews.filter(review => review.freelancerId === freelancerId);
};

export const getOrdersByClient = (clientId: string, filters?: { freelancerId?: string; status?: string }) => {
  let orders = mockOrders.filter(order => order.clientId === clientId);
  
  if (filters?.freelancerId) {
    orders = orders.filter(order => order.freelancerId === filters.freelancerId);
  }
  
  if (filters?.status) {
    orders = orders.filter(order => order.status === filters.status);
  }
  
  return orders;
};