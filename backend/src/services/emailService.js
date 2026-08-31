"use strict";

const nodemailer = require("nodemailer");

const logger = require("../utils/logger");

// Create a reusable transporter using the SMTP configuration
function getTransporter() {
  const host = process.env.SMTP_HOST || "localhost";
  const port = parseInt(process.env.SMTP_PORT || "1025", 10);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const secure = process.env.SMTP_SECURE === "true";

  // Configuration object
  const config = {
    host,
    port,
    secure,
  };

  if (user && pass) {
    config.auth = {
      user,
      pass,
    };
  }

  return nodemailer.createTransport(config);
}

/**
 * Send an email
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text content
 * @param {string} [options.html] - HTML content
 */
async function sendEmail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || "no-reply@stellarmicropay.io";

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });

    logger.info(JSON.stringify({ type: "email_sent", messageId: info.messageId, to, subject }));
    return info;
  } catch (err) {
    logger.error(JSON.stringify({ type: "email_error", error: err.message, to, subject }));
    throw err;
  }
}

module.exports = {
  sendEmail,
};
