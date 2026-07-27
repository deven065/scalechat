const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");
const logger = require("../utils/logger");

const adminValidator = async (req, res, next) => {
  try {
    const token = req.get("Authorization");
    if (!token) {
      return res.json({ msg: "No token found", token: token, logout: true });
    }

    jwt.verify(token.split(" ")[1], process.env.JWTKEY, async (err, decode) => {
      if (err) {
        return res.json({
          success: 0,
          msg: "Invalid token found",
          token,
          logout: true,
        });
      }

      // Fetch admin by uid only — no password in DB query
      const getAdmin = await query(`SELECT * FROM admin WHERE uid = ?`, [
        decode.uid,
      ]);

      if (getAdmin.length < 1) {
        return res.json({
          success: false,
          msg: "Invalid token found",
          token,
          logout: true,
        });
      }

      const admin = getAdmin[0];

      // tokenVersion check — invalidates all old tokens on password change
      if (decode.tokenVersion !== admin.tokenVersion) {
        return res.json({
          success: false,
          msg: "Session expired. Please login again.",
          logout: true,
        });
      }

      if (admin.role !== "admin") {
        return res.json({
          success: 0,
          msg: "Unauthorized token",
          token: token,
          logout: true,
        });
      }

      req.decode = decode;
      next();
    });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

module.exports = adminValidator;
