const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const validateUser = require("../middlewares/user.js");
const {
  exchangeShortToken,
  exchangeLongToken,
  fetchInstaProfile,
  getInstaCallbackUri,
  subscribeInstaWebhook,
} = require("../helper/addon/insta/insta.js");
const {
  processInstaMessage,
  resolveAccountFromWebhook,
  processInstaComment,
} = require("../helper/addon/insta/processInstagram.js");
const { processMessage } = require("../helper/inbox/inbox.js");
const { processAutomation } = require("../automation/automation.js");
const { checkPlan, checkInstaInbox } = require("../middlewares/plan.js");
const logger = require("../utils/logger.js");
const crypto = require("crypto");

const pageStyle = `
  font-family:sans-serif;display:flex;flex-direction:column;
  align-items:center;justify-content:center;min-height:100vh;
  background:linear-gradient(135deg,#f09433,#dc2743,#bc1888);
  color:#fff;margin:0;padding:20px;box-sizing:border-box;text-align:center
`;

// ─── Get Auth URL ─────────────────────────────────────────
router.get("/auth-url", validateUser, async (req, res) => {
  try {
    const [apiKeys] = await query(
      `SELECT insta_app_id, insta_app_secret FROM web_private`,
      [],
    );

    const instaCallbackUri = await getInstaCallbackUri();

    if (!apiKeys?.insta_app_id || !instaCallbackUri) {
      return res.json({
        success: false,
        msg: "Instagram app not configured. Please contact admin.",
      });
    }

    const SCOPES =
      "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish";

    const params = new URLSearchParams({
      client_id: apiKeys.insta_app_id,
      redirect_uri: instaCallbackUri,
      scope: SCOPES,
      response_type: "code",
      state: req.decode.uid,
    });

    const url = `https://www.instagram.com/oauth/authorize?${params.toString()}`;
    return res.json({ success: true, url });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong" });
  }
});

// ─── OAuth Callback ──────────────────────────────────────
router.get("/callback", async (req, res) => {
  const { code, error, state: uid } = req.query;

  if (error || !code || !uid) {
    return res.send(`<html><body style="${pageStyle}">
      <h2>❌ Error: ${error || "Missing parameters"}</h2>
      <script>setTimeout(() => window.close(), 3000);</script>
    </body></html>`);
  }

  try {
    const [apiKeys] = await query(
      `SELECT insta_app_id, insta_app_secret FROM web_private`,
      [],
    );

    const [user] = await query(`SELECT * FROM user WHERE uid = ?`, [uid]);
    const plan = user?.plan ? JSON.parse(user.plan) : null;
    if (!plan) {
      return res.send(`<html><body style="${pageStyle}">
        <h2>❌ Error: No active plan</h2>
        <p>Please subscribe to a plan to connect your Instagram account.</p>
        <script>setTimeout(() => window.close(), 4000);</script>
      </body></html>`);
    }

    const checkInstraGram = parseInt(plan?.instagram_inbox) > 0 ? true : false;
    if (!checkInstraGram) {
      return res.send(`<html><body style="${pageStyle}">
        <h2>❌ Error: Instagram inbox not included in your plan</h2>
        <p>Please upgrade your plan to connect your Instagram account.</p>
        <script>setTimeout(() => window.close(), 4000);</script>
      </body></html>`);
    }

    const instaCallbackUri = await getInstaCallbackUri();

    if (!apiKeys?.insta_app_id || !apiKeys?.insta_app_secret) {
      throw new Error("Instagram credentials not configured.");
    }

    if (!instaCallbackUri) {
      throw new Error("Instagram callback URL not configured.");
    }

    // Short-lived token
    const tokenData = await exchangeShortToken({
      appId: apiKeys.insta_app_id,
      appSecret: apiKeys.insta_app_secret,
      redirectUri: instaCallbackUri,
      code,
    });

    if (!tokenData.access_token) {
      throw new Error("Token exchange failed: " + JSON.stringify(tokenData));
    }

    // Long-lived token
    const longData = await exchangeLongToken({
      appSecret: apiKeys.insta_app_secret,
      shortToken: tokenData.access_token,
    });

    const finalToken = longData.access_token || tokenData.access_token;

    // Fetch profile
    const profile = await fetchInstaProfile(finalToken);
    if (!profile?.username) {
      throw new Error("Could not fetch Instagram profile.");
    }

    const igBusinessId = String(profile.user_id || profile.id);
    const igGraphId = String(profile.id);

    // ── Delete from ANY uid first (no duplicates across users) ────────────
    await query(`DELETE FROM instagram_accounts WHERE webhook_id = ?`, [
      igBusinessId,
    ]);

    // ── Fresh insert for current uid ──────────────────────────────────────
    await query(
      `INSERT INTO instagram_accounts
        (uid, webhook_id, ig_graph_id, user_id, page_id,
         username, name, profile_pic, access_token,
         token_type, expires_in, connected_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uid,
        igBusinessId,
        igGraphId,
        igBusinessId,
        String(tokenData.user_id || ""),
        profile.username,
        profile.name || "",
        profile.profile_picture_url || "",
        finalToken,
        longData.token_type || "bearer",
        longData.expires_in || null,
        new Date(),
      ],
    );

    await subscribeInstaWebhook(finalToken);

    return res.send(`<html><body style="${pageStyle}">
      <h2>✅ Connected @${profile.username}</h2>
      ${
        profile.profile_picture_url
          ? `<img src="${profile.profile_picture_url}" style="width:80px;height:80px;border-radius:50%;margin:12px 0"/>`
          : ""
      }
      <p>${profile.name || ""}</p>
      <p style="opacity:0.7;font-size:0.85rem">Closing in 2 seconds...</p>
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: "INSTA_CONNECTED" }, "*");
        }
        setTimeout(() => window.close(), 2000);
      </script>
    </body></html>`);
  } catch (err) {
    logger.log(err);
    return res.send(`<html><body style="${pageStyle}">
      <h2>❌ Error</h2>
      <pre style="font-size:0.8rem;opacity:0.8">${err.message}</pre>
      <script>setTimeout(() => window.close(), 4000);</script>
    </body></html>`);
  }
});

// ─── Get all accounts for logged-in user ─────────────────
router.get(
  "/accounts",
  validateUser,
  checkPlan,
  checkInstaInbox,
  async (req, res) => {
    try {
      const accounts = await query(
        `SELECT id, uid, webhook_id, ig_graph_id, user_id,
              username, name, profile_pic, token_type,
              expires_in, connected_at, createdAt
              FROM instagram_accounts WHERE uid = ?`,
        [req.decode.uid],
      );
      res.json({ success: true, accounts });
    } catch (err) {
      logger.log(err);
      res.json({ success: false, msg: "Something went wrong" });
    }
  },
);

// ─── Delete an account ────────────────────────────────────
router.post(
  "/delete-account",
  validateUser,
  checkPlan,
  checkInstaInbox,
  async (req, res) => {
    try {
      const { id } = req.body;
      await query(`DELETE FROM instagram_accounts WHERE id = ?`, [id]);
      res.json({ success: true, msg: "Account disconnected" });
    } catch (err) {
      logger.log(err);
      res.json({ success: false, msg: "Something went wrong" });
    }
  },
);

router.get("/webhook/:uid", (req, res) => {
  const VERIFY_TOKEN = req.params.uid;
  const {
    "hub.mode": mode,
    "hub.verify_token": token,
    "hub.challenge": challenge,
  } = req.query;

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: "Forbidden" });
});

router.post("/webhook/:uid", async (req, res) => {
  try {
    // ── HMAC Signature Verification ──────────────────────
    const signature = req.headers["x-hub-signature-256"];
    if (!signature) return res.status(403).send("Forbidden");

    const [apiKeys] = await query(
      `SELECT insta_app_secret FROM web_private LIMIT 1`,
      [],
    );
    if (!apiKeys?.insta_app_secret) return res.status(403).send("Forbidden");

    const expectedSig =
      "sha256=" +
      crypto
        .createHmac("sha256", apiKeys.insta_app_secret)
        .update(req.rawBody || JSON.stringify(req.body))
        .digest("hex");

    if (signature !== expectedSig) return res.status(403).send("Forbidden");

    const body = req.body;
    res.status(200).send("EVENT_RECEIVED");

    const entry = body?.entry?.[0];
    if (!entry) return;

    const igBusinessId = String(entry.id);
    const igAccount = await resolveAccountFromWebhook(igBusinessId);
    if (!igAccount) {
      // logger.log(`[Instagram Webhook] Unknown IG ID: ${igBusinessId}`);
      return;
    }

    const uid = igAccount.uid;

    // ── COMMENTS ──────────────────────────────────────────────────────────
    const commentChanges = entry.changes?.filter((c) => c.field === "comments");

    if (commentChanges?.length > 0) {
      const {
        getCurrentTimestampInTimeZone,
        saveMessageToConversation,
      } = require("../functions/function");
      const randomstring = require("randomstring");

      const [user] = await query(`SELECT * FROM user WHERE uid = ? LIMIT 1`, [
        uid,
      ]);
      if (!user) return;

      for (const change of commentChanges) {
        const commentData = change.value;
        if (!commentData?.from?.id) continue;

        const commenterId = String(commentData.from.id);
        const commenterName = commentData.from.username || "Instagram User";
        const commentText = commentData.text || "";
        const commentId = commentData.id;
        const mediaId = commentData.media?.id || null;
        const senderMobile = `${commenterId}`;

        // ── Find or create chat ──────────────────────────────────────────
        const [existingChat] = await query(
          `SELECT * FROM beta_chats 
           WHERE uid = ? AND sender_mobile = ? AND origin = ? LIMIT 1`,
          [uid, senderMobile, "instagram_comment"],
        );

        let chatId;
        if (existingChat) {
          chatId = existingChat.chat_id;
        } else {
          chatId = randomstring.generate(20);
          await query(
            `INSERT INTO beta_chats 
              (uid, chat_id, sender_mobile, sender_name, origin,
               origin_instance_id, last_message, createdAt)
             VALUES (?,?,?,?,?,?,?,?)`,
            [
              uid,
              chatId,
              senderMobile,
              commenterName,
              "instagram_comment",
              JSON.stringify({
                // ✅ JSON object, not plain string
                id: igAccount.user_id,
                username: igAccount.username,
                name: igAccount.name || "",
              }),
              JSON.stringify({ type: "text", text: { body: commentText } }),
              new Date(),
            ],
          );
        }

        // ── Save incoming comment to conversation ────────────────────────
        const userTimezone = getCurrentTimestampInTimeZone(
          user?.timezone || "Asia/Kolkata",
        );

        const messageData = {
          type: "text",
          metaChatId: commentId,
          msgContext: { type: "text", text: { body: commentText } },
          reaction: "",
          timestamp: parseInt(userTimezone),
          senderName: commenterName,
          senderMobile,
          star: 0,
          route: "INCOMING",
          context: null,
          origin: "instagram_comment",
        };

        await saveMessageToConversation({
          uid,
          chatId,
          messageData,
          sentBy: "instagram_comment",
        });

        // ── Update last_message on chat ──────────────────────────────────
        await query(
          `UPDATE beta_chats SET last_message = ?, sender_name = ? 
           WHERE chat_id = ? AND uid = ?`,
          [JSON.stringify(messageData), commenterName, chatId, uid],
        );

        // ── Build message object for automation ──────────────────────────
        const message = {
          senderMobile,
          senderName: commenterName,
          msgContext: { type: "text", text: { body: commentText } },
          commentId,
          mediaId,
          commentText,
        };

        // ── Fire automation ──────────────────────────────────────────────
        await processAutomation({
          uid,
          message,
          user,
          sessionId: igAccount.user_id,
          origin: "instagram_comment",
          chatId,
        });
      }
      return;
    }

    // ── REGULAR DM / MESSAGING EVENTS ─────────────────────────────────────
    await processMessage({ body, uid, origin: "instagram" });
  } catch (err) {}
});

// Helper at top of file or in a utils
async function getUserByUid(uid) {
  const [user] = await query(`SELECT * FROM user WHERE uid = ? LIMIT 1`, [uid]);
  return user;
}

module.exports = router;
