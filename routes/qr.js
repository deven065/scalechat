const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const {
  extractFileName,
  getNumberOfDaysFromTimestamp,
  checkWarmerPlan,
} = require("../functions/function.js");
const {
  createSession,
  sendMessage,
  getSession,
  deleteSession,
  isExists,
} = require("../helper/addon/qr/index.js");
const { checkPlan, checkQrScan } = require("../middlewares/plan.js");
const validateUser = require("../middlewares/user.js");
const validateAgent = require("../middlewares/agent.js");
const jwt = require("jsonwebtoken");
const logger = require("../utils/logger.js");

function decodeToken(token) {
  return new Promise((resolve) => {
    jwt.verify(token, process.env.JWTKEY, async (err, decode) => {
      if (err) {
        return resolve({
          success: false,
          data: {},
          message: "Invalid API keys",
        });
      }

      const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
        decode?.uid,
      ]);

      if (getUser.length < 1) {
        return resolve({
          success: false,
          data: {},
          message: "Invalid API keys",
        });
      }

      if (getUser[0]?.api_key !== token) {
        return resolve({
          success: false,
          data: {},
          message: "Token was expired.",
        });
      }

      resolve({
        success: true,
        data: getUser[0],
      });
    });
  });
}

router.get("/create", async (req, res) => {
  try {
    const { id } = req.query;
    // Kick off session creation (which returns immediately)
    await createSession(id || "ID");
    res.json({
      success: true,
      msg: "Session generated",
    });
  } catch (err) {
    logger.error(err);
    res.json({
      success: false,
      msg: "Something went wrong",
      err: err.message,
    });
  }
});

router.get("/send", async (req, res) => {
  try {
    const number = req.query;
    const session = await getSession(
      "lWvj6K0xI0FlSKJoyV7ak9DN0mzvKJK8_zCB5YplH",
    );
    logger.log(session);

    if (session) {
      const esn = await session.sendMessage("918430088300@s.whatsapp.net", {
        text: "Hello",
      });
      logger.log({ esn });
    } else {
      logger.log("Session not found");
    }

    res.json("DONE");
  } catch (err) {
    logger.error(err);
    res.json({
      success: false,
      msg: "Something went wrong",
      err: err.message,
    });
  }
});

router.post(
  "/gen_qr",
  validateUser,
  checkPlan,
  checkQrScan,
  async (req, res) => {
    try {
      const { title, uniqueId } = req.body;
      if (!title || !uniqueId) {
        return res.json({
          success: false,
          msg: "Please provide the all fields! title is required",
        });
      }

      logger.log({ title, uniqueId });

      await query(
        `INSERT INTO instance (uid, title, uniqueId, status) VALUES (?,?,?,?)`,
        [req.decode.uid, title, uniqueId, "GENERATING"],
      );

      await createSession(
        uniqueId,
        title?.length > 20 ? title.slice(0, 20) : title,
      );

      res.json({
        success: true,
        msg: "Qr code is generating",
      });
    } catch (err) {
      logger.error(err);
      res.json({
        success: false,
        msg: "Something went wrong",
        err: err.message,
      });
    }
  },
);

// get all instances
router.get("/get_all_agent", validateAgent, async (req, res) => {
  try {
    const { active } = req.query;
    const instances = await query(`SELECT * FROM instance WHERE uid = ?`, [
      req.owner.uid,
    ]);

    if (!instances.length) {
      return res.json({
        success: true,
        data: [],
      });
    }

    // Process each instance
    for (let instance of instances) {
      const check = getSession(instance.uniqueId);

      if (!check) {
        // If no session, update status to "INACTIVE"
        await query(`UPDATE instance SET status = ? WHERE uniqueId = ?`, [
          "INACTIVE",
          instance.uniqueId,
        ]);
        instance.status = "INACTIVE"; // Update status in response as well
      }
    }

    res.json({
      success: true,
      data: instances,
    });
  } catch (err) {
    logger.error(err);
    res.json({
      success: false,
      msg: "Something went wrong",
      err: err.message,
    });
  }
});

// get all instances
router.get("/get_all", validateUser, async (req, res) => {
  try {
    const { active } = req.query;
    const instances = await query(`SELECT * FROM instance WHERE uid = ?`, [
      req.decode.uid,
    ]);

    if (!instances.length) {
      return res.json({
        success: true,
        data: [],
      });
    }

    // Process each instance
    for (let instance of instances) {
      const check = getSession(instance.uniqueId);

      if (!check) {
        // If no session, update status to "INACTIVE"
        await query(`UPDATE instance SET status = ? WHERE uniqueId = ?`, [
          "INACTIVE",
          instance.uniqueId,
        ]);
        instance.status = "INACTIVE"; // Update status in response as well
      }
    }

    res.json({
      success: true,
      data: instances,
    });
  } catch (err) {
    logger.error(err);
    res.json({
      success: false,
      msg: "Something went wrong",
      err: err.message,
    });
  }
});

// del an instance
router.post("/del_instance", validateUser, async (req, res) => {
  try {
    const { uniqueId } = req.body;
    if (!uniqueId) {
      return res.json({
        success: false,
        msg: "Please provide the all fields! uniqueId is required",
      });
    }

    const session = getSession(uniqueId);

    if (session) {
      try {
        await session.logout();
      } catch {
      } finally {
        deleteSession(uniqueId);
      }
    }

    await query(`DELETE FROM instance WHERE uniqueId = ? AND uid = ?`, [
      uniqueId,
      req.decode.uid,
    ]);

    return res.json({ msg: "WhatsApp deleted successfully", success: true });
  } catch (err) {
    logger.error(err);
    res.json({
      success: false,
      msg: "Something went wrong",
      err: err.message,
    });
  }
});

// change instance status
router.post("/change_instance_status", validateUser, async (req, res) => {
  try {
    const statuses = [
      "unavailable",
      "available",
      // "composing",
      // "recording",
      // "paused",
    ];

    const { insId, status, jid } = req.body;

    const session = await getSession(insId);

    if (!session) {
      return res.json({
        msg: "Unable to change status right now WA is busy",
      });
    }

    if (!statuses.includes(status)) {
      return res.json({
        msg: "Invalid status found",
      });
    }

    const finalUpdate = { onlineStatus: status };

    await session.sendPresenceUpdate(status);
    await query(`UPDATE instance SET other = ? WHERE uniqueId = ?`, [
      JSON.stringify(finalUpdate),
      insId,
    ]);

    res.json({
      success: true,
      msg: "Online status update request sent",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// POST endpoint handler
router.post("/rest/send_message", async (req, res) => {
  try {
    logger.log({
      body: req.body,
    });
    // Validate required parameters
    const requiredParams = [
      "messageType",
      "requestType",
      "token",
      "from",
      "to",
    ];
    const missingParams = requiredParams.filter((param) => !req.body[param]);

    if (missingParams.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required parameters: ${missingParams.join(", ")}`,
        requiredParameters: {
          messageType:
            "Type of message (text, image, video, audio, document, location)",
          requestType: "Must be 'POST' for this endpoint",
          token: "Authentication token",
          from: "Sender phone number with country code",
          to: "Recipient phone number with country code",
        },
      });
    }

    // Extract and validate request type
    const requestType = "post";
    if (requestType !== "post") {
      return res.status(400).json({
        success: false,
        message: "Invalid requestType for POST endpoint. Must be 'POST'.",
        solution: "Use requestType='POST' or call the GET endpoint instead",
      });
    }

    // Process the request (shared function)
    await processMessageRequest(req.body, res);
  } catch (error) {
    handleError(error, res);
  }
});

// GET endpoint handler
router.get("/rest/send_message", async (req, res) => {
  try {
    logger.log(req.query);
    // Validate required parameters
    // Trim 'from' and 'to' if they exist
    if (req.query.from) req.query.from = req.query.from.trim();
    if (req.query.to) req.query.to = req.query.to.trim();

    const requiredParams = [
      "messageType",
      "requestType",
      "token",
      "from",
      "to",
    ];

    const missingParams = requiredParams.filter((param) => !req.query[param]);

    if (missingParams.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required parameters: ${missingParams.join(", ")}`,
        requiredParameters: {
          messageType:
            "Type of message (text, image, video, audio, document, location)",
          requestType: "Must be 'GET' for this endpoint",
          token: "Authentication token",
          from: "Sender phone number with country code",
          to: "Recipient phone number with country code",
        },
      });
    }

    // Extract and validate request type
    const requestType = "get";
    if (requestType !== "get") {
      return res.status(400).json({
        success: false,
        message: "Invalid requestType for GET endpoint. Must be 'GET'.",
        solution: "Use requestType='GET' or call the POST endpoint instead",
      });
    }

    // Process the request (shared function)
    await processMessageRequest(req.query, res);
  } catch (error) {
    handleError(error, res);
  }
});

// Shared function to process message requests
async function processMessageRequest(params, res) {
  const messageType = params.messageType.toLowerCase();

  // Validate message content based on type
  let msgContent;
  switch (messageType) {
    case "text":
      if (!params.text) {
        return res.status(400).json({
          success: false,
          message: "Text content is required for text messages.",
        });
      }
      msgContent = { text: params.text };
      break;

    case "image":
      if (!params.imageUrl) {
        return res.status(400).json({
          success: false,
          message: "imageUrl is required for image messages.",
        });
      }
      msgContent = {
        image: { url: params.imageUrl },
        caption: params.caption || "",
      };
      break;

    case "video":
      if (!params.videoUrl) {
        return res.status(400).json({
          success: false,
          message: "videoUrl is required for video messages.",
        });
      }
      msgContent = {
        video: { url: params.videoUrl },
        caption: params.caption || "",
      };
      break;

    case "audio":
      if (!params.aacUrl) {
        return res.status(400).json({
          success: false,
          message: "aacUrl is required for audio messages.",
        });
      }
      msgContent = {
        audio: { url: params.aacUrl },
        ptt: true,
        mimetype: "audio/aac",
      };
      break;

    case "document":
      if (!params.docUrl) {
        return res.status(400).json({
          success: false,
          message: "docUrl is required for document messages.",
        });
      }
      msgContent = {
        document: { url: params.docUrl },
        caption: params.caption || "",
        fileName: extractFileName(params.docUrl),
      };
      break;

    case "location":
      if (!params.lat || !params.long) {
        return res.status(400).json({
          success: false,
          message:
            "Both latitude (lat) and longitude (long) are required for location messages.",
        });
      }
      msgContent = {
        location: {
          degreesLatitude: parseFloat(params.lat),
          degreesLongitude: parseFloat(params.long),
          name: params.title || "Shared Location",
        },
      };
      break;

    default:
      return res.status(400).json({
        success: false,
        message: "Invalid message type provided.",
        allowedTypes: [
          "text",
          "image",
          "video",
          "audio",
          "document",
          "location",
        ],
      });
  }

  // Validate token
  const checkToken = await decodeToken(params.token);
  if (!checkToken.success) {
    return res.status(401).json({
      success: false,
      message: "Authentication failed. Invalid API token provided.",
    });
  }

  // Check user plan
  const user = checkToken.data;
  if (!user.plan || !user.plan_expire) {
    return res.status(403).json({
      success: false,
      message:
        "No active subscription plan found. Please purchase a plan to continue using this service.",
      actionRequired: "Purchase a subscription plan",
    });
  }

  const checkWarmer = await checkWarmerPlan({ uid: user.uid });
  if (!checkWarmer) {
    return res.status(403).json({
      success: false,
      message: "Your subscription plan does not allow Rest API QR function.",
      actionRequired: "Get a plan which has QR Rest API in it",
    });
  }

  // Check plan expiration
  const daysRemaining = getNumberOfDaysFromTimestamp(user.plan_expire);
  if (daysRemaining < 1) {
    return res.status(403).json({
      success: false,
      message:
        "Your subscription plan has expired. Please renew your plan to continue using this service.",
      actionRequired: "Renew your subscription plan",
    });
  }

  // Validate instance
  const formattedFrom = params.from.replace("+", "");
  const [instance] = await query(
    `SELECT * FROM instance WHERE uid = ? AND number = ? AND status = ?`,
    [user.uid, formattedFrom, "ACTIVE"],
  );

  if (!instance) {
    return res.status(404).json({
      success: false,
      message: `No active WhatsApp instance found for number ${params.from}.`,
      solution: "Please ensure you have an active instance with this number",
    });
  }

  // Check session
  const session = await getSession(instance.uniqueId);
  if (!session) {
    return res.status(500).json({
      success: false,
      message: `The WhatsApp session for ${params.from} is not currently active.`,
      solution: "Please restart the session and try again",
    });
  }

  const checkNumber = await isExists(
    session,
    `${params.to}@s.whatsapp.net`,
    false,
  );

  if (!checkNumber) {
    return res.json({
      success: false,
      message: "This number is not found on WhatsApp",
      solution: "Please give a number which is available on WhatsApp",
    });
  }

  // Send message
  const sendMsg = await session.sendMessage(
    `${params.to}@s.whatsapp.net`,
    msgContent,
  );

  // Success response
  res.status(200).json({
    success: true,
    message: "Message sent successfully",
    data: {
      messageId: sendMsg.key?.id,
      timestamp: new Date().toISOString(),
      recipient: params.to,
      messageType: messageType,
      contentPreview:
        messageType === "text"
          ? params.text.substring(0, 50) +
            (params.text.length > 50 ? "..." : "")
          : `[${messageType.toUpperCase()}] ${params.caption || ""}`,
    },
    other: sendMsg,
  });
}

// Shared error handler
function handleError(error, res) {
  logger.error("Message sending error:", error);
  res.status(500).json({
    success: false,
    message: "An unexpected error occurred while processing your request.",
    technicalDetails:
      process.env.NODE_ENV === "development" ? error.message : undefined,
    supportContact: "support@yourdomain.com",
  });
}

module.exports = router;
