/**
 * src/services/analyticsService.js
 * Business logic for transaction volume analytics.
 * Fetches payment data from Horizon and computes aggregated insights.
 * Includes in-memory caching with 5-minute TTL.
 */

"use strict";

const stellarService = require("./stellarService");

// ─── Cache Configuration ──────────────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const cache = new Map();

/**
 * Cache wrapper function.
 * @param {string} key
 * @param {Function} fn - async function that returns the data
 */
async function withCache(key, fn) {
  const cached = cache.get(key);

  // Return cached data if still fresh
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Fetch fresh data
  const data = await fn();

  // Update cache
  cache.set(key, { data, timestamp: Date.now() });

  return data;
}

// ─── Analytics Functions ──────────────────────────────────────────────────────

/**
 * Get summary analytics for a public key.
 * Returns: total sent, total received, unique counterparties, avg transaction size.
 */
async function getSummary(publicKey) {
  return withCache(`summary:${publicKey}`, async () => {
    const payments = await stellarService.getPayments(publicKey, { limit: 200 });

    let totalSent = 0;
    let totalReceived = 0;
    const counterparties = new Set();
    let transactionCount = 0;

    for (const payment of payments) {
      const amount = parseFloat(payment.amount);

      if (payment.type === "sent") {
        totalSent += amount;
        counterparties.add(payment.to);
      } else {
        totalReceived += amount;
        counterparties.add(payment.from);
      }
      transactionCount++;
    }

    const totalVolume = totalSent + totalReceived;
    const avgTransactionSize =
      transactionCount > 0 ? (totalVolume / transactionCount).toFixed(7) : "0";

    return {
      publicKey,
      totalSentXLM: totalSent.toFixed(7),
      totalReceivedXLM: totalReceived.toFixed(7),
      uniqueCounterparties: counterparties.size,
      averageTransactionSize: avgTransactionSize,
      totalTransactions: transactionCount,
    };
  });
}

/**
 * Get top 5 recipients by total XLM sent.
 */
async function getTopRecipients(publicKey) {
  return withCache(`top-recipients:${publicKey}`, async () => {
    const payments = await stellarService.getPayments(publicKey, { limit: 200 });

    // Map to track total sent per recipient
    const recipientTotals = new Map();

    for (const payment of payments) {
      // Only count sent payments
      if (payment.type === "sent") {
        const amount = parseFloat(payment.amount);
        const recipient = payment.to;

        if (recipientTotals.has(recipient)) {
          recipientTotals.set(
            recipient,
            recipientTotals.get(recipient) + amount
          );
        } else {
          recipientTotals.set(recipient, amount);
        }
      }
    }

    // Convert to array and sort by amount (descending)
    const sorted = Array.from(recipientTotals.entries())
      .map(([address, total]) => ({
        address,
        totalXLMSent: total.toFixed(7),
      }))
      .sort((a, b) => parseFloat(b.totalXLMSent) - parseFloat(a.totalXLMSent))
      .slice(0, 5); // Top 5 only

    return {
      publicKey,
      topRecipients: sorted,
      count: sorted.length,
    };
  });
}

/**
 * Get payment activity by day of week.
 * Returns counts for all 7 days (Sunday = 0, ... Saturday = 6).
 */
async function getActivityByDay(publicKey) {
  return withCache(`activity:${publicKey}`, async () => {
    const payments = await stellarService.getPayments(publicKey, { limit: 200 });

    // Initialize counters for all 7 days
    const dayActivity = {
      0: 0, // Sunday
      1: 0, // Monday
      2: 0, // Tuesday
      3: 0, // Wednesday
      4: 0, // Thursday
      5: 0, // Friday
      6: 0, // Saturday
    };

    // Count transactions by day of week
    for (const payment of payments) {
      const date = new Date(payment.createdAt);
      const dayOfWeek = date.getUTCDay();
      dayActivity[dayOfWeek]++;
    }

    // Convert to array format
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const activity = days.map((dayName, index) => ({
      day: dayName,
      dayIndex: index,
      transactionCount: dayActivity[index],
    }));

    return {
      publicKey,
      activityByDay: activity,
    };
  });
}

/**
 * Clear cache for a specific public key (optional helper).
 * Useful for manual cache invalidation if needed.
 */
function clearCache(publicKey) {
  cache.delete(`summary:${publicKey}`);
  cache.delete(`top-recipients:${publicKey}`);
  cache.delete(`activity:${publicKey}`);
}

module.exports = {
  getSummary,
  getTopRecipients,
  getActivityByDay,
  clearCache,
};
