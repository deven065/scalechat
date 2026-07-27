const fetch = require("node-fetch");
const fs = require("fs");

function readJSONFile(filePath, length) {
  try {
    console.log("HEY");
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      console.error("File not found:", filePath);
      return []; // Return empty array if file does not exist
    }

    // Read the file content
    let fileContent = fs.readFileSync(filePath, "utf8");

    // }\n]  }\n]

    if (fileContent?.endsWith("}\n]  }\n]")) {
      console.log("FOUND ENDS");
      console.log("Invalid JSON found, making it correct");
      fileContent = fileContent.replace("}\n]  }\n]", "\n}\n]");
      console.log("Correction done!");

      // Write the corrected JSON back to the file
      fs.writeFileSync(filePath, fileContent, "utf8");
      console.log("Corrected JSON has been written to the file");
    }

    // Remove invalid trailing characters if they exist
    if (fileContent?.endsWith("}\n]\n}\n]")) {
      console.log("FOUND ENDS");
      console.log("Invalid JSON found, making it correct");
      fileContent = fileContent.replace("}\n]\n}\n]", "\n}\n]");
      console.log("Correction done!");

      // Write the corrected JSON back to the file
      fs.writeFileSync(filePath, fileContent, "utf8");
      console.log("Corrected JSON has been written to the file");
    }

    // Try to parse the JSON
    let jsonArray;
    try {
      jsonArray = JSON.parse(fileContent);
    } catch (error) {
      console.error("Initial JSON parse error:", error.message);
      return []; // Return empty array if JSON is not valid
    }

    // Check if the parsed content is an array
    if (!Array.isArray(jsonArray)) {
      console.error("Invalid JSON format: not an array");
      return []; // Return empty array if JSON is not an array
    }

    // If length is provided, return only specified number of latest objects
    if (typeof length === "number" && length > 0) {
      return jsonArray.slice(-length);
    }

    return jsonArray; // Return all objects if length is not provided or invalid
  } catch (error) {
    console.error("Error reading JSON file:", error);
    return []; // Return empty array if there's an error
  }
}

function findTaskById(nodes, searchId) {
  // Iterate over each node in the nodes array
  for (const node of nodes) {
    // Check if the node has a taskArr property
    if (node.data?.msgContent?.taskArr) {
      // Look for the task with the matching ID
      const task = node.data.msgContent.taskArr.find(
        (task) => task.id === searchId
      );

      // If a matching task is found, return it
      if (task) {
        return task;
      }
    }
  }

  // Return null if no matching task is found
  return null;
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

function returnAfterAddingVariable(msgContent, response) {
  let returnObj;
  if (msgContent.type == "text") {
    returnObj = {
      type: "text",
      text: {
        preview_url: true,
        body: replacePlaceholders(msgContent?.text?.body, response),
      },
    };
  } else if (msgContent.type == "video") {
    returnObj = {
      type: "video",
      video: {
        link: replacePlaceholders(msgContent?.video?.link, response),
        caption: replacePlaceholders(msgContent?.video?.caption, response),
      },
    };
  } else if (
    msgContent.type == "interactive" &&
    msgContent?.interactive?.type == "list"
  ) {
    returnObj = {
      type: "interactive",
      interactive: {
        type: "list",
        header: {
          type: "text",
          text: replacePlaceholders(
            msgContent.interactive.header.text,
            response
          ),
        },
        body: {
          text: replacePlaceholders(msgContent.interactive.body.text, response),
        },
        footer: {
          text: replacePlaceholders(
            msgContent.interactive.footer.text,
            response
          ),
        },
        action: msgContent.interactive.action,
      },
    };
  } else if (msgContent.type == "image") {
    returnObj = {
      type: "image",
      image: {
        link: replacePlaceholders(msgContent.image.link, response),
        caption: replacePlaceholders(msgContent.image.caption, response),
      },
    };
  } else if (msgContent.type == "document") {
    returnObj = {
      type: "document",
      document: {
        link: replacePlaceholders(msgContent.document.link, response),
        caption: replacePlaceholders(msgContent.document.caption, response),
      },
    };
  } else if (
    msgContent.type == "interactive" &&
    msgContent.interactive.type == "button"
  ) {
    returnObj = {
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: replacePlaceholders(msgContent.interactive.body.text, response),
        },
        action: msgContent.interactive.action,
      },
    };
  } else if (msgContent.type == "audio") {
    returnObj = {
      type: "audio",
      audio: {
        link: replacePlaceholders(msgContent.audio.link, response),
      },
    };
  }
  return returnObj;
}

function openAiResponse({
  openAiKey,
  msgArr,
  functionArr,
  allowTask,
  openAiModel,
}) {
  return new Promise(async (resolve) => {
    try {
      const url = "https://api.openai.com/v1/chat/completions";
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      };

      // Prepare the request body
      const body = {
        model: openAiModel,
        messages: msgArr,
        ...(functionArr?.length > 0 &&
          allowTask && {
            functions: functionArr,
            function_call: "auto",
          }),
      };

      const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body),
      });

      const responseData = await response.json();

      if (responseData?.error || responseData?.choices?.length < 1) {
        resolve({
          success: false,
          msg: responseData?.error?.message || "Error found in OpenAI keys",
        });
      } else {
        resolve({
          success: true,
          msg: responseData.choices[0].message?.content,
          function:
            responseData.choices[0].message?.function_call?.name || false,
        });
      }
    } catch (err) {
      console.log(`Error found in openAiResponse() ai.js`, err);
      resolve({
        success: false,
        msg: "An error occurred while processing the request.",
      });
    }
  });
}

function returnMsgArr({
  dirPath,
  lengthNum,
  trainData,
  functionArr,
  allowTask,
  nodes,
}) {
  const data = readJSONFile(dirPath, lengthNum || 2);

  const filterOnlyText = data?.filter((x) => x.type == "text");

  const filterArr = filterOnlyText.map((i) => {
    return {
      role: i?.route === "INCOMING" ? "user" : "assistant",
      content: i?.type === "text" ? i?.msgContext?.text?.body ?? "" : "",
    };
  });

  const trainObj = {
    role: "system",
    content: trainData || "You are helpful assistant",
  };

  const actualMessage = [trainObj, ...filterArr];

  const correctFunctionArr = allowTask
    ? functionArr.map((x) => {
        return {
          name: findTaskById(nodes, x.id).id,
          description: findTaskById(nodes, x.id).text,
        };
      })
    : null;

  return { msgArr: actualMessage, funArr: correctFunctionArr };
}

function getOriginData(chatbotFromMysq) {
  try {
    const origin = JSON.parse(chatbotFromMysq?.origin);
    return { success: origin?.code === "META" ? false : true, data: origin };
  } catch (err) {
    return { success: false, data: {} };
  }
}

async function singleReplyAi({
  uid,
  k,
  chatbotFromMysq,
  toName,
  senderNumber,
  sendMetaMsg,
  chatId,
  nodes,
  edges,
  incomingMsg,
  destributeTaskFlow,
}) {
  try {
    // delay so that concersatio get saved
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const originData = getOriginData(chatbotFromMysq);

    if (originData?.success) {
      chatId = `${senderNumber}_${originData?.data?.code}`;
    } else {
      chatId = chatId;
    }

    const dirPath = `${__dirname}/../conversations/inbox/${uid}/${chatId}.json`;

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const { msgArr, funArr } = returnMsgArr({
      dirPath: dirPath,
      allowTask: k?.data?.msgContent?.allowTask,
      functionArr: k?.data?.msgContent?.taskArr,
      lengthNum: k?.data?.msgContent?.history || 2,
      trainData: k?.data?.msgContent?.trainText,
      nodes,
    });

    const resp = await openAiResponse({
      openAiKey: k?.data?.msgContent?.keys,
      allowTask: k?.data?.msgContent?.allowTask,
      functionArr: funArr,
      msgArr: msgArr,
      openAiModel: k?.data?.msgContent?.aiMode,
    });

    // when found function hit
    if (resp?.function) {
      const findEdgeWithFuntionName = edges?.filter(
        (x) => x.sourceHandle == resp?.function
      );
      if (findEdgeWithFuntionName?.length) {
        for (const f of findEdgeWithFuntionName) {
          const targetId = f?.target;
          const findNode = nodes?.filter((x) => x.id == targetId);
          if (findNode?.length > 0) {
            for (const k of findNode) {
              await destributeTaskFlow({
                uid,
                k,
                chatbotFromMysq,
                toName,
                senderNumber,
                sendMetaMsg,
                chatId,
                nodes,
                edges,
                incomingMsg,
                once: true,
              });
            }
          }
        }
      }
    }

    // when found some message to send
    if (resp?.msg) {
      const msgObj = {
        type: "text",
        text: {
          preview_url: true,
          body: resp?.msg,
        },
      };

      const saveObj = {
        type: "text",
        metaChatId: "",
        msgContext: msgObj,
        reaction: "",
        timestamp: "",
        senderName: toName,
        senderMobile: senderNumber,
        status: "sent",
        star: false,
        route: "OUTGOING",
      };

      await sendMetaMsg({
        uid: uid,
        msgObj: msgObj,
        toNumber: senderNumber,
        savObj: saveObj,
        chatId: chatId,
        chatbotFromMysq: chatbotFromMysq,
      });
    }

    // console.log({ resp: JSON.stringify(resp) });
  } catch (err) {
    console.log(`error found in singleReplyAi ai.js`, err);
  }
}

module.exports = { singleReplyAi };
