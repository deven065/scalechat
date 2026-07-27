const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function aiTransferHandler(params) {
  return { success: false, message: "Ai plugin is required" };
}

module.exports = { aiTransferHandler };
