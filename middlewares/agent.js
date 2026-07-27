const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");
const logger = require("../utils/logger");

const validateAgent = async (req, res, next) => {
  try {
    const authHeader = req.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        msg: "No token found",
        logout: true,
      });
    }

    const token = authHeader.split(" ")[1];

    let decode;
    try {
      decode = jwt.verify(token, process.env.JWTKEY);
    } catch (err) {
      return res.status(401).json({
        success: false,
        msg: "Invalid token found",
        logout: true,
      });
    }

    if (!decode?.uid || decode?.role !== "agent" || !decode?.owner_uid) {
      return res.status(401).json({
        success: false,
        msg: "Unauthorized token",
        logout: true,
      });
    }

    const [agent] = await query(
      `SELECT * FROM agents WHERE uid = ? AND owner_uid = ?`,
      [decode.uid, decode.owner_uid],
    );

    if (!agent) {
      return res.status(401).json({
        success: false,
        msg: "Invalid agent token",
        logout: true,
      });
    }

    // ✅ tokenVersion check — invalidates all old tokens on password change
    if (decode.tokenVersion !== agent.tokenVersion) {
      return res.status(401).json({
        success: false,
        msg: "Session expired. Please login again.",
        logout: true,
      });
    }

    if (agent.is_active < 1) {
      return res.status(403).json({
        success: false,
        msg: "You are an inactive agent.",
        logout: true,
      });
    }

    const [owner] = await query(`SELECT * FROM user WHERE uid = ?`, [
      agent.owner_uid,
    ]);

    if (!owner) {
      return res.status(401).json({
        success: false,
        msg: "Agent owner not found",
        logout: true,
      });
    }

    req.owner = owner;

    req.decode = {
      uid: agent.uid,
      role: "agent",
      email: agent.email,
      owner_uid: agent.owner_uid,
      tokenVersion: agent.tokenVersion,
      userData: agent,
    };

    next();
  } catch (err) {
    logger.error("validateAgent error:", err);
    return res.status(500).json({
      success: false,
      msg: "server error",
    });
  }
};

module.exports = validateAgent;
