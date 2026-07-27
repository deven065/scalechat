const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const {
  createSession,
  verifyCode,
  getUserSessions,
  getSessionStatus,
  connectSession,
  disconnectSession,
  deleteSession,
  getChats,
  checkTele,
  sendMessage,
} = require("../helper/addon/telegram/tele.js");
const { checkPlan, checkTeleInbox } = require("../middlewares/plan.js");
const validateUser = require("../middlewares/user.js");
const logger = require("../utils/logger.js");

// Helper function to format phone number
function formatNumber(number) {
  return number?.replace("+", "");
}

// ============================================
// SESSION MANAGEMENT ROUTES
// ============================================

// Create new session and send OTP
router.post(
  "/send_otp",
  validateUser,
  checkPlan,
  checkTeleInbox,
  async (req, res) => {
    try {
      const { mobile, title, sessionId } = req.body;

      if (!mobile || !title || !sessionId) {
        return res.json({
          success: false,
          msg: "Missing required fields: mobile, title, or sessionId",
        });
      }

      const [api] = await query(`SELECT * FROM web_private`, []);
      const apiId = api?.teleAppId;
      const apiHash = api?.teleHash;

      if (!apiId || !apiHash) {
        return res.json({ msg: "Telegram creds are required from admin." });
      }

      const result = await createSession(
        req.decode.uid,
        title,
        `+${formatNumber(mobile)}`,
        sessionId,
        apiId,
        apiHash,
      );

      res.json(result);
    } catch (err) {
      res.json({
        success: false,
        msg: err.userMessage || "Failed to send OTP",
        err: err.message,
      });
      logger.log(err);
    }
  },
);

// Verify OTP code
router.post("/verify_otp", validateUser, async (req, res) => {
  try {
    const { sessionId, code } = req.body;

    if (!sessionId || !code) {
      return res.json({
        success: false,
        msg: "Missing required fields: sessionId or code",
      });
    }

    const result = await verifyCode(sessionId, code);
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      msg: err.userMessage || "Verification failed",
      err: err.message,
    });
    logger.log(err);
  }
});

// Get all sessions for logged-in user
router.get("/sessions", validateUser, async (req, res) => {
  try {
    const sessions = await getUserSessions(req.decode.uid);
    res.json({ success: true, sessions });
  } catch (err) {
    res.json({
      success: false,
      msg: err.userMessage || "Failed to fetch sessions",
      err: err.message,
    });
    logger.log(err);
  }
});

// Get specific session status
router.get("/session_status/:sessionId", validateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await getSessionStatus(sessionId);
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      msg: "Failed to get session status",
      err: err.message,
    });
    logger.log(err);
  }
});

// Reconnect existing session
router.post("/reconnect", validateUser, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.json({
        success: false,
        msg: "Missing required field: sessionId",
      });
    }

    const result = await connectSession(sessionId);
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      msg: err.userMessage || "Failed to reconnect session",
      err: err.message,
    });
    logger.log(err);
  }
});

// Disconnect active session
router.post("/disconnect", validateUser, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.json({
        success: false,
        msg: "Missing required field: sessionId",
      });
    }

    const result = await disconnectSession(sessionId);
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      msg: err.userMessage || "Failed to disconnect session",
      err: err.message,
    });
    logger.log(err);
  }
});

// Delete session (supports both GET and DELETE methods for compatibility)
router.get("/session/:sessionId", validateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await deleteSession(sessionId);
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      msg: err.userMessage || "Failed to delete session",
      err: err.message,
    });
    logger.log(err);
  }
});

// Alternative GET endpoint for delete (for frontend compatibility)
router.get("/delete_session/:sessionId", validateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await deleteSession(sessionId);
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      msg: err.userMessage || "Failed to delete session",
      err: err.message,
    });
    logger.log(err);
  }
});

// ============================================
// MESSAGING ROUTES
// ============================================

// Send message to a chat
router.post("/send_message", validateUser, async (req, res) => {
  try {
    const { sessionId, chatId, message } = req.body;

    if (!sessionId || !chatId || !message) {
      return res.json({
        success: false,
        msg: "Missing required fields: sessionId, chatId, or message",
      });
    }

    const result = await sendMessage(sessionId, chatId, message);
    res.json(result);
  } catch (err) {
    res.json({
      success: false,
      msg: err.userMessage || "Failed to send message",
      err: err.message,
    });
    logger.log(err);
  }
});

// ============================================
// CHAT/DIALOG ROUTES
// ============================================

// Get chats/dialogs for a session
router.get("/chats/:sessionId", validateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit } = req.query;

    const chats = await getChats(sessionId, parseInt(limit) || 50);

    res.json({
      success: true,
      chats,
    });
  } catch (err) {
    res.json({
      success: false,
      msg: err.userMessage || "Failed to fetch chats",
      err: err.message,
    });
    logger.log(err);
  }
});

// Alternative POST endpoint for getting chats
router.post("/get_chats", validateUser, async (req, res) => {
  try {
    const { sessionId, limit } = req.body;

    if (!sessionId) {
      return res.json({
        success: false,
        msg: "Missing required field: sessionId",
      });
    }

    const chats = await getChats(sessionId, parseInt(limit) || 50);

    res.json({
      success: true,
      chats,
    });
  } catch (err) {
    res.json({
      success: false,
      msg: err.userMessage || "Failed to fetch chats",
      err: err.message,
    });
    logger.log(err);
  }
});

// ============================================
// STATUS CHECK ROUTES
// ============================================

// Check if specific session is connected
router.get("/check_status/:sessionId", validateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const connected = checkTele(sessionId);

    res.json({
      success: true,
      connected,
      sessionId,
    });
  } catch (err) {
    res.json({
      success: false,
      msg: "Failed to check session status",
      err: err.message,
    });
    logger.log(err);
  }
});

// Check multiple sessions status
router.post("/check_multiple_status", validateUser, async (req, res) => {
  try {
    const { sessionIds } = req.body;

    if (!sessionIds || !Array.isArray(sessionIds)) {
      return res.json({
        success: false,
        msg: "sessionIds must be an array",
      });
    }

    const statuses = sessionIds.map((sessionId) => ({
      sessionId,
      connected: checkTele(sessionId),
    }));

    res.json({
      success: true,
      statuses,
    });
  } catch (err) {
    res.json({
      success: false,
      msg: "Failed to check sessions status",
      err: err.message,
    });
    logger.log(err);
  }
});

// ============================================
// TESTING/DEBUG ROUTES (Optional - Remove in production)
// ============================================

// Test route
router.post("/test", validateUser, async (req, res) => {
  try {
    const { title } = req.body;
    res.json({ msg: title, success: true, uid: req.decode.uid });
  } catch (err) {
    res.json({
      success: false,
      msg: "Test failed",
      err: err.message,
    });
    logger.log(err);
  }
});

// Health check
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Telegram routes are working",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
