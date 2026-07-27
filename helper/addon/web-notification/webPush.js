const admin = require("firebase-admin");
const { query } = require("../../../database/dbpromise");

async function sendFcmPushNotification({
  fcm_projectId,
  fcm_clientEmail,
  fcm_privateKey,
  tokens,
  notification,
}) {
  try {
    // ── Init or reuse Firebase app ───────────────────────────────────────────
    const appName = `fcm_app_${fcm_projectId}`;
    let firebaseApp;

    try {
      firebaseApp = admin.app(appName);
    } catch {
      firebaseApp = admin.initializeApp(
        {
          credential: admin.credential.cert({
            projectId: fcm_projectId,
            clientEmail: fcm_clientEmail,
            privateKey: fcm_privateKey.replace(/\\n/g, "\n"),
          }),
        },
        appName,
      );
    }

    const messaging = firebaseApp.messaging();

    // ── Build message ────────────────────────────────────────────────────────
    const baseMessage = {
      notification: {
        title: notification.title,
        body: notification.body,
        ...(notification.imageUrl ? { imageUrl: notification.imageUrl } : {}),
      },
      webpush: {
        headers: {
          Urgency: "high",
          TTL: "86400",
        },
        notification: {
          title: notification.title,
          body: notification.body,
          ...(notification.imageUrl ? { image: notification.imageUrl } : {}),
          icon: "/logo192.png",
        },
        ...(notification.clickUrl
          ? { fcmOptions: { link: notification.clickUrl } }
          : {}),
      },
      android: {
        priority: "high", // 👈 optional but good to have
      },
      apns: {
        headers: {
          "apns-priority": "10", // 👈 optional but good to have
        },
      },
    };

    // ── Chunk tokens into batches of 500 ─────────────────────────────────────
    const chunkSize = 500;
    const chunks = [];
    for (let i = 0; i < tokens.length; i += chunkSize) {
      chunks.push(tokens.slice(i, i + chunkSize));
    }

    let successCount = 0;
    let failureCount = 0;
    const results = [];

    for (const chunk of chunks) {
      const response = await messaging.sendEachForMulticast({
        ...baseMessage,
        tokens: chunk,
      });

      successCount += response.successCount;
      failureCount += response.failureCount;

      response.responses.forEach((r, idx) => {
        results.push({
          token: chunk[idx],
          success: r.success,
          error: r.error?.message || null,
        });
      });
    }

    // ── Return ───────────────────────────────────────────────────────────────
    return {
      success: true,
      successCount,
      failureCount,
      totalSent: tokens.length,
      results,
    };
  } catch (err) {
    return {
      success: false,
      msg: err.message || "Failed to send FCM push notification.",
    };
  }
}

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

async function extractTokens(params) {
  try {
  } catch (err) {
    console.log(err);
  }
}

async function processWebPushMessageNotificaion({
  uid,
  message,
  user,
  sessionId,
  origin,
  chatId,
}) {
  try {
    // ── Fetch FCM credentials for this user ──────────────────────────────────
    const [fcmConfig] = await query(
      `SELECT fcm_projectId, fcm_clientEmail, fcm_privateKey FROM web_private`,
      [],
    );

    if (
      !fcmConfig?.fcm_projectId ||
      !fcmConfig?.fcm_clientEmail ||
      !fcmConfig?.fcm_privateKey
    ) {
      return;
    }

    const { fcm_projectId, fcm_clientEmail, fcm_privateKey } = fcmConfig;

    // ── Build notification content from message ──────────────────────────────
    const notification = generateNotificationFromMessage(message);

    // ── Send to user ─────────────────────────────────────────────────────────
    const [userTokenRow] = await query(
      `SELECT token FROM fcm_tokens WHERE uid = ? LIMIT 1`,
      [uid],
    );

    if (userTokenRow?.token) {
      const userResult = await sendFcmPushNotification({
        fcm_projectId,
        fcm_clientEmail,
        fcm_privateKey,
        tokens: [userTokenRow.token],
        notification,
      });

      if (!userResult.success) {
        console.log(`[WebPush] Failed to send to user ${uid}:`, userResult.msg);
      }
    }

    // ── Send to assigned agents if chat is assigned ──────────────────────────
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

        if (!agentData?.uid) continue;

        const [agentTokenRow] = await query(
          `SELECT token FROM fcm_tokens WHERE uid = ? LIMIT 1`,
          [agentData.uid],
        );

        if (!agentTokenRow?.token) continue;

        const agentResult = await sendFcmPushNotification({
          fcm_projectId,
          fcm_clientEmail,
          fcm_privateKey,
          tokens: [agentTokenRow.token],
          notification,
        });

        if (!agentResult.success) {
          console.log(
            `[WebPush] Failed to send to agent ${agentData.uid}:`,
            agentResult.msg,
          );
        }
      }
    }
  } catch (err) {
    console.log("ERROR SENDING processWebPushMessageNotificaion");
    console.log(err);
  }
}

function checkWebPush() {
  return true;
}

module.exports = {
  checkWebPush,
  sendFcmPushNotification,
  generateNotificationFromMessage,
  processWebPushMessageNotificaion,
};
