const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const {
  isValidEmail,
  getFileExtension,
  makeRequestBeta,
  executeMySQLQuery,
  buildSystemPrompt,
  buildUserPrompt,
  callOpenAI,
  callGemini,
  callDeepSeek,
} = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { checkPlan } = require("../middlewares/plan.js");
const validateAgent = require("../middlewares/agent.js");
const { returnAddons } = require("../utils/addons.js");
const axios = require("axios");
const logger = require("../utils/logger.js");

const validateLastNode = (nodes, edges) => {
  // Find all target nodes (nodes that have incoming connections)
  const targetNodeIds = new Set(edges.map((edge) => edge.target));

  // Find source nodes that aren't targets (potential starting nodes)
  const startingNodes = nodes.filter((node) => !targetNodeIds.has(node.id));

  // If no edges exist, just check the last node in array
  if (edges.length === 0) {
    const lastNode = nodes[nodes.length - 1];
    if (lastNode?.data?.moveToNextNode) {
      return {
        isValid: false,
        message: `${lastNode?.type} Node cannot be last.`,
      };
    }
    return { isValid: true };
  }

  // Traverse the flow to find the actual last connected node
  let lastConnectedNode = null;
  const visited = new Set();

  const traverse = (currentNodeId) => {
    if (visited.has(currentNodeId)) return;
    visited.add(currentNodeId);

    const outgoingEdges = edges.filter((edge) => edge.source === currentNodeId);
    if (outgoingEdges.length === 0) {
      const node = nodes.find((n) => n.id === currentNodeId);
      if (
        node &&
        (!lastConnectedNode || node.position.x > lastConnectedNode.position.x)
      ) {
        lastConnectedNode = node;
      }
      return;
    }

    outgoingEdges.forEach((edge) => {
      traverse(edge.target);
    });
  };

  // Start traversal from all starting nodes
  startingNodes.forEach((node) => traverse(node.id));

  if (lastConnectedNode?.data?.moveToNextNode) {
    return {
      isValid: false,
      message: `${lastConnectedNode?.type} Node cannot be last in the flow.`,
    };
  }

  return { isValid: true };
};

// add new beta
router.post("/insert_flow_beta", validateUser, checkPlan, async (req, res) => {
  try {
    const { name, flow_id, data, source } = req.body;
    if (!name && !flow_id) {
      return res.json({ msg: "Please type a flow name" });
    }

    const nodesVar = data?.nodes || [];

    const validation = validateLastNode(nodesVar, data?.edges);
    if (!validation.isValid) {
      return res.json({ msg: validation.message });
    }

    const sourceTypes = [
      "wa_chatbot",
      "webhook_flow",
      "webhook_automation",
      "telegram_chatbot",
      "instagram_chatbot",
      "instagram_comment",
    ];

    if (!sourceTypes.includes(source)) {
      return res.json({ msg: `Unknown flow source found: ${source}` });
    }

    if (data?.nodes?.length < 1 || data?.edges?.length < 1) {
      return res.json({ msg: "Blank flow can ot be saved" });
    }

    // checking with the same id
    const [cehckId] = await query(
      `SELECT * FROM beta_flows WHERE flow_id = ?`,
      [flow_id],
    );
    if (cehckId) {
      await query(
        `UPDATE beta_flows SET name = ?, data = ?, source = ? WHERE flow_id = ?`,
        [name, JSON.stringify(data), source, flow_id],
      );

      res.json({ msg: "Flows was updated", success: true });
    } else {
      await query(
        `INSERT INTO beta_flows (uid, flow_id, source, name, data) VALUES (?,?,?,?,?)`,
        [req.decode.uid, flow_id, source, name, JSON.stringify(data)],
      );

      res.json({ msg: "Flows was saved", success: true });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// get flows beta
router.get("/get_flows_beta", validateUser, checkPlan, async (req, res) => {
  try {
    const { type } = req.query;

    let data = [];
    if (type === "all") {
      data = await query(`SELECT * FROM beta_flows WHERE uid = ?`, [
        req.decode.uid,
      ]);
    } else {
      data = await query(
        `SELECT * FROM beta_flows WHERE uid = ? AND source = ?`,
        [req.decode.uid, type],
      );
    }
    data = data.map((x) => {
      return {
        ...x,
        data: JSON.parse(x.data),
      };
    });

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// del flow beta
router.post("/del_flow_beta", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM beta_flows WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ msg: "Flow was deleted", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// get my flows
router.get("/get_mine", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM flow WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// get chats activity
router.post("/get_activity", validateUser, checkPlan, async (req, res) => {
  try {
    const { flowId } = req.body;

    const getFlow = await query(
      `SELECT * FROM flow WHERE uid = ? AND flow_id = ?`,
      [req.decode.uid, flowId],
    );

    // Parse prevent and ai lists from the database
    const prevent = getFlow[0]?.prevent_list
      ? JSON.parse(getFlow[0]?.prevent_list)
      : [];
    const ai = getFlow[0]?.ai_list ? JSON.parse(getFlow[0]?.ai_list) : [];

    // Assign unique IDs to each item in the prevent and ai lists
    const preventWithIds = prevent.map((item, index) => ({
      ...item,
      id: `prevent-${index}`, // Assign a unique ID using the index
    }));
    const aiWithIds = ai.map((item, index) => ({
      ...item,
      id: `ai-${index}`, // Assign a unique ID using the index
    }));

    // Log the data with unique IDs
    logger.log({
      prevent: preventWithIds,
      ai: aiWithIds,
    });

    // Send the response with lists that have unique IDs
    res.json({ success: true, prevent: preventWithIds, ai: aiWithIds });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// remove number from flow activiy
router.post("/remove_number_from_activity", validateUser, async (req, res) => {
  try {
    const { type, number, flowId } = req.body;

    const [flow] = await query(`SELECT * FROM flow WHERE flow_id = ?`, [
      flowId,
    ]);

    if (type == "AI") {
      // removing from ai arr
      const aiArr = flow?.ai_list ? JSON.parse(flow?.ai_list) : [];
      const updatedArr = aiArr?.filter((x) => x.senderNumber !== number);

      await query(`UPDATE flow SET ai_list = ? WHERE flow_id = ? AND uid = ?`, [
        JSON.stringify(updatedArr),
        flowId,
        req.decode.uid,
      ]);
    } else if (type == "DISABLED") {
      // removing from prevent arr
      const preventArr = flow?.prevent_list
        ? JSON.parse(flow?.prevent_list)
        : [];
      const updatedPreventArr = preventArr?.filter(
        (x) => x.senderNumber !== number,
      );

      await query(
        `UPDATE flow SET prevent_list = ? WHERE flow_id = ? AND uid = ?`,
        [JSON.stringify(updatedPreventArr), flowId, req.decode.uid],
      );
    }

    res.json({ msg: "Number was removed", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// get beta flow sessiosn
router.post("/session_mine", validateUser, async (req, res) => {
  try {
    const { flow_id, sender_mobile } = req.body;
    const data = await query(
      `SELECT * FROM flow_session WHERE uid = ? AND flow_id = ? AND sender_mobile = ?`,
      [req.decode.uid, flow_id, sender_mobile],
    );

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// get beta flow sessiosn
router.post("/session_mine_agent", validateAgent, async (req, res) => {
  try {
    const { flow_id, sender_mobile } = req.body;
    const data = await query(
      `SELECT * FROM flow_session WHERE uid = ? AND flow_id = ? AND sender_mobile = ?`,
      [req.owner.uid, flow_id, sender_mobile],
    );

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

router.post("/enable_chat_agent", validateAgent, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM flow_session WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ msg: "Auto reply enabled", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "something went wrong" });
  }
});

router.post("/enable_chat", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`DELETE FROM flow_session WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({ msg: "Auto reply enabled", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "something went wrong" });
  }
});

router.post("/disable_chat", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    const [flow] = await query(
      `SELECT * FROM flow_session WHERE id = ? AND uid = ?`,
      [id, req.decode.uid],
    );

    if (flow) {
      let data = flow?.data ? JSON.parse(flow?.data) : {};

      // Add 1 year + 10 minutes to current time
      const currentTime = new Date();
      currentTime.setHours(currentTime.getHours() + 8760);
      currentTime.setMinutes(currentTime.getMinutes() + 10);

      data.disableChat = {
        node: {},
        timestamp: currentTime.getTime(), // or currentTime.toISOString()
      };

      // Save back to DB
      await query(`UPDATE flow_session SET data = ? WHERE id = ?`, [
        JSON.stringify(data),
        id,
      ]);
    }

    res.json({ msg: "Auto reply disabled", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "something went wrong" });
  }
});

router.post("/disable_chat_agent", validateAgent, async (req, res) => {
  try {
    const { id } = req.body;

    const [flow] = await query(`SELECT * FROM flow_session WHERE id = ?`, [id]);
    if (flow) {
      let data = flow?.data ? JSON.parse(flow?.data) : {};

      // Add 1 year + 10 minutes to current time
      const currentTime = new Date();
      currentTime.setHours(currentTime.getHours() + 8760);
      currentTime.setMinutes(currentTime.getMinutes() + 10);

      data.disableChat = {
        node: {},
        timestamp: currentTime.getTime(), // or currentTime.toISOString()
      };

      // Save back to DB
      await query(`UPDATE flow_session SET data = ? WHERE id = ?`, [
        JSON.stringify(data),
        id,
      ]);
    }

    res.json({ msg: "Auto reply disabled", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "something went wrong" });
  }
});

// get beta flow sessiosn
router.post("/get_beta_flow_sessions", validateUser, async (req, res) => {
  try {
    const { flow_id } = req.body;
    const data = await query(
      `SELECT * FROM flow_session WHERE uid = ? AND flow_id = ?`,
      [req.decode.uid, flow_id],
    );

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// del flow session
router.post("/del_flow_sess", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM flow_session WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ msg: "Session was deleted", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// reset disabled chat
router.post("/reset_dc_sess", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    const [getSess] = await query(
      `SELECT * FROM flow_session WHERE id = ? AND uid = ?`,
      [id, req.decode.uid],
    );

    if (getSess) {
      let a = JSON.parse(getSess.data);
      delete a.disableChat;
      await query(`UPDATE flow_session SET data = ? WHERE id = ?`, [
        JSON.stringify(a),
        id,
      ]);
    }

    res.json({ msg: "Disable chat was reset", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// Delete multiple flow sessions
router.post("/del_multiple_flow_sess", validateUser, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.json({ success: false, msg: "No sessions selected" });
    }

    // Create placeholders for the SQL query
    const placeholders = ids.map(() => "?").join(",");

    await query(
      `DELETE FROM flow_session WHERE id IN (${placeholders}) AND uid = ?`,
      [...ids, req.decode.uid],
    );

    res.json({ msg: "Selected sessions were deleted", success: true });
  } catch (err) {
    res.json({ success: false, msg: "Something went wrong" });
    logger.log(err);
  }
});

// make request beta
router.post("/make_request_try_beta", validateUser, async (req, res) => {
  try {
    const { data } = req.body;
    const vars = {
      name: "John Doe",
    };
    const resp = await makeRequestBeta(data, vars);

    if (resp.success) {
      logger.log({ data: resp.data.body.name });
      res.json({ success: true, msg: "Done" });
    } else {
      res.json({ success: false, msg: resp.msg });
    }
  } catch (err) {
    res.json({ success: false, msg: "Something went wrong" });
    logger.log(err);
  }
});

// try mysql con
router.post("/try_con", validateUser, async (req, res) => {
  try {
    const { data } = req.body;
    const respp = await executeMySQLQuery(data);
    if (respp?.success) {
      return res.json({
        success: true,
        msg: "Connection successful",
        data: respp?.data,
      });
    }
    res.json({ success: false, msg: respp?.error || "Connection failed" });
  } catch (err) {
    res.json({ success: false, msg: "Something went wrong" });
    logger.log(err);
  }
});

// get available origins for chatflow
router.get("/get_origians", validateUser, async (req, res) => {
  try {
    const addons = returnAddons();
    let origins = [
      {
        title: "Meta",
        code: "META",
        data: {},
      },
    ];

    if (addons?.includes("QR")) {
      const instances = await query(
        `SELECT * FROM instance WHERE uid = ? AND status = ?`,
        [req.decode.uid, "ACTIVE"],
      );

      const correctOrign = instances.map((x) => ({
        title: x.number,
        code: "QR",
        data: x,
      }));

      origins.push(...correctOrign);
    }

    if (addons?.includes("TELEGRAM")) {
      const teleSess = await query(
        `SELECT * FROM telegram_session WHERE uid = ? AND status = ?`,
        [req.decode.uid, "active"],
      );

      const correctOrign =
        teleSess?.map((x) => ({
          title: x.data ? JSON.parse(x.data)?.number : "NOT USABLE",
          code: "TELEGRAM",
          data: x,
        })) || [];

      origins.push(...correctOrign);
    }

    // In get_origians — add Instagram accounts
    if (addons?.includes("INSTAGRAM")) {
      // Instagram is always available (no addon check needed)
      const igAccounts = await query(
        `SELECT * FROM instagram_accounts WHERE uid = ?`,
        [req.decode.uid],
      );

      const igOrigins = igAccounts.map((x) => ({
        title: `@${x.username || x.user_id}`,
        code: "INSTAGRAM",
        data: x,
      }));

      origins.push(...igOrigins);
    }

    res.json({ data: origins, success: true });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong" });
  }
});

router.post("/generate", validateUser, async (req, res) => {
  try {
    const {
      instruction,
      provider, // { id: "openai"|"gemini"|"deepseek" }
      model, // { id: "gpt-4o" }
      apiKey,
      nodeSchemas, // serialized menuItems from frontend
      currentFlow, // { nodes, edges } or null
      mode, // "create" | "edit"
    } = req.body;

    if (!instruction || !provider?.id || !model?.id || !apiKey) {
      return res.json({
        success: false,
        msg: "instruction, provider, model, and apiKey are required",
      });
    }

    if (!nodeSchemas || nodeSchemas.length === 0) {
      return res.json({ success: false, msg: "nodeSchemas are required" });
    }

    const systemPrompt = buildSystemPrompt(nodeSchemas);
    const userPrompt = buildUserPrompt(instruction, currentFlow, mode);

    let rawJson;

    switch (provider.id.toLowerCase()) {
      case "openai":
        rawJson = await callOpenAI(apiKey, model.id, systemPrompt, userPrompt);
        break;
      case "gemini":
        rawJson = await callGemini(apiKey, model.id, systemPrompt, userPrompt);
        break;
      case "deepseek":
        rawJson = await callDeepSeek(
          apiKey,
          model.id,
          systemPrompt,
          userPrompt,
        );
        break;
      default:
        return res.json({ success: false, msg: "Unsupported provider" });
    }

    // Parse and validate
    let parsed;
    try {
      // Strip markdown fences if model ignores json_object instruction
      const cleaned = rawJson
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      logger.error("JSON parse error:", e.message, "\nRaw:", rawJson);
      return res.json({
        success: false,
        msg: "AI returned invalid JSON. Try rephrasing your instruction.",
        raw: rawJson,
      });
    }

    if (!parsed.nodes || !parsed.edges) {
      return res.json({
        success: false,
        msg: "AI response missing nodes or edges",
        raw: rawJson,
      });
    }

    res.json({ success: true, data: parsed });
  } catch (err) {
    logger.error("[AI Flow Builder]", err.response?.data || err.message);
    res.json({
      success: false,
      msg:
        err.response?.data?.error?.message || err.message || "AI call failed",
    });
  }
});

module.exports = router;
