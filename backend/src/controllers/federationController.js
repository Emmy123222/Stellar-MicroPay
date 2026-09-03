/**
 * src/controllers/federationController.js
 * Handles federation requests per SEP-0002.
 */

"use strict";

const axios = require("axios");
const usernameService = require("../services/usernameService");

/**
 * GET /federation?q=<query>&type=<type>
 * Federation endpoint per SEP-0002.
 */
async function resolveFederation(req, res, next) {
  try {
    const { q, type } = req.query;

    if (!q || !type) {
      return res.status(400).json({
        error: "Missing required parameters: q and type",
      });
    }

    if (type === "name") {
      // Resolve stellar address to account ID
      const result = await resolveStellarAddress(q);
      return res.json(result);
    } else if (type === "id") {
      // Resolve account ID to stellar address
      const result = await resolveAccountId(q);
      return res.json(result);
    } else {
      return res.status(400).json({
        error: "Invalid type parameter. Must be 'name' or 'id'",
      });
    }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        error: "Not found",
      });
    }
    next(err);
  }
}

/**
 * Resolve a stellar address (user*domain.com) to an account ID.
 * @param {string} stellarAddress - The stellar address to resolve
 * @returns {Object} Federation response
 */
async function resolveStellarAddress(stellarAddress) {
  // Parse the stellar address
  const parts = stellarAddress.split("*");
  if (parts.length !== 2) {
    const error = new Error("Invalid stellar address format");
    error.status = 400;
    throw error;
  }

  const [username, domain] = parts;

  // Check if it's our domain
  const ourDomain = process.env.DOMAIN || "stellarmicropay.com";
  if (domain === ourDomain) {
    // Local resolution
    const result = usernameService.resolveUsername(username);
    return {
      stellar_address: stellarAddress,
      account_id: result.publicKey,
    };
  } else {
    // Forward federation to external server
    return await forwardFederation(stellarAddress, "name");
  }
}

/**
 * Resolve an account ID to a stellar address.
 * @param {string} accountId - The account ID to resolve
 * @returns {Object} Federation response
 */
async function resolveAccountId(accountId) {
  // First check local usernames
  const allUsernames = usernameService.getAllUsernames();
  const match = allUsernames.find(user => user.publicKey === accountId);

  if (match) {
    const domain = process.env.DOMAIN || "stellarmicropay.com";
    return {
      stellar_address: `${match.username}*${domain}`,
    };
  }

  // If not found locally, we don't support reverse federation for external addresses
  // per SEP-0002, reverse federation is optional
  const error = new Error("Account ID not found");
  error.status = 404;
  throw error;
}

/**
 * Forward federation request to external federation server.
 * @param {string} query - The query to forward
 * @param {string} type - The type of query
 * @returns {Object} Federation response
 */
async function forwardFederation(query, type) {
  // Parse domain from stellar address
  const parts = query.split("*");
  if (parts.length !== 2) {
    throw new Error("Invalid stellar address format");
  }

  const domain = parts[1];

  // Fetch stellar.toml from the domain
  const tomlUrl = `https://${domain}/.well-known/stellar.toml`;
  const tomlResponse = await axios.get(tomlUrl, { timeout: 5000 });
  const tomlContent = tomlResponse.data;

  // Parse TOML to find FEDERATION_SERVER
  const federationServer = parseFederationServer(tomlContent);
  if (!federationServer) {
    throw new Error("No federation server found in stellar.toml");
  }

  // Make request to external federation server
  const federationUrl = `${federationServer}?q=${encodeURIComponent(query)}&type=${type}`;
  const response = await axios.get(federationUrl, { timeout: 5000 });

  return response.data;
}

/**
 * Parse FEDERATION_SERVER from stellar.toml content.
 * @param {string} tomlContent - The TOML content
 * @returns {string|null} The federation server URL or null
 */
function parseFederationServer(tomlContent) {
  // Simple TOML parsing for FEDERATION_SERVER
  const lines = tomlContent.split("\n");
  let inFederationServer = false;
  let server = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "[FEDERATION_SERVER]") {
      inFederationServer = true;
    } else if (inFederationServer && trimmed.startsWith("SERVER")) {
      const match = trimmed.match(/SERVER\s*=\s*"([^"]+)"/);
      if (match) {
        server = match[1];
        break;
      }
    } else if (inFederationServer && trimmed.startsWith("[")) {
      // End of section
      break;
    }
  }

  return server;
}

module.exports = { resolveFederation };