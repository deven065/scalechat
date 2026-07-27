const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const {
  isValidEmail,
  getFileExtension,
  sendMetaMsg,
  mergeArrays,
  sendMetatemplet,
  updateMetaTempletInMsg,
  getUserPlayDays,
  parseJson,
  handleWAFormSubmission,
} = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { getIOInstance } = require("../socket.js");
const { checkPlan } = require("../middlewares/plan.js");
const { processMessage } = require("../helper/inbox/inbox.js");
const con = require("../database/config.js");
const { updateMessageStatus } = require("../loops/campaignBeta.js");
const logger = require("../utils/logger.js");
const fs = require("fs");
const path = require("path");
const { handleCalls } = require("../helper/addon/wacall/wacall.js");
const {
  handleBroadcastCallConnect,
  handleBroadcastCallTerminate,
  outgoingCallStates,
} = require("../helper/addon/wacall/broadcastProcessor.js");

function logToFile(label, data) {
  const filePath = path.join(__dirname, "log.txt");
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${label}] ${typeof data === "object" ? JSON.stringify(data, null, 2) : data}\n${"─".repeat(80)}\n`;
  fs.promises.appendFile(filePath, line, "utf-8").catch(() => {
    // silent fail — never crash the webhook
  });
}

// WhatsApp Webhook Verification
router.get("/embed/webhook/:uid", async (req, res) => {
  try {
    const [admin] = await query(`SELECT uid FROM admin LIMIT 1`);
    if (!admin) {
      return res.sendStatus(400);
    }

    const VERIFY_TOKEN = admin.uid;

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (!mode || !token) {
      return res.sendStatus(400);
    }

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      logger.log("✅ WHATSAPP WEBHOOK VERIFIED");
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  } catch (err) {
    logger.error(err);
    return res.sendStatus(500);
  }
});

router.post("/embed/webhook/:uid", async (req, res) => {
  try {
    const body = req.body;
    res.sendStatus(200);

    const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;

    // Handle message status updates
    if (req.body && req.body.entry) {
      for (const entry of req.body.entry) {
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value && change.value.statuses) {
              for (const status of change.value.statuses) {
                if (status.id) {
                  await updateMessageStatus(status.id, status.status);
                }
              }
            }
          }
        }
      }
    }

    // updating API logs
    if (statuses?.length > 0) {
      const { status, id } = statuses[0];
      const errorData = JSON.stringify(body);

      if (status === "failed") {
        await query(
          `UPDATE beta_api_logs SET status = ?, err = ? WHERE msg_id = ?`,
          [status, errorData, id],
        );
      } else if (id) {
        await query(`UPDATE beta_api_logs SET status = ? WHERE msg_id = ?`, [
          status,
          id,
        ]);
      }
    }

    if (statuses?.length > 0) {
      const { status, id } = statuses[0];
      const errorData = JSON.stringify(body);

      if (status === "failed") {
        await query(
          `UPDATE beta_campaign_logs SET delivery_status = ?, error_message = ? WHERE meta_msg_id = ?`,
          [status, errorData, id],
        );
      } else if (id) {
        await query(
          `UPDATE beta_campaign_logs SET delivery_status = ? WHERE meta_msg_id = ?`,
          [status, id],
        );
      }
    }

    const changes = body?.entry[0]?.changes[0];
    const phoneNumId = changes?.value?.metadata?.phone_number_id;
    const wabaId = body?.entry[0]?.id;

    logToFile("EXTRACTED_IDS", { phoneNumId, wabaId });

    let userUID = null;

    if (phoneNumId) {
      logToFile("QUERYING_META_API", { wabaId, phoneNumId });

      const getMyMetaApi = await query(
        `SELECT * FROM meta_api WHERE business_phone_number_id = ?`,
        [phoneNumId],
      );

      logToFile("META_API_QUERY_RESULT", getMyMetaApi);

      if (!getMyMetaApi || getMyMetaApi.length < 1) {
        logToFile("BLOCKED", "No meta_api record found for this phoneNumId");
        return;
      }

      const matchedApi = getMyMetaApi[0];
      userUID = matchedApi.uid;

      logToFile("USER_UID_RESOLVED", { userUID });

      const getDays = await getUserPlayDays(userUID);
      logToFile("USER_PLAY_DAYS", { userUID, getDays });

      if (getDays < 1) {
        logToFile("BLOCKED", "User plan expired");
        return;
      }
    } else {
      logToFile(
        "BLOCKED",
        "phoneNumId is null/undefined — skipping user lookup",
      );
    }

    logToFile("USER_UID_FINAL", { userUID });

    if (!userUID) {
      logToFile("BLOCKED", "userUID is null — returning");
      return;
    }

    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];

    if (!change) {
      logToFile("BLOCKED", "No change data found");
      return;
    }

    logToFile("CHANGE_FIELD", { field: change.field });

    switch (change.field) {
      case "messages":
        logToFile("PROCESSING", "Calling processMessage");
        await processMessage({
          body,
          uid: userUID,
          origin: "meta",
        });
        logToFile("PROCESSING", "processMessage done");

        // ✅ Handle WhatsApp Forms submission — added to match normal webhook
        await handleWAFormSubmission(change, userUID);
        logToFile("PROCESSING", "handleWAFormSubmission done");

        const messages = change.value?.messages || [];
        for (const message of messages) {
          if (
            message.type === "interactive" &&
            message.interactive?.type === "call_permission_reply"
          ) {
            const reply = message.interactive.call_permission_reply;
            const fromNumber = message.from;

            logToFile("CALL_PERMISSION_REPLY", { fromNumber, reply });

            if (reply.response === "accept") {
              await updateBroadcastContactPermission(
                fromNumber,
                "granted",
                reply,
              );
            } else if (reply.response === "reject") {
              await updateBroadcastContactPermission(
                fromNumber,
                "denied",
                reply,
              );
            }
          }
        }
        break;

      case "smb_message_echoes":
        await processMessage({ body, uid: userUID, origin: "meta_echo" });
        break;

      case "calls":
        const callEvents = change.value.calls || [];
        const callStatuses = change.value.statuses || [];

        for (const callEvent of callEvents) {
          const callId = callEvent.id;
          const callbackData = callEvent.biz_opaque_callback_data;

          logToFile("CALL_EVENT", {
            callId,
            event: callEvent.event,
            callbackData,
          });

          let isBroadcastCall = false;
          let parsedCallbackData = null;

          if (callbackData) {
            try {
              parsedCallbackData = JSON.parse(callbackData);
              isBroadcastCall = !!parsedCallbackData.campaign_id;
              logToFile("CALL_CALLBACK_PARSED", {
                callId,
                parsedCallbackData,
                isBroadcastCall,
              });
            } catch (e) {
              logToFile("CALL_CALLBACK_PARSE_ERROR", {
                callId,
                error: e.message,
              });
            }
          }

          if (isBroadcastCall) {
            logToFile("CALL_TYPE", { callId, type: "broadcast" });

            if (callEvent.event === "connect" && callEvent.session) {
              await handleBroadcastCallConnect(
                callId,
                callEvent.session,
                callbackData,
              );
            }

            if (callEvent.event === "terminate") {
              await handleBroadcastCallTerminate(
                callId,
                callEvent.status,
                callEvent.duration,
                callbackData,
              );
            }
          } else {
            logToFile("CALL_TYPE", { callId, type: "incoming" });
            await handleCalls(change, userUID, body);
          }
        }

        for (const status of callStatuses) {
          const callId = status.id;
          const isBroadcastCall = outgoingCallStates.has(callId);

          if (isBroadcastCall) {
            const callState = outgoingCallStates.get(callId);
            if (callState) {
              const { campaignId, contact } = callState;
              logToFile("CALL_STATUS_UPDATE", {
                callId,
                status: status.status,
              });

              if (status.status === "REJECTED") {
                await updateContactInBroadcast(campaignId, contact.mobile, {
                  call_status: "rejected",
                });
              }
            }
          }
        }
        break;

      default:
        logToFile("UNKNOWN_FIELD", { field: change.field });
        break;
    }
  } catch (err) {
    logToFile("FATAL_ERROR", { message: err.message, stack: err.stack });
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

router.post("/webhook/:uid", async (req, res) => {
  try {
    const body = req.body;
    const userUID = req.params.uid;

    // ✅ ACK immediately
    res.sendStatus(200);

    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];

    if (!change) {
      logger.log("⚠️ No change data");
      return;
    }

    switch (change.field) {
      case "messages":
        await handleMessages(change, userUID, body);

        await handleWAFormSubmission(change, userUID);

        // Handle call permission replies for broadcasts
        const messages = change.value?.messages || [];
        for (const message of messages) {
          if (
            message.type === "interactive" &&
            message.interactive?.type === "call_permission_reply"
          ) {
            const reply = message.interactive.call_permission_reply;
            const fromNumber = message.from;

            if (reply.response === "accept") {
              await updateBroadcastContactPermission(
                fromNumber,
                "granted",
                reply,
              );
            } else if (reply.response === "reject") {
              await updateBroadcastContactPermission(
                fromNumber,
                "denied",
                reply,
              );
            }
          }
        }
        break;

      case "calls":
        const callEvents = change.value.calls || [];
        const statuses = change.value.statuses || [];

        for (const callEvent of callEvents) {
          const callId = callEvent.id;

          const callbackData = callEvent.biz_opaque_callback_data;

          logger.log(`🔍 [${callId}] Call event:`, callEvent.event);
          logger.log(`🔍 [${callId}] Callback data:`, callbackData);

          let isBroadcastCall = false;
          let parsedCallbackData = null;

          if (callbackData) {
            try {
              parsedCallbackData = JSON.parse(callbackData);
              isBroadcastCall = !!parsedCallbackData.campaign_id;
              logger.log(`🔍 [${callId}] Parsed callback:`, parsedCallbackData);
              logger.log(`🔍 [${callId}] Is broadcast call:`, isBroadcastCall);
            } catch (e) {
              logger.error(`[${callId}] Failed to parse callback data:`, e);
            }
          }

          if (isBroadcastCall) {
            logger.log(`📞 [${callId}] Handling as broadcast call`);

            if (callEvent.event === "connect" && callEvent.session) {
              logger.log(`📞 [${callId}] Broadcast call connect event`);
              await handleBroadcastCallConnect(
                callId,
                callEvent.session,
                callbackData,
              );
            }

            if (callEvent.event === "terminate") {
              logger.log(`📞 [${callId}] Broadcast call terminate event`);
              await handleBroadcastCallTerminate(
                callId,
                callEvent.status,
                callEvent.duration,
                callbackData,
              );
            }
          } else {
            logger.log(`📞 [${callId}] Handling as incoming call`);
            await handleCalls(change, userUID, body);
          }
        }

        for (const status of statuses) {
          const callId = status.id;
          const isBroadcastCall = outgoingCallStates.has(callId);

          if (isBroadcastCall) {
            const callState = outgoingCallStates.get(callId);
            if (callState) {
              const { campaignId, contact } = callState;

              logger.log(`📞 [${callId}] Status update:`, status.status);

              if (status.status === "REJECTED") {
                await updateContactInBroadcast(campaignId, contact.mobile, {
                  call_status: "rejected",
                });
              }
            }
          }
        }
        break;

      default:
        logger.log(`⚠️ Unknown field: ${change.field}`);
        break;
    }
  } catch (err) {
    logger.error("Webhook error:", err);
  }
});

// Helper function to update broadcast contact permission
async function updateBroadcastContactPermission(mobile, status, reply) {
  try {
    logger.log(`🔄 Updating permission for ${mobile} to ${status}...`);

    const broadcasts = await query(
      `SELECT * FROM wa_call_broadcasts WHERE status IN ('requesting_permissions', 'ready', 'running', 'draft')`,
    );

    let updated = false;

    for (const broadcast of broadcasts) {
      const contacts = JSON.parse(broadcast.contacts || "[]");
      const contactIndex = contacts.findIndex((c) => c.mobile === mobile);

      if (contactIndex !== -1) {
        if (
          ["pending", "requested"].includes(
            contacts[contactIndex].permission_status,
          )
        ) {
          contacts[contactIndex].permission_status = status;
          contacts[contactIndex].permission_granted_at =
            new Date().toISOString();

          if (status === "granted") {
            contacts[contactIndex].permission_type = reply.is_permanent
              ? "permanent"
              : "temporary";
            contacts[contactIndex].permission_expires_at =
              reply.expiration_timestamp
                ? new Date(reply.expiration_timestamp * 1000).toISOString()
                : null;
          }

          let statsUpdate = {};
          if (status === "granted") {
            statsUpdate.permission_granted =
              (broadcast.permission_granted || 0) + 1;
          } else if (status === "denied") {
            statsUpdate.permission_denied =
              (broadcast.permission_denied || 0) + 1;
          }

          let updateQuery = `UPDATE wa_call_broadcasts SET contacts = ?`;
          let updateParams = [JSON.stringify(contacts)];

          Object.keys(statsUpdate).forEach((key) => {
            updateQuery += `, ${key} = ?`;
            updateParams.push(statsUpdate[key]);
          });

          updateQuery += ` WHERE campaign_id = ?`;
          updateParams.push(broadcast.campaign_id);

          await query(updateQuery, updateParams);

          logger.log(
            `✅ Updated permission for ${mobile} in campaign ${broadcast.campaign_id}`,
          );

          updated = true;
        }
      }
    }

    if (!updated) {
      logger.log(`⚠️ No matching campaign found for ${mobile}`);
    }
  } catch (err) {
    logger.error("Error updating broadcast contact permission:", err);
  }
}

async function handleMessages(change, uid, body) {
  const value = change.value;

  // ✅ Check plan ONLY for messages
  const getDays = await getUserPlayDays(uid);
  if (getDays < 1) {
    logger.log("User plan expired");
    return;
  }

  // Handle message status updates
  const statuses = value?.statuses;

  if (statuses && statuses.length > 0) {
    for (const status of statuses) {
      if (status.id) {
        await updateMessageStatus(status.id, status.status);
      }
    }

    // Update API logs
    const { status, id } = statuses[0];
    const errorData = JSON.stringify(body);

    if (status === "failed") {
      await query(
        `UPDATE beta_api_logs SET status = ?, err = ? WHERE msg_id = ?`,
        [status, errorData, id],
      );
    } else if (id) {
      await query(`UPDATE beta_api_logs SET status = ? WHERE msg_id = ?`, [
        status,
        id,
      ]);
    }

    // Update campaign logs
    if (status === "failed") {
      await query(
        `UPDATE beta_campaign_logs SET delivery_status = ?, error_message = ? WHERE meta_msg_id = ?`,
        [status, errorData, id],
      );
    } else if (id) {
      await query(
        `UPDATE beta_campaign_logs SET delivery_status = ? WHERE meta_msg_id = ?`,
        [status, id],
      );
    }
  }

  // Verify phone number
  if (value?.metadata?.phone_number_id) {
    const getMyMetaApi = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      uid,
    ]);

    if (getMyMetaApi?.length > 0) {
      const checkNumber = value.metadata.phone_number_id;
      const myNumberId = getMyMetaApi[0]?.business_phone_number_id;

      if (checkNumber !== myNumberId) {
        logger.log("⚠️ Phone number mismatch");
        return;
      }
    }
  }

  // Save message
  await processMessage({
    body,
    uid,
    origin: "meta",
  });
}

// adding webhook
router.get("/webhook/:uid", async (req, res) => {
  try {
    const { uid } = req.params;

    const queryParan = req.query;
    const body = req.body;

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

    let verify_token = "";

    if (getUser.length < 1) {
      verify_token = "NULL";
      res.json({
        success: false,
        msg: "Token not verified",
        webhook: uid,
        token: "NOT FOUND",
      });
    } else {
      verify_token = uid;

      let mode = req.query["hub.mode"];
      let token = req.query["hub.verify_token"];
      let challenge = req.query["hub.challenge"];

      if (mode && token) {
        if (mode === "subscribe" && token === verify_token) {
          logger.log("WEBHOOK_VERIFIED");
          res.status(200).send(challenge);
        } else {
          res.sendStatus(403);
        }
      } else {
        res.json({
          success: false,
          msg: "Token not verified",
          webhook: uid,
          token: "FOUND",
        });
      }
    }
  } catch (err) {
    logger.log(err);
    res.json({ err, success: false, msg: "Something went wrong" });
  }
});

// sending templets
router.post("/send_templet", validateUser, checkPlan, async (req, res) => {
  try {
    const { content, toName, toNumber, chatId, msgType } = req.body;

    if (!content || !toName || !toName || !msgType) {
      return res.json({ success: false, msg: "Invalid request" });
    }

    const msgObj = content;

    const savObj = {
      type: msgType,
      metaChatId: "",
      msgContext: content,
      reaction: "",
      timestamp: "",
      senderName: toName,
      senderMobile: toNumber,
      status: "sent",
      star: false,
      route: "OUTGOING",
    };

    const resp = await sendMetaMsg(
      req.decode.uid,
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

function groupChatsByNumberArrayFormat(chats) {
  const groupedChats = [];

  chats.forEach((chat) => {
    const number = chat.number;

    const existingGroup = groupedChats.find(
      (group) => group.instance === number,
    );

    if (existingGroup) {
      existingGroup.array.push(chat);
    } else {
      groupedChats.push({
        instance: number,
        array: [chat],
      });
    }
  });

  return groupedChats;
}

module.exports = router;
