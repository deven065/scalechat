const { query } = require("../../database/dbpromise");
const {
  getConnectionsByUid,
  sendToUid,
  sendRingToUid,
  sendToSocket,
} = require("../../socket");
const { mergeArraysWithPhonebook } = require("../socket/function");
const { processMetaMessage, processMetaEchoMessage } = require("./meta");
const { processMessageQr } = require("../addon/qr/processThings");
const {
  processMessageTelegram,
} = require("../addon/telegram/processTelegramInbox");
const { processWebhook } = require("./chatbot");
const { processAutomation } = require("../../automation/automation");
const { sendFCMNotification } = require("../../functions/function");
const {
  processWebPushMessageNotificaion,
} = require("../addon/web-notification/webPush");
const { processInstaMessage } = require("../addon/insta/processInstagram");
const logger = require("../../utils/logger");

const generateNotificationFromMessage = (msg, langData = {}) => {
  if (!msg) {
    return {
      title: "New Message",
      body: "You have a new message",
      imageUrl: null,
    };
  }

  const senderIdentifier = msg.senderName || msg.senderMobile || "Unknown";
  let title = "";
  let body = "";
  let imageUrl = null;

  // Extract image URL if available
  if (msg.profileImage) {
    imageUrl = msg.profileImage;
  }

  switch (msg.type) {
    case "text":
      title = `${senderIdentifier}`;
      body = msg.msgContext?.text?.body || "New text message";
      break;

    case "image":
      title = `${senderIdentifier}`;
      const imageCaption = msg.msgContext?.image?.caption;
      body = imageCaption
        ? `📷 Photo: ${imageCaption}`
        : `📷 ${langData?.photo || "Photo"}`;
      // Use the actual image from message if available
      if (msg.msgContext?.image?.link) {
        imageUrl = msg.msgContext.image.link;
      }
      break;

    case "video":
      title = `${senderIdentifier}`;
      const videoCaption = msg.msgContext?.video?.caption;
      body = videoCaption
        ? `🎥 Video: ${videoCaption}`
        : `🎥 ${langData?.videoo || "Video"}`;
      break;

    case "audio":
      title = `${senderIdentifier}`;
      body = `🎵 ${langData?.audioMsgg || "Voice message"}`;
      break;

    case "document":
      title = `${senderIdentifier}`;
      const docCaption = msg.msgContext?.document?.caption;
      const docFilename = msg.msgContext?.document?.filename;
      body = docCaption
        ? `📄 Document: ${docCaption}`
        : docFilename
          ? `📄 Document: ${docFilename}`
          : `📄 ${langData?.document || "Document"}`;
      break;

    case "location":
      title = `${senderIdentifier}`;
      body = `📍 ${langData?.locShared || "Location shared"}`;
      const locationName = msg.msgContext?.location?.name;
      if (locationName) {
        body += `: ${locationName}`;
      }
      break;

    case "contact":
      title = `${senderIdentifier}`;
      const contactName =
        msg.msgContext?.contact?.contacts?.[0]?.name?.formatted_name ||
        "Contact";
      body = `👤 ${langData?.contactt || "Contact"}: ${contactName}`;
      break;

    case "reaction":
      title = `${senderIdentifier}`;
      const reactionEmoji = msg.reaction || msg.msgContext?.reaction?.emoji;
      body = reactionEmoji
        ? `Reacted ${reactionEmoji}`
        : `${langData?.reacted || "Reacted to your message"}`;
      break;

    case "sticker":
      title = `${senderIdentifier}`;
      body = `🎨 ${langData?.stickerSent || "Sticker"}`;
      break;

    case "status":
      title = `${senderIdentifier}`;
      body = msg.msgContext?.status?.status || "Status update";
      break;

    case "button":
      title = `${senderIdentifier}`;
      const buttonText =
        msg.msgContext?.interactive?.body?.text || msg.msgContext?.button?.text;
      body = buttonText
        ? `🔘 ${buttonText}`
        : `🔘 ${langData?.buttonMsg || "Button message"}`;
      break;

    case "list":
      title = `${senderIdentifier}`;
      const listText =
        msg.msgContext?.interactive?.header?.text ||
        msg.msgContext?.interactive?.body?.text;
      body = listText
        ? `📋 ${listText}`
        : `📋 ${langData?.listMsg || "List message"}`;
      break;

    case "poll":
      title = `${senderIdentifier}`;
      const pollQuestion = msg.msgContext?.poll?.question;
      body = pollQuestion
        ? `📊 Poll: ${pollQuestion}`
        : `📊 ${langData?.poll || "Poll"}`;
      break;

    case "template":
      title = `${senderIdentifier}`;
      const templateText = msg.msgContext?.template?.text;
      body = templateText || `📝 ${langData?.template || "Template message"}`;
      break;

    default:
      title = `${senderIdentifier}`;
      body = langData?.unkwnMsg || "New message";
      break;
  }

  // Truncate body if too long (for notification display)
  if (body.length > 120) {
    body = body.substring(0, 117) + "...";
  }

  return {
    title,
    body,
    imageUrl,
  };
};

function extractTokens(str) {
  try {
    const obj = JSON.parse(str);
    if (Array.isArray(obj.tokens) && obj.tokens.length > 0) {
      return obj.tokens;
    }
    return [];
  } catch {
    return [];
  }
}

async function processMobileNotificaion({
  uid,
  message,
  user,
  sessionId,
  origin,
  chatId,
}) {
  try {
    // sending to user
    const userTokens = extractTokens(user?.fcm_data);
    userTokens?.forEach(async (token) => {
      const noti = generateNotificationFromMessage(message);
      if (typeof sendFCMNotification === "function") {
        await sendFCMNotification({
          token,
          imageUrl: noti?.imageUrl,
          body: noti?.body,
          data: {
            chatId,
            origin,
            sessionId,
          },
          title: noti.title,
        });
      }
    });

    // Fetch chat row only if current user belongs to assigned_agent
    const [row] = await query(
      `SELECT *
        FROM beta_chats
        WHERE chat_id = ?
          AND uid = ?
          AND JSON_SEARCH(assigned_agent, 'one', ?) IS NOT NULL
        LIMIT 1`,
      [chatId, uid, uid],
    );

    if (row) {
      const extractAgents = row.assigned_agent
        ? JSON.parse(row.assigned_agent)
        : [];

      const agentIds = extractAgents.map((a) => a.id);

      for (const agentId of agentIds) {
        const [agentData] = await query(`SELECT * FROM agents WHERE id = ?`, [
          agentId,
        ]);

        const agentTokens = extractTokens(agentData?.fcm_data);

        for (const token of agentTokens || []) {
          const noti = generateNotificationFromMessage(message);

          await sendFCMNotification({
            token,
            imageUrl: noti?.imageUrl,
            body: noti.body,
            data: {
              chatId,
              origin,
              sessionId,
            },
            title: noti.title,
          });
        }
      }
    }
  } catch (err) {
    logger.log("ERROR IN processMobileNotificaion");
    logger.log(err);
  }
}

async function processMessage({
  body,
  uid,
  origin,
  getSession,
  sessionId,
  qrType,
}) {
  try {
    // getting user data
    const [userData] = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);
    if (!userData) return;

    let latestConversation = [];

    switch (origin) {
      case "meta":
        const metaMsg = await processMetaMessage({
          body,
          uid,
          origin,
          userData,
        });
        latestConversation = metaMsg;
        break;

      case "meta_echo":
        const echoMsg = await processMetaEchoMessage({ body, uid, userData });
        latestConversation = echoMsg;
        break;

      case "qr":
        const qrMsg = await processMessageQr({
          getSession,
          message: body,
          sessionId,
          type: qrType,
          uid,
          userData,
        });
        latestConversation = qrMsg;
        break;
      case "instagram":
        const instaMsg = await processInstaMessage({
          body,
          uid,
        });
        latestConversation = instaMsg;
        break;
      case "telegram":
        const telegramMsg = await processMessageTelegram({
          getSession,
          message: body,
          sessionId,
          type: qrType,
          uid,
          userData,
        });
        latestConversation = telegramMsg;
        break;
      default:
        break;
    }

    // Send the latest chat list to all sockets of the user.
    const socketConnections = getConnectionsByUid(uid, true) || [];

    socketConnections.forEach(async (socket) => {
      sendToSocket(
        socket?.socketId,
        { chatId: latestConversation?.chatId },
        "request_update_chat_list",
      );
      if (latestConversation?.newMessage) {
        sendToSocket(socket?.socketId, {}, "ring");
      }
    });

    // chatbot init
    if (latestConversation?.newMessage && uid) {
      // Skip if message is from me (for QR/Telegram)
      if (origin === "qr" && body?.key?.fromMe) {
        return;
      }

      if (origin === "meta_echo") {
        socketConnections.forEach(async (socket) => {
          sendToSocket(
            socket?.socketId,
            { chatId: latestConversation?.chatId },
            "request_update_chat_list",
          );
        });
        return; // no chatbot, no notification, no automation
      }

      if (
        origin === "telegram" &&
        latestConversation?.newMessage?.route === "OUTGOING"
      ) {
        return;
      }

      // Get user details
      const [user] = await query("SELECT * FROM user WHERE uid = ?", [uid]);
      if (!user) {
        return logger.log("User not found");
      }

      // Process the message through the flow builder
      await processWebhook(latestConversation?.newMessage, user);

      await processAutomation({
        uid,
        message: latestConversation?.newMessage,
        user,
        sessionId: latestConversation?.sessionId || sessionId,
        origin,
        chatId: latestConversation?.chatId,
      });

      const msg = latestConversation?.newMessage;
      if (msg?.route === "INCOMING") {
        await processMobileNotificaion({
          uid,
          message: latestConversation?.newMessage,
          user,
          sessionId,
          origin,
          chatId: latestConversation?.chatId,
        });

        await processWebPushMessageNotificaion({
          uid,
          message: latestConversation?.newMessage,
          user,
          sessionId,
          origin,
          chatId: latestConversation?.chatId,
        });
      }
    }
  } catch (err) {
    logger.log(err);
  }
}

module.exports = { processMessage };
