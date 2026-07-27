const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const aiTransferHandler = async (
  inputData,
  conversationHistory,
  // Default config messageReferenceCount to a sensible number if not provided,
  // or handle 0 as "all history"
  config = { messageReferenceCount: 10 } // Default to last 10, can be overridden by inputData.messageReferenceCount
) => {
  const validateInput = (input) => {
    if (!input?.provider?.id || !input?.model?.id || !input?.apiKey) {
      console.error(
        "Validation Error: Missing provider.id, model.id, or apiKey"
      );
      return false;
    }
    return true;
  };

  const formatConversationHistory = (history, msgRefCount) => {
    if (!history || !Array.isArray(history)) return [];

    const formatted = history
      .filter((msg) => msg.type === "text" && msg.msgContext)
      .map((msg) => {
        try {
          // Ensure msgContext is parsed correctly, even if it's already an object
          const context =
            typeof msg.msgContext === "string"
              ? JSON.parse(msg.msgContext)
              : msg.msgContext;
          const content = context?.text?.body;
          if (!content) return null;
          return {
            role: msg.route === "INCOMING" ? "user" : "assistant",
            content: content,
          };
        } catch (e) {
          console.error("Error parsing msgContext:", msg.msgContext, e);
          return null;
        }
      })
      .filter(Boolean);

    if (msgRefCount > 0) {
      return formatted.slice(-msgRefCount);
    }
    return formatted; // Return all formatted messages if msgRefCount is 0 or less
  };

  // --- OpenAI Tool/Function Generation ---
  const generateOpenAITools = (functions) => {
    if (!functions || functions.length === 0) return undefined;
    return functions.map((func) => ({
      type: "function",
      function: {
        name: func.id, // Use the unique ID as the function name for the API
        description: func.name, // Use the descriptive name as the description
        parameters: func.parameters || {
          // Allow passing parameters schema if available
          type: "object",
          properties: {},
          required: [],
        },
      },
    }));
  };

  // --- Gemini Tool/Function Generation ---
  const generateGeminiTools = (functions) => {
    if (!functions || functions.length === 0) return undefined;
    return [
      {
        // Gemini expects a 'tools' array with a single object containing functionDeclarations
        functionDeclarations: functions.map((func) => ({
          name: func.id, // Use the unique ID as the function name for the API
          description: func.name, // Use the descriptive name as the description
          parameters: func.parameters || {
            // Allow passing parameters schema if available
            type: "OBJECT", // Gemini uses uppercase
            properties: {},
            // required: [], // Define if necessary
          },
        })),
      },
    ];
  };

  // --- DeepSeek Function Generation (older OpenAI style) ---
  const generateDeepSeekFunctions = (functions) => {
    if (!functions || functions.length === 0) return undefined;
    return functions.map((func) => ({
      name: func.id, // Use the unique ID as the function name for the API
      description: func.name, // Use the descriptive name as the description
      parameters: func.parameters || {
        type: "object",
        properties: {},
        required: [],
      },
    }));
  };

  const processOpenAI = async (currentInputData, history) => {
    const messages = [
      { role: "system", content: currentInputData.systemPrompt },
    ];
    history.forEach((msg) => {
      messages.push({ role: msg.role, content: msg.content });
    });

    const body = {
      model: currentInputData.model.id,
      messages,
      temperature: currentInputData.temperature,
      max_tokens: currentInputData.maxTokens,
    };

    if (
      currentInputData.aiTask?.active &&
      currentInputData.aiTask.functions?.length > 0
    ) {
      const tools = generateOpenAITools(currentInputData.aiTask.functions);
      if (tools) {
        body.tools = tools;
        body.tool_choice = "auto";
      }
    }

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        body,
        {
          headers: {
            Authorization: `Bearer ${currentInputData.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const choice = response.data.choices[0].message;
      const result = {
        content: choice.content || "",
        functionCalls: [],
      };

      if (choice.tool_calls) {
        result.functionCalls = choice.tool_calls.map((toolCall) => {
          const originalFunction = currentInputData.aiTask.functions.find(
            (f) => f.id === toolCall.function.name
          );
          return {
            tool_call_id: toolCall.id, // OpenAI specific tool call identifier
            id: originalFunction ? originalFunction.id : toolCall.function.name, // Your function definition ID
            name: originalFunction ? originalFunction.name : "Unknown Function", // Your descriptive function name
            arguments: JSON.parse(toolCall.function.arguments),
          };
        });
      }
      return result;
    } catch (error) {
      console.error("OpenAI API Error:", error.response?.data || error.message);
      const errorMessage =
        error.response?.data?.error?.message ||
        error.message ||
        "OpenAI API request failed";
      return { content: null, functionCalls: [], error: true, errorMessage };
    }
  };

  const processGemini = async (currentInputData, history) => {
    const genAI = new GoogleGenerativeAI(currentInputData.apiKey);
    const geminiTools =
      currentInputData.aiTask?.active &&
      currentInputData.aiTask.functions?.length > 0
        ? generateGeminiTools(currentInputData.aiTask.functions)
        : undefined;

    const modelParams = {
      model: currentInputData.model.id,
      generationConfig: {
        temperature: currentInputData.temperature,
        maxOutputTokens: currentInputData.maxTokens,
      },
      systemInstruction: {
        parts: [{ text: currentInputData.systemPrompt }],
        role: "system",
      },
    };
    if (geminiTools) {
      modelParams.tools = geminiTools;
    }
    const model = genAI.getGenerativeModel(modelParams);

    const geminiHistory = history.map((msg) => ({
      role: msg.role === "user" ? "user" : "model", // Gemini uses "model" for assistant
      parts: [{ text: msg.content }],
    }));

    // The last message in history is considered the current prompt to the model
    const lastUserMessage =
      geminiHistory.length > 0 &&
      geminiHistory[geminiHistory.length - 1].role === "user"
        ? geminiHistory[geminiHistory.length - 1].parts[0].text
        : geminiHistory.length > 0
        ? geminiHistory[geminiHistory.length - 1].parts[0].text
        : "Hello"; // Or handle case where history might be empty or end with assistant

    if (
      geminiHistory.length === 0 &&
      !lastUserMessage &&
      currentInputData.systemPrompt
    ) {
      // If history is empty and no specific user message, can use system prompt to initiate if needed,
      // though typically a user message should be present.
      // For now, we assume lastUserMessage or history will provide the prompt.
    }

    try {
      const chat = model.startChat({ history: geminiHistory });
      const response = await chat.sendMessage(
        lastUserMessage || currentInputData.systemPrompt
      ); // Send the last message or system prompt if no history

      let textContent = "";
      const calledFunctions = [];
      const fullResponse = response.response;

      if (fullResponse.candidates && fullResponse.candidates.length > 0) {
        const candidate = fullResponse.candidates[0];
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              textContent += part.text;
            }
            if (part.functionCall) {
              const originalFunction = currentInputData.aiTask.functions.find(
                (f) => f.id === part.functionCall.name
              );
              calledFunctions.push({
                id: originalFunction
                  ? originalFunction.id
                  : part.functionCall.name,
                name: originalFunction
                  ? originalFunction.name
                  : "Unknown Function",
                arguments: part.functionCall.args,
              });
            }
          }
        }
      } else {
        textContent = fullResponse.text?.() || ""; // Fallback for simpler text responses
      }

      return {
        content: textContent.trim(),
        functionCalls: calledFunctions,
      };
    } catch (error) {
      console.error("Gemini API Error:", error.message, error.stack);
      const errorMessage = error.message || "Gemini API request failed";
      return { content: null, functionCalls: [], error: true, errorMessage };
    }
  };

  const processDeepSeek = async (currentInputData, history) => {
    const messages = [
      { role: "system", content: currentInputData.systemPrompt },
    ];
    history.forEach((msg) => {
      messages.push({ role: msg.role, content: msg.content });
    });

    const body = {
      model: currentInputData.model.id,
      messages,
      temperature: currentInputData.temperature,
      max_tokens: currentInputData.maxTokens,
    };

    if (
      currentInputData.aiTask?.active &&
      currentInputData.aiTask.functions?.length > 0
    ) {
      const dsFunctions = generateDeepSeekFunctions(
        currentInputData.aiTask.functions
      );
      if (dsFunctions) {
        body.functions = dsFunctions;
        // Deepseek might support function_choice: "auto" or similar, check their docs.
      }
    }

    try {
      const response = await axios.post(
        "https://api.deepseek.com/v1/chat/completions",
        body,
        {
          headers: {
            Authorization: `Bearer ${currentInputData.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const choice = response.data.choices[0].message;
      const result = {
        content: choice.content || "",
        functionCalls: [],
      };

      if (choice.function_call) {
        const originalFunction = currentInputData.aiTask.functions.find(
          (f) => f.id === choice.function_call.name
        );
        result.functionCalls = [
          {
            id: originalFunction
              ? originalFunction.id
              : choice.function_call.name,
            name: originalFunction ? originalFunction.name : "Unknown Function",
            arguments: JSON.parse(choice.function_call.arguments),
          },
        ];
      }
      return result;
    } catch (error) {
      console.error(
        "DeepSeek API Error:",
        error.response?.data || error.message
      );
      const errorMessage =
        error.response?.data?.error?.message ||
        error.message ||
        "DeepSeek API request failed";
      return { content: null, functionCalls: [], error: true, errorMessage };
    }
  };

  // --- Main Handler Logic ---
  if (!validateInput(inputData)) {
    return {
      success: false,
      message: "Invalid input data: Missing provider, model, or API key.",
    };
  }

  // Use messageReferenceCount from inputData if present, otherwise from default config
  const messageCount =
    typeof inputData.messageReferenceCount === "number"
      ? inputData.messageReferenceCount
      : config.messageReferenceCount;

  const formattedHistory = formatConversationHistory(
    conversationHistory,
    messageCount
  );

  let result;
  try {
    switch (inputData.provider.id.toLowerCase()) {
      case "openai":
        result = await processOpenAI(inputData, formattedHistory);
        break;
      case "gemini":
        result = await processGemini(inputData, formattedHistory);
        break;
      case "deepseek":
        result = await processDeepSeek(inputData, formattedHistory);
        break;
      default:
        return { success: false, message: "Unsupported AI provider" };
    }

    if (result.error) {
      return {
        success: false,
        message: result.errorMessage || "AI processing failed.",
      };
    }

    return {
      success: true,
      data: {
        message: result.content,
        function:
          result.functionCalls?.length > 0 ? result.functionCalls : null,
      },
    };
  } catch (e) {
    console.error("General aiTransferHandler Error:", e);
    return {
      success: false,
      message: `An unexpected error occurred: ${e.message}`,
    };
  }
};

module.exports = { aiTransferHandler };
