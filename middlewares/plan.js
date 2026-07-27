const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");
const { getNumberOfDaysFromTimestamp } = require("../functions/function");
const logger = require("../utils/logger");

const checkPlan = async (req, res, next) => {
  try {
    if (req.owner) {
      req.decode.uid = req.owner.uid;
    }

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const plan = getUser[0]?.plan;

    if (!plan) {
      return res.json({
        success: false,
        msg: "Please subscribe a plan to proceed this.",
      });
    }

    const numOfDyaLeft = getNumberOfDaysFromTimestamp(getUser[0]?.plan_expire);

    if (numOfDyaLeft < 1) {
      return res.json({
        success: false,
        msg: "Your plan was expired. Please buy a plan",
      });
    } else {
      req.plan = JSON.parse(getUser[0]?.plan);
      next();
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkContactLimit = async (req, res, next) => {
  try {
    const contact_limit = req.plan?.contact_limit;

    const getContacts = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.decode.uid,
    ]);

    if (getContacts.length >= contact_limit) {
      return res.json({
        success: false,
        msg: `Your plan allowd you to add only ${contact_limit} contacts. Delete some to add new`,
      });
    } else {
      next();
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkNote = async (req, res, next) => {
  try {
    if (req.plan?.allow_note > 0) {
      next();
    } else {
      return res.json({
        msg: "Your plan does not allow you to add or edit chat notes",
      });
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkTags = async (req, res, next) => {
  try {
    if (req.plan?.allow_tag > 0) {
      next();
    } else {
      return res.json({
        msg: "Your plan does not allow you to add or edit chat notes",
      });
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkWaWArmer = async (req, res, next) => {
  try {
    if (req.plan?.wa_warmer > 0) {
      next();
    } else {
      return res.json({
        msg: "Your plan does not allow you this feature",
      });
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkQrScan = async (req, res, next) => {
  try {
    if (req.plan?.qr_account > 0) {
      const accounts = parseInt(req?.plan?.qr_account) || 0;
      const instances = await query(`SELECT * FROM instance WHERE uid = ?`, [
        req.decode.uid,
      ]);

      if (instances?.length >= accounts) {
        return res.json({
          msg: `Your plan allows you to add ${accounts} instances only`,
        });
      }

      next();
    } else {
      return res.json({
        msg: "Your plan does not allow you this feature",
      });
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkTeleInbox = async (req, res, next) => {
  try {
    if (req.plan?.telegram_inbox > 0) {
      next();
    } else {
      return res.json({
        msg: "Your plan does not allow you this feature",
      });
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkInstaInbox = async (req, res, next) => {
  try {
    if (req.plan?.instagram_inbox > 0) {
      next();
    } else {
      return res.json({
        msg: "Your plan does not allow you this feature",
      });
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

const checkWaForms = async (req, res, next) => {
  try {
    if (req.plan?.allow_wa_forms > 0) {
      next();
    } else {
      return res.json({
        msg: "Your plan does not allow you this feature",
      });
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "server error", err });
  }
};

module.exports = {
  checkPlan,
  checkContactLimit,
  checkNote,
  checkTags,
  checkWaWArmer,
  checkQrScan,
  checkWaForms,
  checkInstaInbox,
  checkTeleInbox,
};
