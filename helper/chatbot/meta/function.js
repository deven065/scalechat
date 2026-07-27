const { query } = require("../../../database/dbpromise");
const {
  getCurrentTimestampInTimeZone,
  addObjectToFile,
} = require("../../../functions/function");
const fetch = require("node-fetch");

function findTargetNodes(nodes, edges, incomingWord) {
  const matchingEdges = edges.filter(
    (edge) => edge.sourceHandle === incomingWord
  );
  const targetNodeIds = matchingEdges.map((edge) => edge.target);
  const targetNodes = nodes.filter((node) => targetNodeIds.includes(node.id));
  return targetNodes;
}

function timeoutPromise(promise, ms) {
  const timeout = new Promise(
    (resolve) => setTimeout(() => resolve(null), ms) // Instead of rejecting, resolve null
  );
  return Promise.race([promise, timeout]);
}

function checkAssignAi(nodes) {
  try {
    const check = nodes.filter((x) => x?.data?.msgContent?.assignAi === true);
    return check?.length > 0 ? check : [];
  } catch (err) {
    console.log(err);
    return [];
  }
}

function getReply(nodes, edges, incomingWord) {
  const getNormal = findTargetNodes(nodes, edges, incomingWord);
  // console.dir(
  //   {
  //     getNormal,
  //     incomingWord,
  //   },
  //   { depth: null }
  // );
  if (getNormal.length > 0) {
    return getNormal;
  } else if (checkAssignAi(nodes)?.length > 0) {
    const findAiNodes = checkAssignAi(nodes);
    return findAiNodes;
  } else {
    const getOther = findTargetNodes(nodes, edges, "{{OTHER_MSG}}");
    return getOther;
  }
}

function convertNumberToRandomString(number) {
  const mapping = {
    0: "i",
    1: "j",
    2: "I",
    3: "u",
    4: "I",
    5: "U",
    6: "S",
    7: "D",
    8: "B",
    9: "j",
  };

  const numStr = number.toString();
  let result = "";
  for (let i = 0; i < numStr.length; i++) {
    const digit = numStr[i];
    result += mapping[digit];
  }
  return result;
}

function extractFileName(url) {
  try {
    const decodedUrl = decodeURIComponent(url.split("?")[0]); // Remove query params
    return decodedUrl.substring(decodedUrl.lastIndexOf("/") + 1);
  } catch (error) {
    console.error("Error extracting file name:", error.message);
    return null;
  }
}

function setQrMsgObj(obj) {
  console.dir({ obj }, { depth: null });
  if (!obj || typeof obj !== "object") return null;

  switch (obj.type) {
    case "text":
      return { text: obj.text?.body || "" };
    case "image":
      return {
        image: {
          url: obj?.image?.link,
        },
        caption: obj?.image?.caption || null,
        // jpegThumbnail: fetchImageAsBase64(obj?.image?.link),
      };

    case "video":
      return {
        video: {
          url: obj?.video?.link,
        },
        caption: obj?.video?.caption || null,
      };

    case "audio":
      const mp3FileName = extractFileName(obj?.audio?.link);
      const mp3FilePath = `${__dirname}/../../client/public/media/${mp3FileName}`;

      return {
        audio: {
          url: mp3FilePath,
        },
        ptt: true,
        mimetype: "audio/aac",
      };

    case "document":
      return {
        document: {
          url: obj?.document?.link,
        },
        caption: obj?.document?.caption || null,
        fileName: extractFileName(obj?.document?.link),
      };

    case "location":
      return {
        location: {
          degreesLatitude: obj?.location?.latitude,
          degreesLongitude: obj?.location?.longitude,
          name: obj?.location?.name,
        },
      };

    default:
      return null;
  }
}

function getOriginData(chatbotFromMysq) {
  try {
    const origin = JSON.parse(chatbotFromMysq?.origin);
    return { success: origin?.code === "META" ? false : true, data: origin };
  } catch (err) {
    return { success: false, data: {} };
  }
}

function sendMetaMsgCloud({ uid, msgObj, toNumber, savObj, chatId }) {
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
          getUser[0]?.timezone || Date.now() / 1000
        );
        const finalSaveMsg = {
          ...savObj,
          metaChatId: data?.messages[0]?.id,
          timestamp: userTimezone,
        };

        const chatPath = `${__dirname}/../../../conversations/inbox/${uid}/${chatId}.json`;

        console.log({ chatPath });

        addObjectToFile(finalSaveMsg, chatPath);

        await query(
          `UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ?`,
          [userTimezone, JSON.stringify(finalSaveMsg), 1, chatId]
        );

        await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [
          1,
          chatId,
        ]);
      }

      resolve({ success: true });
    } catch (err) {
      resolve({ success: false, msg: err.toString(), err });
      console.log(err);
    }
  });
}

async function sendQrMsg({
  uid,
  msgObj,
  toNumber,
  savObj,
  chatId,
  chatbotFromMysq,
  originData,
}) {
  try {
    const normalizeQrMsg = setQrMsgObj(msgObj);
    const sessionId = originData?.data?.code;

    if (!sessionId) {
      return {
        success: false,
        msg: `Session was not found for the instance: ${originData?.data?.title}`,
      };
    }

    // importing things
    const {
      getSession,
      formatGroup,
      formatPhone,
    } = require("../../../helper/addon/qr");

    const session = await timeoutPromise(getSession(sessionId || "a"), 60000);
    if (!session) {
      return { success: false, msg: "Session not found locally within 60 sec" };
    }

    const jid = formatPhone(toNumber);
    const send = await timeoutPromise(
      session?.sendMessage(jid, normalizeQrMsg),
      60000
    );
    const msgId = send?.key?.id;

    if (!msgId) {
      return {
        success: false,
        msg: `Could not send message: ${send?.toString()}`,
      };
    } else {
      const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);

      const userTimezone = getCurrentTimestampInTimeZone(
        getUser[0]?.timezone || Date.now() / 1000
      );
      const finalSaveMsg = {
        ...savObj,
        metaChatId: msgId,
        timestamp: userTimezone,
      };

      // console.log({ chatId });
      const chatIdNew = `${toNumber}_${originData?.data?.code}`;

      const chatPath = `${__dirname}/../../../conversations/inbox/${uid}/${chatIdNew}.json`;

      addObjectToFile(finalSaveMsg, chatPath);

      await query(
        `UPDATE chats SET last_message_came = ?, last_message = ?, is_opened = ? WHERE chat_id = ?`,
        [userTimezone, JSON.stringify(finalSaveMsg), 1, chatIdNew]
      );

      await query(`UPDATE chats SET is_opened = ? WHERE chat_id = ?`, [
        1,
        chatIdNew,
      ]);
    }
  } catch (err) {
    console.log(err);
    return { success: false, msg: err.toString(), err };
  }
}

async function sendMetaMsg({
  uid,
  msgObj,
  toNumber,
  savObj,
  chatId,
  chatbotFromMysq,
}) {
  try {
    const originData = getOriginData(chatbotFromMysq);

    // console.log({ originData: originData.data });

    if (originData?.success) {
      // console.log("SEND QR MSG");
      const sendBaileysApi = await sendQrMsg({
        uid,
        msgObj,
        toNumber,
        savObj,
        chatId,
        chatbotFromMysq,
        originData,
      });
      // sendBaileysApi && console.log({ sendBaileysApi });
      return sendBaileysApi;
    } else {
      const sendCloudApi = await sendMetaMsgCloud({
        uid,
        msgObj,
        toNumber,
        savObj,
        chatId,
        chatbotFromMysq,
        originData,
      });
      // sendCloudApi && console.log({ sendCloudApi });
      return sendCloudApi;
    }
  } catch (err) {
    console.log(err);
    return {
      success: false,
      msg: err.toString(),
      err,
    };
  }
}

module.exports = {
  checkAssignAi,
  findTargetNodes,
  getReply,
  convertNumberToRandomString,
  sendMetaMsg,
  sendQrMsg,
};
