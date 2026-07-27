const axios = require("axios");
const { query } = require("../../../database/dbpromise");

// Stub function that returns false to indicate embed is disabled
function checkEmbed() {
  return false;
}

// Register phone number - stub
async function registerPhoneNumber({ token, phoneNumId, pin = "123456" }) {
  return {
    success: false,
    msg: "Registration disabled (stub)",
  };
}

// Get phone number status - stub
async function getPhoneNumberStatus({ token, phoneNumId }) {
  return {
    success: false,
    msg: "Phone status check disabled (stub)",
  };
}

// Subscribe to webhook - stub
async function subscribeWebhook({ token, wabaId }) {
  return {
    success: false,
    msg: "Webhook subscription disabled (stub)",
  };
}

// Get WABA details - stub
async function getWABADetails({ token, wabaId }) {
  return {
    success: false,
    msg: "WABA details disabled (stub)",
  };
}

// Exchange token - stub
async function exchangeEmbedToken({
  appId,
  appSecret,
  authCode,
  wabaId,
  phoneNumId,
  businessId,
  registrationPin = "123456",
}) {
  return {
    success: false,
    msg: "Token exchange disabled (stub)",
  };
}

// Generate embed webhook - stub
async function genEmbedWebhook(params) {
  return null;
}

module.exports = {
  checkEmbed,
  exchangeEmbedToken,
  genEmbedWebhook,
  registerPhoneNumber,
  getPhoneNumberStatus,
  subscribeWebhook,
  getWABADetails,
};
