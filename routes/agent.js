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
  mergeArrays,
  readJSONFile,
  sendMetaMsg,
  removeTokenFromAll,
} = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const validateAgent = require("../middlewares/agent.js");
const Stripe = require("stripe");
const {
  checkPlan,
  checkNote,
  checkTags,
  checkContactLimit,
} = require("../middlewares/plan.js");
const { recoverEmail } = require("../emails/returnEmails.js");
const moment = require("moment");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const fs = require("fs");
const logger = require("../utils/logger.js");

// adding agent
router.post("/add_agent", validateUser, checkPlan, async (req, res) => {
  try {
    const { name, password, email, mobile, comments } = req.body;

    if (!name || !password || !email || !mobile) {
      return res.json({
        msg: "Please fill all the details",
      });
    }

    if (!isValidEmail(email)) {
      return res.json({ msg: "Please enter a valid email" });
    }

    // check if already
    const getUser = await query(`SELECT * FROM agents WHERE email = ?`, [
      email?.toLowerCase(),
    ]);

    if (getUser.length > 0) {
      return res.json({
        msg: "This email is already used by you or someone else on the platform, Please choose another email",
      });
    }

    const hashPass = await bcrypt.hash(password, 10);

    const uid = randomstring.generate();

    await query(
      `INSERT INTO agents (owner_uid, uid, email, password, name, mobile, comments) VALUES (
            ?,?,?,?,?,?,?
        )`,
      [
        req.decode.uid,
        uid,
        email?.toLowerCase(),
        hashPass,
        name,
        mobile,
        comments,
      ],
    );

    res.json({
      msg: "Agent account was created",
      success: true,
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get all agents
router.get("/get_my_agents", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM agents WHERE owner_uid = ?`, [
      req.decode.uid,
    ]);

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// change status mask number
router.post("/change_status_mask", validateUser, async (req, res) => {
  try {
    const { agentUid, activeness } = req.body;

    await query(`UPDATE agents SET mask_number = ? WHERE uid = ?`, [
      activeness ? 1 : 0,
      agentUid,
    ]);

    res.json({
      success: true,
      msg: "Success",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// change status mask number
router.post("/change_status_allow_send", validateUser, async (req, res) => {
  try {
    const { agentUid, activeness } = req.body;

    await query(`UPDATE agents SET allow_send_new_qr = ? WHERE uid = ?`, [
      activeness ? 1 : 0,
      agentUid,
    ]);

    res.json({
      success: true,
      msg: "Success",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// change agent activeness
router.post("/change_agent_activeness", validateUser, async (req, res) => {
  try {
    const { agentUid, activeness } = req.body;

    await query(`UPDATE agents SET is_active = ? WHERE uid = ?`, [
      activeness ? 1 : 0,
      agentUid,
    ]);

    res.json({
      success: true,
      msg: "Success",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// del user
router.post("/del_agent", validateUser, async (req, res) => {
  try {
    const { uid } = req.body;
    await query(`DELETE FROM agents WHERE uid = ? AND owner_uid = ?`, [
      uid,
      req.decode.uid,
    ]);

    res.json({
      success: true,
      msg: "Agent was deleted",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get agent chats by owner
router.post("/get_agent_chats_owner", validateUser, async (req, res) => {
  try {
    const { uid } = req.body;

    const data = await query(
      `
        SELECT * 
        FROM agent_chats 
        JOIN chats  
        ON agent_chats.chat_id = chats.chat_id 
        WHERE agent_chats.owner_uid = ? 
        AND chats.uid = ?        
        `,
      [req.decode.uid, req.decode.uid, uid],
    );

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get chat assisgn agent
router.post("/get_assigned_chat_agent", validateUser, async (req, res) => {
  try {
    const { chatId } = req.body;

    let data;

    data = await query(
      `SELECT * FROM agent_chats WHERE chat_id = ? AND owner_uid = ?`,
      [chatId, req.decode.uid],
    );

    if (data.length > 0) {
      const agent = await query(`SELECT * FROM agents WHERE uid = ?`, [
        data[0]?.uid,
      ]);
      data[0] = {
        ...agent[0],
        chat_id: data[0].chat_id,
        owner_uid: data[0].owner_uid,
      };
    } else {
      data = {};
    }

    res.json({ data: data[0], success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// update agent in chat

// update agent in chat
router.post("/update_agent_in_chat", validateUser, async (req, res) => {
  try {
    const { assignAgent, chatId, agentUid } = req.body;

    if (assignAgent?.email) {
      await query(
        `DELETE FROM agent_chats WHERE owner_uid = ? AND chat_id = ?`,
        [req.decode?.uid, chatId],
      );

      await query(
        `INSERT INTO agent_chats (owner_uid, uid, chat_id) VALUES (?,?,?)`,
        [req.decode.uid, assignAgent?.uid, chatId],
      );
    } else {
      await query(
        `DELETE FROM agent_chats WHERE owner_uid = ? AND chat_id = ?`,
        [req.decode?.uid, chatId],
      );
    }

    res.json({ msg: "Updated", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// deleted assign chat
router.post("/del_assign_chat_by_owner", validateUser, async (req, res) => {
  try {
    const { uid, chat_id } = req.body;

    logger.log(req.body);

    await query(
      `DELETE FROM agent_chats WHERE owner_uid = ? AND uid = ? AND chat_id = ?`,
      [req.decode.uid, uid, chat_id],
    );

    res.json({ msg: "Chat was removed from the agent", success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.json({
        success: false,
        msg: "Please provide email and password",
      });
    }

    const agentFind = await query(`SELECT * FROM agents WHERE email = ?`, [
      email,
    ]);
    if (agentFind.length < 1) {
      return res.json({ msg: "Invalid credentials" });
    }

    const compare = await bcrypt.compare(password, agentFind[0].password);
    if (!compare) {
      return res.json({ msg: "Invalid credentials" });
    }

    // ✅ No password in token — uses tokenVersion instead
    const token = sign(
      {
        uid: agentFind[0].uid,
        role: "agent",
        email: agentFind[0].email,
        owner_uid: agentFind[0]?.owner_uid,
        tokenVersion: agentFind[0]?.tokenVersion ?? 0,
      },
      process.env.JWTKEY,
      {},
    );

    const currentDate = new Date().toISOString().split("T")[0];
    const loginTime = new Date().toISOString();

    const existingLogs = agentFind[0].logs ? JSON.parse(agentFind[0].logs) : {};

    if (!existingLogs.dateTracking) {
      existingLogs.dateTracking = {};
    }

    if (!existingLogs.dateTracking[currentDate]) {
      existingLogs.dateTracking[currentDate] = {
        logins: 0,
        logouts: 0,
        lastLogin: loginTime,
        lastLogout: null,
      };
    }

    existingLogs.dateTracking[currentDate].logins++;
    existingLogs.dateTracking[currentDate].lastLogin = loginTime;

    await query(`UPDATE agents SET logs = ? WHERE uid = ?`, [
      JSON.stringify(existingLogs),
      agentFind[0].uid,
    ]);

    res.json({
      success: true,
      token,
      todayStats: existingLogs.dateTracking[currentDate],
    });
  } catch (err) {
    logger.error(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// logout agent
router.get("/logout", validateAgent, async (req, res) => {
  try {
    const uid = req.decode.uid;

    if (!uid) {
      return res.json({
        success: false,
        msg: "Agent UID is required",
      });
    }

    // Get agent data
    const agentFind = await query(`SELECT * FROM agents WHERE uid = ?`, [uid]);
    if (agentFind.length < 1) {
      return res.json({ success: false, msg: "Agent not found" });
    }

    // Parse existing logs or initialize
    const existingLogs = agentFind[0].logs ? JSON.parse(agentFind[0].logs) : {};

    // Initialize dateTracking if not exists
    if (!existingLogs.dateTracking) {
      existingLogs.dateTracking = {};
    }

    // Get current date (YYYY-MM-DD)
    const currentDate = new Date().toISOString().split("T")[0];

    // Initialize date entry if not exists
    if (!existingLogs.dateTracking[currentDate]) {
      existingLogs.dateTracking[currentDate] = {
        logins: 0,
        logouts: 0,
        lastLogin: null,
        lastLogout: new Date().toISOString(),
      };
    } else {
      // Update existing date entry
      existingLogs.dateTracking[currentDate].logouts++;
      existingLogs.dateTracking[currentDate].lastLogout =
        new Date().toISOString();
    }

    // Update database
    await query(`UPDATE agents SET logs = ? WHERE uid = ?`, [
      JSON.stringify(existingLogs),
      uid,
    ]);

    res.json({
      success: true,
      msg: "Logout recorded successfully",
      todayStats: existingLogs.dateTracking[currentDate],
    });
  } catch (err) {
    logger.error(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// get me agent
router.get("/get_me", validateAgent, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM agents WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data: data[0], success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get agent assign chats
router.get("/get_my_assigned_chats", validateAgent, async (req, res) => {
  try {
    let data = [];

    const getMyChatsId = await query(
      `SELECT * FROM agent_chats WHERE uid = ?`,
      [req.decode.uid],
    );

    logger.log({
      getMyChatsId,
    });

    if (getMyChatsId.length < 1) {
      return res.json({ data: [], success: true });
    }

    const chatIds = getMyChatsId.map((i) => i?.chat_id);

    logger.log({
      chatIds,
    });

    // Using IN clause to match against multiple IDs
    data = await query(`SELECT * FROM chats WHERE chat_id IN (?) AND uid = ?`, [
      chatIds,
      req.owner?.uid,
    ]);

    logger.log({
      data,
    });

    const getContacts = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.owner.uid,
    ]);

    if (data.length > 0 && getContacts.length > 0) {
      data = mergeArrays(getContacts, data);
    } else {
      data = data;
    }

    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

// get chat conversatio
router.post("/get_convo", validateAgent, async (req, res) => {
  try {
    const { chatId } = req.body;

    const filePath = `${__dirname}/../conversations/inbox/${req.owner.uid}/${chatId}.json`;
    const data = readJSONFile(filePath, 100);

    res.json({ data, success: true });
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// send chat text
router.post("/send_text", validateAgent, checkPlan, async (req, res) => {
  try {
    const { text, toNumber, toName, chatId } = req.body;

    if (!text || !toNumber || !toName || !chatId) {
      return res.json({ success: false, msg: "Not enough input provided" });
    }

    const msgObj = {
      type: "text",
      text: {
        preview_url: true,
        body: text,
      },
    };

    const savObj = {
      type: "text",
      metaChatId: "",
      msgContext: {
        type: "text",
        text: {
          preview_url: true,
          body: text,
        },
      },
      reaction: "",
      timestamp: "",
      senderName: toName,
      senderMobile: toNumber,
      status: "sent",
      star: false,
      route: "OUTGOING",
      agent: req.decode?.email,
    };

    const resp = await sendMetaMsg(
      req.owner.uid,
      msgObj,
      toNumber,
      savObj,
      chatId,
    );
    res.json(resp);
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// send audio
router.post("/send_audio", validateAgent, checkPlan, async (req, res) => {
  try {
    const { url, toNumber, toName, chatId } = req.body;

    if (!url || !toNumber || !toName || !chatId) {
      return res.json({ success: false, msg: "Not enough input provided" });
    }

    const msgObj = {
      type: "audio",
      audio: {
        link: url,
      },
    };

    const savObj = {
      type: "audio",
      metaChatId: "",
      msgContext: {
        type: "audio",
        audio: {
          link: url,
        },
      },
      reaction: "",
      timestamp: "",
      senderName: toName,
      senderMobile: toNumber,
      status: "sent",
      star: false,
      route: "OUTGOING",
      agent: req.decode?.email,
    };

    const resp = await sendMetaMsg(
      req.owner.uid,
      msgObj,
      toNumber,
      savObj,
      chatId,
    );
    res.json(resp);
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// return image url
router.post("/return_media_url", validateAgent, async (req, res) => {
  let randomString;
  let file;

  try {
    ffmpeg.setFfmpegPath(ffmpegStatic);
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.json({ success: false, msg: "No files were uploaded" });
    }

    randomString = randomstring.generate();
    file = req.files.file;
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

    // logger.log({
    //   success: true,
    //   url,
    //   converted: shouldConvert && file.mimetype.startsWith("audio/"),
    //   format:
    //     shouldConvert && file.mimetype.startsWith("audio/")
    //       ? target === "baileys"
    //         ? "ogg"
    //         : "mp3"
    //       : getFileExtension(file.name),
    //   target: target || "default",
    // });
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

router.post("/convert_audio", validateAgent, async (req, res) => {
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

// send document
router.post("/send_doc", validateAgent, checkPlan, async (req, res) => {
  try {
    const { url, toNumber, toName, chatId, caption } = req.body;

    if (!url || !toNumber || !toName || !chatId) {
      return res.json({ success: false, msg: "Not enough input provided" });
    }

    const msgObj = {
      type: "document",
      document: {
        link: url,
        caption: caption || "",
      },
    };

    const savObj = {
      type: "document",
      metaChatId: "",
      msgContext: {
        type: "document",
        document: {
          link: url,
          caption: caption || "",
        },
      },
      reaction: "",
      timestamp: "",
      senderName: toName,
      senderMobile: toNumber,
      status: "sent",
      star: false,
      route: "OUTGOING",
      agent: req.decode?.email,
    };

    const resp = await sendMetaMsg(
      req.owner.uid,
      msgObj,
      toNumber,
      savObj,
      chatId,
    );
    res.json(resp);
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// send video
router.post("/send_video", validateAgent, checkPlan, async (req, res) => {
  try {
    const { url, toNumber, toName, chatId, caption } = req.body;

    if (!url || !toNumber || !toName || !chatId) {
      return res.json({ success: false, msg: "Not enough input provided" });
    }

    const msgObj = {
      type: "video",
      video: {
        link: url,
        caption: caption || "",
      },
    };

    const savObj = {
      type: "video",
      metaChatId: "",
      msgContext: {
        type: "video",
        video: {
          link: url,
          caption: caption || "",
        },
      },
      reaction: "",
      timestamp: "",
      senderName: toName,
      senderMobile: toNumber,
      status: "sent",
      star: false,
      route: "OUTGOING",
      agent: req.decode?.email,
    };

    const resp = await sendMetaMsg(
      req.owner.uid,
      msgObj,
      toNumber,
      savObj,
      chatId,
    );
    res.json(resp);
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// send image
router.post("/send_image", validateAgent, checkPlan, async (req, res) => {
  try {
    const { url, toNumber, toName, chatId, caption } = req.body;

    if (!url || !toNumber || !toName || !chatId) {
      return res.json({ success: false, msg: "Not enough input provided" });
    }

    const msgObj = {
      type: "image",
      image: {
        link: url,
        caption: caption || "",
      },
    };

    const savObj = {
      type: "image",
      metaChatId: "",
      msgContext: {
        type: "image",
        image: {
          link: url,
          caption: caption || "",
        },
      },
      reaction: "",
      timestamp: "",
      senderName: toName,
      senderMobile: toNumber,
      status: "sent",
      star: false,
      route: "OUTGOING",
      agent: req.decode?.email,
    };

    const resp = await sendMetaMsg(
      req.owner.uid,
      msgObj,
      toNumber,
      savObj,
      chatId,
    );
    res.json(resp);
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// get my tasks
router.get("/get_my_task", validateAgent, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM agent_task WHERE uid = ?`, [
      req.decode.uid,
    ]);

    res.json({ data, success: true });
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// mark task complete
router.post("/mark_task_complete", validateAgent, async (req, res) => {
  try {
    const { id, comment } = req.body;

    if (!comment) {
      return res.json({ msg: "Please type your comments." });
    }

    await query(
      `UPDATE agent_task SET status = ?, agent_comments = ? WHERE id = ?`,
      ["COMPLETED", comment, id],
    );

    res.json({ msg: "Task updated", success: true });
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// change chat status
router.post("/change_chat_ticket_status", validateAgent, async (req, res) => {
  try {
    const { status, chatId } = req.body;

    if (!status || !chatId) {
      return res.json({ msg: "invalid request" });
    }

    await query(`UPDATE chats SET chat_status = ? WHERE chat_id = ?`, [
      status,
      chatId,
    ]);

    res.json({
      success: true,
      msg: "Chat status updated",
    });
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// get all quick reply
router.get("/get_all_quick_reply", validateAgent, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM quick_reply WHERE uid = ?`, [
      req.owner.uid,
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

// change status save as contact
router.post("/save_contact_agent", validateUser, async (req, res) => {
  try {
    const { agentUid, activeness } = req.body;

    await query(`UPDATE agents SET allow_save_contact = ? WHERE uid = ?`, [
      activeness ? 1 : 0,
      agentUid,
    ]);

    res.json({
      success: true,
      msg: "Success",
    });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong", err });
    logger.log(err);
  }
});

router.post("/update_fcm_token", validateAgent, async (req, res) => {
  try {
    const { other, token } = req.body;
    const user = req.decode.userData;

    // 1️⃣ Remove token everywhere first
    await removeTokenFromAll(token);

    // 2️⃣ Parse CURRENT AGENT fcm_data safely
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

    // 3️⃣ Add token to current agent (no duplicates)
    // const newTokens = existingTokens.includes(token)
    //   ? existingTokens
    //   : [...existingTokens, token];

    const newTokens = [token];

    const newUpdated = {
      tokens: newTokens,
      other: { ...existingOther, ...other },
    };

    // 4️⃣ Save final data
    await query(`UPDATE agents SET fcm_data = ? WHERE uid = ?`, [
      JSON.stringify(newUpdated),
      req.decode.uid,
    ]);

    res.json({ success: true, fcm_data: newUpdated });
  } catch (err) {
    logger.error("❌ AGENT FCM update error:", err);
    res.status(500).json({
      success: false,
      msg: "Something went wrong",
      err: err.message,
    });
  }
});

module.exports = router;
