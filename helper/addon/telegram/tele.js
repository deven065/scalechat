const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { query } = require("../../../database/dbpromise");
const { processMessage } = require("../../inbox/inbox");

// Store active clients in memory
const activeClients = new Map();

// Store pending auth clients
const pendingClients = new Map();

// Store session metadata
const sessionMetadata = new Map();

// Error message mapper
function getErrorMessage(error) {
  const errorStr = error.message || error.toString();

  const errorMap = {
    PHONE_CODE_INVALID: "Invalid verification code. Please try again.",
    PHONE_CODE_EXPIRED: "Verification code expired. Please request a new code.",
    PHONE_NUMBER_INVALID: "Invalid phone number format.",
    SESSION_PASSWORD_NEEDED:
      "Two-factor authentication enabled. Password required.",
    AUTH_KEY_UNREGISTERED: "Session expired. Please create a new session.",
    USER_DEACTIVATED: "This account has been deactivated.",
    PHONE_NUMBER_BANNED: "This phone number is banned from Telegram.",
    TIMEOUT: "Connection timeout. Please try again.",
    FLOOD_WAIT: "Too many requests. Please wait a moment.",
  };

  for (const [key, message] of Object.entries(errorMap)) {
    if (errorStr.includes(key)) {
      return message;
    }
  }

  return errorStr;
}

// Get user profile info
async function getUserProfile(client) {
  return null;
}

// Setup message listener (centralized)
function setupMessageListener(client, title, sessionId) {
  return false;
}

function getSession(sid) {
  return null;
}

// Initialize all sessions on app start
async function initTele() {
  return false;
}

// Update connectSession function
async function connectSession(sessionId, isNew = false) {
  return { success: false, message: "Telegram plugin is required" };
}

// Update createSession function
async function createSession(
  uid,
  title,
  phoneNumber,
  sessionId,
  apiId,
  apiHash,
) {
  return {
    success: false,
    message: "Telegram plugin is required",
  };
}

// Update verifyCode function
async function verifyCode(sessionId, code) {
  return {
    success: false,
    message: "Telegram plugin is required",
  };
}

// Get session status with profile
async function getSessionStatus(sessionId) {
  return {
    success: false,
    message: "Telegram plugin is required",
  };
}

// Update getUserSessions function
async function getUserSessions(uid) {
  return [];
}

// Logout and delete session
async function deleteSession(sessionId) {
  return { success: false, message: "Telegram plugin is required" };
}

// Disconnect session
async function disconnectSession(sessionId) {
  return { success: false, message: "Telegram plugin is required" };
}

// Send message
async function sendMessage(sessionId, chatId, message) {
  return { success: false, message: "Telegram plugin is required" };
}

// Get chats/dialogs
async function getChats(sessionId, limit = 50) {
  return [];
}

// Check if session is active
function checkTele(sessionId) {
  return false;
}

// Cleanup on app shutdown
async function cleanupTele() {
  return false;
}

function checkTelePlugin() {
  return false;
}

module.exports = {
  initTele,
  checkTelePlugin,
  createSession,
  verifyCode,
  connectSession,
  disconnectSession,
  deleteSession,
  sendMessage,
  getChats,
  getUserSessions,
  getSessionStatus,
  cleanupTele,
  checkTele,
  getSession,
};
