require("dotenv").config({ silent: true });
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const fileUpload = require("express-fileupload");
const nodeCleanup = require("node-cleanup");
const { initCampaign } = require("./loops/campaignBeta.js");
const { init, cleanup } = require("./helper/addon/qr");
const { warmerLoopInit } = require("./helper/addon/qr/warmer/index.js");
const { initTele, cleanupTele } = require("./helper/addon/telegram/tele.js");
const isLogging = process.env.NODE_ENV === "logs";

function updateLangJsonFromEnglish() {
  try {
    const langsDir = `${__dirname}/../languages`;

    // ── 1. Read master (English.json) ──────────────────────────
    const englishPath = path.join(langsDir, "English.json");

    if (!fs.existsSync(englishPath)) {
      return;
    }

    const englishRaw = fs.readFileSync(englishPath, "utf8");
    const englishJson = JSON.parse(englishRaw);
    const englishKeys = Object.keys(englishJson);

    // ── 2. Get all .json files except English.json & default.json ─
    const allFiles = fs
      .readdirSync(langsDir)
      .filter(
        (f) =>
          f.endsWith(".json") && f !== "English.json" && f !== "default.json",
      );

    if (allFiles.length === 0) {
      return;
    }

    let totalFilesUpdated = 0;
    let totalKeysAdded = 0;

    // ── 3. Loop each target file ───────────────────────────────
    for (const file of allFiles) {
      const filePath = path.join(langsDir, file);

      let targetJson = {};
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        targetJson = JSON.parse(raw);
      } catch (parseErr) {
        continue;
      }

      // ── 4. Find missing keys ─────────────────────────────────
      const missingKeys = englishKeys.filter((key) => !(key in targetJson));

      if (missingKeys.length === 0) {
        continue;
      }

      // ── 5. Append missing keys with English value as fallback ─
      for (const key of missingKeys) {
        targetJson[key] = englishJson[key];
      }

      // ── 6. Write back ────────────────────────────────────────
      try {
        fs.writeFileSync(filePath, JSON.stringify(targetJson, null, 2), "utf8");
        totalFilesUpdated++;
        totalKeysAdded += missingKeys.length;
      } catch (writeErr) {}
    }

    // ── 7. Summary ───────────────────────────────────────────
    if (totalFilesUpdated > 0) {
    } else {
    }
  } catch (err) {}
}

const app = express();
const currentDir = process.cwd();

const allowedOrigins = [process.env.FRONTENDURI, process.env.BACKURI]
  .filter(Boolean)
  .flatMap((o) => o.split(",")) //
  .map((o) => o.trim())
  .filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      // Split incoming origin by comma (handles nginx corruption)
      // Check if ANY of the incoming origins match allowed list
      const incomingOrigins = origin.split(",").map((o) => o.trim());
      const isAllowed = incomingOrigins.some((o) => allowedOrigins.includes(o));

      if (isAllowed) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(fileUpload());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/user", require("./routes/user"));
app.use("/api/web", require("./routes/web"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/phonebook", require("./routes/phonebook"));
app.use("/api/chat_flow", require("./routes/chatFlow"));
app.use("/api/inbox", require("./routes/inbox"));
app.use("/api/templet", require("./routes/templet"));
app.use("/api/chatbot", require("./routes/chatbot"));
app.use("/api/broadcast", require("./routes/broadcast"));
app.use("/api/v1", require("./routes/apiv2"));
app.use("/api/agent", require("./routes/agent"));
app.use("/api/qr", require("./routes/qr"));
app.use("/api/ai", require("./routes/ai"));
app.use("/api/webhook", require("./routes/webhook"));
app.use("/api/wa_call", require("./routes/waCall"));
app.use("/api/telegram", require("./routes/telegram"));
app.use("/api/theme", require("./routes/theme"));
app.use("/api/insta", require("./routes/insta"));
app.use("/api/kaban", require("./routes/kaban"));
app.use("/api/waform", require("./routes/waform"));

// ─── Media Streaming Middleware ───────────────────────────────────────────────
const createMediaMiddleware = (folderPath) => {
  const mimeTypes = {
    // Video
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    // Audio
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
  };

  return express.static(path.resolve(currentDir, folderPath), {
    setHeaders: (res, filePath) => {
      res.setHeader("Accept-Ranges", "bytes");

      const ext = path.extname(filePath).toLowerCase();
      if (mimeTypes[ext]) {
        res.setHeader("Content-Type", mimeTypes[ext]);
      }

      res.setHeader("Cache-Control", "public, max-age=31536000");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range");
    },
    index: false,
    acceptRanges: true,
  });
};

app.use("/media", createMediaMiddleware("./client/public/media"));
app.use("/meta-media", createMediaMiddleware("./client/public/meta-media"));

// ─── Static & Catch-All ───────────────────────────────────────────────────────
app.use(express.static(path.resolve(currentDir, "./client/public")));

app.get("*", function (request, response) {
  response.sendFile(path.resolve(currentDir, "./client/public", "index.html"));
});

// ─── Server ───────────────────────────────────────────────────────────────────
const server = app.listen(process.env.PORT || 3010, () => {
  isLogging &&
    console.log(`WaCrm server is running on port ${process.env.PORT}`);

  updateLangJsonFromEnglish();
  init();
  setTimeout(() => {
    warmerLoopInit();
    initCampaign();
    initTele();
  }, 1000);
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = require("./socket").initializeSocket(server);
module.exports = io;

// ─── Cleanup ──────────────────────────────────────────────────────────────────
nodeCleanup(async (exitCode, signal) => {
  await cleanupTele();
  cleanup();
});
