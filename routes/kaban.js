const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const validateUser = require("../middlewares/user.js");
const { checkPlan } = require("../middlewares/plan.js");
const logger = require("../utils/logger.js");

// ── Move card to a new column (replace first label) ──────────────────────────
router.post("/move_card", validateUser, checkPlan, async (req, res) => {
  try {
    const uid = req.decode.uid;
    const { chatId, newLabelId, kanban_order } = req.body;

    if (!chatId) return res.json({ success: false, msg: "chatId is required" });

    const [chat] = await query(
      `SELECT id, chat_label FROM beta_chats WHERE id = ? AND uid = ?`,
      [chatId, uid],
    );
    if (!chat) return res.json({ success: false, msg: "Chat not found" });

    // Moving to unlabeled column → clear all labels
    if (!newLabelId) {
      await query(
        `UPDATE beta_chats SET chat_label = ?, kanban_order = ? WHERE id = ? AND uid = ?`,
        [JSON.stringify([]), kanban_order ?? 0, chatId, uid],
      );
      return res.json({ success: true });
    }

    const [newLabel] = await query(
      `SELECT * FROM chat_tags WHERE id = ? AND uid = ?`,
      [newLabelId, uid],
    );
    if (!newLabel) return res.json({ success: false, msg: "Label not found" });

    let existingLabels = [];
    try {
      const parsed = JSON.parse(chat.chat_label || "[]");
      existingLabels = Array.isArray(parsed) ? parsed : [parsed];
    } catch {}

    // Replace first label, keep the rest
    const updatedLabels = [newLabel, ...existingLabels.slice(1)];

    await query(
      `UPDATE beta_chats SET chat_label = ?, kanban_order = ? WHERE id = ? AND uid = ?`,
      [JSON.stringify(updatedLabels), kanban_order ?? 0, chatId, uid],
    );

    res.json({ success: true });
  } catch (err) {
    logger.error(err);
    res.json({ success: false, msg: "Something went wrong" });
  }
});

router.post("/get_board", validateUser, checkPlan, async (req, res) => {
  try {
    const uid = req.decode.uid;
    const { search = "", limit = 20, offset = 0 } = req.body;

    const labels = await query(
      `SELECT * FROM chat_tags WHERE uid = ? ORDER BY id ASC`,
      [uid],
    );

    // Build search condition
    let searchCondition = `WHERE uid = ?`;
    const params = [uid];

    if (search) {
      searchCondition += ` AND (
        sender_name LIKE ? OR
        sender_mobile LIKE ? OR
        last_message LIKE ? OR
        chat_label LIKE ?
      )`;
      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%"title":"%${search}%"%`,
      );
    }

    // Get total count
    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM beta_chats ${searchCondition}`,
      params,
    );

    const chats = await query(
      `SELECT id, chat_id, sender_name, sender_mobile, last_message,
              origin, unread_count, assigned_agent, chat_label, kanban_order, updatedAt
       FROM beta_chats ${searchCondition}
       ORDER BY kanban_order ASC, updatedAt DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const parsedChats = chats.map((chat) => {
      try {
        chat.last_message = JSON.parse(chat.last_message);
      } catch {}
      return chat;
    });

    // Group by label
    const grouped = {};
    labels.forEach((l) => (grouped[l.id] = []));
    grouped["unlabeled"] = [];

    parsedChats.forEach((chat) => {
      let firstLabel = null;
      try {
        const arr = JSON.parse(
          typeof chat.chat_label === "string" ? chat.chat_label : "[]",
        );
        firstLabel = (Array.isArray(arr) ? arr : [arr])[0] || null;
      } catch {}

      if (firstLabel && grouped[firstLabel.id] !== undefined) {
        grouped[firstLabel.id].push({ ...chat, kanbanLabel: firstLabel });
      } else {
        grouped["unlabeled"].push({ ...chat, kanbanLabel: null });
      }
    });

    res.json({ success: true, labels, grouped, total, offset, limit });
  } catch (err) {
    logger.error(err);
    res.json({ success: false, msg: "Something went wrong" });
  }
});

module.exports = router;
