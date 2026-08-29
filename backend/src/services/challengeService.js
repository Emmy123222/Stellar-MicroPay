/**
 * src/services/challengeService.js
 * Business logic for storing and validating one-time use challenge transactions.
 * Uses SQLite for durable storage across requests and replicas.
 */

"use strict";

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const crypto = require("crypto");

// Database instance (singleton)
let db = null;

/**
 * Initialize the SQLite database and create the challenges table if it doesn't exist.
 * @returns {Promise<void>}
 */
async function initDatabase() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve();
      return;
    }

    // Database file path
    const dbPath = process.env.SQLITE_PATH || path.join(__dirname, "..", "..", "data", "challenges.db");
    
    // Ensure data directory exists
    const fs = require("fs");
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }

      // Create challenges table
      db.run(`
        CREATE TABLE IF NOT EXISTS challenges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          challenge_id TEXT UNIQUE NOT NULL,
          subject TEXT NOT NULL,
          network TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          consumed_at INTEGER,
          consumed_by TEXT
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          // Create indexes for faster lookups
          db.run("CREATE INDEX IF NOT EXISTS idx_challenge_id ON challenges(challenge_id)", (err) => {
            if (err) {
              reject(err);
            } else {
              db.run("CREATE INDEX IF NOT EXISTS idx_subject ON challenges(subject)", (err) => {
                if (err) {
                  reject(err);
                } else {
                  db.run("CREATE INDEX IF NOT EXISTS idx_expires_at ON challenges(expires_at)", (err) => {
                    if (err) {
                      reject(err);
                    } else {
                      resolve();
                    }
                  });
                }
              });
            }
          });
        }
      });
    });
  });
}

/**
 * Generate a unique challenge ID from a challenge transaction.
 * @param {string} transaction - The challenge transaction XDR
 * @returns {string} SHA-256 hash of the transaction
 */
function generateChallengeId(transaction) {
  return crypto.createHash("sha256").update(transaction).digest("hex");
}

/**
 * Store a new challenge in the database.
 * @param {Object} params - Challenge parameters
 * @param {string} params.transaction - The challenge transaction XDR
 * @param {string} params.subject - The client account (public key)
 * @param {string} params.network - Network passphrase
 * @param {number} params.expiresAt - Unix timestamp when the challenge expires
 * @returns {Promise<Object>} The stored challenge record
 */
async function storeChallenge({ transaction, subject, network, expiresAt }) {
  await initDatabase();
  
  const challengeId = generateChallengeId(transaction);
  const now = Math.floor(Date.now() / 1000);
  
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO challenges (challenge_id, subject, network, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [challengeId, subject, network, expiresAt, now],
      function(err) {
        if (err) {
          // If it's a duplicate challenge ID (should be extremely rare), treat as success
          if (err.code === "SQLITE_CONSTRAINT" && err.message.includes("UNIQUE constraint")) {
            // Try to fetch the existing challenge
            db.get(
              "SELECT * FROM challenges WHERE challenge_id = ?",
              [challengeId],
              (fetchErr, row) => {
                if (fetchErr) {
                  reject(fetchErr);
                } else if (row) {
                  resolve(row);
                } else {
                  reject(new Error("Duplicate challenge but not found"));
                }
              }
            );
          } else {
            reject(err);
          }
        } else {
          resolve({
            id: this.lastID,
            challenge_id: challengeId,
            subject,
            network,
            expires_at: expiresAt,
            created_at: now,
            consumed_at: null,
            consumed_by: null
          });
        }
      }
    );
  });
}

/**
 * Atomically consume a challenge if it hasn't been consumed yet.
 * @param {Object} params - Challenge consumption parameters
 * @param {string} params.transaction - The challenge transaction XDR
 * @param {string} params.consumedBy - Identifier for who's consuming the challenge (e.g., replica ID)
 * @returns {Promise<Object|null>} The consumed challenge record, or null if already consumed or expired
 */
async function consumeChallenge({ transaction, consumedBy = "default" }) {
  await initDatabase();
  
  const challengeId = generateChallengeId(transaction);
  const now = Math.floor(Date.now() / 1000);
  
  return new Promise((resolve, reject) => {
    // First, check if challenge exists and is not expired
    db.get(
      `SELECT * FROM challenges 
       WHERE challenge_id = ? AND expires_at > ?`,
      [challengeId, now],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!row) {
          // Challenge doesn't exist or is expired
          resolve(null);
          return;
        }
        
        // Try to atomically mark as consumed
        db.run(
          `UPDATE challenges 
           SET consumed_at = ?, consumed_by = ?
           WHERE challenge_id = ? AND consumed_at IS NULL`,
          [now, consumedBy, challengeId],
          function(updateErr) {
            if (updateErr) {
              reject(updateErr);
              return;
            }
            
            if (this.changes === 0) {
              // Challenge was already consumed by someone else
              resolve(null);
              return;
            }
            
            // Successfully consumed - return the updated record
            resolve({
              ...row,
              consumed_at: now,
              consumed_by: consumedBy
            });
          }
        );
      }
    );
  });
}

/**
 * Get a challenge by its ID.
 * @param {string} challengeId - The challenge ID (hash)
 * @returns {Promise<Object|null>} The challenge record, or null if not found
 */
async function getChallenge(challengeId) {
  await initDatabase();
  
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM challenges WHERE challenge_id = ?",
      [challengeId],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Clean up expired challenges (both consumed and unconsumed).
 * @param {number} [maxAgeHours=24] - Maximum age in hours to keep challenges
 * @returns {Promise<number>} Number of rows deleted
 */
async function cleanupExpiredChallenges(maxAgeHours = 24) {
  await initDatabase();
  
  const cutoffTime = Math.floor(Date.now() / 1000) - (maxAgeHours * 3600);
  
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM challenges WHERE created_at < ?",
      [cutoffTime],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

/**
 * Get statistics about challenges in the database.
 * @returns {Promise<Object>} Statistics object
 */
async function getChallengeStats() {
  await initDatabase();
  
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN consumed_at IS NULL THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN consumed_at IS NOT NULL THEN 1 ELSE 0 END) as consumed,
        SUM(CASE WHEN expires_at < strftime('%s', 'now') THEN 1 ELSE 0 END) as expired
       FROM challenges`,
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

/**
 * Close the database connection (for testing).
 * @returns {Promise<void>}
 */
async function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }
    
    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        db = null;
        resolve();
      }
    });
  });
}

module.exports = {
  initDatabase,
  generateChallengeId,
  storeChallenge,
  consumeChallenge,
  getChallenge,
  cleanupExpiredChallenges,
  getChallengeStats,
  closeDatabase
};