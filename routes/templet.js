const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const { isValidEmail, getFileExtension } = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { checkPlan } = require("../middlewares/plan.js");
const logger = require("../utils/logger.js");

// add templet
router.post("/add_new", validateUser, checkPlan, async (req, res) => {
  try {
    const { title, type, content } = req.body;

    if (!title || !type || !content) {
      return res.json({ success: false, msg: "Please give a title" });
    }

    await query(
      `INSERT INTO templets (uid, content, type, title) VALUES (?,?,?,?)`,
      [req.decode.uid, JSON.stringify(content), type, title],
    );

    res.json({ success: true, msg: "Templet was added" });
  } catch (err) {
    logger.log(err);
    res.json({ err, msg: "something went wrong", success: false });
  }
});

// get my templet
router.get("/get_templets", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM templets WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    logger.log(err);
    res.json({ err, msg: "something went wrong", success: false });
  }
});

// dele templets
router.post("/del_templets", validateUser, async (req, res) => {
  try {
    await query(`DELETE FROM templets WHERE id IN (?)`, [req.body.selected]);
    res.json({ success: true, msg: "Contact(s) was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

module.exports = router;
