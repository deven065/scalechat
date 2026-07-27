const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const { query } = require("../database/dbpromise");
const { default: axios } = require("axios");
const randomstring = require("randomstring");
const { getIOInstance } = () => {};
const fetch = require("node-fetch");
const mime = require("mime-types");
const nodemailer = require("nodemailer");
const unzipper = require("unzipper");
const { URLSearchParams } = require("url");
const mysql = require("mysql2/promise");
const { MongoClient } = require("mongodb");
const admin = require("firebase-admin");
const sharp = require("sharp");
const net = require("net");
const dns = require("dns").promises;
const logger = require("../utils/logger");

// Block private/internal IP ranges
function isPrivateOrReservedIP(ip) {
  const privateRanges = [
    /^127\./, // Loopback
    /^10\./, // Private Class A
    /^172\.(1[6-9]|2\d|3[01])\./, // Private Class B
    /^192\.168\./, // Private Class C
    /^169\.254\./, // Link-local (AWS metadata)
    /^::1$/, // IPv6 loopback
    /^fc00:/, // IPv6 private
    /^fe80:/, // IPv6 link-local
    /^0\./, // Reserved
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
  ];
  return privateRanges.some((range) => range.test(ip));
}

async function resolveAndValidateHost(host) {
  // Block if already a private IP
  if (net.isIP(host)) {
    if (isPrivateOrReservedIP(host)) {
      throw new Error(`Connection to private/internal IP is not allowed`);
    }
    return host;
  }

  // Block localhost by name
  const blockedHostnames = ["localhost", "metadata.google.internal"];
  if (blockedHostnames.includes(host.toLowerCase())) {
    throw new Error(`Connection to reserved hostname is not allowed`);
  }

  // Resolve hostname and check the resolved IP
  try {
    const { address } = await dns.lookup(host);
    if (isPrivateOrReservedIP(address)) {
      throw new Error(
        `Hostname resolves to a private/internal IP which is not allowed`,
      );
    }
    return address;
  } catch (err) {
    throw new Error(`Could not resolve host: ${host}`);
  }
}

async function executeMySQLQuery(config) {
  let connection;
  try {
    // ✅ SECURITY: Validate host before connecting
    const host = config?.connection?.host;
    const port = parseInt(config?.connection?.port) || 3306;

    if (!host) {
      return {
        success: false,
        error: "No host provided",
        moveToNextNode: false,
      };
    }

    // Block non-standard ports that aren't MySQL
    const allowedPorts = [3306, 3307, 3308, 3309];
    if (!allowedPorts.includes(port)) {
      return {
        success: false,
        error: `Port ${port} is not allowed. Only MySQL ports (3306-3309) are permitted.`,
        moveToNextNode: false,
      };
    }

    // Validate host resolves to a public IP
    await resolveAndValidateHost(host);

    connection = await mysql.createConnection({
      host: host,
      port: port,
      user: config.connection.username,
      password: config.connection.password,
      database: config.connection.database,
      ssl: config.connection.ssl ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 8000, // ✅ Prevent slow-connection attacks
    });

    const [rows] = await connection.query(config.query, config.variables);

    return {
      success: true,
      data: rows,
      moveToNextNode: config.moveToNextNode,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      sqlState: error.code,
      moveToNextNode: false,
    };
  } finally {
    if (connection) await connection.end();
  }
}

async function makeRequestBeta(config, variables = {}) {
  // Helper function to get nested value from object using dot notation
  const getNestedValue = (obj, path) => {
    let current = obj;
    const parts = path.split(".");
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = current[part];
    }
    return current;
  };

  // Helper function to substitute variables in strings, supporting nested paths
  const substituteVariables = (str) => {
    if (typeof str !== "string") return str;
    return str.replace(/\{\{\{(.+?)\}\}\}/g, (match, varName) => {
      const value = getNestedValue(variables, varName);
      return value !== undefined ? value : match;
    });
  };

  // Validate configuration
  if (!config)
    return { success: false, data: {}, msg: "Configuration is required" };
  if (!config.method)
    return { success: false, data: {}, msg: "HTTP method is required" };
  if (!config.url) return { success: false, data: {}, msg: "URL is required" };

  // Substitute variables in URL
  const url = substituteVariables(config.url);

  // Prepare headers with variable substitution
  const headers = {};
  (config.headers || []).forEach((header) => {
    if (header.key && header.value) {
      headers[substituteVariables(header.key)] = substituteVariables(
        header.value,
      );
    }
  });

  // Prepare body based on content type
  let body;
  const contentType = config.contentType || "application/json";

  switch (contentType) {
    case "application/json":
      if (config.bodyInputMode === "visual" && config.bodyData?.json) {
        // Build JSON from visual editor data
        const jsonObj = {};
        config.bodyData.json.forEach((item) => {
          if (item.enabled !== false && item.key) {
            try {
              jsonObj[substituteVariables(item.key)] = JSON.parse(
                substituteVariables(item.value),
              );
            } catch {
              jsonObj[substituteVariables(item.key)] = substituteVariables(
                item.value,
              );
            }
          }
        });
        body = JSON.stringify(jsonObj);
      } else {
        // Use raw JSON body with variable substitution
        body = substituteVariables(config.bodyData?.raw || "{}");
        // Validate JSON if in raw mode
        if (config.bodyInputMode !== "visual") {
          try {
            JSON.parse(body);
          } catch (error) {
            throw new Error(`Invalid JSON: ${error.message}`);
          }
        }
      }
      break;

    case "application/x-www-form-urlencoded":
      if (config.bodyInputMode === "visual" && config.bodyData?.urlEncoded) {
        const params = new URLSearchParams();
        config.bodyData.urlEncoded.forEach((item) => {
          if (item.enabled !== false && item.key) {
            params.append(
              substituteVariables(item.key),
              substituteVariables(item.value),
            );
          }
        });
        body = params.toString();
      } else {
        body = substituteVariables(config.bodyData?.raw || "");
      }
      break;

    default:
      // For text/plain, application/xml, etc.
      body = substituteVariables(config.bodyData?.raw || "");
  }

  // Set up abort controller for timeout (50 seconds)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);

  try {
    const response = await fetch(url, {
      method: config.method,
      headers,
      body: ["GET", "HEAD"].includes(config.method.toUpperCase())
        ? undefined
        : body,
      signal: controller.signal,
      redirect: "follow",
      timeout: 50000,
    });

    clearTimeout(timeout);

    // Process response headers
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Process response body based on content type
    let responseBody;
    const responseContentType = response.headers.get("content-type") || "";

    if (responseContentType.includes("application/json")) {
      responseBody = await response.json();
    } else if (
      responseContentType.includes("text/") ||
      responseContentType.includes("application/xml")
    ) {
      responseBody = await response.text();
    } else {
      responseBody = await response.buffer();
    }

    return {
      success: true,
      data: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        ok: response.ok,
        redirected: response.redirected,
        url: response.url,
      },
    };
  } catch (error) {
    clearTimeout(timeout);
    logger.log(error);
    return { success: false, msg: "Request timed out after 50 seconds" };
  }
}

// Function to split array into chunks
function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

async function checkExistingChat(uid, chatId) {
  try {
    const [existing] = await query(
      `SELECT 1 FROM beta_chats WHERE uid = ? AND chat_id = ? LIMIT 1`,
      [uid, chatId],
    );
    return !!existing;
  } catch (err) {
    logger.error("Error checking existing chat:", err);
    return false; // Assume not exists if there's an error
  }
}

async function processBatch(batch, batchNumber) {
  logger.log(`Processing batch ${batchNumber} with ${batch.length} items`);

  const insertPromises = batch.map(async (chat) => {
    try {
      // Parse the last_message JSON
      const lastMessage = JSON.parse(chat.last_message || "{}");

      // Determine origin_instance_id
      let originInstanceId = "{}";
      if (chat.other) {
        try {
          const other = JSON.parse(chat.other);
          if (other && typeof other === "object") {
            originInstanceId = JSON.stringify(other);
          }
        } catch (e) {
          logger.error("Error parsing other field:", e);
        }
      }

      // Generate chat_id based on rules
      let chatId;
      try {
        const other = chat.other ? JSON.parse(chat.other) : {};
        let whatsappNumber = "";

        // Extract whatsapp number from other.id if it exists
        if (
          other.id &&
          typeof other.id === "string" &&
          other.id.includes("@s.whatsapp.net")
        ) {
          whatsappNumber = other.id.split("@")[0].split(":")[0];
        }

        if (whatsappNumber) {
          chatId = `${whatsappNumber}_${chat.sender_mobile}_${chat.uid}`;
        } else {
          // Fallback to meta_senderMobile if no whatsapp number found
          chatId = `meta_${chat.sender_mobile}`;
        }
      } catch (e) {
        logger.error("Error generating chat_id:", e);
        chatId = `meta_${chat.sender_mobile}`;
      }

      // Check if chat already exists with same uid and chat_id
      const exists = await checkExistingChat(chat.uid, chatId);
      if (exists) {
        logger.log(
          `Skipping duplicate chat: uid ${chat.uid}, chat_id ${chatId}`,
        );
        return { success: true, id: chat.id, skipped: true };
      }

      await query(
        `INSERT INTO beta_chats (
          id,
          uid,
          old_chat_id,
          profile,
          origin_instance_id,
          chat_id,
          last_message,
          chat_label,
          chat_note,
          sender_name,
          sender_mobile,
          unread_count,
          origin,
          assigned_agent,
          createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chat.id, // auto-generated ID
          chat.uid,
          chat.chat_id || null, // old_chat_id
          chat.profile ? JSON.stringify({ profileImage: chat.profile }) : null,
          originInstanceId,
          chatId, // newly generated chat_id
          JSON.stringify({
            type: lastMessage.type || "text",
            metaChatId: lastMessage.metaChatId || "",
            msgContext: lastMessage.msgContext || {
              type: "text",
              text: { preview_url: true, body: "" },
            },
            reaction: lastMessage.reaction || "",
            timestamp: lastMessage.timestamp || Math.floor(Date.now() / 1000),
            senderName: lastMessage.senderName || chat.sender_name || "",
            senderMobile: lastMessage.senderMobile || chat.sender_mobile || "",
            status: lastMessage.status || "",
            star: lastMessage.star || false,
            route: lastMessage.route || "OUTGOING",
            context: lastMessage.context || null,
            origin: chat.origin || "meta",
          }),
          chat.chat_tags ? chat.chat_tags : null,
          chat.chat_note || null,
          chat.sender_name || "",
          chat.sender_mobile || "",
          chat.is_opened === 1 ? 1 : 0,
          chat.origin || "meta",
          null, // assigned_agent
          chat.createdAt ? new Date(chat.createdAt) : new Date(),
        ],
      );
      return { success: true, id: chat.id };
    } catch (err) {
      logger.log(`Error inserting chat ${chat.id}:`, err);
      return { success: false, id: chat.id, error: err };
    }
  });

  return Promise.all(insertPromises);
}

async function saveMessageToConversation({
  uid,
  chatId,
  messageData,
  sentBy = "human",
}) {
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
      status: "sent",
      chat_id: chatId,
      sentBy,
    });
    return true;
  } catch (err) {
    logger.log("Error saving message to conversation:", err);
    return false;
  }
}

async function executeQueries(queries, pool) {
  try {
    const connection = await pool.getConnection(); // Get a connection from the pool
    for (const query of queries) {
      await connection.query(query);
    }
    connection.release(); // Release the connection back to the pool
    return { success: true };
  } catch (err) {
    return { success: false, err };
  }
}

function updateMessageObjectInFile(filePath, metaChatId, key, value) {
  // Read JSON data from the file
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      logger.error("Error reading file:", err);
      return;
    }

    try {
      // Parse JSON data
      const dataArray = JSON.parse(data);

      // Find the message object with the given metaChatId
      const message = dataArray.find((obj) => obj.metaChatId === metaChatId);

      // If the message is found, update the key with the new value
      if (message) {
        message[key] = value;
        logger.log(
          `Updated message with metaChatId ${metaChatId}: ${key} set to ${value}`,
        );

        // Write the modified JSON data back to the file
        fs.writeFile(
          filePath,
          JSON.stringify(dataArray, null, 2),
          "utf8",
          (err) => {
            if (err) {
              logger.error("Error writing file:", err);
              return;
            }
            logger.log("File updated successfully");
          },
        );
      } else {
        logger.error(`Message with metaChatId ${metaChatId} not found`);
      }
    } catch (error) {
      logger.error("Error parsing JSON:", error);
    }
  });
}

async function downloadAndSaveMedia(token, mediaId) {
  try {
    const url = `https://graph.facebook.com/v19.0/${mediaId}/`;
    // retriving url
    const getUrl = await axios(url, {
      headers: {
        Authorization: "Bearer " + token,
      },
    });

    const config = {
      method: "get",
      url: getUrl?.data?.url, //PASS THE URL HERE, WHICH YOU RECEIVED WITH THE HELP OF MEDIA ID
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: "arraybuffer",
    };

    const response = await axios(config);
    const ext = response.headers["content-type"].split("/")[1];

    const randomSt = randomstring.generate();
    const savingPath = `${__dirname}/../client/public/meta-media/${randomSt}`;
    await fs.promises.writeFile(`${savingPath}.${ext}`, response.data);
    return `${randomSt}.${ext}`;
  } catch (error) {
    logger.error("Error downloading media:", error);
  }
}

function getCurrentTimestampInTimeZone(timezone) {
  const currentTimeInZone = moment.tz(timezone);
  const currentTimestampInSeconds = Math.round(
    currentTimeInZone.valueOf() / 1000,
  );

  return currentTimestampInSeconds;
}
async function addObjectToFile(object, filePath) {
  const parentDir = path.dirname(filePath);
  await fs.promises.mkdir(parentDir, { recursive: true });
  let existingData = [];
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existingData = parsed;
    else logger.error("File does not contain an array.");
  } catch {
    // file doesn't exist yet — start fresh
  }
  existingData.push(object);
  await fs.promises.writeFile(filePath, JSON.stringify(existingData, null, 2));
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function areMobileNumbersFilled(array) {
  for (const item of array) {
    if (!item.mobile) {
      return false;
    }
  }

  return true;
}

function getFileExtension(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex !== -1 && dotIndex !== 0) {
    const extension = fileName.substring(dotIndex + 1);
    return extension.toLowerCase();
  }
  return "";
}

function updateMetaTempletInMsg(uid, savObj, chatId, msgId) {
  return new Promise(async (resolve, reject) => {
    try {
      logger.log({ thisss: uid });
      const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

      if (getUser.length < 1) {
        return resolve({ success: false, msg: "user not found" });
      }

      const userTimezone = getCurrentTimestampInTimeZone(
        getUser[0]?.timezone || Date.now() / 1000,
      );
      const finalSaveMsg = {
        ...savObj,
        metaChatId: msgId,
        timestamp: userTimezone,
      };

      const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;
      addObjectToFile(finalSaveMsg, chatPath);

      const io = getIOInstance();

      await query(
        `UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ?`,
        [userTimezone, JSON.stringify(savObj), 0, chatId],
      );

      const getId = await query(`SELECT * FROM rooms WHERE uid = ?`, [uid]);

      await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [
        1,
        chatId,
      ]);

      const chats = await query(`SELECT * FROM chats WHERE uid = ?`, [uid]);

      io.to(getId[0]?.socket_id).emit("update_conversations", {
        chats: chats,
        notificationOff: true,
      });

      io.to(getId[0]?.socket_id).emit("push_new_msg", {
        msg: finalSaveMsg,
        chatId: chatId,
      });

      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function sendAPIMessage(obj, waNumId, waToken) {
  return new Promise(async (resolve) => {
    try {
      const url = `https://graph.facebook.com/v17.0/${waNumId}/messages`;

      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...obj,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${waToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data?.error) {
        return resolve({ success: false, message: data?.error?.message });
      }

      resolve({
        success: true,
        message: "Message sent successfully!",
        data: data?.messages[0],
      });
    } catch (err) {
      resolve({ success: false, msg: err.toString(), err });
      logger.log(err);
    }
  });
}

function sendMetaMsg(uid, msgObj, toNumber, savObj, chatId) {
  return new Promise(async (resolve) => {
    try {
      const getMeta = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
        uid,
      ]);
      const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

      if (getMeta.length < 1) {
        return resolve({ success: false, msg: "Unable to to find API " });
      }

      const waToken = getMeta[0]?.access_token;
      const waNumId = getMeta[0]?.business_phone_number_id;

      if (!waToken || !waNumId) {
        return resolve({
          success: false,
          msg: "Please add your meta token and phone number ID",
        });
      }

      const url = `https://graph.facebook.com/v17.0/${waNumId}/messages`;

      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toNumber,
        ...msgObj,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${waToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data?.error) {
        return resolve({ success: false, msg: data?.error?.message });
      }

      if (data?.messages[0]?.id) {
        const userTimezone = getCurrentTimestampInTimeZone(
          getUser[0]?.timezone || Date.now() / 1000,
        );
        const finalSaveMsg = {
          ...savObj,
          metaChatId: data?.messages[0]?.id,
          timestamp: userTimezone,
        };

        const chatPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;
        addObjectToFile(finalSaveMsg, chatPath);

        await query(
          `UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ?`,
          [userTimezone, JSON.stringify(finalSaveMsg), 1, chatId],
        );

        await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [
          1,
          chatId,
        ]);
      }

      resolve({ success: true });
    } catch (err) {
      resolve({ success: false, msg: err.toString(), err });
      logger.log(err);
    }
  });
}

function mergeArrays(arrA, arrB) {
  const mergedArray = arrB.map((objB) => {
    const matchingObject = arrA.find(
      (objA) => objA.mobile === objB.sender_mobile,
    );
    if (matchingObject) {
      return { ...objB, contact: matchingObject };
    }
    return objB;
  });

  return mergedArray;
}

async function getBusinessPhoneNumber(
  apiVersion,
  businessPhoneNumberId,
  bearerToken,
) {
  const url = `https://graph.facebook.com/${apiVersion}/${businessPhoneNumberId}`;
  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error fetching data:", error);
    throw error; // Re-throw the error to handle it upstream
  }
}

async function createMetaTemplet(apiVersion, waba_id, bearerToken, body) {
  const url = `https://graph.facebook.com/${apiVersion}/${waba_id}/message_templates`;
  const options = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body), // Include the request body here
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error fetching data:", error);
    throw error; // Re-throw the error to handle it upstream
  }
}

async function getAllTempletsMeta(apiVersion, waba_id, bearerToken) {
  const url = `https://graph.facebook.com/${apiVersion}/${waba_id}/message_templates`;
  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error fetching data:", error);
    throw error; // Re-throw the error to handle it upstream
  }
}

async function delMetaTemplet(apiVersion, waba_id, bearerToken, name) {
  const url = `https://graph.facebook.com/${apiVersion}/${waba_id}/message_templates?name=${name}`;
  const options = {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error fetching data:", error);
    throw error; // Re-throw the error to handle it upstream
  }
}

async function sendMetatemplet(
  toNumber,
  business_phone_number_id,
  token,
  template,
  example,
  dynamicMedia,
) {
  const checkBody = template?.components?.filter((i) => i.type === "BODY");
  const getHeader = template?.components?.filter((i) => i.type === "HEADER");
  const getButtons = template?.components?.filter((i) => i.type === "BUTTONS");
  const headerFormat = getHeader.length > 0 ? getHeader[0]?.format : "";

  let templ = {
    name: template?.name,
    language: {
      code: template?.language,
    },
    components: [],
  };

  // Body component handling
  if (checkBody.length > 0) {
    const bodyComponent = checkBody[0];
    if (
      bodyComponent?.example?.body_text &&
      bodyComponent.example.body_text[0]
    ) {
      const comp = bodyComponent.example.body_text[0].map(
        (placeholder, key) => ({
          type: "text",
          text: example[key] || placeholder,
        }),
      );

      if (comp && comp.length > 0) {
        templ.components.push({
          type: "body",
          parameters: comp,
        });
      }
    }
  }

  // Header component handling - IMAGE
  if (headerFormat === "IMAGE" && getHeader.length > 0) {
    const getMedia = await query(
      `SELECT * FROM meta_templet_media WHERE templet_name = ?`,
      [template?.name],
    );

    templ.components.unshift({
      type: "header",
      parameters: [
        {
          type: "image",
          image: {
            link: dynamicMedia
              ? dynamicMedia
              : getMedia.length > 0
                ? `${process.env.FRONTENDURI}/media/${getMedia[0]?.file_name}`
                : getHeader[0].example?.header_handle[0],
          },
        },
      ],
    });
  }

  // Header component handling - VIDEO
  if (headerFormat === "VIDEO" && getHeader.length > 0) {
    const getMedia = await query(
      `SELECT * FROM meta_templet_media WHERE templet_name = ?`,
      [template?.name],
    );

    templ.components.unshift({
      type: "header",
      parameters: [
        {
          type: "video",
          video: {
            link: dynamicMedia
              ? dynamicMedia
              : getMedia.length > 0
                ? `${process.env.FRONTENDURI}/media/${getMedia[0]?.file_name}`
                : getHeader[0].example?.header_handle[0],
          },
        },
      ],
    });
  }

  // Header component handling - DOCUMENT
  if (headerFormat === "DOCUMENT" && getHeader.length > 0) {
    const getMedia = await query(
      `SELECT * FROM meta_templet_media WHERE templet_name = ?`,
      [template?.name],
    );

    templ.components.unshift({
      type: "header",
      parameters: [
        {
          type: "document",
          document: {
            link: dynamicMedia
              ? dynamicMedia
              : getMedia.length > 0
                ? `${process.env.FRONTENDURI}/media/${getMedia[0]?.file_name}`
                : getHeader[0].example?.header_handle[0],
            filename: "document",
          },
        },
      ],
    });
  }

  // Header component handling - TEXT (for dynamic text headers)
  if (headerFormat === "TEXT" && getHeader.length > 0) {
    const headerComponent = getHeader[0];
    if (
      headerComponent?.example?.header_text &&
      headerComponent.example.header_text.length > 0
    ) {
      const headerParams = headerComponent.example.header_text.map(
        (placeholder, key) => ({
          type: "text",
          text: example[key] || placeholder,
        }),
      );

      if (headerParams && headerParams.length > 0) {
        templ.components.unshift({
          type: "header",
          parameters: headerParams,
        });
      }
    }
  }

  // Button component handling
  if (getButtons.length > 0) {
    const buttonsComponent = getButtons[0];
    if (buttonsComponent?.buttons && buttonsComponent.buttons.length > 0) {
      buttonsComponent.buttons.forEach((button, buttonIndex) => {
        if (button.type === "URL" && button.url) {
          // Check if button URL has parameters
          const urlParameterMatches = button.url.match(/\{\{(\d+)\}\}/g);

          if (urlParameterMatches && urlParameterMatches.length > 0) {
            const buttonParameters = [];

            urlParameterMatches.forEach((match) => {
              const paramIndex = parseInt(match.replace(/\{\{|\}\}/g, "")) - 1; // Convert to 0-based index
              if (example[paramIndex] !== undefined) {
                buttonParameters.push({
                  type: "text",
                  text: example[paramIndex].toString(),
                });
              }
            });

            if (buttonParameters.length > 0) {
              templ.components.push({
                type: "button",
                sub_type: "url",
                index: buttonIndex.toString(),
                parameters: buttonParameters,
              });
            }
          }
        }

        // Handle QUICK_REPLY buttons (if needed)
        if (button.type === "QUICK_REPLY") {
          // Quick reply buttons typically don't need parameters
          // but you can add handling here if your template requires it
        }

        // Handle PHONE_NUMBER buttons (if needed)
        if (button.type === "PHONE_NUMBER") {
          // Phone number buttons typically don't need parameters
          // but you can add handling here if your template requires it
        }
      });
    }
  }

  // WhatsApp API endpoint
  const url = `https://graph.facebook.com/v18.0/${business_phone_number_id}/messages`;

  // Request body
  const body = {
    messaging_product: "whatsapp",
    to: toNumber,
    type: "template",
    template: templ,
  };

  // Request options
  const options = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };

  try {
    logger.log("Sending template with body:", JSON.stringify(body, null, 2));

    const response = await fetch(url, options);
    const data = await response.json();

    logger.log("Meta API Response:", JSON.stringify(data, null, 2));

    return data;
  } catch (error) {
    logger.error("Error sending message:", error);
    throw error;
  }
}

function getFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, stats) => {
      if (err) {
        reject(err);
      } else {
        const fileSizeInBytes = stats.size;
        const mimeType = mime.lookup(filePath) || "application/octet-stream";
        resolve({ fileSizeInBytes, mimeType });
      }
    });
  });
}

async function getSessionUploadMediaMeta(
  apiVersion,
  app_id,
  bearerToken,
  fileSize,
  mimeType,
) {
  const url = `https://graph.facebook.com/${apiVersion}/${app_id}/uploads?file_length=${fileSize}&file_type=${mimeType}`;
  const options = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error fetching data:", error);
    throw error; // Re-throw the error to handle it upstream
  }
}

async function uploadFileMeta(sessionId, filePath, apiVersion, accessToken) {
  return new Promise(async (resolve) => {
    try {
      // Read the file as binary data
      const fileData = await fs.promises.readFile(filePath);

      // Prepare URL
      const url = `https://graph.facebook.com/${apiVersion}/${sessionId}`;

      // Prepare options for fetch
      const options = {
        method: "POST",
        headers: {
          Authorization: `OAuth ${accessToken}`,
          "Content-Type": "application/pdf",
          Cookie: "ps_l=0; ps_n=0",
        },
        body: fileData,
      };

      // Make fetch request
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorResponse = await response.json(); // Parse error response as JSON
        logger.error("Error response:", errorResponse);
        return resolve({ success: false, data: errorResponse });
      }
      const data = await response.json();
      return resolve({ success: true, data });
    } catch (error) {
      return resolve({ success: false, data: error });
    }
  });
}

async function getMetaNumberDetail(
  apiVersion,
  budiness_phone_number_id,
  bearerToken,
) {
  const url = `https://graph.facebook.com/${apiVersion}/${budiness_phone_number_id}`;
  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error fetching data:", error);
    throw error; // Re-throw the error to handle it upstream
  }
}

function addDaysToCurrentTimestamp(days) {
  // Get the current timestamp
  let currentTimestamp = Date.now();

  // Calculate the milliseconds for the given number of days
  let millisecondsToAdd = days * 24 * 60 * 60 * 1000;

  // Add the milliseconds to the current timestamp
  let newTimestamp = currentTimestamp + millisecondsToAdd;

  // Return the new timestamp
  return newTimestamp;
}

// update user plan
async function updateUserPlan(plan, uid) {
  logger.log({ plan });
  const planDays = parseInt(plan?.plan_duration_in_days || 0);
  const timeStamp = addDaysToCurrentTimestamp(planDays);
  await query(`UPDATE user SET plan = ?, plan_expire = ? WHERE uid = ?`, [
    JSON.stringify(plan),
    timeStamp,
    uid,
  ]);
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

async function sendEmailBeta(config) {
  try {
    const {
      host,
      port,
      email,
      pass,
      username,
      from,
      to,
      subject,
      html,
      security,
      useAuth,
    } = config;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // Use true for port 465 (SSL), false for 587 (TLS)
      auth: useAuth
        ? {
            user: username,
            pass: pass,
          }
        : undefined,
      tls: security === "tls" ? { rejectUnauthorized: false } : undefined,
    });

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    return { success: false, msg: err.message };
  }
}

function sendEmail(host, port, email, pass, html, subject, from, to, username) {
  logger.log({
    host,
    port,
    email,
    pass,
  });
  return new Promise(async (resolve) => {
    try {
      let transporter = nodemailer.createTransport({
        host: host,
        port: port,
        secure: port === "465" ? true : false, // true for 465, false for other ports
        auth: {
          user: username || email, // generated ethereal user
          pass: pass, // generated ethereal password
        },
        tls: {
          rejectUnauthorized: false,
        },
      });

      let info = await transporter.sendMail({
        from: `${from || "Email From"} <${email}>`, // sender address
        to: to, // list of receivers
        subject: subject || "Email", // Subject line
        html: html, // html body
      });

      resolve({ success: true, info });
    } catch (err) {
      resolve({ success: false, err: err.toString() || "Invalid Email" });
    }
  });
}

function getUserSignupsByMonth(users) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();

  // Filter users into paid and unpaid arrays
  const { paidUsers, unpaidUsers } = users.reduce(
    (acc, user) => {
      const planExpire = user.plan_expire
        ? new Date(parseInt(user.plan_expire))
        : null;
      const isPaid = planExpire ? planExpire > currentDate : false;
      if (isPaid) {
        acc.paidUsers.push(user);
      } else {
        acc.unpaidUsers.push(user);
      }
      return acc;
    },
    { paidUsers: [], unpaidUsers: [] },
  );

  // Create signups by month for paid users
  const paidSignupsByMonth = months.map((month, monthIndex) => {
    const usersInMonth = paidUsers.filter((user) => {
      const userDate = new Date(user.createdAt);
      return (
        userDate.getMonth() === monthIndex &&
        userDate.getFullYear() === currentYear
      );
    });
    const numberOfSignups = usersInMonth.length;
    const userEmails = usersInMonth.map((user) => user.email);
    return { month, numberOfSignups, userEmails, paid: true };
  });

  // Create signups by month for unpaid users
  const unpaidSignupsByMonth = months.map((month, monthIndex) => {
    const usersInMonth = unpaidUsers.filter((user) => {
      const userDate = new Date(user.createdAt);
      return (
        userDate.getMonth() === monthIndex &&
        userDate.getFullYear() === currentYear
      );
    });
    const numberOfSignups = usersInMonth.length;
    const userEmails = usersInMonth.map((user) => user.email);
    return { month, numberOfSignups, userEmails, paid: false };
  });

  return { paidSignupsByMonth, unpaidSignupsByMonth };
}

function getUserOrderssByMonth(orders) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const signupsByMonth = Array.from({ length: 12 }, (_, monthIndex) => {
    const month = months[monthIndex];
    const ordersInMonth = orders.filter((user) => {
      const userDate = new Date(user.createdAt);
      return (
        userDate.getMonth() === monthIndex &&
        userDate.getFullYear() === currentYear
      );
    });
    const numberOfOders = ordersInMonth.length;
    return { month, numberOfOders };
  });
  return signupsByMonth;
}

function getNumberOfDaysFromTimestamp(timestamp) {
  if (!timestamp || isNaN(timestamp)) {
    return 0; // Invalid timestamp
  }

  const currentTimestamp = Date.now();
  if (timestamp <= currentTimestamp) {
    return 0; // Timestamp is in the past or current time
  }

  const millisecondsInADay = 1000 * 60 * 60 * 24;
  const differenceInDays = Math.ceil(
    (timestamp - currentTimestamp) / millisecondsInADay,
  );
  return differenceInDays;
}

async function getUserPlayDays(uid) {
  const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);
  if (getUser.length < 1) {
    return 0;
  }
  if (!getUser[0].plan_expire) {
    return 0;
  } else {
    const days = getNumberOfDaysFromTimestamp(getUser[0]?.plan_expire);
    return days;
  }
}

async function folderExists(folderPath) {
  try {
    await fs.promises.access(folderPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function downloadAndExtractFile(filesObject, outputFolderPath) {
  try {
    const uploadedFile = filesObject?.file;
    if (!uploadedFile) {
      return { success: false, msg: "No file data found in FormData" };
    }

    const outputPath = path.join(outputFolderPath, uploadedFile.name);

    // Step 1: Save the uploaded zip
    await new Promise((resolve, reject) => {
      uploadedFile.mv(outputPath, (err) => (err ? reject(err) : resolve()));
    });

    // Step 2: Extract using a proper entry-by-entry approach
    await new Promise((resolve, reject) => {
      const writePromises = [];

      fs.createReadStream(outputPath)
        .pipe(unzipper.Parse())
        .on("entry", (entry) => {
          const entryPath = path.join(outputFolderPath, entry.path);
          const type = entry.type; // 'Directory' or 'File'

          if (type === "Directory") {
            const dirPromise = fs.promises
              .mkdir(entryPath, { recursive: true })
              .then(() => entry.autodrain());
            writePromises.push(dirPromise);
          } else {
            // Ensure parent directory exists before writing
            const dirName = path.dirname(entryPath);
            const filePromise = fs.promises
              .mkdir(dirName, { recursive: true })
              .then(
                () =>
                  new Promise((res, rej) => {
                    entry
                      .pipe(fs.createWriteStream(entryPath))
                      .on("finish", res)
                      .on("error", rej);
                  }),
              );
            writePromises.push(filePromise);
          }
        })
        .on("close", async () => {
          try {
            // Wait for ALL file writes to complete
            await Promise.all(writePromises);
            resolve();
          } catch (err) {
            reject(err);
          }
        })
        .on("error", reject);
    });

    // Step 3: Only delete zip AFTER all writes are confirmed done
    await fs.promises.unlink(outputPath);

    return { success: true, msg: "App was successfully installed/updated" };
  } catch (error) {
    logger.error("Error downloading and extracting file:", error);
    return { success: false, msg: error.message };
  }
}

function fetchProfileFun(mobileId, token) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v17.0/${mobileId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          // body: JSON.stringify(payload)
        },
      );

      const data = await response.json();

      if (data.error) {
        return resolve({ success: false, msg: data.error?.message });
      } else {
        return resolve({ success: true, data: data });
      }
    } catch (error) {
      logger.log({ error });
      reject(error);
    }
  });
}

function returnWidget(image, imageSize, url, position) {
  let style = "";
  switch (position) {
    case "TOP_RIGHT":
      style = "position: fixed; top: 15px; right: 15px;";
      break;
    case "TOP_CENTER":
      style =
        "position: fixed; top: 15px; right: 50%; transform: translateX(-50%);";
      break;
    case "TOP_LEFT":
      style = "position: fixed; top: 15px; left: 15px;";
      break;
    case "BOTTOM_RIGHT":
      style = "position: fixed; bottom: 15px; right: 15px;";
      break;
    case "BOTTOM_CENTER":
      style =
        "position: fixed; bottom: 15px; right: 50%; transform: translateX(-50%);";
      break;
    case "BOTTOM_LEFT":
      style = "position: fixed; bottom: 15px; left: 15px;";
      break;
    case "ALL_CENTER":
      style =
        "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);";
      break;
    default:
      // Default position is top right
      style = "position: fixed; top: 15px; right: 15px;";
      break;
  }

  return `
    <a href="${url}">
      <img  src="${image}" alt="Widget" id="widget-image"
        style="${style} width: ${imageSize}px; height: auto; cursor: pointer; z-index: 9999;">
        </a>
      <!-- Widget content -->

      <div  class="widget-container" id="widget-container"
        style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: #fff; border: 1px solid #ccc; border-radius: 5px; padding: 10px; box-shadow: 0px 2px 5px rgba(0, 0, 0, 0.1); display: none; z-index: 9999;">
        <span class="close-btn" id="close-btn"
          style="position: absolute; top: 5px; right: 5px; cursor: pointer;">&times;</span>
      </div>

      
  
      <script>
        // Get references to the image and widget container
        const widgetImage = document.getElementById('widget-image');
        const widgetContainer = document.getElementById('widget-container');
  
        // Redirect to a URL when the image is clicked
        widgetImage.addEventListener('click', function () {
          // Replace '${url} with the desired URL
          window.location.href = '${url}';
        });
  
        // Close widget when close button is clicked
        const closeBtn = document.getElementById('close-btn');
        closeBtn.addEventListener('click', function (event) {
          event.stopPropagation(); // Prevents the click event from propagating to the widget image
          widgetContainer.style.display = 'none';
        });
      </script>
    `;
}

function generateWhatsAppURL(phoneNumber, text) {
  const baseUrl = "https://wa.me/";
  const formattedPhoneNumber = phoneNumber.replace(/\D/g, ""); // Remove non-numeric characters
  const encodedText = encodeURIComponent(text);
  return `${baseUrl}${formattedPhoneNumber}?text=${encodedText}`;
}

async function makeRequest({ method, url, body = null, headers = [] }) {
  try {
    // Create an AbortController to handle the timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 seconds

    // Convert headers array to an object
    const headersObject = headers.reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {});

    // Set Content-Type to application/json for POST and PUT methods
    if (method === "POST" || method === "PUT") {
      headersObject["Content-Type"] = "application/json";
    }

    // Convert body array to an object if it's not GET or DELETE
    const requestBody =
      method === "GET" || method === "DELETE"
        ? undefined
        : JSON.stringify(
            body.reduce((acc, { key, value }) => {
              acc[key] = value;
              return acc;
            }, {}),
          );

    // Set up the request configuration
    const config = {
      method,
      headers: headersObject,
      body: requestBody,
      signal: controller.signal,
    };

    logger.log({
      config,
    });

    // Perform the request
    const response = await fetch(url, config);

    // Clear the timeout
    clearTimeout(timeoutId);

    // Check if the response status is OK
    if (!response.ok) {
      return { success: false, msg: `HTTP error ${response.status}` };
    }

    // Parse the response
    const data = await response.json();

    // Validate the response
    if (typeof data === "object" || Array.isArray(data)) {
      return { success: true, data };
    } else {
      return { success: false, msg: "Invalid response format" };
    }
  } catch (error) {
    // Handle errors (e.g., timeout, network issues)
    return { success: false, msg: error.message };
  }
}

function replacePlaceholders(template, data) {
  return template.replace(/{{{([^}]+)}}}/g, (match, key) => {
    // Remove any whitespace and parse the key
    key = key.trim();

    // Handle array indexing
    const arrayMatch = key.match(/^\[(\d+)]\.(.+)$/);
    if (arrayMatch) {
      const index = parseInt(arrayMatch[1], 10);
      const property = arrayMatch[2];

      if (Array.isArray(data) && index >= 0 && index < data.length) {
        let value = data[index];
        // Split the property string for nested properties
        const nestedKeys = property.split(".");
        for (const k of nestedKeys) {
          if (value && Object.prototype.hasOwnProperty.call(value, k)) {
            value = value[k];
          } else {
            return "NA";
          }
        }
        return value !== undefined ? value : "NA";
      } else {
        return "NA";
      }
    }

    // Handle object properties
    const keys = key.split("."); // Support for nested keys
    let value = data;

    for (const k of keys) {
      if (value && Object.prototype.hasOwnProperty.call(value, k)) {
        value = value[k];
      } else {
        return "NA"; // Return 'NA' if key is not found in the object
      }
    }

    return value !== undefined ? value : "NA"; // Return 'NA' if value is undefined
  });
}

const rzCapturePayment = (paymentId, amount, razorpayKey, razorpaySecret) => {
  // Disable SSL certificate validation
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const auth =
    "Basic " +
    Buffer.from(razorpayKey + ":" + razorpaySecret).toString("base64");

  return new Promise((resolve, reject) => {
    fetch(`https://api.razorpay.com/v1/payments/${paymentId}/capture`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: amount }), // Replace with the actual amount to capture
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.error) {
          logger.error("Error capturing payment:", data.error);
          reject(data.error);
        } else {
          logger.log("Payment captured successfully:", data);
          resolve(data);
        }
      })
      .catch((error) => {
        logger.error("Error capturing payment:", error);
        reject(error);
      });
  });
};

async function validateFacebookToken(userAccessToken, appId, appSecret) {
  // Construct the app access token by combining App ID and App Secret
  const appAccessToken = `${appId}|${appSecret}`;

  // Define the Facebook Graph API URL for debugging tokens
  const url = `https://graph.facebook.com/debug_token?input_token=${userAccessToken}&access_token=${appAccessToken}`;

  try {
    // Fetch the response from the Facebook Graph API
    const response = await fetch(url);

    // Parse the JSON response
    const data = await response.json();

    // Check if the token is valid
    if (data.data && data.data.is_valid) {
      // Token is valid
      return { success: true, response: data };
    } else {
      // Token is not valid
      return { success: false, response: data };
    }
  } catch (error) {
    // Handle any errors that occur during the fetch operation
    logger.error("Error validating Facebook token:", error);
    return { success: false, response: error };
  }
}

function extractFileName(url) {
  try {
    const decodedUrl = decodeURIComponent(url.split("?")[0]); // Remove query params
    return decodedUrl.substring(decodedUrl.lastIndexOf("/") + 1);
  } catch (error) {
    logger.error("Error extracting file name:", error.message);
    return null;
  }
}

async function checkWarmerPlan({ uid }) {
  try {
    const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);
    const warmer = user?.plan ? JSON.parse(user?.plan)?.wa_warmer : 0;
    return parseInt(warmer) > 0 ? true : false;
  } catch (err) {
    return false;
  }
}

async function getAllTempletsMetaBeta(
  apiVersion,
  waba_id,
  bearerToken,
  limit = 9,
  after = null,
  before = null,
  status = "APPROVED",
) {
  let url = `https://graph.facebook.com/${apiVersion}/${waba_id}/message_templates?limit=${limit}&status=${status}`;

  // Add cursor parameters if provided
  if (after) {
    url += `&after=${after}`;
  } else if (before) {
    url += `&before=${before}`;
  }

  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error fetching data:", error);
    throw error;
  }
}

// Helper function to extract variables from a template
function extractTemplateVariablesBeta(template) {
  const variables = [];

  // Check components for variables
  if (template.components) {
    template.components.forEach((component) => {
      // Check body component for variables
      if (component.type === "BODY" && component.text) {
        const matches = component.text.match(/{{(\d+)}}/g) || [];
        matches.forEach((match) => {
          const varNumber = match.replace("{{", "").replace("}}", "");
          variables.push({
            component: "BODY",
            index: varNumber,
            example:
              component.example?.body_text?.[Number(varNumber) - 1] || "",
          });
        });
      }

      // Check header for media variables
      if (component.type === "HEADER" && component.format !== "TEXT") {
        variables.push({
          component: "HEADER",
          type: component.format.toLowerCase(),
          example: component.example?.header_handle?.[0] || "",
        });
      }

      // Check buttons for variables
      if (component.type === "BUTTONS" && component.buttons) {
        component.buttons.forEach((button, idx) => {
          if (button.type === "URL" && button.url.includes("{{")) {
            variables.push({
              component: "BUTTON",
              index: idx,
              buttonType: "URL",
              example: button.example || "",
            });
          }
        });
      }
    });
  }

  return variables;
}

// Helper function to format phone number
function formatPhoneNumber(phone) {
  // Remove any non-digit characters
  let cleaned = phone.replace(/\D/g, "");

  // Ensure it has country code (add default 1 for US if needed)
  if (cleaned.length === 10) {
    cleaned = "1" + cleaned;
  }

  // Add + prefix if not present
  if (!cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }

  return cleaned;
}

// Function to send template message
async function sendTemplateMessage(
  apiVersion,
  phoneNumberId,
  accessToken,
  templateName,
  language,
  recipientPhone,
  bodyVariables = [],
  headerVariable = null,
  buttonVariables = [],
) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  // Prepare the message payload
  const messagePayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientPhone,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: language,
      },
      components: [],
    },
  };

  // Add body component with variables if provided
  if (bodyVariables && bodyVariables.length > 0) {
    const bodyComponent = {
      type: "body",
      parameters: bodyVariables.map((variable) => {
        return {
          type: "text",
          text: variable,
        };
      }),
    };
    messagePayload.template.components.push(bodyComponent);
  }

  // Add header component with variable if provided
  if (headerVariable) {
    const headerComponent = {
      type: "header",
      parameters: [],
    };

    // Determine header variable type
    if (headerVariable.type === "image") {
      headerComponent.parameters.push({
        type: "image",
        image: {
          link: headerVariable.url,
        },
      });
    } else if (headerVariable.type === "document") {
      headerComponent.parameters.push({
        type: "document",
        document: {
          link: headerVariable.url,
          filename: headerVariable.filename || "document",
        },
      });
    } else if (headerVariable.type === "video") {
      headerComponent.parameters.push({
        type: "video",
        video: {
          link: headerVariable.url,
        },
      });
    }

    messagePayload.template.components.push(headerComponent);
  }

  // Add button variables if provided
  if (buttonVariables && buttonVariables.length > 0) {
    buttonVariables.forEach((buttonVar, index) => {
      if (buttonVar.value) {
        const buttonComponent = {
          type: "button",
          sub_type: "url",
          index: buttonVar.index.toString(),
          parameters: [
            {
              type: "text",
              text: buttonVar.value,
            },
          ],
        };

        messagePayload.template.components.push(buttonComponent);
      }
    });
  }

  // Send the request
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(messagePayload),
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("Error sending template message:", error);
    throw error;
  }
}

// Helper function to get recent messages for context
async function getRecentMessages(chatId, uid, limit = 5) {
  try {
    const messages = await query(
      `SELECT * FROM beta_conversation 
       WHERE chat_id = ? AND uid = ? 
       ORDER BY timestamp DESC LIMIT ?`,
      [chatId, uid, limit],
    );

    return messages
      .map((msg) => {
        try {
          const parsedContext = msg.msgContext
            ? JSON.parse(msg.msgContext)
            : {};
          return {
            type: msg.type,
            text: parsedContext.text?.body || "",
            route: msg.route,
            timestamp: msg.timestamp,
          };
        } catch (e) {
          return {
            type: msg.type,
            text: "",
            route: msg.route,
            timestamp: msg.timestamp,
          };
        }
      })
      .reverse(); // Return in chronological order
  } catch (error) {
    logger.error("Error fetching recent messages:", error);
    return [];
  }
}

async function suggestReplyWithOpenAI(messages, lastMessage, apiKey) {
  try {
    // Format conversation history
    const formattedMessages = messages.map((msg) => ({
      role: msg.route === "INCOMING" ? "user" : "assistant",
      content: msg.text,
    }));

    // Add system message at the beginning
    formattedMessages.unshift({
      role: "system",
      content:
        "You are a helpful assistant. Generate a concise, natural-sounding reply to the conversation. The reply should be friendly, helpful, and appropriate for a business conversation. Only return the suggested reply without explanations.",
    });
    if (lastMessage) {
      formattedMessages.push({
        role: "user",
        content: lastMessage,
      });
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error(
      "OpenAI suggestion error:",
      error.response?.data || error.message,
    );
    throw new Error(
      error.response?.data?.error?.message || "OpenAI suggestion failed",
    );
  }
}

async function suggestReplyWithGemini(messages, lastMessage, apiKey) {
  try {
    // Format conversation history
    let conversationText = "Here is the conversation history:\n\n";

    messages.forEach((msg) => {
      const role = msg.route === "INCOMING" ? "Customer" : "Support";
      conversationText += `${role}: ${msg.text}\n`;
    });

    // Add the latest message if provided
    if (lastMessage) {
      conversationText += `Customer: ${lastMessage}\n`;
    }

    conversationText +=
      "\nGenerate a concise, natural-sounding reply from Support. The reply should be friendly, helpful, and appropriate for a business conversation. Only return the suggested reply without explanations.";

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: conversationText,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    return response.data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    logger.error(
      "Gemini suggestion error:",
      error.response?.data || error.message,
    );
    throw new Error(
      error.response?.data?.error?.message || "Gemini suggestion failed",
    );
  }
}

async function suggestReplyWithDeepseek(messages, lastMessage, apiKey) {
  try {
    // Format conversation history
    const formattedMessages = messages.map((msg) => ({
      role: msg.route === "INCOMING" ? "user" : "assistant",
      content: msg.text,
    }));

    // Add system message at the beginning
    formattedMessages.unshift({
      role: "system",
      content:
        "You are a helpful assistant. Generate a concise, natural-sounding reply to the conversation. The reply should be friendly, helpful, and appropriate for a business conversation. Only return the suggested reply without explanations.",
    });

    // Add the latest message if provided
    if (lastMessage) {
      formattedMessages.push({
        role: "user",
        content: lastMessage,
      });
    }

    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error(
      "Deepseek suggestion error:",
      error.response?.data || error.message,
    );
    throw new Error(
      error.response?.data?.error?.message || "Deepseek suggestion failed",
    );
  }
}

const languageNames = [
  { code: "af", name: "Afrikaans" },
  { code: "am", name: "Amharic" },
  { code: "ar", name: "Arabic" },
  { code: "az", name: "Azerbaijani" },
  { code: "be", name: "Belarusian" },
  { code: "bg", name: "Bulgarian" },
  { code: "bn", name: "Bengali" },
  { code: "bs", name: "Bosnian" },
  { code: "ca", name: "Catalan" },
  { code: "ceb", name: "Cebuano" },
  { code: "cs", name: "Czech" },
  { code: "cy", name: "Welsh" },
  { code: "da", name: "Danish" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "en", name: "English" },
  { code: "eo", name: "Esperanto" },
  { code: "es", name: "Spanish" },
  { code: "et", name: "Estonian" },
  { code: "eu", name: "Basque" },
  { code: "fa", name: "Persian" },
  { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" },
  { code: "fy", name: "Frisian" },
  { code: "ga", name: "Irish" },
  { code: "gd", name: "Scottish Gaelic" },
  { code: "gl", name: "Galician" },
  { code: "gu", name: "Gujarati" },
  { code: "ha", name: "Hausa" },
  { code: "haw", name: "Hawaiian" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hmn", name: "Hmong" },
  { code: "hr", name: "Croatian" },
  { code: "ht", name: "Haitian Creole" },
  { code: "hu", name: "Hungarian" },
  { code: "hy", name: "Armenian" },
  { code: "id", name: "Indonesian" },
  { code: "ig", name: "Igbo" },
  { code: "is", name: "Icelandic" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "jw", name: "Javanese" },
  { code: "ka", name: "Georgian" },
  { code: "kk", name: "Kazakh" },
  { code: "km", name: "Khmer" },
  { code: "kn", name: "Kannada" },
  { code: "ko", name: "Korean" },
  { code: "ku", name: "Kurdish" },
  { code: "ky", name: "Kyrgyz" },
  { code: "la", name: "Latin" },
  { code: "lo", name: "Lao" },
  { code: "lt", name: "Lithuanian" },
  { code: "lv", name: "Latvian" },
  { code: "mg", name: "Malagasy" },
  { code: "mi", name: "Maori" },
  { code: "mk", name: "Macedonian" },
  { code: "ml", name: "Malayalam" },
  { code: "mn", name: "Mongolian" },
  { code: "mr", name: "Marathi" },
  { code: "ms", name: "Malay" },
  { code: "mt", name: "Maltese" },
  { code: "my", name: "Burmese" },
  { code: "ne", name: "Nepali" },
  { code: "nl", name: "Dutch" },
  { code: "no", name: "Norwegian" },
  { code: "ny", name: "Chichewa" },
  { code: "pa", name: "Punjabi" },
  { code: "pl", name: "Polish" },
  { code: "ps", name: "Pashto" },
  { code: "pt", name: "Portuguese" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "rw", name: "Kinyarwanda" },
  { code: "sd", name: "Sindhi" },
  { code: "si", name: "Sinhala" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "sm", name: "Samoan" },
  { code: "sn", name: "Shona" },
  { code: "so", name: "Somali" },
  { code: "sq", name: "Albanian" },
  { code: "sr", name: "Serbian" },
  { code: "st", name: "Sesotho" },
  { code: "su", name: "Sundanese" },
  { code: "sv", name: "Swedish" },
  { code: "sw", name: "Swahili" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "tg", name: "Tajik" },
  { code: "th", name: "Thai" },
  { code: "tk", name: "Turkmen" },
  { code: "tl", name: "Filipino" },
  { code: "tr", name: "Turkish" },
  { code: "tt", name: "Tatar" },
  { code: "ug", name: "Uyghur" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "uz", name: "Uzbek" },
  { code: "vi", name: "Vietnamese" },
  { code: "xh", name: "Xhosa" },
  { code: "yi", name: "Yiddish" },
  { code: "yo", name: "Yoruba" },
  { code: "zh", name: "Chinese" },
  { code: "zu", name: "Zulu" },
];

async function translateWithOpenAI(text, targetLanguage, apiKey) {
  const targetLanguageName = languageNames[targetLanguage] || targetLanguage;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a translator. Translate the following text to ${targetLanguageName}. Preserve formatting and tone. Only return the translated text without explanations.`,
          },
          {
            role: "user",
            content: text,
          },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error(
      "OpenAI translation error:",
      error.response?.data || error.message,
    );
    throw new Error(
      error.response?.data?.error?.message || "OpenAI translation failed",
    );
  }
}

async function translateWithGemini(text, targetLanguage, apiKey) {
  const targetLanguageName = languageNames[targetLanguage] || targetLanguage;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: `Translate the following text to ${targetLanguageName}. Only return the translated text without explanations:\n\n${text}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1000,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    return response.data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    logger.error(
      "Gemini translation error:",
      error.response?.data || error.message,
    );
    throw new Error(
      error.response?.data?.error?.message || "Gemini translation failed",
    );
  }
}

async function translateWithDeepseek(text, targetLanguage, apiKey) {
  const targetLanguageName = languageNames[targetLanguage] || targetLanguage;

  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are a translator. Translate the following text to ${targetLanguageName}. Preserve formatting and tone. Only return the translated text without explanations.`,
          },
          {
            role: "user",
            content: text,
          },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error(
      "Deepseek translation error:",
      error.response?.data || error.message,
    );
    throw new Error(
      error.response?.data?.error?.message || "Deepseek translation failed",
    );
  }
}

async function testMongoConnection(mongoUri) {
  let client;

  try {
    // Validate input
    if (!mongoUri || typeof mongoUri !== "string") {
      return {
        success: false,
        msg: "Invalid MongoDB connection string provided",
      };
    }

    // Create MongoDB client with connection options
    client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
      connectTimeoutMS: 10000,
    });

    // Attempt to connect
    await client.connect();

    // Verify connection by pinging the database
    await client.db("admin").command({ ping: 1 });

    return {
      success: true,
      msg: "MongoDB connection successful",
    };
  } catch (error) {
    // Handle different types of errors
    let errorMsg = "MongoDB connection failed: ";

    if (error.name === "MongoServerSelectionError") {
      errorMsg +=
        "Unable to reach MongoDB server. Check your connection string and network.";
    } else if (error.name === "MongoParseError") {
      errorMsg += "Invalid connection string format.";
    } else if (error.message.includes("authentication")) {
      errorMsg += "Authentication failed. Check your credentials.";
    } else {
      errorMsg += error.message;
    }

    return {
      success: false,
      msg: errorMsg,
    };
  } finally {
    // Always close the connection
    if (client) {
      try {
        await client.close();
      } catch (closeError) {
        logger.error("Error closing MongoDB connection:", closeError);
      }
    }
  }
}

let firebaseApp = null;

async function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  const [mb] = await query(`SELECT * FROM mobile_app`, []);
  const serviceAccount = JSON.parse(mb.fcmJson);

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return firebaseApp;
}

async function sendFCMNotification({
  token,
  title = "No title passed",
  body = "No body passed",
  data = {},
  imageUrl,
}) {
  try {
    await getFirebaseApp();

    const message = {
      token,
      notification: {
        title: title || "New Notification",
        body: body || "You have a new message",
        ...(imageUrl ? { image: imageUrl } : {}),
      },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)]),
      ),
      android: {
        priority: "high",
        ttl: 0,
        notification: {
          sound: "default",
          channelId: "default",
          priority: "max",
          ...(imageUrl ? { image: imageUrl } : {}),
        },
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: { aps: { sound: "default", contentAvailable: true } },
        fcm_options: imageUrl ? { image: imageUrl } : {},
      },
    };

    const response = await admin.messaging().send(message);
    return { success: true, response };
  } catch (err) {
    return { success: false, msg: err?.toString() };
  }
}

async function removeTokenFromAll(token) {
  // Remove from users
  const users = await query(
    `SELECT uid, fcm_data FROM user WHERE fcm_data LIKE ?`,
    [`%${token}%`],
  );

  for (const u of users) {
    let data;
    try {
      data = JSON.parse(u.fcm_data || "{}");
    } catch {
      data = {};
    }

    data.tokens = (data.tokens || []).filter((t) => t !== token);

    await query(`UPDATE user SET fcm_data = ? WHERE uid = ?`, [
      JSON.stringify(data),
      u.uid,
    ]);
  }

  // Remove from agents
  const agents = await query(
    `SELECT uid, fcm_data FROM agents WHERE fcm_data LIKE ?`,
    [`%${token}%`],
  );

  for (const a of agents) {
    let data;
    try {
      data = JSON.parse(a.fcm_data || "{}");
    } catch {
      data = {};
    }

    data.tokens = (data.tokens || []).filter((t) => t !== token);

    await query(`UPDATE agents SET fcm_data = ? WHERE uid = ?`, [
      JSON.stringify(data),
      a.uid,
    ]);
  }
}

function parseJson(data) {
  try {
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

async function getElevenLabsVoices({ apiKeys }) {
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: {
        "xi-api-key": apiKeys,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const data = await response.json();

    const voices = data?.voices?.map((i) => ({
      name: i.name,
      id: i.voice_id, // it's `voice_id` not `id`
      gender: i.labels?.gender || "unknown",
      url: i.preview_url,
    }));

    return {
      success: true,
      data: voices,
    };
  } catch (error) {
    return {
      success: false,
      msg: `Invalid keys provided or ${error?.toString()}`,
    };
  }
}

async function processImage({ sourcePath, savingPath, width, height }) {
  const resolvedSource = path.normalize(sourcePath); // ← normalize, not resolve
  const outputPath = path.normalize(savingPath); // ← same here
  const resolvedDir = path.dirname(outputPath);
  const ext = path.extname(outputPath).toLowerCase().replace(".", "");

  try {
    await fs.promises.access(resolvedSource);
  } catch {
    throw new Error(`Source file not found: ${resolvedSource}`);
  }

  await fs.promises.mkdir(resolvedDir, { recursive: true });
  logger.log(`📁 Created directory: ${resolvedDir}`);

  const resized = sharp(resolvedSource).resize(width, height, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  if (ext === "ico") {
    const { data, info } = await resized
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pngBuffer = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();

    const ICONDIR_SIZE = 6;
    const ICONDIRENTRY_SIZE = 16;
    const imageOffset = ICONDIR_SIZE + ICONDIRENTRY_SIZE;
    const header = Buffer.alloc(imageOffset);

    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt8(info.width >= 256 ? 0 : info.width, 6);
    header.writeUInt8(info.height >= 256 ? 0 : info.height, 7);
    header.writeUInt8(0, 8);
    header.writeUInt8(0, 9);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(pngBuffer.length, 14);
    header.writeUInt32LE(imageOffset, 18);

    await fs.promises.writeFile(outputPath, Buffer.concat([header, pngBuffer]));
  } else if (ext === "png") {
    await resized.png({ compressionLevel: 9 }).toFile(outputPath);
  } else if (ext === "jpg" || ext === "jpeg") {
    await resized.jpeg({ quality: 92 }).toFile(outputPath);
  } else if (ext === "webp") {
    await resized.webp({ quality: 90 }).toFile(outputPath);
  } else if (ext === "gif") {
    await resized.gif().toFile(outputPath);
  } else if (ext === "avif") {
    await resized.avif({ quality: 80 }).toFile(outputPath);
  } else if (ext === "tiff" || ext === "tif") {
    await resized.tiff().toFile(outputPath);
  } else if (ext === "bmp") {
    await resized.bmp().toFile(outputPath);
  } else {
    throw new Error(`Unsupported extension: .${ext}`);
  }

  logger.log(`✅ Saved: ${outputPath} [${width}×${height}] .${ext}`);
  return outputPath;
}

function serializeNodeSchema(nodeSchemas) {
  return nodeSchemas.map((n) => ({
    id: n.id,
    nodeType: n.nodeType,
    category: n.category,
    description: n.description,
    defaultMoveToNextNode: n.data?.moveToNextNode ?? false,
    dataShape: n.data,
  }));
}

function buildSystemPrompt(nodeSchemas) {
  const schemaStr = JSON.stringify(serializeNodeSchema(nodeSchemas), null, 2);

  return `You are an expert WhatsApp chatbot flow builder assistant.
Your job is to generate or modify a React Flow graph ({ nodes, edges }) based on user instructions.

## RULES
1. Always return ONLY valid JSON in this exact shape:
   { "nodes": [...], "edges": [...] }
   No markdown, no explanation, no code fences — raw JSON only.

2. Node structure:
   {
     "id": "<unique string>",
     "type": "<nodeType from schema>",
     "position": { "x": <number>, "y": <number> },
     "data": { ...fields matching the schema for that nodeType }
   }

3. Edge structure:
   {
     "id": "<unique string>",
     "source": "<nodeId>",
     "target": "<nodeId>",
     "sourceHandle": "<handleId or null>",
     "type": "smoothstep",
     "animated": false
   }

4. ALWAYS include the initialNode:
   {
     "id": "initialNode",
     "type": "INITIAL",
     "position": { "x": 100, "y": 300 },
     "data": { "whPhonePath": "" }
   }
   The first edge must go FROM "initialNode" to the first real node.

5. moveToNextNode: Use EXACTLY the defaultMoveToNextNode from the schema for each nodeType.
   NEVER override it unless the flow logic absolutely requires it.
   - false = node WAITS for user reply before continuing
   - true  = node continues automatically without waiting

6. Node positioning: lay nodes out left-to-right, x += 350 per step, y centered around 300.
   For branches (CONDITION), offset y by ±200 for each branch.

7. CONDITION nodes: each condition needs a unique targetNodeId (sourceHandle on the edge).
   Always include a "default" branch edge (sourceHandle: "default").

8. For SEND_MESSAGE nodes, always fill content with a placeholder message.

9. Keep node IDs short and descriptive: "msg_welcome", "cond_choice", "delay_1" etc.

## AVAILABLE NODE TYPES & SCHEMAS
${schemaStr}

## FLOW LOGIC GUIDE
- User sends message → INITIAL NODE (always first)
- To collect user input: SEND_MESSAGE (ask question) → RESPONSE_SAVER (save answer) → next step
- To branch: CONDITION node (moveToNextNode: true, runs immediately)
- To pause and wait for reply: SEND_MESSAGE with moveToNextNode: false
- To call API: MAKE_REQUEST (moveToNextNode: true)
- To add delay: DELAY node
- AI_TRANSFER: hands off to AI, stays there until function call routes back
`;
}

function buildUserPrompt(instruction, currentFlow, mode) {
  if (mode === "edit" && currentFlow) {
    return `You are EDITING an existing flow.

Current flow:
${JSON.stringify(currentFlow, null, 2)}

User instruction: "${instruction}"

Return the complete updated { nodes, edges } JSON.
Keep all existing nodes/edges unless the instruction says to remove them.
Maintain existing node IDs where possible.
Only change what the instruction asks for.`;
  }

  return `Create a new chatbot flow for this use case:

"${instruction}"

Return { nodes, edges } JSON following all the rules.`;
}

async function callOpenAI(apiKey, model, systemPrompt, userPrompt) {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    },
  );
  return response.data.choices[0].message.content;
}

async function callGemini(apiKey, model, systemPrompt, userPrompt) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4000,
      responseMimeType: "application/json",
    },
    systemInstruction: { parts: [{ text: systemPrompt }], role: "system" },
  });

  const chat = geminiModel.startChat({ history: [] });
  const result = await chat.sendMessage(userPrompt);
  return result.response.text();
}

async function callDeepSeek(apiKey, model, systemPrompt, userPrompt) {
  const response = await axios.post(
    "https://api.deepseek.com/v1/chat/completions",
    {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    },
  );
  return response.data.choices[0].message.content;
}

async function handleWAFormSubmission(change, userUID) {
  try {
    const messages = change.value?.messages || [];

    for (const message of messages) {
      if (
        message?.type === "interactive" &&
        message?.interactive?.type === "nfm_reply"
      ) {
        const fromPhone = message.from;
        const responseJson = message.interactive.nfm_reply?.response_json;

        let payload = {};
        try {
          payload = JSON.parse(responseJson);
        } catch {
          payload = {};
        }

        // Match form by flow_token embedded in payload
        // flow_token format: "TOKEN_<timestamp>_<flow_id>" or just match by uid + flow_id
        const flowToken = payload?.flow_token || "";

        // Try to find the form by matching flow_id from wa_forms
        // We stored flow_token as "TOKEN_<Date.now()>" so we can't reverse it,
        // but we CAN match by uid — get all forms and find by flow_token prefix if needed
        // Best approach: match the most recent form submission by uid
        // (or store flow_token → flow_id mapping — see note below)
        const forms = await query(`SELECT * FROM wa_forms WHERE uid = ?`, [
          userUID,
        ]);

        // Try to match flow_id from payload flow_token if you encoded it,
        // otherwise fall back to most recent form
        let matchedForm = null;

        // If you want exact matching, encode flow_id in the token (see backend note below)
        // For now, scan forms to find a match via flow_token pattern
        for (const f of forms) {
          if (flowToken.includes(f.flow_id)) {
            matchedForm = f;
            break;
          }
        }

        // Fallback: most recently used form
        if (!matchedForm && forms.length > 0) {
          matchedForm = forms[forms.length - 1];
        }

        // ✅ Only store uid, flow_id, form_name, from_phone, raw_payload
        await query(
          `INSERT INTO wa_form_submissions 
            (uid, flow_id, form_name, from_phone, raw_payload, createdAt)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [
            userUID,
            matchedForm?.flow_id || null,
            matchedForm?.name || null,
            fromPhone,
            JSON.stringify(payload),
          ],
        );
      }
    }
  } catch (err) {
    logger.error("❌ handleWAFormSubmission error:", err);
  }
}

async function patchIndexHtml({
  app_name = "",
  site_name = "",
  meta_title = "",
  meta_description = "",
  meta_keywords = "",
  og_title = "",
  og_description = "",
  og_image = "",
  logo = "",
  write = true,
} = {}) {
  const indexPath = path.join(__dirname, "../client/public/index.html");

  try {
    await fs.promises.access(indexPath);
  } catch {
    logger.warn("⚠️  index.html not found at:", indexPath);
    return "";
  }

  let html = await fs.promises.readFile(indexPath, "utf8");

  // ── Resolve final values ────────────────────────────────────────
  const resolvedSiteName = escapeHtml(site_name || app_name);
  const resolvedTitle = escapeHtml(meta_title || app_name);
  const resolvedDesc = escapeHtml(meta_description);
  const resolvedKeywords = escapeHtml(meta_keywords);
  const resolvedOgTitle = escapeHtml(og_title || meta_title || app_name);
  const resolvedOgDesc = escapeHtml(og_description || meta_description);
  const resolvedImagePath = og_image
    ? `/media/${og_image}`
    : logo
      ? `/media/${logo}`
      : "";

  // ── Build injection block ───────────────────────────────────────
  const metaTags = `
    <!-- ── Server Injected Meta ── -->
    ${resolvedTitle ? `<title>${resolvedTitle}</title>` : ""}
    ${resolvedTitle ? `<meta name="title"            content="${resolvedTitle}" />` : ""}
    ${resolvedDesc ? `<meta name="description"      content="${resolvedDesc}" />` : ""}
    ${resolvedKeywords ? `<meta name="keywords"         content="${resolvedKeywords}" />` : ""}
    ${resolvedTitle ? `<meta name="application-name" content="${resolvedTitle}" />` : ""}
    ${resolvedTitle ? `<meta name="apple-mobile-web-app-title" content="${resolvedTitle}" />` : ""}

    <!-- Open Graph -->
    <meta property="og:type"        content="website" />
    ${resolvedOgTitle ? `<meta property="og:title"       content="${resolvedOgTitle}" />` : ""}
    ${resolvedOgDesc ? `<meta property="og:description" content="${resolvedOgDesc}" />` : ""}
    ${resolvedImagePath ? `<meta property="og:image"       content="${resolvedImagePath}" />` : ""}
    ${resolvedSiteName ? `<meta property="og:site_name"   content="${resolvedSiteName}" />` : ""}

    <!-- Twitter Card -->
    <meta name="twitter:card"        content="summary_large_image" />
    ${resolvedOgTitle ? `<meta name="twitter:title"       content="${resolvedOgTitle}" />` : ""}
    ${resolvedOgDesc ? `<meta name="twitter:description" content="${resolvedOgDesc}" />` : ""}
    ${resolvedImagePath ? `<meta name="twitter:image"       content="${resolvedImagePath}" />` : ""}
    <!-- ── End Injected ── -->
  `;

  // ── Strip old tags, inject before </head> ───────────────────────
  html = html.replace(/<title>.*?<\/title>/is, "");
  html = html.replace(
    /<!--\s*──\s*Server Injected Meta[\s\S]*?End Injected\s*──\s*-->/i,
    "",
  ); // idempotent re-runs
  html = html.replace("</head>", `${metaTags}\n</head>`);

  if (write) {
    await fs.promises.writeFile(indexPath, html, "utf8");
    logger.log("✅ index.html meta tags patched");
  }

  return html;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Replaces an existing <meta> tag that contains `attrSnippet`,
 * or inserts the new tag before </head> if not found.
 */
function replaceOrInsertMeta(html, attrSnippet, newTag) {
  // Match the full <meta ... /> or <meta ...> line containing the attribute
  const regex = new RegExp(
    `<meta[^>]*${escapeRegex(attrSnippet)}[^>]*/?>`,
    "i",
  );

  if (regex.test(html)) {
    return html.replace(regex, newTag);
  }

  // Not found — insert before </head>
  return html.replace("</head>", `  ${newTag}\n</head>`);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  serializeNodeSchema,
  buildSystemPrompt,
  buildUserPrompt,
  callOpenAI,
  callGemini,
  callDeepSeek,
  removeTokenFromAll,
  sendFCMNotification,
  translateWithOpenAI,
  translateWithGemini,
  translateWithDeepseek,
  formatPhoneNumber,
  sendTemplateMessage,
  isValidEmail,
  downloadAndExtractFile,
  folderExists,
  sendAPIMessage,
  sendEmail,
  getUserPlayDays,
  getNumberOfDaysFromTimestamp,
  getUserOrderssByMonth,
  getUserSignupsByMonth,
  validateEmail,
  updateUserPlan,
  getFileInfo,
  uploadFileMeta,
  getMetaNumberDetail,
  getSessionUploadMediaMeta,
  sendMetaMsg,
  updateMetaTempletInMsg,
  sendMetatemplet,
  delMetaTemplet,
  getAllTempletsMeta,
  createMetaTemplet,
  getBusinessPhoneNumber,
  mergeArrays,
  getCurrentTimestampInTimeZone,
  areMobileNumbersFilled,
  getFileExtension,
  executeQueries,
  fetchProfileFun,
  returnWidget,
  generateWhatsAppURL,
  makeRequest,
  replacePlaceholders,
  rzCapturePayment,
  validateFacebookToken,
  addObjectToFile,
  extractFileName,
  checkWarmerPlan,
  saveMessageToConversation,
  makeRequestBeta,
  sendEmailBeta,
  executeMySQLQuery,
  getAllTempletsMetaBeta,
  extractTemplateVariablesBeta,
  getRecentMessages,
  suggestReplyWithOpenAI,
  suggestReplyWithGemini,
  suggestReplyWithDeepseek,
  testMongoConnection,
  parseJson,
  getElevenLabsVoices,
  processImage,
  handleWAFormSubmission,
  patchIndexHtml,
};
