const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const {
  isValidEmail,
  areMobileNumbersFilled,
} = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const csv = require("csv-parser");
const fs = require("fs");
const { checkPlan, checkContactLimit } = require("../middlewares/plan.js");
const logger = require("../utils/logger.js");

// add phonebook name
router.post(
  "/add",
  validateUser,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      const { name } = req.body;

      if (!name) {
        return res.json({
          success: false,
          msg: "Please enter a phonebook name",
        });
      }

      // find ext
      const findExt = await query(
        `SELECT * FROM phonebook WHERE uid = ? AND name = ?`,
        [req.decode.uid, name],
      );

      if (findExt.length > 0) {
        return res.json({
          success: false,
          msg: "Duplicate phonebook name found",
        });
      }

      await query(`INSERT INTO phonebook (name, uid) VALUES (?,?)`, [
        name,
        req.decode.uid,
      ]);
      res.json({ success: true, msg: "Phonebook was addedd" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      logger.log(err);
    }
  },
);

// get by uid
router.get("/get_by_uid", validateUser, async (req, res) => {
  try {
    let data = await query(`SELECT * FROM phonebook WHERE uid = ?`, [
      req.decode.uid,
    ]);

    data = await Promise.all(
      data.map(async (x) => {
        const [result] = await query(
          `SELECT COUNT(*) AS count FROM contact WHERE phonebook_id = ?`,
          [x.id],
        );
        return { ...x, contactCount: result.count };
      }),
    );

    res.json({ data, success: true });
  } catch (err) {
    logger.error(err);
    res.json({ success: false, msg: "Something went wrong" });
  }
});

// Edit Contact
router.put("/edit_contact", validateUser, async (req, res) => {
  const { contactId, name, mobile, var1, var2, var3, var4, var5 } = req.body;

  try {
    // Update contact in the database
    const result = await query(
      `UPDATE contact SET name = ?, mobile = ?, var1 = ?, var2 = ?, var3 = ?, var4 = ?, var5 = ?, var6 = ? WHERE id = ? AND uid = ?`,
      [
        name,
        mobile,
        var1,
        var2,
        var3,
        var4,
        var5,
        var6,
        contactId,
        req.decode.uid,
      ],
    );

    if (result.affectedRows > 0) {
      res.json({ success: true, msg: "Contact updated successfully" });
    } else {
      res.json({ success: false, msg: "Contact not found or no changes made" });
    }
  } catch (err) {
    logger.error(err);
    res.json({ success: false, msg: "Something went wrong" });
  }
});

// del a phonebook
router.post("/del_phonebook", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`DELETE FROM phonebook WHERE id = ?`, [id]);
    await query(`DELETE FROM contact WHERE phonebook_id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({ success: true, msg: "Phonebook was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

function parseCSVFile(fileData) {
  return new Promise((resolve, reject) => {
    const results = [];

    // Check if file data is provided
    if (!fileData) {
      resolve(null);
      return;
    }

    const stream = require("stream");
    const bufferStream = new stream.PassThrough();

    // Convert file data (Buffer) to a readable stream
    bufferStream.end(fileData);

    // Use csv-parser to parse the CSV data
    bufferStream
      .pipe(csv())
      .on("data", (data) => {
        // Push each row of data to the results array
        results.push(data);
      })
      .on("end", () => {
        // Resolve the promise with the parsed CSV data
        resolve(results);
      })
      .on("error", (error) => {
        // Reject the promise if there is an error
        resolve(null);
      });
  });
}

// import contcats
router.post(
  "/import_contacts",
  validateUser,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      if (!req.files || Object.keys(req.files).length === 0) {
        return res.json({ success: false, msg: "No files were uploaded" });
      }

      const { id, phonebook_name } = req.body;

      const csvData = await parseCSVFile(req.files.file.data);
      if (!csvData) {
        return res.json({ success: false, msg: "Invalid CSV provided" });
      }

      const cvalidateMobile = areMobileNumbersFilled(csvData);
      if (!cvalidateMobile) {
        return res.json({
          msg: "Please check your CSV there one or more mobile not filled",
          csvData,
        });
      }

      // Flatten the array of objects into an array of values
      const values = csvData.map((item) => [
        req.decode.uid, // assuming uid is available in each item
        id,
        phonebook_name,
        item.name,
        item.mobile,
        item.var1,
        item.var2,
        item.var3,
        item.var4,
        item.var5,
      ]);

      // Execute the query
      await query(
        `INSERT INTO contact (uid, phonebook_id, phonebook_name, name, mobile, var1, var2, var3, var4, var5) VALUES ?`,
        [values],
      );

      res.json({ success: true, msg: "Contacts were inserted" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      logger.log(err);
    }
  },
);

// add single contact
router.post(
  "/add_single_contact",
  validateUser,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      const { id, phonebook_name, mobile, name, var1, var2, var3, var4, var5 } =
        req.body;

      if (!mobile) {
        return res.json({ success: false, msg: "Mobile number is required" });
      }

      await query(
        `INSERT INTO contact (uid, phonebook_id, phonebook_name, name, mobile, var1, var2, var3, var4, var5) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          req.decode.uid,
          id,
          phonebook_name,
          name,
          mobile,
          var1,
          var2,
          var3,
          var4,
          var5,
        ],
      );

      res.json({ success: true, msg: "Contact was inserted" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      logger.log(err);
    }
  },
);

// get contacts using uid
router.get("/get_uid_contacts", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

// dele contcats
router.post("/del_contacts", validateUser, async (req, res) => {
  try {
    await query(`DELETE FROM contact WHERE id IN (?)`, [req.body.selected]);
    res.json({ success: true, msg: "Contact(s) was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    logger.log(err);
  }
});

module.exports = router;
