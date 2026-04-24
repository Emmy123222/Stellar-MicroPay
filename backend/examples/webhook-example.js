/**
 * examples/webhook-example.js
 * Example demonstrating webhook registration and usage
 */

const axios = require("axios");
const crypto = require("crypto");

const API_BASE = "http://localhost:4000/api";

// Example Stellar testnet public key (replace with actual key)
const PUBLIC_KEY = "GCKFBEIYTKP6JY4Q2UZKBQJLGR2HKFOQNPZGFR5HKXQXQXQXQXQXQXQX";
const WEBHOOK_URL = "https://your-webhook-endpoint.com/stellar-payment";
const WEBHOOK_SECRET = "your-webhook-secret-key";

async function registerWebhook() {
  try {
    console.log("Registering webhook...");
    
    const response = await axios.post(`${API_BASE}/webhooks`, {
      publicKey: PUBLIC_KEY,
      url: WEBHOOK_URL,
      secret: WEBHOOK_SECRET
    });

    console.log("Webhook registered successfully:");
    console.log(JSON.stringify(response.data, null, 2));
    
    return response.data.id;
  } catch (error) {
    console.error("Error registering webhook:", error.response?.data || error.message);
  }
}

async function listWebhooks() {
  try {
    console.log("Fetching webhooks...");
    
    const response = await axios.get(`${API_BASE}/webhooks/${PUBLIC_KEY}`);
    
    console.log("Registered webhooks:");
    console.log(JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    console.error("Error fetching webhooks:", error.response?.data || error.message);
  }
}

async function deleteWebhook(webhookId) {
  try {
    console.log(`Deleting webhook ${webhookId}...`);
    
    await axios.delete(`${API_BASE}/webhooks/${webhookId}`);
    
    console.log("Webhook deleted successfully");
  } catch (error) {
    console.error("Error deleting webhook:", error.response?.data || error.message);
  }
}

/**
 * Verify webhook signature (for your webhook endpoint)
 */
function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
    
  return signature === `sha256=${expectedSignature}`;
}

/**
 * Example webhook handler (for your webhook endpoint)
 */
function handleWebhook(req, res) {
  const signature = req.headers["x-webhook-signature"];
  const payload = req.body;
  
  if (!verifyWebhookSignature(payload, signature, WEBHOOK_SECRET)) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  
  console.log("Received payment notification:", payload);
  
  // Process the payment notification
  if (payload.type === "payment") {
    console.log(`Payment received: ${payload.amount} ${payload.asset} from ${payload.from}`);
  }
  
  res.status(200).json({ received: true });
}

// Example usage
async function main() {
  console.log("Stellar Webhook Example");
  console.log("======================");
  
  // Register a webhook
  const webhookId = await registerWebhook();
  
  if (webhookId) {
    // List webhooks
    await listWebhooks();
    
    // Wait a bit, then clean up
    setTimeout(async () => {
      await deleteWebhook(webhookId);
    }, 5000);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  verifyWebhookSignature,
  handleWebhook
};