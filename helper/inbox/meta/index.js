const { query } = require("../../../database/dbpromise");
const axios = require("axios");
const randomstring = require("randomstring");
const mime = require("mime-types");
const fs = require("fs");
const path = require("path");
const logger = require("../../../utils/logger");

// Utility Functions
function getCurrentTimestamp() {
  return Math.round(Date.now() / 1000);
}

function extractPhoneNumber(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)/);
  return match ? match[1] : null;
}

function formatMessage(type, content) {
  return { type, [type]: content };
}

// Media Handling
async function downloadAndSaveMedia(token, mediaId, uid) {
  try {
    const { data: mediaData } = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}/`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!mediaData.url) throw new Error("Media URL not found");

    const response = await axios.get(mediaData.url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "arraybuffer",
    });

    const ext = mime.extension(response.headers["content-type"]) || "bin";
    const fileName = `${randomstring.generate(10)}.${ext}`;
    const filePath = path.resolve(
      __dirname,
      "../../../client/public/meta-media",
      fileName,
    );

    // Ensure directory exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    await fs.promises.writeFile(filePath, response.data);
    return fileName;
  } catch (err) {
    logger.error("Media download error:", err.message);
    return null;
  }
}

// Database Operations
async function updateChatInMysql({
  chatId,
  uid,
  senderName,
  senderMobile,
  actualMsg,
  body,
}) {
  try {
    const allowedMessageTypes = ["text", "image", "document", "video", "audio"];
    const isIncoming = actualMsg?.route === "INCOMING";

    // Check if chat exists
    const [chat] = await query(
      `SELECT * FROM beta_chats 
       WHERE uid = ? AND chat_id = ?`,
      [uid, chatId],
    );

    const updateFields = {
      last_message: JSON.stringify(actualMsg),
      sender_name: senderName || "NA",
      sender_mobile: senderMobile || "NA",
      origin: "meta",
    };

    if (isIncoming && allowedMessageTypes.includes(actualMsg?.type)) {
      updateFields.unread_count = chat?.unread_count
        ? chat.unread_count + 1
        : 1;
    }

    if (chat) {
      await query(`UPDATE beta_chats SET ? WHERE chat_id = ? AND uid = ?`, [
        updateFields,
        chatId,
        uid,
      ]);
    } else {
      await query(`INSERT INTO beta_chats SET ?`, {
        ...updateFields,
        uid,
        origin_instance_id: JSON.stringify({
          id:
            body.entry?.[0]?.changes?.[0]?.value?.metadata
              ?.display_phone_number || chatId,
        }),
        chat_id: chatId,
        unread_count: isIncoming ? 1 : 0,
        assigned_agent: null,
        createdAt: new Date(),
      });
    }

    return true;
  } catch (err) {
    logger.error("Chat update error:", err);
    return false;
  }
}

async function saveMessageToConversation({ uid, chatId, messageData }) {
  try {
    await query(`INSERT INTO beta_conversation SET ?`, {
      type: messageData.type,
      metaChatId: messageData.metaChatId,
      msgContext: JSON.stringify(messageData.msgContext),
      reaction: messageData.reaction || "",
      timestamp: messageData.timestamp || getCurrentTimestamp(),
      senderName: messageData.senderName,
      senderMobile: messageData.senderMobile,
      star: messageData.star ? 1 : 0,
      route: messageData.route,
      context: messageData.context ? JSON.stringify(messageData.context) : null,
      origin: messageData.origin,
      uid,
      chat_id: chatId,
      status: messageData.status || "",
      createdAt: new Date(),
    });
    return true;
  } catch (err) {
    logger.error("Message save error:", err);
    return false;
  }
}

// Message Processing
async function processMediaMessage(type, message, uid) {
  try {
    const [{ access_token: token }] = await query(
      `SELECT access_token FROM meta_api WHERE uid = ?`,
      [uid],
    );
    if (!token) return null;

    const mediaId = message[type]?.id;
    if (!mediaId) return null;

    const fileName = await downloadAndSaveMedia(token, mediaId, uid);
    if (!fileName) return null;

    const content = {
      link: `${process.env.FRONTENDURI}/meta-media/${fileName}`,
    };
    if (message[type]?.caption) content.caption = message[type].caption;

    return formatMessage(type, content);
  } catch (err) {
    logger.error("Media processing error:", err);
    return null;
  }
}

async function processMetaMsg({ body, uid, origin }) {
  try {
    if (!body?.entry?.[0]?.changes?.[0]?.value) return null;
    const isEcho = origin === "meta_echo";

    const value = body.entry[0].changes[0].value;
    const messages = value.messages || [];
    const statuses = value.statuses || [];
    if (!messages.length && !statuses.length) return null;

    const message = messages[0] || null;
    let msgContext = null;
    let statusType = "";
    let newMessage = null;
    let contextData = null;

    // ✅ Handle ad referral messages - log for debugging
    if (message?.referral) {
      logger.log("📢 Message from Ad:", {
        source: message.referral.source_type,
        headline: message.referral.headline,
        from: message.from,
      });
    }

    // Enhanced context processing
    if (message?.context?.id) {
      try {
        const [foundMsg] = await query(
          `SELECT 
            metaChatId, 
            msgContext, 
            timestamp, 
            senderMobile, 
            senderName,
            type
           FROM beta_conversation 
           WHERE metaChatId = ? AND uid = ?`,
          [message.context.id, uid],
        );

        if (foundMsg) {
          const parsedContext = foundMsg.msgContext
            ? JSON.parse(foundMsg.msgContext)
            : { type: "text", text: { body: "Referenced message" } };

          contextData = {
            id: foundMsg.metaChatId,
            msgContext: parsedContext,
            timestamp: foundMsg.timestamp,
            senderMobile: foundMsg.senderMobile,
            senderName: foundMsg.senderName,
            type: foundMsg.type,
            conversation:
              parsedContext.text?.body ||
              parsedContext.image?.caption ||
              parsedContext.interactive?.body?.text ||
              "Referenced message",
          };
        } else {
          contextData = {
            id: message.context.id,
            from: message.context.from,
            conversation: "Original message not found",
          };
        }
      } catch (err) {
        logger.error("Error processing context:", err);
        contextData = message.context
          ? {
              id: message.context.id,
              from: message.context.from,
              conversation: "Referenced message",
            }
          : null;
      }
    }

    // Status processing
    if (statuses.length) {
      const status = statuses[0];
      statusType =
        status.status === "sent"
          ? "sent"
          : status.status === "delivered"
            ? "delivered"
            : status.status === "read"
              ? "read"
              : status.status === "failed"
                ? "failed"
                : "";

      if (statusType) {
        if (statusType === "failed") {
          await query(
            `UPDATE beta_conversation SET status = ?, err = ? 
           WHERE metaChatId = ? AND uid = ?`,
            [statusType, JSON.stringify(body), status.id, uid],
          );
        } else {
          await query(
            `UPDATE beta_conversation SET status = ? 
           WHERE metaChatId = ? AND uid = ?`,
            [statusType, status.id, uid],
          );
        }
      }
    }

    // Message processing
    // Message processing
    if (message) {
      const msgType = message.type;
      const interactive = message.interactive;
      const button = message?.button?.text;

      // ✅ Process message content (works for both regular and ad messages)
      switch (msgType) {
        case "text":
          msgContext = formatMessage("text", {
            body: message.text.body,
            preview_url: true,
          });
          break;
        case "image":
        case "video":
        case "document":
        case "audio":
          msgContext = await processMediaMessage(msgType, message, uid);
          break;
        case "interactive":
          if (interactive?.button_reply) {
            msgContext = formatMessage("text", {
              body: interactive.button_reply.title,
              preview_url: false,
            });
          } else if (interactive?.list_reply) {
            msgContext = formatMessage("text", {
              body: interactive.list_reply.title,
              preview_url: false,
            });
          }
          break;
        case "location":
          msgContext = formatMessage("location", {
            latitude: message.location.latitude,
            longitude: message.location.longitude,
            name: message.location.name || "",
            address: message.location.address || "",
          });
          break;
        case "referral":
          const referralText =
            message.referral?.body ||
            message.referral?.headline ||
            message.text?.body ||
            "Message from ad";
          msgContext = formatMessage("text", {
            body: referralText,
            preview_url: false,
          });
          break;
        default:
          if (button) {
            msgContext = formatMessage("text", {
              body: button,
              preview_url: false,
            });
          }
      }

      // ✅ Fallback — if msgContext is still null but message has text somewhere, capture it
      // This catches edge cases where ad messages have unusual type but still carry text
      if (!msgContext && message) {
        const fallbackBody =
          message.text?.body ||
          message.button?.text ||
          message.referral?.body ||
          message.referral?.headline ||
          null;

        if (fallbackBody) {
          logger.log(
            `📢 Fallback text extraction for type "${msgType}":`,
            fallbackBody,
          );
          msgContext = formatMessage("text", {
            body: fallbackBody,
            preview_url: false,
          });
        }
      }

      if (msgContext) {
        // ✅ Extract contact info - works for both regular and ad messages
        const contactInfo = value?.contacts?.[0] || {};
        const senderName = contactInfo?.profile?.name || "NA";
        const senderMobile = contactInfo?.wa_id || message.from || "NA";

        newMessage = {
          type: msgContext.type,
          metaChatId: message.id,
          msgContext,
          reaction: "",
          timestamp: message.timestamp || getCurrentTimestamp(),
          senderName,
          senderMobile,
          status: isEcho ? "sent" : statusType,
          star: false,
          route: isEcho ? "OUTGOING" : "INCOMING",
          context: contextData,
          origin: "meta",
        };

        // ✅ Generate chatId from sender's number
        const chatId = `meta_${
          extractPhoneNumber(senderMobile) || randomstring.generate(10)
        }`;

        await saveMessageToConversation({
          uid,
          chatId,
          messageData: newMessage,
        });

        await updateChatInMysql({
          chatId,
          uid,
          senderName: newMessage.senderName,
          senderMobile: newMessage.senderMobile,
          actualMsg: newMessage,
          body,
        });

        return {
          newMessage,
          chatId,
        };
      }
    }

    // ✅ Return chatId even if no new message (for status updates)
    const fallbackChatId = `meta_${
      extractPhoneNumber(value?.contacts?.[0]?.wa_id) ||
      randomstring.generate(10)
    }`;

    return {
      newMessage,
      chatId: fallbackChatId,
    };
  } catch (err) {
    logger.error("Message processing error:", err);
    return null;
  }
}

async function processMetaMessage({ body, uid }) {
  try {
    const data = await processMetaMsg({ body, uid });
    return data;
  } catch (err) {
    logger.error("Meta message processing failed:", err);
    return null;
  }
}

async function processMetaEchoMessage({ body, uid, userData }) {
  try {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return null;

    const echoes = value.message_echoes || [];
    if (!echoes.length) return null;

    const echo = echoes[0];

    // From the payload:
    // echo.from  = your business number (18082149436)
    // echo.to    = customer number (918430088300)
    // echo.text  = { body: "Hello u get it?" }
    // echo.type  = "text"

    const toNumber = echo.to; // customer's number
    const fromNumber = echo.from; // your business number
    const msgType = echo.type;

    let msgContext = null;

    switch (msgType) {
      case "text":
        msgContext = {
          type: "text",
          text: {
            body: echo.text?.body || "",
            preview_url: false,
          },
        };
        break;

      case "image":
        msgContext = {
          type: "image",
          image: {
            link: echo.image?.link || "",
            caption: echo.image?.caption || "",
          },
        };
        break;

      case "video":
        msgContext = {
          type: "video",
          video: {
            link: echo.video?.link || "",
            caption: echo.video?.caption || "",
          },
        };
        break;

      case "document":
        msgContext = {
          type: "document",
          document: {
            link: echo.document?.link || "",
            caption: echo.document?.caption || "",
            filename: echo.document?.filename || "",
          },
        };
        break;

      case "audio":
        msgContext = {
          type: "audio",
          audio: {
            link: echo.audio?.link || "",
          },
        };
        break;

      default:
        // fallback for unknown types
        msgContext = {
          type: "text",
          text: { body: `[${msgType} message]`, preview_url: false },
        };
        break;
    }

    if (!msgContext) return null;

    // ✅ chatId is based on the CUSTOMER's number (echo.to)
    const chatId = `meta_${extractPhoneNumber(toNumber) || randomstring.generate(10)}`;

    // ✅ Get customer name from contacts array if available
    const contactInfo = value?.contacts?.[0] || {};
    const senderName = contactInfo?.profile?.name || toNumber;
    const senderMobile = toNumber;

    const newMessage = {
      type: msgContext.type,
      metaChatId: echo.id,
      msgContext,
      reaction: "",
      timestamp: echo.timestamp || getCurrentTimestamp(),
      senderName,
      senderMobile,
      status: "sent",
      star: false,
      route: "OUTGOING", // ✅ business sent this from their phone
      context: null,
      origin: "meta",
    };

    await saveMessageToConversation({ uid, chatId, messageData: newMessage });

    await updateChatInMysql({
      chatId,
      uid,
      senderName,
      senderMobile,
      actualMsg: newMessage,
      body,
    });

    return { newMessage, chatId };
  } catch (err) {
    logger.error("Echo message processing error:", err);
    return null;
  }
}

module.exports = { processMetaMessage, processMetaEchoMessage };
