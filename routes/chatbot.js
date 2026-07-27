const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const {
  isValidEmail,
  getFileExtension,
  makeRequest,
} = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { checkPlan } = require("../middlewares/plan.js");
const logger = require("../utils/logger.js");

function hasPropertyWithValue(arr, property, value) {
  return arr.some((item) => item[property] === value);
}

router.post("/add_beta_chatbot", validateUser, checkPlan, async (req, res) => {
  try {
    const { title, origin, flow } = req.body;
    if (!title || !origin || !flow?.id) {
      return res.json({ msg: "Please fill all required fields" });
    }

    if (req.plan?.allow_chatbot < 1) {
      return res.json({
        success: false,
        msg: "Your plan does not allow you to set a chatbot",
      });
    }

    const { flow_id } = flow;
    const [getFlow] = await query(
      `SELECT * FROM beta_flows WHERE flow_id = ? AND uid = ?`,
      [flow_id, req.decode.uid],
    );
    if (!getFlow) {
      return res.json({ msg: "This flow is not existed" });
    }

    const flowNodesEdges = getFlow?.data ? JSON.parse(getFlow.data) : null;
    if (!flowNodesEdges || flowNodesEdges?.nodes?.length < 2) {
      return res.json({
        msg: "This flow does not have enough nodes to start, Please complete the flow",
      });
    }

    const { nodes, edges } = flowNodesEdges;

    // Interactive messages only work on META — block for others
    if (origin?.code !== "META") {
      const hasButtons = nodes.some(
        (node) =>
          node.data?.type?.type === "button" ||
          (node.data?.content?.type === "interactive" &&
            node.data?.content?.interactive?.type === "button"),
      );
      const hasLists = nodes.some(
        (node) =>
          node.data?.type?.type === "list" ||
          (node.data?.content?.type === "interactive" &&
            node.data?.content?.interactive?.type === "list"),
      );

      if (hasButtons || hasLists) {
        const originLabel =
          origin.code === "TELEGRAM"
            ? "Telegram"
            : origin.code === "INSTAGRAM"
              ? "Instagram"
              : "QR";
        return res.json({
          success: false,
          msg: `Interactive buttons and lists are not supported for ${originLabel} origin.`,
        });
      }
    }

    const validOrigins = [
      "QR",
      "META",
      "WEBHOOK_AUTOMATION",
      "TELEGRAM",
      "INSTAGRAM",
      "INSTAGRAM_COMMENT",
    ];
    if (!validOrigins.includes(origin.code)) {
      return res.json({ msg: `Selected Origin not found ${origin?.code}` });
    }

    // ── origin-specific validation ──────────────────────────────────────────
    if (origin.code === "QR" && !origin.data?.uniqueId) {
      return res.json({ msg: "No active account found using this origin" });
    }
    if (origin.code === "TELEGRAM" && !origin.data?.id) {
      return res.json({
        msg: "No active Telegram session found using this origin",
      });
    }
    if (origin.code === "INSTAGRAM" && !origin.data?.user_id) {
      return res.json({
        msg: "No active Instagram account found using this origin",
      });
    }
    if (origin.code === "INSTAGRAM_COMMENT" && !origin.data?.user_id) {
      return res.json({
        msg: "No active Instagram account found using this origin",
      });
    }

    // ── duplicate check ─────────────────────────────────────────────────────
    const getAllChatbots = await query(
      `SELECT * FROM beta_chatbot WHERE uid = ?`,
      [req.decode.uid],
    );
    const chatbots = getAllChatbots?.map((x) => JSON.parse(x.origin)) || [];

    if (origin?.code === "META" && chatbots.find((x) => x.code === "META")) {
      return res.json({
        msg: "A chatbot is already running for META, please delete that first",
      });
    }

    if (
      chatbots.find((x) => x.title === origin?.title && x.code === origin?.code)
    ) {
      return res.json({
        msg: "A chatbot with this origin already exists",
      });
    }

    // ── resolve origin_id ───────────────────────────────────────────────────
    let origin_id;
    if (origin.code === "META") {
      origin_id = "META";
    } else if (origin.code === "TELEGRAM") {
      origin_id = origin.data?.session_id || origin.data?.id;
    } else if (origin.code === "QR") {
      origin_id = origin.data?.uniqueId;
    } else if (origin.code === "INSTAGRAM") {
      origin_id = origin.data?.user_id;
    } else if (origin.code === "INSTAGRAM_COMMENT") {
      origin_id = origin.data?.user_id; // ✅ FIXED
    } else {
      origin_id = null;
    }

    // ── resolve source ──────────────────────────────────────────────────────
    let source;
    if (origin?.code === "WEBHOOK_AUTOMATION") {
      source = "webhook_automation";
    } else if (origin?.code === "INSTAGRAM") {
      source = "instagram_chatbot";
    } else if (origin?.code === "INSTAGRAM_COMMENT") {
      source = "instagram_comment"; // ✅ FIXED
    } else {
      source = "wa_chatbot";
    }

    await query(
      `INSERT INTO beta_chatbot (uid, source, title, flow_id, origin, origin_id) VALUES (?,?,?,?,?,?)`,
      [
        req.decode.uid,
        source,
        title,
        flow_id,
        JSON.stringify(origin),
        origin_id,
      ],
    );

    res.json({ success: true, msg: "Chatbot was added successfully" });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// get all chatbots beta
router.get("/get_beta_chatbots", validateUser, async (req, res) => {
  try {
    const { type } = req.query;
    const data = await query(
      `SELECT * FROM beta_chatbot WHERE uid = ? AND source = ?`,
      [req.decode.uid, type],
    );
    res.json({ data, success: true });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// change bot status
router.post("/change_beta_bot_status", validateUser, async (req, res) => {
  try {
    const { id, status } = req.body;
    await query(`UPDATE beta_chatbot SET active = ? WHERE uid = ? AND id = ?`, [
      status ? 1 : 0,
      req.decode.uid,
      id,
    ]);
    res.json({ msg: "Satus changed", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// del beta chatbot
router.post("/del_beta_chatbot", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM beta_chatbot WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ msg: "Chatbot was deleted", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

module.exports = router;
