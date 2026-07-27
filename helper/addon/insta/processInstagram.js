const { query } = require("../../../database/dbpromise");

// ─── Stub: processInstaMessage ────────────────────────────
async function processInstaMessage({ body, uid }) {
  return {
    newMessage: null,
    chatId: null,
    sessionId: null,
    __stub: "plugin_required",
  };
}

// ─── Stub: resolveAccountFromWebhook ─────────────────────
async function resolveAccountFromWebhook(igBusinessId) {
  return null;
}

// ─── Stub: processInstaComment ────────────────────────────
async function processInstaComment({ igAccount, commentData, uid }) {
  return {
    message: null,
    chatId: null,
    __stub: "plugin_required",
  };
}

module.exports = {
  processInstaMessage,
  resolveAccountFromWebhook,
  processInstaComment,
};
