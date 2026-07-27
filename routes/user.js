const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const {
  isValidEmail,
  getFileExtension,
  getBusinessPhoneNumber,
  createMetaTemplet,
  getAllTempletsMeta,
  delMetaTemplet,
  getFileInfo,
  getSessionUploadMediaMeta,
  uploadFileMeta,
  updateUserPlan,
  getUserOrderssByMonth,
  sendEmail,
  fetchProfileFun,
  returnWidget,
  generateWhatsAppURL,
  rzCapturePayment,
  validateFacebookToken,
  getAllTempletsMetaBeta,
  extractTemplateVariablesBeta,
  formatPhoneNumber,
  sendTemplateMessage,
  sendFCMNotification,
  removeTokenFromAll,
} = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const Stripe = require("stripe");
const {
  checkPlan,
  checkNote,
  checkTags,
  checkContactLimit,
  checkWaWArmer,
} = require("../middlewares/plan.js");
const { recoverEmail } = require("../emails/returnEmails.js");
const moment = require("moment");
const fetch = require("node-fetch");
const jwt = require("jsonwebtoken");
const { checkQr } = require("../helper/addon/qr/index.js");
const { addON } = require("../env.js");
const { checkWebhook } = require("../helper/addon/webhook/index.js");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");
const {
  exchangeEmbedToken,
  checkEmbed,
} = require("../helper/addon/embed/index.js");
const { NodeVM } = require("vm2");
const { returnAddons } = require("../utils/addons.js");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const axios = require("axios");
const logger = require("../utils/logger.js");

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "application/pdf",
];

const allowedExtensions = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "mp4",
  "mp3",
  "ogg",
  "wav",
  "pdf",
];

const validateUploadFile = (file) => {
  if (!file) return false;

  const ext = getFileExtension(file.name)?.toLowerCase();

  if (!allowedExtensions.includes(ext)) return false;
  if (!allowedMimeTypes.includes(file.mimetype)) return false;

  return true;
};

// facebook login
router.post("/login_with_facebook", async (req, res) => {
  try {
    const { token, userId, email, name } = req.body;

    if (!token || !userId || !email || !name) {
      return res.json({
        success: false,
        msg: "Login cannot be completed, input not provided",
      });
    }

    const [getWeb] = await query(`SELECT * FROM web_public`, []);

    const appId = getWeb?.fb_login_app_id;
    const appSec = getWeb?.fb_login_app_sec;

    if (!appId || !appSec) {
      return res.json({
        success: false,
        msg: "Facebook login is not configured properly",
      });
    }

    const checkToken = await validateFacebookToken(token, appId, appSec);

    if (!checkToken?.success) {
      return res.json({
        success: false,
        msg: "Could not validate Facebook token",
      });
    }

    const resp = checkToken?.response?.data;
    const decodedUserId = resp?.user_id;

    if (decodedUserId != userId || !resp?.is_valid) {
      return res.json({
        success: false,
        msg: "Invalid Facebook login token",
      });
    }

    const getUser = await query(`SELECT * FROM user WHERE email = ?`, [email]);

    // NEW USER
    if (getUser.length < 1) {
      const uid = randomstring.generate();

      const randomPassword = randomstring.generate(24);

      const hasPass = await bcrypt.hash(randomPassword, 10);

      await query(
        `INSERT INTO user (name, uid, email, password, tokenVersion) VALUES (?,?,?,?,?)`,
        [name, uid, email, hasPass, 0],
      );

      const loginToken = sign(
        {
          uid,
          role: "user",
          tokenVersion: 0,
        },
        process.env.JWTKEY,
        {
          expiresIn: "7d",
        },
      );

      return res.json({
        success: true,
        token: loginToken,
      });
    }

    // EXISTING USER
    const loginToken = sign(
      {
        uid: getUser[0].uid,
        role: "user",
        tokenVersion: getUser[0].tokenVersion || 0,
      },
      process.env.JWTKEY,
      {
        expiresIn: "7d",
      },
    );

    return res.json({
      success: true,
      token: loginToken,
    });
  } catch (err) {
    logger.log(err);

    return res.json({
      success: false,
      msg: "Something went wrong",
    });
  }
});

// google login
router.post("/login_with_google", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.json({
        success: false,
        msg: "Token is missing",
      });
    }

    const googleRes = await axios.get(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const { email, email_verified, name } = googleRes.data;

    if (!email || !email_verified) {
      return res.json({
        success: false,
        msg: "Could not complete Google login",
      });
    }

    const getUser = await query(`SELECT * FROM user WHERE email = ?`, [email]);

    // NEW USER
    if (getUser.length < 1) {
      const uid = randomstring.generate();

      const randomPassword = randomstring.generate(24);

      const hasPass = await bcrypt.hash(randomPassword, 10);

      await query(
        `INSERT INTO user (name, uid, email, password, tokenVersion) VALUES (?,?,?,?,?)`,
        [name, uid, email, hasPass, 0],
      );

      const loginToken = sign(
        {
          uid,
          role: "user",
          tokenVersion: 0,
        },
        process.env.JWTKEY,
        {
          expiresIn: "7d",
        },
      );

      return res.json({
        success: true,
        token: loginToken,
      });
    }

    // EXISTING USER
    const loginToken = sign(
      {
        uid: getUser[0].uid,
        role: "user",
        tokenVersion: getUser[0].tokenVersion || 0,
      },
      process.env.JWTKEY,
      {
        expiresIn: "7d",
      },
    );

    return res.json({
      success: true,
      token: loginToken,
    });
  } catch (err) {
    logger.log(err);

    return res.json({
      success: false,
      msg: "Something went wrong",
    });
  }
});

// aignup user
router.post("/signup", async (req, res) => {
  try {
    const { email, name, password, mobile_with_country_code, acceptPolicy } =
      req.body;

    if (!email || !name || !password || !mobile_with_country_code) {
      return res.json({ msg: "Please fill the details", success: false });
    }

    if (!acceptPolicy) {
      return res.json({
        msg: "You did not click on checkbox of Privacy & Terms",
        success: false,
      });
    }

    if (!isValidEmail(email)) {
      return res.json({ msg: "Please enter a valid email", success: false });
    }

    // check if user already has same email
    const findEx = await query(`SELECT * FROM user WHERE email = ?`, email);
    if (findEx.length > 0) {
      return res.json({ msg: "A user already exist with this email" });
    }

    const haspass = await bcrypt.hash(password, 10);
    const uid = randomstring.generate();

    await query(
      `INSERT INTO user (name, uid, email, password, mobile_with_country_code) VALUES (?,?,?,?,?)`,
      [name, uid, email, haspass, mobile_with_country_code],
    );

    // assigning plan
    // const planId = 20;
    // const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [planId]);
    // if (getPlan.length < 1) {
    //   return res.json({ success: false, msg: "Invalid plan found" });
    // }

    // await updateUserPlan(getPlan[0], uid);

    res.json({ msg: "Signup Success", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// login user
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.json({
        success: false,
        msg: "Please provide email and password",
      });
    }

    // check for user
    const userFind = await query(`SELECT * FROM user WHERE email = ?`, [email]);
    if (userFind.length < 1) {
      return res.json({ msg: "Invalid credentials" });
    }

    const compare = await bcrypt.compare(password, userFind[0].password);

    if (!compare) {
      return res.json({ msg: "Invalid credentials" });
    } else {
      const token = sign(
        {
          uid: userFind[0].uid,
          role: "user",
          tokenVersion: userFind[0].tokenVersion || 0,
        },
        process.env.JWTKEY,
        {
          expiresIn: "7d",
        },
      );
      res.json({
        success: true,
        token,
      });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// return image url
router.post("/return_media_url", validateUser, async (req, res) => {
  let randomString;
  let file;

  try {
    ffmpeg.setFfmpegPath(ffmpegStatic);
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.json({ success: false, msg: "No files were uploaded" });
    }

    randomString = randomstring.generate();
    file = req.files.file;

    if (!validateUploadFile(file)) {
      return res.status(400).json({
        success: false,
        msg: "Invalid file type",
      });
    }

    const shouldConvert = req.body.convert === "YES";
    const target = req.body.target; // 'baileys' or other values

    let filename = `${randomString}.${getFileExtension(file.name)}`;
    const tempPath = `${__dirname}/../client/public/media/temp_${filename}`;
    const finalPath = `${__dirname}/../client/public/media/${filename}`;

    // Move file to temp location first
    await new Promise((resolve, reject) => {
      file.mv(tempPath, (err) => {
        if (err) {
          logger.log("File move error:", err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // If conversion is requested and it's an audio file
    if (shouldConvert && file.mimetype.startsWith("audio/")) {
      try {
        // logger.log(
        //   `Converting audio file for ${
        //     target === "baileys" ? "WhatsApp Baileys" : "MP3"
        //   } using fluent-ffmpeg...`
        // );

        if (target === "baileys") {
          // Baileys conversion: OGG format with specific settings
          filename = `${randomString}.ogg`;
          const convertedPath = `${__dirname}/../client/public/media/${filename}`;

          await new Promise((resolve, reject) => {
            ffmpeg(tempPath)
              .noVideo()
              .audioFrequency(48000)
              .audioChannels(1)
              .audioCodec("libopus")
              .audioBitrate(64)
              .outputOptions([
                "-application voip",
                "-avoid_negative_ts make_zero",
                "-map_metadata -1",
              ])
              .format("ogg")
              .on("start", (commandLine) => {
                // logger.log("FFmpeg started with command:", commandLine);
              })
              .on("progress", (progress) => {
                // logger.log("Processing: " + progress.percent + "% done");
              })
              .on("end", () => {
                // logger.log("Audio conversion to OGG completed successfully");
                resolve();
              })
              .on("error", (err) => {
                logger.error("FFmpeg conversion error:", err);
                reject(err);
              })
              .save(convertedPath);
          });
        } else {
          // Default conversion: MP3 format
          filename = `${randomString}.mp3`;
          const convertedPath = `${__dirname}/../client/public/media/${filename}`;

          await new Promise((resolve, reject) => {
            ffmpeg(tempPath)
              .noVideo()
              .audioCodec("libmp3lame")
              .audioBitrate(128)
              .audioChannels(2)
              .audioFrequency(44100)
              .outputOptions(["-write_xing 0", "-id3v2_version", "3"])
              .format("mp3")
              .on("start", (commandLine) => {
                logger.log("FFmpeg started with command:", commandLine);
              })
              .on("progress", (progress) => {
                logger.log("Processing: " + progress.percent + "% done");
              })
              .on("end", () => {
                logger.log("Audio conversion to MP3 completed successfully");
                resolve();
              })
              .on("error", (err) => {
                logger.error("FFmpeg conversion error:", err);
                reject(err);
              })
              .save(convertedPath);
          });
        }

        // Delete temp file after successful conversion
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

        // Verify the converted file exists and has content
        const finalConvertedPath = `${__dirname}/../client/public/media/${filename}`;
        if (
          !fs.existsSync(finalConvertedPath) ||
          fs.statSync(finalConvertedPath).size === 0
        ) {
          throw new Error("Conversion produced empty or missing file");
        }
      } catch (conversionError) {
        logger.error("Audio conversion failed:", conversionError);

        // If conversion fails, use original file
        if (fs.existsSync(tempPath)) {
          fs.renameSync(tempPath, finalPath);
        }

        // Reset filename to original extension
        filename = `${randomString}.${getFileExtension(file.name)}`;

        logger.log("Using original file due to conversion failure");
      }
    } else {
      // No conversion needed, just move from temp to final location
      if (fs.existsSync(tempPath)) {
        fs.renameSync(tempPath, finalPath);
      }
    }

    const url = `${process.env.FRONTENDURI}/media/${filename}`;

    res.json({
      success: true,
      url,
      converted: shouldConvert && file.mimetype.startsWith("audio/"),
      format:
        shouldConvert && file.mimetype.startsWith("audio/")
          ? target === "baileys"
            ? "ogg"
            : "mp3"
          : getFileExtension(file.name),
      target: target || "default",
    });
  } catch (err) {
    logger.error("Media upload error:", err);

    // Clean up temp file if it exists
    if (randomString && file) {
      const tempPath = `${__dirname}/../client/public/media/temp_${randomString}.${getFileExtension(
        file.name,
      )}`;
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch (cleanupError) {
          logger.error("Error cleaning up temp file:", cleanupError);
        }
      }
    }

    res.json({ success: false, msg: "Something went wrong", err: err.message });
  }
});

router.post("/convert_audio", validateUser, async (req, res) => {
  try {
    ffmpeg.setFfmpegPath(ffmpegStatic);

    const { msgId, audioUrl } = req.body;

    if (!audioUrl) {
      return res.json({ success: false, msg: "Audio URL is required" });
    }

    // Extract filename from URL (works with any domain)
    const urlObj = new URL(audioUrl);
    const pathname = urlObj.pathname;
    const originalFilename = pathname.split("/").pop(); // Gets last part of path
    const filenameWithoutExt =
      originalFilename.substring(0, originalFilename.lastIndexOf(".")) ||
      originalFilename;
    const currentExt = originalFilename.substring(
      originalFilename.lastIndexOf(".") + 1,
    );

    // Check if already MP3
    if (currentExt.toLowerCase() === "mp3") {
      return res.json({
        success: true,
        newUrl: audioUrl,
        msg: "Already in MP3 format",
      });
    }

    // Extract the directory from pathname (e.g., /meta-media/)
    const pathParts = pathname.split("/");
    pathParts.pop(); // Remove filename
    const directory = pathParts.join("/").replace(/^\//, ""); // Remove leading slash

    // Define paths
    const oldFilePath = `${__dirname}/../client/public/${directory}/${originalFilename}`;
    const newFilename = `${filenameWithoutExt}.mp3`;
    const newFilePath = `${__dirname}/../client/public/${directory}/${newFilename}`;

    // Check if original file exists
    if (!fs.existsSync(oldFilePath)) {
      return res.json({
        success: false,
        msg: "Original audio file not found on server",
      });
    }

    // Convert audio to MP3 using fluent-ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(oldFilePath)
        .noVideo()
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .audioFrequency(44100)
        .outputOptions(["-write_xing 0", "-id3v2_version", "3"])
        .format("mp3")
        .on("start", (commandLine) => {
          logger.log("FFmpeg conversion started:", commandLine);
        })
        .on("progress", (progress) => {
          logger.log("Processing: " + (progress.percent || 0) + "% done");
        })
        .on("end", () => {
          logger.log("Audio conversion to MP3 completed successfully");
          resolve();
        })
        .on("error", (err) => {
          logger.error("FFmpeg conversion error:", err);
          reject(err);
        })
        .save(newFilePath);
    });

    // Verify the converted file exists and has content
    if (!fs.existsSync(newFilePath) || fs.statSync(newFilePath).size === 0) {
      return res.json({
        success: false,
        msg: "Conversion produced empty or missing file",
      });
    }

    // Update database with new URL
    const [getMsg] = await query(
      `SELECT * FROM beta_conversation WHERE id = ?`,
      [msgId],
    );

    if (getMsg) {
      const msgCon = getMsg?.msgContext ? JSON.parse(getMsg.msgContext) : {};
      const newUrl = `${urlObj.origin}/${directory}/${newFilename}`;

      const updatedMsgCon = {
        ...msgCon,
        type: "audio",
        audio: {
          ...msgCon.audio,
          link: newUrl,
        },
      };

      await query(`UPDATE beta_conversation SET msgContext = ? WHERE id = ?`, [
        JSON.stringify(updatedMsgCon),
        msgId,
      ]);

      logger.log("Database updated with new MP3 URL");
    }

    // Delete old file (non-MP3)
    if (fs.existsSync(oldFilePath)) {
      fs.unlinkSync(oldFilePath);
      logger.log("Old audio file deleted:", originalFilename);
    }

    // Construct new URL
    const newUrl = `${urlObj.origin}/${directory}/${newFilename}`;

    res.json({
      success: true,
      newUrl,
      oldFile: originalFilename,
      newFile: newFilename,
      msg: "Audio converted to MP3 successfully",
    });
  } catch (err) {
    logger.error("Audio conversion error:", err);
    res.json({
      success: false,
      msg: "Something went wrong during conversion",
      err: err.message,
    });
  }
});

// get user
router.get("/get_me", validateUser, async (req, res) => {
  try {
    const { userOnly } = req.query;
    const data = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);

    const finalAddon = returnAddons();

    let contact = [];

    if (!userOnly) {
      // getting phonebook
      contact = await query(`SELECT * FROM contact WHERE uid = ?`, [
        req.decode.uid,
      ]);
    }

    res.json({
      data: { ...data[0], contact: contact.length },
      success: true,
      addon: finalAddon,
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// update notes
router.post(
  "/save_note",
  validateUser,
  checkPlan,
  checkNote,
  async (req, res) => {
    try {
      const { chatId, note } = req.body;

      await query(
        `UPDATE chats SET chat_note = ? WHERE chat_id = ? AND uid = ?`,
        [note, chatId, req.decode.uid],
      );
      res.json({ success: true, msg: "Notes were updated" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      logger.log(err);
    }
  },
);

// update tags
router.post(
  "/push_tag",
  validateUser,
  checkPlan,
  checkTags,
  async (req, res) => {
    try {
      const { tag, chatId } = req.body;

      if (!tag) {
        return res.json({ success: false, msg: "Please type a tag" });
      }

      const getChat = await query(
        `SELECT * FROM chats WHERE chat_id = ? AND uid = ?`,
        [chatId, req.decode.uid],
      );

      if (getChat.length < 1) {
        return res.json({ success: false, msg: "Chat not found" });
      }
      const getTags = getChat[0]?.chat_tags
        ? JSON.parse(getChat[0]?.chat_tags)
        : [];
      const addNew = [...getTags, tag];

      await query(
        `UPDATE chats SET chat_tags = ? WHERE chat_id = ? AND uid = ?`,
        [JSON.stringify(addNew), chatId, req.decode.uid],
      );

      res.json({ success: true, msg: "Tag was added" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      logger.log(err);
    }
  },
);

// del a tag
router.post("/del_tag", validateUser, async (req, res) => {
  try {
    const { tag, chatId } = req.body;

    const getAll = await query(
      `SELECT * FROM chats WHERE chat_id = ? AND uid = ?`,
      [chatId, req.decode.uid],
    );
    if (getAll.length < 1) {
      return res.json({ success: false, msg: "Chat not found" });
    }

    const getAllTags = getAll[0]?.chat_tags
      ? JSON.parse(getAll[0]?.chat_tags)
      : [];

    const newOne = getAllTags?.filter((i) => i !== tag);

    logger.log({ newOne });

    await query(
      `UPDATE chats SET chat_tags = ? WHERE chat_id = ? AND uid = ?`,
      [JSON.stringify(newOne), chatId, req.decode.uid],
    );

    res.json({ success: true, msg: "Tag was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// check contact exist
router.post("/check_contact", validateUser, async (req, res) => {
  try {
    const { mobile } = req.body;

    const findFirst = await query(
      `SELECT * FROM contact WHERE mobile = ? AND uid = ? `,
      [mobile, req.decode.uid],
    );
    const getAllPhonebook = await query(
      `SELECT * FROM phonebook WHERE uid = ?`,
      [req.decode.uid],
    );

    if (findFirst.length < 1) {
      return res.json({
        success: false,
        msg: "Contact not found in phonebook",
        phonebook: getAllPhonebook,
      });
    }

    res.json({
      success: true,
      phonebook: getAllPhonebook,
      contact: findFirst[0],
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// save the contact
router.post(
  "/save_contact",
  validateUser,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      const {
        phoneBookName,
        phoneBookId,
        phoneNumber,
        contactName,
        var1,
        var2,
        var3,
        var4,
        var5,
      } = req.body;

      if (!phoneBookName || !phoneBookId || !phoneNumber || !contactName) {
        return res.json({ success: false, msg: "incomplete input provided" });
      }

      const findExist = await query(
        `SELECT * FROM contact WHERE mobile = ? AND uid = ?`,
        [phoneNumber, req.decode.uid],
      );
      if (findExist.length > 0) {
        return res.json({ success: false, msg: "Contact already existed" });
      }

      await query(
        `INSERT INTO contact (uid, phonebook_id, phonebook_name, name, mobile, var1, var2, var3, var4, var5) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          req.decode.uid,
          phoneBookId,
          phoneBookName,
          contactName,
          phoneNumber,
          var1 || "",
          var2 || "",
          var3 || "",
          var4 || "",
          var5 || "",
        ],
      );

      res.json({ success: true, msg: "Contact was added" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong", err });
      logger.log(err);
    }
  },
);

// del contact
router.post("/del_contact", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM contact WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ success: true, msg: "Contact was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

router.post("/update_meta", validateUser, async (req, res) => {
  try {
    const { waba_id, access_token, business_phone_number_id, app_id } =
      req.body;

    if (!waba_id || !access_token || !app_id) {
      return res.json({ success: false, msg: "Please fill all the fields" });
    }

    const resp = await getBusinessPhoneNumber(
      "v18.0",
      business_phone_number_id,
      access_token,
    );

    if (resp?.error) {
      return res.json({
        success: false,
        msg: resp?.error?.message || "Please check your details",
      });
    }

    const findOne = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (findOne.length > 0) {
      await query(
        `UPDATE meta_api SET waba_id = ?, access_token = ?, business_phone_number_id = ?, app_id = ?, login_type = ? WHERE uid = ?`,
        [
          waba_id,
          access_token,
          business_phone_number_id,
          app_id,
          "manual",
          req.decode.uid,
        ],
      );
    } else {
      await query(
        `INSERT INTO meta_api (uid, waba_id, access_token, business_phone_number_id, app_id, login_type) VALUES (?,?,?,?,?,?)`,
        [
          req.decode.uid,
          waba_id,
          access_token,
          business_phone_number_id,
          app_id,
          "manual",
        ],
      );
    }

    res.json({
      success: true,
      msg: "Your meta settings were updated successfully!",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// update embed meta
router.post("/update_embed_meta", validateUser, async (req, res) => {
  try {
    const { embed_meta } = req.body;
    if (!embed_meta?.waba?.id) {
      return res.json({ success: false, msg: "Please click Login first" });
    }

    const findOne = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (findOne.length > 0) {
      await query(
        `UPDATE meta_api SET embed_data = ?, login_type = ? WHERE uid = ?`,
        [JSON.stringify(embed_meta), "embed", req.decode.uid],
      );
    } else {
      await query(
        `INSERT INTO meta_api (uid, embed_data, login_type) VALUES (?,?,?)`,
        [req.decode.uid, JSON.stringify(embed_meta), "embed"],
      );
    }

    res.json({
      success: true,
      msg: "Your meta settings were updated successfully!",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get meta keys
router.get("/get_meta_keys", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (data.length < 1) {
      res.json({ success: true, data: {} });
    } else {
      res.json({ success: true, data: data[0] });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// add meta templet
router.post("/add_meta_templet", validateUser, checkPlan, async (req, res) => {
  try {
    const getAPIKEYS = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);

    if (getAPIKEYS.length < 1) {
      return res.json({
        success: false,
        msg: "Please fill your meta API keys",
      });
    }

    const resp = await createMetaTemplet(
      "v18.0",
      getAPIKEYS[0]?.waba_id,
      getAPIKEYS[0]?.access_token,
      req.body,
    );

    if (resp.error) {
      res.json({ msg: resp?.error?.error_user_msg || resp?.error?.message });
    } else {
      logger.log(resp);
      res.json({
        msg: "Templet was added and waiting for the review",
        success: true,
      });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get user meta templet
router.get("/get_my_meta_templets", validateUser, async (req, res) => {
  try {
    const getMETA = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (getMETA.length < 1) {
      return res.json({
        success: false,
        msg: "Please check your meta API keys",
      });
    }

    const resp = await getAllTempletsMeta(
      "v18.0",
      getMETA[0]?.waba_id,
      getMETA[0]?.access_token,
    );

    if (resp?.error) {
      res.json({
        success: false,
        msg: resp?.error?.message || "Please check your API",
      });
    } else {
      res.json({ success: true, data: resp?.data || [] });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// del meta templet
router.post("/del_meta_templet", validateUser, async (req, res) => {
  try {
    const { name } = req.body;

    const getMETA = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (getMETA.length < 1) {
      return res.json({
        success: false,
        msg: "Please check your meta API keys",
      });
    }

    const resp = await delMetaTemplet(
      "v18.0",
      getMETA[0]?.waba_id,
      getMETA[0]?.access_token,
      name,
    );

    if (resp.error) {
      return res.json({
        success: false,
        msg: resp?.error?.error_user_title || "Please check your API",
      });
    } else {
      res.json({
        success: true,
        data: resp?.data || [],
        msg: "Templet was deleted",
      });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// return meta media url
router.post("/return_media_url_meta", validateUser, async (req, res) => {
  try {
    if (!req.body?.templet_name) {
      return res.json({
        success: false,
        msg: "Please give a templet name first ",
      });
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.json({ success: false, msg: "No files were uploaded" });
    }

    const getMETA = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (getMETA.length < 1) {
      return res.json({
        success: false,
        msg: "Please check your meta API keys",
      });
    }

    const randomString = randomstring.generate();
    const file = req.files.file;

    if (!validateUploadFile(file)) {
      return res.status(400).json({
        success: false,
        msg: "Invalid file type",
      });
    }

    const filename = `${randomString}.${getFileExtension(file.name)}`;

    // Move the file and wait for it to complete
    await new Promise((resolve, reject) => {
      file.mv(`${__dirname}/../client/public/media/${filename}`, (err) => {
        if (err) {
          logger.log(err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    setTimeout(async () => {
      const { fileSizeInBytes, mimeType } = await getFileInfo(
        `${__dirname}/../client/public/media/${filename}`,
      );

      const getSession = await getSessionUploadMediaMeta(
        "v18.0",
        getMETA[0]?.app_id,
        getMETA[0]?.access_token,
        fileSizeInBytes,
        mimeType,
      );

      const uploadFile = await uploadFileMeta(
        getSession?.id,
        `${__dirname}/../client/public/media/${filename}`,
        "v18.0",
        getMETA[0]?.access_token,
      );

      if (!uploadFile?.success) {
        return res.json({ success: false, msg: "Please check your meta API" });
      }

      const url = `${process.env.FRONTENDURI}/media/${filename}`;

      await query(
        `INSERT INTO meta_templet_media (uid, templet_name, meta_hash, file_name) VALUES (?,?,?,?)`,
        [req.decode.uid, req.body?.templet_name, uploadFile?.data?.h, filename],
      );

      res.json({ success: true, url, hash: uploadFile?.data?.h });
    }, 1000);
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get plan detail
router.post("/get_plan_details", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    const data = await query(`SELECT * FROM plan WHERE id = ?`, [id]);
    if (data.length < 1) {
      return res.json({ success: false, data: null });
    } else {
      res.json({ success: true, data: data[0] });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get payment gateway
router.get("/get_payment_details", validateUser, async (req, res) => {
  try {
    const resp = await query(`SELECT * FROM web_private`, []);
    let data = resp[0];
    const [userData] = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);

    data.pay_stripe_key = "";
    res.json({ data, userData, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// creating stripe pay session
router.post("/create_stripe_session", validateUser, async (req, res) => {
  try {
    const getWeb = await query(`SELECT * FROM web_private`, []);

    if (
      getWeb.length < 1 ||
      !getWeb[0]?.pay_stripe_key ||
      !getWeb[0]?.pay_stripe_id
    ) {
      return res.json({
        success: false,
        msg: "Opss.. payment keys found not found",
      });
    }

    const stripeKeys = getWeb[0]?.pay_stripe_key;

    const stripeClient = new Stripe(stripeKeys);

    const { planId } = req.body;

    const plan = await query(`SELECT * FROM plan WHERE id = ?`, [planId]);

    if (plan.length < 1) {
      return res.json({ msg: "No plan found with the id" });
    }

    const randomSt = randomstring.generate();
    const orderID = `STRIPE_${randomSt}`;

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "STRIPE", plan[0]?.price, orderID],
    );

    const web = await query(`SELECT * FROM web_public`, []);

    const productStripe = [
      {
        price_data: {
          currency: web[0]?.currency_code,
          product_data: {
            name: plan[0]?.title,
            // images:[product.imgdata]
          },
          unit_amount: plan[0]?.price * 100,
        },
        quantity: 1,
      },
    ];

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: productStripe,
      mode: "payment",
      success_url: `${process.env.BACKURI}/api/user/stripe_payment?order=${orderID}&plan=${plan[0]?.id}`,
      cancel_url: `${process.env.BACKURI}/api/user/stripe_payment?order=${orderID}&plan=${plan[0]?.id}`,
      locale: process.env.STRIPE_LANG || "en",
    });

    await query(`UPDATE orders SET s_token = ? WHERE data = ?`, [
      session?.id,
      orderID,
    ]);

    res.json({ success: true, session: session });
  } catch (err) {
    res.json({ msg: err.toString(), err });
    logger.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

router.post("/pay_with_rz", validateUser, async (req, res) => {
  try {
    const { rz_payment_id, plan, amount } = req.body;
    if (!rz_payment_id || !plan || !amount) {
      return res.json({ msg: "please send required fields" });
    }

    // getting plan
    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan?.id]);

    if (getPlan.length < 1) {
      return res.json({
        msg: "Invalid plan found",
      });
    }

    // getting private web
    const [webPrivate] = await query(`SELECT * from web_private`, []);
    const [webPublic] = await query(`SELECT * FROM web_public`, []);

    const rzId = webPrivate?.rz_id;
    const rzKeys = webPrivate?.rz_key;

    if (!rzId || !rzKeys) {
      return res.json({
        msg: `Please fill your razorpay credentials! if: ${rzId} keys: ${rzKeys}`,
      });
    }

    const finalamt =
      (parseInt(amount) / parseInt(webPublic.exchange_rate)) * 80;

    const resp = await rzCapturePayment(
      rz_payment_id,
      Math.round(finalamt) * 100,
      rzId,
      rzKeys,
    );

    if (!resp) {
      res.json({ success: false, msg: resp.description });
      return;
    }

    await updateUserPlan(getPlan[0], req.decode.uid);

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "RAZORPAY", plan?.price, JSON.stringify(resp)],
    );

    res.json({
      success: true,
      msg: "Thank for your payment you are good to go now.",
    });
  } catch (err) {
    res.json({ msg: err.toString(), err });
    logger.log({ err, msg: JSON.stringify(err), string: err.toString() });
  }
});

// pay with paypal
router.post("/pay_with_paypal", validateUser, async (req, res) => {
  try {
    const { orderID, plan } = req.body;

    if (!plan || !orderID) {
      return res.json({ msg: "order id and plan required" });
    }

    // getting plan
    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan?.id]);

    if (getPlan.length < 1) {
      return res.json({
        msg: "Invalid plan found",
      });
    }

    // getting private web
    const [webPrivate] = await query(`SELECT * from web_private`, []);

    const paypalClientId = webPrivate?.pay_paypal_id;
    const paypalClientSecret = webPrivate?.pay_paypal_key;

    if (!paypalClientId || !paypalClientSecret) {
      return res.json({
        msg: "Please provide paypal ID and keys from the Admin",
      });
    }

    let response = await fetch(
      "https://api.sandbox.paypal.com/v1/oauth2/token",
      {
        method: "POST",
        body: "grant_type=client_credentials",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${paypalClientId}:${paypalClientSecret}`,
              "binary",
            ).toString("base64"),
        },
      },
    );

    let data = await response.json();

    let resp_order = await fetch(
      `https://api.sandbox.paypal.com/v1/checkout/orders/${orderID}`,
      {
        method: "GET",
        headers: {
          Authorization: "Bearer " + data.access_token,
        },
      },
    );

    let order_details = await resp_order.json();

    if (order_details.status === "COMPLETED") {
      await updateUserPlan(getPlan[0], req.decode.uid);

      await query(
        `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
        [req.decode.uid, "PAYPAL", plan?.price, JSON.stringify(order_details)],
      );

      res.json({
        success: true,
        msg: "Thank for your payment you are good to go now.",
      });
    } else {
      res.json({ success: false, msg: "error_description" });
      return;
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

function checlStripePayment(orderId) {
  return new Promise(async (resolve) => {
    try {
      const getStripe = await query(`SELECT * FROM web_private`, []);

      const stripeClient = new Stripe(getStripe[0]?.pay_stripe_key);
      const getPay = await stripeClient.checkout.sessions.retrieve(orderId);

      // logger.log({ status: getPay?.payment_status });

      if (getPay?.payment_status === "paid") {
        resolve({ success: true, data: getPay });
      } else {
        resolve({ success: false });
      }
    } catch (err) {
      resolve({ success: false, data: {} });
    }
  });
}

function returnHtmlRes(msg) {
  const html = `<!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="refresh" content="5;url=${process.env.FRONTENDURI}/user">
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
          text-align: center;
          margin: 0;
          padding: 0;
        }

        .container {
          background-color: #ffffff;
          border: 1px solid #ccc;
          border-radius: 4px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          margin: 100px auto;
          padding: 20px;
          width: 300px;
        }

        p {
          font-size: 18px;
          color: #333;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <p>${msg}</p>
      </div>
    </body>
    </html>
    `;
  return html;
}

router.get("/stripe_payment", async (req, res) => {
  try {
    const { order, plan } = req.query;

    if (!order || !plan) {
      return res.send("INVALID REQUEST");
    }

    const getOrder = await query(
      `SELECT * FROM orders WHERE data = ? AND payment_mode = ? LIMIT 1`,
      [order || "", "STRIPE"],
    );

    if (getOrder.length < 1) {
      return res.send("Invalid payment found");
    }

    if (getOrder[0]?.status === "COMPLETED") {
      return res.send(
        returnHtmlRes("Payment already processed. Redirecting..."),
      );
    }

    const getPlan = await query(`SELECT * FROM plan WHERE id = ? LIMIT 1`, [
      plan,
    ]);

    if (getPlan.length < 1) {
      return res.send("Invalid plan found");
    }

    const checkPayment = await checlStripePayment(getOrder[0]?.s_token);

    if (!checkPayment.success) {
      return res.send(
        "Payment Failed! If the balance was deducted please contact support. Redirecting...",
      );
    }

    await query(
      `UPDATE orders 
       SET data = ?, status = ? 
       WHERE id = ? AND payment_mode = ?`,
      [
        JSON.stringify(checkPayment?.data),
        "COMPLETED",
        getOrder[0].id,
        "STRIPE",
      ],
    );

    await updateUserPlan(getPlan[0], getOrder[0]?.uid);

    return res.send(returnHtmlRes("Payment Success! Redirecting..."));
  } catch (err) {
    logger.log(err);
    return res.json({ msg: "Something went wrong", success: false });
  }
});

// pay with paystack
router.post("/pay_with_paystack", validateUser, async (req, res) => {
  try {
    const { planData, trans_id, reference } = req.body;

    if (!planData || !trans_id) {
      return res.json({
        msg: "Order id and plan required",
      });
    }

    // getting plan
    const plan = await query(`SELECT * FROM plan WHERE id = ?`, [planData.id]);

    if (plan.length < 1) {
      return res.json({ msg: "Sorry this plan was not found" });
    }

    // gettings paystack keys
    const getWebPrivate = await query(`SELECT * FROM web_private`, []);
    const paystackSecretKey = getWebPrivate[0]?.pay_paystack_key;
    const paystackId = getWebPrivate[0]?.pay_paystack_id;

    if (!paystackSecretKey || !paystackId) {
      return res.json({ msg: "Paystack credentials not found" });
    }

    var response = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const resp = await response.json();

    if (resp.data?.status !== "success") {
      res.json({ success: false, msg: `${resp.message} - Ref:-${reference}` });
      return;
    }

    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "PAYSTACK", plan[0]?.price, reference],
    );

    await updateUserPlan(plan[0], req.decode.uid);

    res.json({
      success: true,
      msg: "Payment success! Redirecting...",
    });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// update profile
router.post("/update_profile", validateUser, async (req, res) => {
  try {
    let mobile_with_country_code;
    const {
      newPassword,
      name,
      mobile: mobileFromBody,
      mobile_with_country_code: mobile_with_country_codeNew,
      email,
      timezone,
    } = req.body;

    if (mobileFromBody) {
      mobile_with_country_code = mobileFromBody;
    }

    if (mobile_with_country_codeNew) {
      mobile_with_country_code = mobile_with_country_codeNew;
    }

    if (!name || !mobile_with_country_code || !email || !timezone) {
      return res.json({
        success: false,
        msg: "Name, Mobile, Email, Timezone are required fields",
      });
    }

    if (newPassword) {
      const hash = await bcrypt.hash(newPassword, 10);

      await query(
        `UPDATE user 
         SET name = ?, email = ?, password = ?, mobile_with_country_code = ?, timezone = ?, tokenVersion = COALESCE(tokenVersion, 0) + 1 
         WHERE uid = ?`,
        [name, email, hash, mobile_with_country_code, timezone, req.decode.uid],
      );
    } else {
      await query(
        `UPDATE user 
         SET name = ?, email = ?, mobile_with_country_code = ?, timezone = ? 
         WHERE uid = ?`,
        [name, email, mobile_with_country_code, timezone, req.decode.uid],
      );
    }

    res.json({ success: true, msg: "Profile was updated" });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// get dashboard
router.get("/get_dashboard_old", validateUser, async (req, res) => {
  try {
    const getOpenChat = await query(
      `SELECT * FROM chats WHERE uid = ? AND chat_status = ?`,
      [req.decode.uid, "open"],
    );
    const getOpenPending = await query(
      `SELECT * FROM chats WHERE uid = ? AND chat_status = ?`,
      [req.decode.uid, "pending"],
    );
    const getOpenResolved = await query(
      `SELECT * FROM chats WHERE uid = ? AND chat_status = ?`,
      [req.decode.uid, "solved"],
    );

    const getActiveChatbots = await query(
      `SELECT * FROM chatbot WHERE active = ? AND uid = ?`,
      [1, req.decode.uid],
    );
    const getDActiveChatbots = await query(
      `SELECT * FROM chatbot WHERE active = ? AND uid = ?`,
      [0, req.decode.uid],
    );

    const opened = getUserOrderssByMonth(getOpenChat);
    const pending = getUserOrderssByMonth(getOpenPending);
    const resolved = getUserOrderssByMonth(getOpenResolved);
    const activeBot = getUserOrderssByMonth(getActiveChatbots);
    const dActiveBot = getUserOrderssByMonth(getDActiveChatbots);

    // get total chats
    const totalChats = await query(`SELECT * FROM chats WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const totalChatbots = await query(`SELECT * FROM chatbot WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const totalContacts = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const totalFlows = await query(`SELECT * FROM flow WHERE uid = ?`, [
      req.decode.uid,
    ]);
    const totalBroadcast = await query(
      `SELECT * FROM broadcast WHERE uid = ?`,
      [req.decode.uid],
    );
    const totalTemplets = await query(`SELECT * FROM templets WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({
      success: true,
      opened,
      pending,
      resolved,
      activeBot,
      dActiveBot,
      totalChats: totalChats.length,
      totalChatbots: totalChatbots?.length,
      totalContacts: totalContacts?.length,
      totalFlows: totalFlows?.length,
      totalBroadcast: totalBroadcast?.length,
      totalTemplets: totalTemplets?.length,
    });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

router.get("/get_dashboard", validateUser, async (req, res) => {
  try {
    const uid = req.decode.uid;

    // 1. User Profile Data
    const user = await query("SELECT * FROM user WHERE uid = ?", [uid]);

    // 2. Statistics
    const [agents, activeChats, completedTasks, activeInstances] =
      await Promise.all([
        query("SELECT COUNT(*) as count FROM agents WHERE owner_uid = ?", [
          uid,
        ]),
        query(
          "SELECT COUNT(*) as count FROM beta_chats WHERE uid = ? AND unread_count > 0",
          [uid],
        ),
        query(
          "SELECT COUNT(*) as count FROM agent_task WHERE owner_uid = ? AND status = 'COMPLETED'",
          [uid],
        ),
        query(
          "SELECT COUNT(*) as count FROM instance WHERE uid = ? AND status = 'ACTIVE'",
          [uid],
        ),
      ]);

    // 3. Recent Conversations (from beta_conversation)
    const recentConversations = [];

    // 4. Unread Messages Summary
    const unreadSummary = [];

    // 5. Active Chatbots
    const activeChatbots = await query(
      `
      SELECT title, flow_id 
      FROM beta_chatbot 
      WHERE uid = ? AND active = 1
      LIMIT 3
    `,
      [uid],
    );

    // 6. Performance Metrics (last 7 days)
    const performanceData = await query(
      `
      SELECT 
        DATE(createdAt) as date,
        COUNT(CASE WHEN route = 'INCOMING' THEN 1 END) as incoming,
        COUNT(CASE WHEN route = 'OUTGOING' THEN 1 END) as outgoing
      FROM beta_conversation
      WHERE uid = ? AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(createdAt)
      ORDER BY date ASC
    `,
      [uid],
    );

    const data = {
      user: user[0],
      stats: {
        agents: agents[0].count,
        activeChats: activeChats[0].count,
        completedTasks: completedTasks[0].count,
        activeInstances: activeInstances[0].count,
      },
      recentConversations,
      unreadSummary,
      activeChatbots,
      performanceData,
      lastUpdated: new Date().toISOString(),
    };

    res.json({ success: true, data });
  } catch (err) {
    logger.error("Dashboard error:", err);
    res
      .status(500)
      .json({ success: false, msg: "Failed to load dashboard data" });
  }
});

// enroll free plan
router.post("/start_free_trial", validateUser, async (req, res) => {
  try {
    const { planId } = req.body;

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (getUser[0]?.trial > 0) {
      return res.json({
        success: false,
        msg: "You have already taken Trial once. You can not enroll for trial again.",
      });
    }

    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [planId]);
    if (getPlan.length < 1) {
      return res.json({ msg: "Invalid plan found" });
    }

    if (getPlan[0]?.price > 0) {
      return res.json({ msg: "This plan is not a trial plan." });
    }
    await query(
      `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
      [req.decode.uid, "OFFLINE", 0, JSON.stringify({ plan: getPlan[0] })],
    );

    await updateUserPlan(getPlan[0], getUser[0]?.uid);

    await query(`UPDATE user SET trial = ? WHERE uid = ?`, [1, req.decode.uid]);

    res.json({
      success: true,
      msg: "Your trial plan has been activated. You are redirecting to the panel...",
    });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// send recover
router.post("/send_resovery", async (req, res) => {
  try {
    const { email } = req.body;

    if (!isValidEmail(email)) {
      return res.json({ msg: "Please enter a valid email" });
    }

    const checkEmailValid = await query(`SELECT * FROM user WHERE email = ?`, [
      email,
    ]);
    if (checkEmailValid.length < 1) {
      return res.json({
        success: true,
        msg: "We have sent a recovery link if this email is associated with user account.",
      });
    }

    const getWeb = await query(`SELECT * FROM web_public`, []);
    const appName = getWeb[0]?.app_name;

    const jsontoken = sign(
      {
        old_email: email,
        email: email,
        time: moment(new Date()),
        password: checkEmailValid[0]?.password,
        role: "user",
      },
      process.env.JWTKEY,
      {},
    );

    const recpveryUrl = `${process.env.FRONTENDURI}/recovery-user/${jsontoken}`;

    const getHtml = recoverEmail(appName, recpveryUrl);

    // getting smtp
    const smtp = await query(`SELECT * FROM smtp`, []);
    if (
      !smtp[0]?.email ||
      !smtp[0]?.host ||
      !smtp[0]?.port ||
      !smtp[0]?.password ||
      !smtp[0]?.username
    ) {
      return res.json({
        success: false,
        msg: "SMTP connections not found! Unable to send recovery link",
      });
    }

    await sendEmail(
      smtp[0]?.host,
      smtp[0]?.port,
      smtp[0]?.email,
      smtp[0]?.password,
      getHtml,
      `${appName} - Password Recovery`,
      smtp[0]?.email,
      email,
      smtp[0]?.username,
    );

    res.json({
      success: true,
      msg: "We have sent your a password recovery link. Please check your email",
    });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// modify recovery password
router.get("/modify_password", validateUser, async (req, res) => {
  try {
    const { pass } = req.query;

    if (!pass) {
      return res.json({ success: false, msg: "Please provide a password" });
    }

    if (moment(req.decode.time).diff(moment(new Date()), "hours") > 1) {
      return res.json({ success: false, msg: "Token expired" });
    }

    const hashpassword = await bcrypt.hash(pass, 10);

    const result = await query(
      `UPDATE user 
       SET password = ?, tokenVersion = COALESCE(tokenVersion, 0) + 1 
       WHERE email = ?`,
      [hashpassword, req.decode.old_email],
    );

    res.json({
      success: true,
      msg: "Your password has been changed. You may login now! Redirecting...",
      data: result,
    });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// generate api keys
router.get("/generate_api_keys", validateUser, async (req, res) => {
  try {
    const token = sign(
      { uid: req.decode.uid, role: "user" },
      process.env.JWTKEY,
      {},
    );

    // saving keys to user
    await query(`UPDATE user SET api_key = ? WHERE uid = ?`, [
      token,
      req.decode.uid,
    ]);

    res.json({ success: true, token, msg: "New keys has been generated" });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

router.get("/fetch_profile", validateUser, async (req, res) => {
  try {
    // const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [req.decode.uid])

    const metaKeys = await query("SELECT * FROM meta_api WHERE uid = ?", [
      req.decode?.uid,
    ]);

    if (!metaKeys[0]?.access_token || !metaKeys[0]?.business_phone_number_id) {
      return res.json({
        success: false,
        msg: "Please fill the meta token and mobile id",
      });
    }
    const fetchProfile = await fetchProfileFun(
      metaKeys[0]?.business_phone_number_id,
      metaKeys[0]?.access_token,
    );

    res.json(fetchProfile);
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// adding task for agent
router.post("/add_task_for_agent", validateUser, async (req, res) => {
  try {
    const { title, des, agent_uid } = req.body;
    if (!title || !des) {
      return res.json({ msg: "Please give title and description" });
    }

    if (!agent_uid) {
      return res.json({ msg: "Please select an agent" });
    }

    await query(
      `INSERT INTO agent_task (owner_uid, uid, title, description, status) VALUES (?,?,?,?,?)`,
      [req.decode.uid, agent_uid, title, des, "PENDING"],
    );

    res.json({ success: true, msg: "Task was added" });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// get my agent tasks
router.get("/get_my_agent_tasks", validateUser, async (req, res) => {
  try {
    const data = await query(
      `
            SELECT agent_task.*, agents.email AS agent_email
            FROM agent_task
            JOIN agents ON agents.uid = agent_task.uid
            WHERE agent_task.owner_uid = ?
        `,
      [req.decode.uid],
    );

    res.json({ data, success: true });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// delete task for agent
router.post("/del_task_for_agent", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM agent_task WHERE id = ? AND owner_uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({ msg: "Task was deleted", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// add widget
router.post("/add_widget", validateUser, async (req, res) => {
  try {
    const { title, whatsapp_number, place, selectedIcon, logoType, size } =
      req.body;

    if (!title || !whatsapp_number || !place) {
      return res.json({ msg: "Please fill the details" });
    }

    let filename;

    if (logoType === "UPLOAD") {
      if (!req.files || Object.keys(req.files).length === 0) {
        return res.json({ success: false, msg: "Please upload a logo" });
      }

      const randomString = randomstring.generate();
      const file = req.files.file;

      if (!validateUploadFile(file)) {
        return res.status(400).json({
          success: false,
          msg: "Invalid file type",
        });
      }

      if (file.size > 20 * 1024 * 1024) {
        return res.json({
          success: false,
          msg: "File too large",
        });
      }

      filename = `${randomString}.${getFileExtension(file.name)}`;

      file.mv(`${__dirname}/../client/public/media/${filename}`, (err) => {
        if (err) {
          logger.log(err);
          return res.json({ err });
        }
      });
    } else {
      filename = selectedIcon;
    }

    const unique_id = randomstring.generate(10);

    await query(
      `INSERT INTO chat_widget (unique_id, uid, title, whatsapp_number, logo, place, size) VALUES (?,?,?,?,?,?,?)`,
      [
        unique_id,
        req.decode.uid,
        title,
        whatsapp_number,
        filename,
        place,
        size || 50,
      ],
    );

    res.json({
      msg: "Widget was added",
      success: true,
    });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// get my widget
router.get("/get_my_widget", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM chat_widget WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({ data, success: true });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// del widget
router.post("/del_widget", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    await query(`DELETE FROM chat_widget WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    res.json({ msg: "Widget was deleted", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

router.get("/widget", async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res.send(``);
    }

    const getWidget = await query(
      `SELECT * FROM chat_widget WHERE unique_id = ?`,
      [id],
    );

    if (getWidget.length < 1) {
      return res.send(``);
    }

    const url = generateWhatsAppURL(
      getWidget[0]?.whatsapp_number,
      getWidget[0]?.title,
    );

    res.send(
      returnWidget(
        `${process.env.FRONTENDURI}/media/${getWidget[0]?.logo}`,
        getWidget[0]?.size,
        url,
        getWidget[0]?.place,
      ),
    );
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// update agent profile
router.post("/update_agent_profile", validateUser, async (req, res) => {
  try {
    const { email, name, mobile, newPas, uid } = req.body;

    if (!uid || !email || !name || !mobile) {
      return res.json({
        success: false,
        msg: "You cannot remove any detail of agent",
      });
    }

    const [agent] = await query(
      `SELECT * FROM agents WHERE uid = ? AND owner_uid = ?`,
      [uid, req.decode.uid],
    );

    if (!agent) {
      return res.status(404).json({
        success: false,
        msg: "Agent not found",
      });
    }

    if (newPas) {
      const hasPas = await bcrypt.hash(newPas, 10);

      await query(
        `UPDATE agents 
         SET email = ?, name = ?, mobile = ?, password = ? 
         WHERE uid = ? AND owner_uid = ?`,
        [email, name, mobile, hasPas, uid, req.decode.uid],
      );
    } else {
      await query(
        `UPDATE agents 
         SET email = ?, name = ?, mobile = ? 
         WHERE uid = ? AND owner_uid = ?`,
        [email, name, mobile, uid, req.decode.uid],
      );
    }

    res.json({
      success: true,
      msg: "Agent profile was updated",
    });
  } catch (err) {
    logger.log(err);
    res.json({
      success: false,
      msg: "something went wrong",
    });
  }
});

// auto login agent
router.post("/auto_agent_login", validateUser, async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.json({
        success: false,
        msg: "Agent uid is required",
      });
    }

    const agentFind = await query(
      `SELECT * FROM agents WHERE uid = ? AND owner_uid = ?`,
      [uid, req.decode.uid],
    );

    if (agentFind.length < 1) {
      return res.status(404).json({
        success: false,
        msg: "Agent not found",
      });
    }

    const token = sign(
      {
        uid: agentFind[0].uid,
        role: "agent",
        email: agentFind[0].email,
        owner_uid: agentFind[0].owner_uid,
      },
      process.env.JWTKEY,
      {
        expiresIn: "7d",
      },
    );

    res.json({
      token,
      success: true,
    });
  } catch (err) {
    logger.log(err);
    res.json({
      success: false,
      msg: "something went wrong",
    });
  }
});

// add warmer message
router.post("/add_warmer_message", validateUser, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.json({ msg: "Please enter a message to add" });
    }

    await query(`INSERT INTO warmer_script (uid, message) VALUES (?,?)`, [
      req.decode.uid,
      message,
    ]);

    res.json({ msg: "Warmer message was added", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// get my warmer script
router.get("/get_warmer_script", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM warmer_script WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// del a message
router.post("/del_warmer_msg", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM warmer_script WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);
    res.json({ msg: "Message was deleted", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ msg: "something went wrong", err });
  }
});

// add to warmer
router.post(
  "/add_ins_to_warm",
  validateUser,
  checkPlan,
  checkWaWArmer,
  async (req, res) => {
    try {
      const { instance } = req.body;

      const getWarm = await query(`SELECT * FROM warmers WHERE uid = ?`, [
        req.decode.uid,
      ]);

      const addedIns = JSON.parse(getWarm[0]?.instances);

      if (addedIns.includes(instance)) {
        const finalIns = addedIns.filter((i) => i !== instance);

        await query(`UPDATE warmers SET instances = ? WHERE uid = ?`, [
          JSON.stringify(finalIns),
          req.decode.uid,
        ]);
      } else {
        const fiIns = [...addedIns, instance];
        await query(`UPDATE warmers SET instances = ? WHERE uid = ?`, [
          JSON.stringify(fiIns),
          req.decode.uid,
        ]);
      }

      res.json({
        msg: "Warmer updated",
        success: true,
      });
    } catch (err) {
      logger.log(err);
      res.json({ msg: "something went wrong", err });
    }
  },
);

// get my warmer
router.get("/get_my_warmer", validateUser, async (req, res) => {
  try {
    const { uid } = req.decode;

    const getWarmer = await query(`SELECT * FROM warmers WHERE uid = ?`, [uid]);

    if (getWarmer?.length < 1) {
      await query(
        `INSERT INTO warmers (uid, instances, is_active) VALUES (?,?,?)`,
        [uid, JSON.stringify([]), 1],
      );

      // getting warmer again
      const warmer = await query(`SELECT * FROM warmers WHERE uid = ?`, [uid]);

      warmer[0].instances = JSON.parse(warmer[0].instances);
      res.json({ data: warmer[0], success: true });
    } else {
      getWarmer[0].instances = JSON.parse(getWarmer[0].instances);

      res.json({ data: getWarmer[0], success: true });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// change warmer status
router.post("/change_warmer_status", validateUser, async (req, res) => {
  try {
    const { status } = req.body;

    await query(`UPDATE warmers SET is_active = ? WHERE uid = ?`, [
      status ? 1 : 0,
      req.decode.uid,
    ]);

    res.json({ msg: "Status updated", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// add google auth
router.post("/add_g_auth", validateUser, checkPlan, async (req, res) => {
  try {
    const { label, url } = req.body;
    logger.log(req.body);
    if (!url || !label) {
      return res.json({
        msg: "Please upload and file and give a label to the auth",
      });
    }

    await query(`INSERT INTO g_auth (uid, label, url) VALUES (?,?,?)`, [
      req.decode.uid,
      label,
      url,
    ]);

    res.json({ success: true, msg: "Credentials uploaded" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get my creds
router.get("/get_my_g_creds", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM g_auth WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

router.post("/get_agent_report_old", validateUser, async (req, res) => {
  try {
    let { agentUid, startDate, endDate } = req.body;

    // Validate date range
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        msg: "Start date and end date are required",
      });
    }

    // 1. Get agent data (including logs)
    const [agentData] = await query(`SELECT * FROM agents WHERE uid = ?`, [
      agentUid,
    ]);
    if (!agentData) {
      return res.status(404).json({
        success: false,
        msg: "Agent not found",
      });
    }

    // Parse agent logs
    const agentLogs = agentData.logs ? JSON.parse(agentData.logs) : {};

    // 2. Get all chats assigned to this agent
    const agentChats = await query(
      `SELECT * FROM beta_chats WHERE assigned_agent LIKE ? AND createdAt BETWEEN ? AND ?`,
      [`%${agentUid}%`, startDate, endDate],
    );

    // 3. Get all conversations for these chats
    const chatIds = agentChats.map((chat) => chat.chat_id);
    let allConvos = [];
    if (chatIds.length > 0) {
      allConvos = await query(
        `SELECT * FROM beta_conversation WHERE chat_id IN (?) ORDER BY timestamp ASC`,
        [chatIds],
      );
    }

    // Calculate metrics
    const metrics = {
      // Total chats assigned to agent
      totalChats: agentChats.length,

      // Time spent in panel (from logs)
      timeSpent: calculateTimeSpent(agentLogs, startDate, endDate),

      // Average response time
      avgResponseTime: calculateAvgResponseTime(allConvos),

      // Unread messages count
      unreadMessages: agentChats.reduce(
        (sum, chat) => sum + (chat.unread_count || 0),
        0,
      ),

      // Chat status breakdown
      chatStatus: calculateChatStatus(agentChats),

      // Total messages count
      totalMessages: allConvos.length,

      // Incoming/outgoing breakdown
      messageDirection: calculateMessageDirection(allConvos),

      // Last login/logout
      lastActivity: getLastActivity(agentLogs),

      // Daily breakdown for table
      dailyMetrics: calculateDailyMetrics(
        agentChats,
        allConvos,
        agentLogs,
        startDate,
        endDate,
      ),
    };

    res.json({
      success: true,
      data: {
        agentInfo: {
          name: agentData.name,
          email: agentData.email,
          mobile: agentData.mobile,
        },
        metrics,
      },
    });
  } catch (err) {
    logger.error("Error fetching agent report:", err);
    res.status(500).json({
      success: false,
      msg: "Failed to fetch agent report",
      error: err.message,
    });
  }
});

// Helper functions
function calculateTimeSpent(logs, startDate, endDate) {
  let totalSeconds = 0;
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let date in logs.spendTime) {
    const currentDate = new Date(date);
    if (currentDate >= start && currentDate <= end) {
      totalSeconds += logs.spendTime[date] || 0;
    }
  }

  // Convert to hours and minutes
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function calculateAvgResponseTime(conversations) {
  let totalResponseTime = 0;
  let responseCount = 0;

  for (let i = 0; i < conversations.length - 1; i++) {
    const current = conversations[i];
    const next = conversations[i + 1];

    if (current.route === "INCOMING" && next.route === "OUTGOING") {
      const currentTime = new Date(current.createdAt).getTime();
      const nextTime = new Date(next.createdAt).getTime();
      totalResponseTime += (nextTime - currentTime) / 1000; // in seconds
      responseCount++;
    }
  }

  if (responseCount === 0) return "N/A";

  const avgSeconds = Math.round(totalResponseTime / responseCount);
  const minutes = Math.floor(avgSeconds / 60);
  const seconds = avgSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function calculateChatStatus(chats) {
  const statusCounts = {
    pending: 0,
    open: 0,
    resolved: 0,
    other: 0,
  };

  chats.forEach((chat) => {
    const label = chat.chat_label ? chat.chat_label.toLowerCase() : "other";
    if (label.includes("pending")) {
      statusCounts.pending++;
    } else if (label.includes("open")) {
      statusCounts.open++;
    } else if (label.includes("resolved")) {
      statusCounts.resolved++;
    } else {
      statusCounts.other++;
    }
  });

  return statusCounts;
}

function calculateMessageDirection(conversations) {
  return conversations.reduce(
    (acc, msg) => {
      acc[msg.route === "INCOMING" ? "incoming" : "outgoing"]++;
      return acc;
    },
    { incoming: 0, outgoing: 0 },
  );
}

function getLastActivity(logs) {
  if (!logs.dateTracking) return { lastLogin: "N/A", lastLogout: "N/A" };

  let lastLogin = null;
  let lastLogout = null;

  for (const date in logs.dateTracking) {
    const dayData = logs.dateTracking[date];
    if (
      dayData.lastLogin &&
      (!lastLogin || new Date(dayData.lastLogin) > new Date(lastLogin))
    ) {
      lastLogin = dayData.lastLogin;
    }
    if (
      dayData.lastLogout &&
      (!lastLogout || new Date(dayData.lastLogout) > new Date(lastLogout))
    ) {
      lastLogout = dayData.lastLogout;
    }
  }

  return {
    lastLogin: lastLogin ? formatDate(lastLogin) : "N/A",
    lastLogout: lastLogout ? formatDate(lastLogout) : "N/A",
  };
}

function calculateDailyMetrics(chats, convos, logs, startDate, endDate) {
  const dailyData = {};
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Initialize all dates in range
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    dailyData[dateStr] = {
      date: dateStr,
      totalChats: 0,
      avgResponseTime: 0,
      incomingMessages: 0,
      outgoingMessages: 0,
      timeSpent: logs.spendTime?.[dateStr] || 0,
    };
  }

  // Count chats per day
  chats.forEach((chat) => {
    const chatDate = new Date(chat.createdAt).toISOString().split("T")[0];
    if (dailyData[chatDate]) {
      dailyData[chatDate].totalChats++;
    }
  });

  // Calculate response times and message counts per day
  const dailyConvos = {};
  convos.forEach((convo) => {
    const convoDate = new Date(convo.createdAt).toISOString().split("T")[0];
    if (!dailyConvos[convoDate]) {
      dailyConvos[convoDate] = [];
    }
    dailyConvos[convoDate].push(convo);
  });

  for (const date in dailyConvos) {
    if (dailyData[date]) {
      const dayConvos = dailyConvos[date];
      dailyData[date].incomingMessages = dayConvos.filter(
        (c) => c.route === "INCOMING",
      ).length;
      dailyData[date].outgoingMessages = dayConvos.filter(
        (c) => c.route === "OUTGOING",
      ).length;
      dailyData[date].avgResponseTime = calculateDailyResponseTime(dayConvos);
    }
  }

  return Object.values(dailyData);
}

function calculateDailyResponseTime(conversations) {
  let totalResponseTime = 0;
  let responseCount = 0;

  for (let i = 0; i < conversations.length - 1; i++) {
    const current = conversations[i];
    const next = conversations[i + 1];

    if (current.route === "INCOMING" && next.route === "OUTGOING") {
      const currentTime = new Date(current.createdAt).getTime();
      const nextTime = new Date(next.createdAt).getTime();
      totalResponseTime += (nextTime - currentTime) / 1000; // in seconds
      responseCount++;
    }
  }

  if (responseCount === 0) return 0;
  return Math.round(totalResponseTime / responseCount / 60); // in minutes
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString();
}

router.post("/get_agent_report", validateUser, async (req, res) => {
  try {
    const { uid, startDate, endDate } = req.body;

    logger.log({ uid, startDate, endDate });

    // Date validation and formatting
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.chatDate = {
        start: new Date(startDate),
        end: new Date(endDate),
      };
    }

    // Get agent's chats with optional date filtering
    let agentChatsQuery = `SELECT * FROM beta_chats WHERE assigned_agent LIKE ?`;
    const agentChatsParams = [`%${uid}%`];

    if (dateFilter.chatDate) {
      agentChatsQuery += ` AND createdAt BETWEEN ? AND ?`;
      agentChatsParams.push(dateFilter.chatDate.start, dateFilter.chatDate.end);
    }

    const agentChats = await query(agentChatsQuery, agentChatsParams);

    // Get agent data including logs
    const agentData = await query(`SELECT * FROM agents WHERE uid = ?`, [uid]);

    // Calculate time spent in panel
    let totalTimeSpent = 0;
    let lastLogin = null;
    let lastLogout = null;

    if (agentData[0]?.logs) {
      const logs = JSON.parse(agentData[0].logs);
      if (logs.spendTime) {
        totalTimeSpent = Object.values(logs.spendTime).reduce(
          (sum, time) => sum + time,
          0,
        );
      }
      if (logs.dateTracking) {
        const dates = Object.values(logs.dateTracking);
        if (dates.length > 0) {
          lastLogin = dates[dates.length - 1].lastLogin;
          lastLogout = dates[dates.length - 1].lastLogout;
        }
      }
    }

    // Get chat IDs for conversation query
    const chatIds = agentChats.map((chat) => chat.chat_id);

    // Initialize empty conversations array
    let conversations = [];

    // Only query conversations if we have chat IDs
    if (chatIds.length > 0) {
      // Get conversations with optional date filtering
      let conversationsQuery = `SELECT * FROM beta_conversation WHERE chat_id IN (?)`;
      const conversationsParams = [chatIds];

      if (dateFilter.chatDate) {
        conversationsQuery += ` AND createdAt BETWEEN ? AND ?`;
        conversationsParams.push(
          dateFilter.chatDate.start,
          dateFilter.chatDate.end,
        );
      }

      conversationsQuery += ` ORDER BY createdAt ASC`; // Sort from oldest to newest
      conversations = await query(conversationsQuery, conversationsParams);
    }

    // Calculate metrics
    const metrics = {
      totalChats: agentChats.length,
      timeSpentInPanel: totalTimeSpent, // in minutes
      lastLogin,
      lastLogout,
      unreadMessages: agentChats.reduce(
        (sum, chat) => sum + (chat.unread_count || 0),
        0,
      ),
      totalConversations: conversations.length,
      incomingMessages: conversations.filter((msg) => msg.route === "INCOMING")
        .length,
      outgoingMessages: conversations.filter((msg) => msg.route === "OUTGOING")
        .length,
    };

    // Calculate average response time
    let responseTimes = [];
    let lastIncoming = null;

    conversations.forEach((msg) => {
      if (msg.route === "INCOMING") {
        lastIncoming = new Date(msg.timestamp);
      } else if (msg.route === "OUTGOING" && lastIncoming) {
        const outgoingTime = new Date(msg.timestamp);
        const diff = (outgoingTime - lastIncoming) / 1000; // in seconds
        responseTimes.push(diff);
        lastIncoming = null;
      }
    });

    metrics.avgResponseTime =
      responseTimes.length > 0
        ? Math.round(
            responseTimes.reduce((sum, time) => sum + time, 0) /
              responseTimes.length,
          )
        : 0;

    // Calculate chat status counts
    const statusCounts = {
      open: 0,
      pending: 0,
      unresolved: 0,
      important: 0,
    };

    agentChats.forEach((chat) => {
      if (chat.chat_label) {
        const label = JSON.parse(chat.chat_label);
        if (label.title === "Important") statusCounts.important++;
        // Add more status checks as needed
      }
      // Add other status checks based on your business logic
    });

    metrics.statusCounts = statusCounts;

    res.json({
      success: true,
      data: {
        metrics,
        agentData: agentData[0],
        conversations: conversations.slice(0, 100), // Limit to 100 most recent
        agentChats: agentChats.slice(0, 100), // Limit to 100 most recent
      },
    });
  } catch (err) {
    logger.error(err);
    res.json({
      success: false,
      msg: "Failed to generate agent report",
      err: err.message,
    });
  }
});

router.get("/get_my_meta_templets_beta", validateUser, async (req, res) => {
  try {
    const getMETA = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);
    if (getMETA.length < 1) {
      return res.json({
        success: false,
        msg: "Please check your meta API keys",
      });
    }

    // Add pagination and filtering options
    const limit = req.query.limit || 9;
    const after = req.query.after || null;
    const before = req.query.before || null;
    const status = req.query.status || "APPROVED";

    const resp = await getAllTempletsMetaBeta(
      "v21.0", // Use your API version
      getMETA[0]?.waba_id,
      getMETA[0]?.access_token,
      limit,
      after,
      before,
      status,
    );

    if (resp?.error) {
      res.json({
        success: false,
        msg: resp?.error?.message || "Please check your API",
      });
    } else {
      // Process templates to extract variable information
      const templatesWithVars =
        resp?.data?.map((template) => {
          const variables = extractTemplateVariablesBeta(template);
          return {
            ...template,
            variables,
          };
        }) || [];

      res.json({
        success: true,
        data: templatesWithVars,
        paging: resp?.paging || {},
      });
    }
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

router.post("/send_template_message", validateUser, async (req, res) => {
  try {
    const {
      template_name,
      template_language = "en_US",
      recipient_phone,
      body_variables = [],
      header_variable = null,
      button_variables = [],
    } = req.body;

    // Validate required fields
    if (!template_name || !recipient_phone) {
      return res.json({
        success: false,
        msg: "Template name and recipient phone are required",
      });
    }

    // Format phone number (ensure it has country code)
    const formattedPhone = formatPhoneNumber(recipient_phone);

    // Get user's Meta API credentials
    const getMETA = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);

    if (getMETA.length < 1) {
      return res.json({
        success: false,
        msg: "Please check your meta API keys",
      });
    }

    // Send the template message
    const response = await sendTemplateMessage(
      "v18.0",
      getMETA[0]?.business_phone_number_id,
      getMETA[0]?.access_token,
      template_name,
      template_language,
      formattedPhone,
      body_variables,
      header_variable,
      button_variables,
    );

    if (response?.error) {
      return res.json({
        success: false,
        msg: response?.error?.message || "Failed to send template message",
        error: response.error,
      });
    }

    res.json({
      success: true,
      msg: "Template message sent successfully",
      data: response,
    });
  } catch (err) {
    logger.error("Error sending template message:", err);
    res.json({
      success: false,
      msg: "Something went wrong while sending the template",
      error: err.message,
    });
  }
});

// add quick reply
router.post("/add_quick_reply", validateUser, async (req, res) => {
  try {
    const { msg } = req.body;
    if (!msg) return res.json({ msg: "Please enter message to add" });

    await query(`INSERT INTO quick_reply (uid, msg) VALUES (?,?)`, [
      req.decode.uid,
      msg,
    ]);

    res.json({ success: true, msg: "Quick reply added" });
  } catch (err) {
    logger.error("Error sending template message:", err);
    res.json({
      success: false,
      msg: "something went wrong",
      err: err,
    });
  }
});

// get all quick reply
router.get("/get_all_quick_reply", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM quick_reply WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    logger.log(err);
    res.json({
      success: false,
      msg: "something went wrong",
      err: err,
    });
  }
});

// del one quick repl
router.post("/del_quick_r", validateUser, async (req, res) => {
  try {
    const { id } = req.body;
    await query(`DELETE FROM quick_reply WHERE uid = ? AND id = ?`, [
      req.decode.uid,
      id,
    ]);
    res.json({
      success: true,
      msg: "Quick reply deleted",
    });
  } catch (err) {
    logger.log(err);
    res.json({
      success: false,
      msg: "something went wrong",
      err: err,
    });
  }
});

router.post("/update_fcm_token", validateUser, async (req, res) => {
  try {
    const { other, token } = req.body;
    const user = req.decode.userData;

    // 1️⃣ Remove token everywhere first
    await removeTokenFromAll(token);

    // 2️⃣ Parse CURRENT USER fcm_data safely
    let fcmData;
    try {
      fcmData = JSON.parse(user?.fcm_data || "{}");
    } catch {
      fcmData = {};
    }

    const existingTokens = Array.isArray(fcmData.tokens) ? fcmData.tokens : [];
    const existingOther =
      typeof fcmData.other === "object" && fcmData.other !== null
        ? fcmData.other
        : {};

    // 3️⃣ Add token to current user (no duplicates)
    // const newTokens = existingTokens.includes(token)
    //   ? existingTokens
    //   : [...existingTokens, token];

    const newTokens = [token];

    const newUpdated = {
      tokens: newTokens,
      other: { ...existingOther, ...other },
    };

    // 4️⃣ Save final data
    await query(`UPDATE user SET fcm_data = ? WHERE uid = ?`, [
      JSON.stringify(newUpdated),
      req.decode.uid,
    ]);

    res.json({ success: true, fcm_data: newUpdated });
  } catch (err) {
    logger.error("❌ USER FCM update error:", err);
    res.status(500).json({
      success: false,
      msg: "Something went wrong",
      err: err.message,
    });
  }
});

router.post("/exchange_embed_token", validateUser, async (req, res) => {
  try {
    const { authCode, wabaId, phoneNumId, businessId, isCoexistence } =
      req.body;

    // 🔥 CRITICAL: Log what we received
    logger.log("📥 /exchange_embed_token received:", {
      authCode: authCode ? "✅ present" : "❌ missing",
      wabaId,
      phoneNumId,
      businessId,
      isCoexistence, // 🔥 CHECK THIS VALUE
      uid: req.decode.uid,
    });

    const [web] = await query(`SELECT * FROM web_private`, []);

    if (!web || !web?.embed_app_id || !web?.embed_app_sec) {
      return res.json({
        success: false,
        msg: "Embed app is not configured. Please configure it from admin panel",
      });
    }

    const appId = web?.embed_app_id;
    const appSecret = web?.embed_app_sec;

    // 🔥 CRITICAL: Pass isCoexistence correctly
    const genToken = await exchangeEmbedToken({
      appId,
      appSecret,
      authCode,
      wabaId,
      phoneNumId,
      businessId,
      isCoexistence: isCoexistence === true || isCoexistence === "true", // 🔥 Handle both boolean and string
    });

    logger.log("🔄 exchangeEmbedToken result:", {
      success: genToken?.success,
      isCoexistence: genToken?.data?.isCoexistence,
      msg: genToken?.msg,
    });

    if (genToken?.success) {
      const waba_id = genToken?.data?.waba?.id;
      const access_token = genToken?.data?.token;
      const business_phone_number_id = genToken?.data?.phoneNumId;
      const app_id = appId;
      const is_coexistence = genToken?.data?.isCoexistence || false;
      const platform_type = genToken?.data?.platformType || null;

      const findOne = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
        req.decode.uid,
      ]);

      if (findOne.length > 0) {
        await query(
          `UPDATE meta_api SET 
            embed_data = ?, 
            login_type = ?, 
            waba_id = ?, 
            access_token = ?, 
            business_phone_number_id = ?, 
            app_id = ?, 
            is_coexistence = ?, 
            platform_type = ? 
          WHERE uid = ?`,
          [
            JSON.stringify(genToken?.data),
            "embed",
            waba_id,
            access_token,
            business_phone_number_id,
            app_id,
            is_coexistence ? 1 : 0,
            platform_type,
            req.decode.uid,
          ],
        );
      } else {
        await query(
          `INSERT INTO meta_api 
            (uid, embed_data, login_type, waba_id, access_token, business_phone_number_id, app_id, is_coexistence, platform_type) 
          VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            req.decode.uid,
            JSON.stringify(genToken?.data),
            "embed",
            waba_id,
            access_token,
            business_phone_number_id,
            app_id,
            is_coexistence ? 1 : 0,
            platform_type,
          ],
        );
      }

      // Auto-sync if coexistence
      if (is_coexistence) {
        // logger.log("🔄 Starting coexistence sync...");
        // setTimeout(async () => {
        //   try {
        //     await syncContacts({
        //       token: access_token,
        //       phoneNumId: business_phone_number_id,
        //     });
        //     await syncMessageHistory({
        //       token: access_token,
        //       phoneNumId: business_phone_number_id,
        //     });
        //     logger.log("✅ Coexistence sync initiated");
        //   } catch (syncErr) {
        //     logger.error("❌ Sync error:", syncErr);
        //   }
        // }, 2000);
      }
    }

    res.json(genToken);
  } catch (err) {
    logger.error("❌ /exchange_embed_token error:", err);
    res.json({ success: false, msg: "Something went wrong", err: err.message });
  }
});

router.get("/get_embed_keys", validateUser, async (req, res) => {
  try {
    const [web] = await query(`SELECT * FROM web_private`, []);
    res.json({
      success: true,
      data: {
        embed_app_id: web?.embed_app_id || null,
        embed_app_config: web?.embed_app_config || null,
      },
    });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

router.post("/try_js", validateUser, async (req, res) => {
  const { code, previousResponse, allResponses } = req.body;

  if (!code || typeof code !== "string") {
    return res.status(400).json({
      success: false,
      error: "Invalid code",
    });
  }

  if (code.length > 5000) {
    return res.status(400).json({
      success: false,
      error: "Code is too long",
    });
  }

  try {
    const logs = [];

    const vm = new NodeVM({
      timeout: 5000,
      console: "redirect",
      sandbox: {
        response: previousResponse || null,
        allResponses: allResponses || {},
      },
      require: {
        external: false,
        builtin: [],
      },
      eval: false,
      wasm: false,
    });

    vm.on("logger.log", (...args) => {
      logs.push(args.map(String).join(" "));
    });

    vm.on("logger.error", (...args) => {
      logs.push(`ERROR: ${args.map(String).join(" ")}`);
    });

    const result = await vm.run(`
      module.exports = (async () => {
        "use strict";
        ${code}
      })();
    `);

    res.json({
      success: true,
      data: result !== undefined ? result : null,
      logs,
      warning:
        result === undefined ? "No return statement found in code" : null,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      errorType: error.name,
    });
  }
});

// Create MercadoPago preference
router.post(
  "/create_mercadopago_preference",
  validateUser,
  async (req, res) => {
    try {
      const { planId } = req.body;

      const getWeb = await query(`SELECT * FROM web_private`, []);
      const [webPublic] = await query(`SELECT * FROM web_public`, []);

      if (
        getWeb.length < 1 ||
        !getWeb[0]?.pay_mercadopago_access_token ||
        !getWeb[0]?.pay_mercadopago_public_key
      ) {
        return res.json({
          success: false,
          msg: "MercadoPago credentials not found",
        });
      }

      const plan = await query(`SELECT * FROM plan WHERE id = ?`, [planId]);

      if (plan.length < 1) {
        return res.json({ msg: "No plan found with the id" });
      }

      const randomSt = randomstring.generate();
      const orderID = `MERCADOPAGO_${randomSt}`;

      await query(
        `INSERT INTO orders (uid, payment_mode, amount, data) VALUES (?,?,?,?)`,
        [req.decode.uid, "MERCADOPAGO", plan[0]?.price, orderID],
      );

      // ✅ NEW SDK: Initialize MercadoPago client
      const client = new MercadoPagoConfig({
        accessToken: getWeb[0]?.pay_mercadopago_access_token,
        options: { timeout: 5000 },
      });

      const preference = new Preference(client);

      // ✅ Create preference body
      const body = {
        items: [
          {
            title: plan[0]?.title,
            unit_price: parseFloat(plan[0]?.price),
            quantity: 1,
            currency_id: webPublic?.currency_code || "USD",
          },
        ],
        back_urls: {
          success: `${process.env.BACKURI}/api/user/mercadopago_payment?order=${orderID}&plan=${plan[0]?.id}&status=success`,
          failure: `${process.env.BACKURI}/api/user/mercadopago_payment?order=${orderID}&plan=${plan[0]?.id}&status=failure`,
          pending: `${process.env.BACKURI}/api/user/mercadopago_payment?order=${orderID}&plan=${plan[0]?.id}&status=pending`,
        },
        auto_return: "approved",
        external_reference: orderID,
        notification_url: `${process.env.BACKURI}/api/user/mercadopago_webhook`,
        statement_descriptor: webPublic?.app_name || "Payment",
        metadata: {
          user_id: req.decode.uid,
          plan_id: planId,
        },
      };

      // ✅ Create preference
      const response = await preference.create({ body });

      await query(`UPDATE orders SET s_token = ? WHERE data = ?`, [
        response.id,
        orderID,
      ]);

      res.json({
        success: true,
        init_point: response.init_point,
        preference_id: response.id,
      });
    } catch (err) {
      logger.error("MercadoPago error:", err);
      res.json({
        msg: err.message || err.toString(),
        err: err.message,
        success: false,
      });
    }
  },
);

// MercadoPago payment callback
router.get("/mercadopago_payment", async (req, res) => {
  try {
    const { order, plan, status, payment_id, collection_status } = req.query;

    if (!order || !plan) {
      return res.send("INVALID REQUEST");
    }

    const getOrder = await query(`SELECT * FROM orders WHERE data = ?`, [
      order || "",
    ]);
    const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [plan]);

    if (getOrder.length < 1) {
      return res.send(returnHtmlRes("Invalid payment found"));
    }

    if (getPlan.length < 1) {
      return res.send(returnHtmlRes("Invalid plan found"));
    }

    // Check payment status
    if (status === "success" || collection_status === "approved") {
      res.send(returnHtmlRes("Payment Success! Redirecting..."));

      // Update order with payment details
      await query(`UPDATE orders SET data = ? WHERE data = ?`, [
        JSON.stringify({
          payment_id,
          status,
          collection_status,
          order_id: order,
        }),
        order,
      ]);

      // Update user plan
      await updateUserPlan(getPlan[0], getOrder[0]?.uid);
    } else if (status === "pending") {
      res.send(
        returnHtmlRes(
          "Payment is pending. We will update you once it's confirmed. Redirecting...",
        ),
      );
    } else {
      res.send(
        returnHtmlRes(
          "Payment Failed! If the balance was deducted please contact support. Redirecting...",
        ),
      );
    }
  } catch (err) {
    logger.log(err);
    res.json({ msg: "Something went wrong", err, success: false });
  }
});

// MercadoPago webhook (for IPN notifications)
router.post("/mercadopago_webhook", async (req, res) => {
  try {
    const { type, data } = req.body;

    logger.log("MercadoPago Webhook:", { type, data });

    if (type === "payment") {
      const getWeb = await query(`SELECT * FROM web_private`, []);

      // ✅ NEW SDK: Initialize client
      const client = new MercadoPagoConfig({
        accessToken: getWeb[0]?.pay_mercadopago_access_token,
      });

      const payment = new Payment(client);

      // ✅ Get payment details
      const paymentInfo = await payment.get({ id: data.id });

      const externalReference = paymentInfo.external_reference;
      const status = paymentInfo.status;

      if (status === "approved") {
        const getOrder = await query(`SELECT * FROM orders WHERE data = ?`, [
          externalReference,
        ]);

        if (getOrder.length > 0) {
          // Get plan ID from metadata
          const planId = paymentInfo.metadata?.plan_id;

          if (planId) {
            const getPlan = await query(`SELECT * FROM plan WHERE id = ?`, [
              planId,
            ]);

            if (getPlan.length > 0) {
              await updateUserPlan(getPlan[0], getOrder[0]?.uid);
            }
          }
        }
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    logger.error("MercadoPago webhook error:", err);
    res.status(500).send("Error");
  }
});

// get fcm data admin
router.get("/get_fcm_data", validateUser, async (req, res) => {
  try {
    const [data] = await query(
      `SELECT fcm_apiKey, 
      fcm_authDomain, 
      fcm_projectId, 
      fcm_storageBucket, 
      fcm_messagingSenderId, 
      fcm_appId, 
      fcm_measurementId, 
      fcm_vapidKey FROM web_private`,
      [],
    );
    res.json({ data, success: true });
  } catch (err) {
    logger.error(err);
    res.json({ msg: "Something went wrong", success: false });
  }
});

router.post("/update_web_fcm_token", validateUser, async (req, res) => {
  try {
    const { token, otherMetaData } = req.body;

    const rows = await query(`SELECT * FROM fcm_tokens WHERE uid = ?`, [
      req.decode.uid,
    ]);

    const existing = rows[0];

    if (!token) {
      await query(`DELETE FROM fcm_tokens WHERE uid = ?`, [req.decode.uid]);
      return res.json({ success: true });
    }

    if (existing) {
      await query(`UPDATE fcm_tokens SET token = ?, other = ? WHERE uid = ?`, [
        token,
        JSON.stringify(otherMetaData),
        req.decode.uid,
      ]);
    } else {
      logger.log("➕ INSERTING new token");
      await query(
        `INSERT INTO fcm_tokens (uid, token, other) VALUES (?, ?, ?)`,
        [req.decode.uid, token, JSON.stringify(otherMetaData)],
      );
    }

    res.json({ success: true });
  } catch (err) {
    logger.error(err);
    res.json({ success: false });
  }
});

// ─── Route 2: Only update fcm_inbox preference (called on switch toggle) ───
router.post("/update_fcm_choice", validateUser, async (req, res) => {
  try {
    const { fcm_inbox } = req.body;

    await query(`UPDATE user SET fcm_inbox = ? WHERE uid = ?`, [
      fcm_inbox ? 1 : 0,
      req.decode.uid,
    ]);

    res.json({ success: true });
  } catch (err) {
    logger.error(err);
    res.json({ success: false });
  }
});

// GET all tags (already exists)
router.get("/get_chat_tags", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM chat_tags WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ success: true, data });
  } catch (err) {
    logger.error(err);
    res.json({ success: false });
  }
});

// POST create new tag
router.post("/add_chat_tag", validateUser, async (req, res) => {
  try {
    const { title, hex } = req.body;
    if (!title || title.length > 12)
      return res.json({ success: false, msg: "Invalid title" });

    await query(`INSERT INTO chat_tags (uid, title, hex) VALUES (?, ?, ?)`, [
      req.decode.uid,
      title,
      hex || "#6366F1",
    ]);
    res.json({ success: true });
  } catch (err) {
    logger.error(err);
    res.json({ success: false });
  }
});

// POST delete tag
router.post("/delete_chat_tag", validateUser, async (req, res) => {
  try {
    const { labelId } = req.body;
    await query(`DELETE FROM chat_tags WHERE id = ? AND uid = ?`, [
      labelId,
      req.decode.uid,
    ]);
    res.json({ success: true });
  } catch (err) {
    logger.error(err);
    res.json({ success: false });
  }
});

module.exports = router;
