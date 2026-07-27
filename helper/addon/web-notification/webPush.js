const admin = require("firebase-admin");
const { query } = require("../../../database/dbpromise");

async function sendFcmPushNotification({
  fcm_projectId,
  fcm_clientEmail,
  fcm_privateKey,
  tokens,
  notification,
}) {
  return { success: false, msg: "Plugin required" };
}

const generateNotificationFromMessage = (msg, langData = {}) => {
  return { success: false, msg: "Plugin required" };
};

async function extractTokens(params) {
  return { success: false, msg: "Plugin required" };
}

async function processWebPushMessageNotificaion({
  uid,
  message,
  user,
  sessionId,
  origin,
  chatId,
}) {
  return { success: false, msg: "Plugin required" };
}

function checkWebPush() {
  return false;
}

module.exports = {
  checkWebPush,
  sendFcmPushNotification,
  generateNotificationFromMessage,
  processWebPushMessageNotificaion,
};
