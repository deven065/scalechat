const { query } = require("../../../database/dbpromise");

const API_VERSION = "v21.0";

function checkInsta() {
  return false;
}

async function genInstaWebhook() {
  return null;
}

async function subscribeInstaWebhook(accessToken) {
  return null;
}

async function getInstaCallbackUri() {
  return null;
}

async function exchangeShortToken({ appId, appSecret, redirectUri, code }) {
  return null;
}

async function exchangeLongToken({ appSecret, shortToken }) {
  return null;
}

async function fetchInstaProfile(token) {
  return null;
}

module.exports = {
  checkInsta,
  genInstaWebhook,
  exchangeShortToken,
  exchangeLongToken,
  fetchInstaProfile,
  API_VERSION,
  getInstaCallbackUri,
  subscribeInstaWebhook,
};
