"use strict";

// Keep the webhook SQLite store in-memory and isolated per test worker so
// test runs never touch (or leak state through) the real backend/data/webhooks.db.
process.env.WEBHOOK_DB_PATH = ":memory:";
