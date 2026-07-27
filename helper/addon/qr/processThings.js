const randomstring = require("randomstring");
const moment = require("moment");
const { query } = require("../../../database/dbpromise");
const mime = require("mime-types");
const { fetchProfileUrl } = require("./control");
const fs = require("fs");

// Import downloadMediaMessage directly from baileys
let downloadMediaMessage;

// Function to load baileys dynamically
async function loadBaileys() {
  if (!downloadMediaMessage) {
    const baileys = await import("baileys");
    downloadMediaMessage = baileys.downloadMediaMessage;
  }
}

function timeoutPromise(promise, ms) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([promise, timeout]);
}

function extractPhoneNumber(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(?=:|\@)/);
  return match ? match[1] : null;
}

async function updateProfileMysql({
  chatId,
  uid,
  getSession,
  remoteJid,
  sessionId,
}) {
  try {
    if (remoteJid.includes("@g.us")) return;

    const session = await timeoutPromise(getSession(sessionId || "a"), 60000);
    if (!session) return;

    const image = await fetchProfileUrl(session, remoteJid);
    if (!image) return;

    // Get existing chat data to preserve other fields
    const [chat] = await query(
      `SELECT * FROM beta_chats WHERE uid = ? AND chat_id = ?`,
      [uid, chatId]
    );

    if (chat) {
      const profile = chat.profile_image
        ? { ...JSON.parse(chat.profile_image), profileImage: image }
        : { profileImage: image };
      await query(
        `UPDATE beta_chats SET last_message = JSON_SET(COALESCE(last_message, '{}'), '$.profileImage', ?), profile = ? WHERE uid = ? AND chat_id = ?`,
        [image, JSON.stringify(profile), uid, chatId]
      );
    }
  } catch (err) {
    console.log("Error updating profile data:", err);
  }
}

async function updateChatInMysql({
  chatId,
  uid,
  senderName,
  senderMobile,
  actualMsg,
  sessionId,
  getSession,
  jid,
  user,
}) {
  try {
    const allowedMessageTypes = ["text", "image", "document", "video", "audio"];
    const isIncoming = actualMsg?.route === "INCOMING";

    // 🔥 Run profile update in background (don't wait for it)
    setImmediate(() => {
      updateProfileMysql({
        chatId,
        uid,
        getSession,
        remoteJid: jid,
        sessionId,
      });
    });

    const sessionData = await getSession(sessionId);
    const originInstanceId =
      sessionData?.authState?.creds?.me || sessionData.user;

    // Check if chat exists
    const [chat] = await query(
      `SELECT unread_count FROM beta_chats WHERE chat_id = ? AND uid = ? LIMIT 1`,
      [chatId, uid]
    );

    const last_message = JSON.stringify(actualMsg);
    const sender_name = senderName || "NA";
    const sender_mobile = senderMobile || "NA";
    const origin = "qr";
    const origin_instance_id = JSON.stringify(originInstanceId);

    let unread_count = 0;
    if (isIncoming && allowedMessageTypes.includes(actualMsg?.type)) {
      unread_count = chat?.unread_count ? chat.unread_count + 1 : 1;
    }

    if (chat) {
      await query(
        `UPDATE beta_chats 
         SET last_message = ?, 
             sender_name = ?, 
             sender_mobile = ?, 
             origin = ?, 
             origin_instance_id = ?
             ${unread_count > 0 ? ", unread_count = ?" : ""}
         WHERE chat_id = ? AND uid = ?`,
        unread_count > 0
          ? [
              last_message,
              sender_name,
              sender_mobile,
              origin,
              origin_instance_id,
              unread_count,
              chatId,
              uid,
            ]
          : [
              last_message,
              sender_name,
              sender_mobile,
              origin,
              origin_instance_id,
              chatId,
              uid,
            ]
      );
    } else {
      await query(
        `INSERT INTO beta_chats 
         (uid, chat_id, last_message, sender_name, sender_mobile, origin, origin_instance_id, unread_count, assigned_agent) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          uid,
          chatId,
          last_message,
          sender_name,
          sender_mobile,
          origin,
          origin_instance_id,
          unread_count,
        ]
      );
    }
  } catch (err) {
    console.log("Error updating chat:", err);
  }
}

function getCurrentTimestampInTimeZone(timezone) {
  if (typeof timezone === "number") {
    return timezone;
  } else if (typeof timezone === "string") {
    const currentTimeInZone = moment.tz(timezone);
    return Math.round(currentTimeInZone.valueOf() / 1000);
  }
  return Math.round(Date.now() / 1000);
}

function saveImageToFile(imageBuffer, filePath, mimetype) {
  try {
    fs.writeFileSync(filePath, imageBuffer);
    console.log(`${mimetype || "IMG"} saved successfully as ${filePath}`);
  } catch (error) {
    console.error(`Error saving image: ${error.message}`);
  }
}

async function downloadMediaPromise(m, mimetype) {
  try {
    // Ensure baileys is loaded
    await loadBaileys();

    const bufferMsg = await downloadMediaMessage(m, "buffer", {}, {});
    const randomSt = randomstring.generate(6);
    const mimeType = mime.extension(mimetype);
    const fileName = `${randomSt}_qr.${mimeType}`;
    const filePath = `${__dirname}/../../../client/public/meta-media/${fileName}`;

    saveImageToFile(bufferMsg, filePath, mimetype);

    return { success: true, fileName };
  } catch (err) {
    console.log("Error in downloadMediaPromise:", err);
    return { err, success: false };
  }
}

function getChatId({ instanceNumber, senderMobile, uid }) {
  try {
    return `${instanceNumber}_${extractPhoneNumber(senderMobile)}_${uid}`;
  } catch (error) {
    return null;
  }
}

async function saveMessageToConversation({ uid, chatId, messageData }) {
  try {
    await query(`INSERT INTO beta_conversation SET ?`, {
      type: messageData.type,
      metaChatId: messageData.metaChatId,
      msgContext: JSON.stringify(messageData.msgContext),
      reaction: messageData.reaction || "",
      timestamp: messageData.timestamp,
      senderName: messageData.senderName,
      senderMobile: messageData.senderMobile,
      star: messageData.star ? 1 : 0,
      route: messageData.route,
      context: messageData.context ? JSON.stringify(messageData.context) : null,
      origin: messageData.origin,
      uid,
      chat_id: chatId,
    });
    return true;
  } catch (err) {
    console.log("Error saving message to conversation:", err);
    return false;
  }
}

async function processBaileysMsg({ body, uid, userFromMysql, chatId }) {
  try {
    if (!body) return null;

    // Status Update Handling
    if (body.update && typeof body.update.status === "number") {
      if (!body.key?.fromMe) {
        return { newMessage: null, chatId };
      }

      const statusMapping = { 2: "sent", 3: "delivered", 4: "read" };
      const newStatusNumber = body.update.status;
      const newStatus = statusMapping[newStatusNumber] || "";

      await query(
        `UPDATE beta_conversation SET status = ? WHERE metaChatId = ? AND uid = ?`,
        [newStatus, body.key.id, uid]
      );

      return { newMessage: null, chatId };
    }

    let msgContext = null;
    let referencedMessageData = null;

    // console.log({ body: JSON.stringify(body) });

    // Determine message type
    if (body.message.conversation) {
      msgContext = {
        type: "text",
        text: {
          body: body.message.conversation,
          preview_url: true,
        },
      };
    } else if (body.message.reactionMessage) {
      const reaction = body.message.reactionMessage;

      // Find the original message that was reacted to
      const [originalMessage] = await query(
        `SELECT * FROM beta_conversation WHERE metaChatId = ? AND uid = ?`,
        [reaction.key.id, uid]
      );

      if (originalMessage) {
        // Update the reaction field in the original message
        await query(
          `UPDATE beta_conversation SET reaction = ? WHERE metaChatId = ? AND uid = ?`,
          [reaction.text, reaction.key.id, uid]
        );

        // Return null as we don't need to create a new message for reactions
        return { newMessage: null, chatId };
      }

      // If original message not found, log warning
      console.warn(
        `Original message ${reaction.key.id} not found for reaction`
      );
      return { newMessage: null, chatId };
    } else if (body.message.extendedTextMessage) {
      const extText = body.message.extendedTextMessage;
      msgContext = {
        type: "text",
        text: {
          body: extText.text,
          preview_url: true,
        },
      };
      if (extText.contextInfo?.quotedMessage) {
        referencedMessageData = extText.contextInfo.quotedMessage;
      }
    } else if (body.message.imageMessage) {
      const img = body.message.imageMessage;
      const downloadResult = await downloadMediaPromise(body, img.mimetype);
      msgContext = {
        type: "image",
        image: {
          link: `${process.env.FRONTENDURI}/meta-media/${
            downloadResult.success ? downloadResult.fileName : ""
          }`,
          caption: img.caption || "",
        },
      };
    } else if (body.message.videoMessage) {
      const vid = body.message.videoMessage;
      const downloadResult = await downloadMediaPromise(body, vid.mimetype);
      msgContext = {
        type: "video",
        video: {
          link: `${process.env.FRONTENDURI}/meta-media/${
            downloadResult.success ? downloadResult.fileName : ""
          }`,
          caption: vid.caption || "",
        },
      };
    } else if (body.message.contactMessage) {
      const contact = body.message.contactMessage;
      msgContext = {
        type: "contact",
        contact: {
          name: contact.displayName || "Unknown Contact",
          vcard: contact.vcard || "",
        },
      };
    } else if (body.message.audioMessage) {
      const aud = body.message.audioMessage;
      const downloadResult = await downloadMediaPromise(body, aud.mimetype);
      msgContext = {
        type: "audio",
        audio: {
          link: `${process.env.FRONTENDURI}/meta-media/${
            downloadResult.success ? downloadResult.fileName : ""
          }`,
        },
      };
    } else if (body.message.locationMessage) {
      msgContext = {
        type: "location",
        location: {
          latitude: body.message?.locationMessage?.degreesLatitude,
          longitude: body.message?.locationMessage?.degreesLongitude,
          name: body.message?.locationMessage?.name,
          address: body.message?.locationMessage?.address,
        },
      };
    } else if (body.message.documentWithCaptionMessage) {
      const doc =
        body.message.documentWithCaptionMessage.message.documentMessage;
      const downloadResult = await downloadMediaPromise(
        body,
        body?.message?.documentWithCaptionMessage?.message?.documentMessage?.mimetype?.replace(
          "application/x-javascript",
          "application/javascript"
        )
      );
      msgContext = {
        type: "document",
        document: {
          link: `${process.env.FRONTENDURI}/meta-media/${
            downloadResult.success ? downloadResult.fileName : ""
          }`,
          caption: doc.caption || doc.title || "",
        },
      };
      if (doc.contextInfo?.quotedMessage) {
        referencedMessageData = doc.contextInfo.quotedMessage;
      }
    } else if (body.message.documentMessage) {
      // Handle regular document messages without caption
      const doc = body.message.documentMessage;
      const downloadResult = await downloadMediaPromise(body, doc.mimetype);
      msgContext = {
        type: "document",
        document: {
          link: `${process.env.FRONTENDURI}/meta-media/${
            downloadResult.success ? downloadResult.fileName : ""
          }`,
          caption: doc.caption || doc.title || doc.fileName || "",
        },
      };
      if (doc.contextInfo?.quotedMessage) {
        referencedMessageData = doc.contextInfo.quotedMessage;
      }
    } else {
      console.warn("Unsupported message type in Baileys webhook");
      return null;
    }

    // Determine context from quoted message if available
    let contextData = "";
    if (referencedMessageData?.stanzaId) {
      const [foundMsg] = await query(
        `SELECT * FROM beta_conversation WHERE metaChatId = ? AND uid = ?`,
        [referencedMessageData.stanzaId, uid]
      );
      contextData = foundMsg || referencedMessageData;
    } else if (referencedMessageData) {
      contextData = referencedMessageData;
    }

    // Create the new message object
    const newMessage = {
      type: msgContext.type,
      metaChatId: body.key.id,
      msgContext,
      reaction: "",
      timestamp: getCurrentTimestampInTimeZone(
        userFromMysql?.timezone || body.messageTimestamp
      ),
      senderName: body.pushName || "NA",
      senderMobile: body.key.remoteJid
        ? body.key.remoteJid.split("@")[0]
        : "NA",
      status: "",
      star: false,
      route: body.key?.fromMe ? "OUTGOING" : "INCOMING",
      context: contextData,
      origin: "qr",
    };

    // Save message to MySQL
    await saveMessageToConversation({
      uid,
      chatId,
      messageData: newMessage,
    });

    return { newMessage, chatId };
  } catch (err) {
    console.error("Error processing Baileys message:", err);
    return null;
  }
}

async function getUserDetails(sessionId, userData) {
  try {
    // Only get instance data, user data is already provided
    const [instance] = await query(
      `SELECT 
        id,
        uid,
        number,
        uniqueId,
        data,
        other
      FROM instance
      WHERE uniqueId = ?
      LIMIT 1`,
      [sessionId]
    );

    if (!instance) return null;

    // Combine userData with instance
    return {
      ...userData,
      instance: {
        id: instance.id,
        uid: instance.uid,
        number: instance.number,
        uniqueId: instance.uniqueId,
        data: instance.data,
        other: instance.other,
        status: instance.status,
      },
    };
  } catch (err) {
    console.error("getUserDetails error:", err);
    return null;
  }
}

async function processMessageQr({
  type,
  message,
  sessionId,
  getSession,
  userData,
  uid,
}) {
  try {
    const userDetails = await getUserDetails(sessionId, userData);

    if (!userDetails) {
      return;
    }

    const instanceNumber = userDetails?.instance?.number;

    if (!instanceNumber || !message.key.remoteJid || !uid) {
      console.log("Details not found to update chat list");
      console.log({
        instanceNumber,
        senderMobile: message.key.remoteJid,
        uid,
      });
    }

    const chatId = getChatId({
      instanceNumber,
      senderMobile: message.key.remoteJid,
      uid,
    });

    const data = await processBaileysMsg({
      body: message,
      uid: uid,
      userFromMysql: userData,
      chatId,
    });

    // Update chat in MySQL with the latest message
    if (data?.newMessage) {
      await updateChatInMysql({
        chatId,
        uid: uid,
        senderName: data.newMessage.senderName,
        senderMobile: data.newMessage.senderMobile,
        actualMsg: data.newMessage,
        sessionId,
        getSession,
        jid: message?.remoteJid || message?.key?.remoteJid,
        userPromise: userDetails,
        user: userData,
      });
    }

    return data;
  } catch (err) {
    console.error("processMessageQr error:", err);
    return null;
  }
}

module.exports = {
  processMessageQr,
};
