const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");
const logger = require("../utils/logger");

const validateUser = async (req, res, next) => {
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

    if (!decode?.uid || decode?.role !== "user") {
      return res.status(401).json({
        success: false,
        msg: "Unauthorized token",
        logout: true,
      });
    }

    const getUser = await query(
      `SELECT * FROM user WHERE uid = ? AND role = ?`,
      [decode.uid, "user"],
    );

    if (getUser.length < 1) {
      return res.status(401).json({
        success: false,
        msg: "Invalid token found",
        logout: true,
      });
    }

    if (
      typeof decode.tokenVersion === "undefined" ||
      Number(getUser[0].tokenVersion || 0) !== Number(decode.tokenVersion)
    ) {
      return res.json({
        success: false,
        msg: "Session expired. Please login again.",
        logout: true,
      });
    }

    req.decode = {
      uid: getUser[0].uid,
      role: "user",
      email: getUser[0].email,
      tokenVersion: getUser[0].tokenVersion || 0,
      userData: getUser[0],
    };

    next();
  } catch (err) {
    logger.log(err);
    return res.status(500).json({
      success: false,
      msg: "server error",
    });
  }
};

module.exports = validateUser;
