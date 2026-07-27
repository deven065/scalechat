const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const validateUser = require("../middlewares/user.js");
const { checkPlan, checkWaForms } = require("../middlewares/plan.js");
const axios = require("axios");
const FormData = require("form-data");
const logger = require("../utils/logger.js");

const API_VERSION = "v20.0";

// ─── HELPER ───────────────────────────────────────────────────────────────────
async function getMetaConfig(uid) {
  const [metaApi] = await query(`SELECT * FROM meta_api WHERE uid = ?`, [uid]);
  return metaApi;
}

// ─── BUILD DYNAMIC FLOW JSON ──────────────────────────────────────────────────
// Supports all 2026 WhatsApp Flow component types
function buildFlowJSON(formName, fields = []) {
  const payload = {};
  const children = [{ type: "TextHeading", text: formName }];

  for (const field of fields) {
    const key = field.name; // snake_case key
    payload[key] = `\${form.${key}}`;

    switch (field.type) {
      case "TextInput":
        children.push({
          type: "TextInput",
          label: field.label,
          name: key,
          required: field.required ?? true,
          "input-type": field.inputType || "text", // text | number | email | password | passcode | phone
          ...(field.placeholder && { "helper-text": field.placeholder }),
        });
        break;

      case "TextArea":
        children.push({
          type: "TextArea",
          label: field.label,
          name: key,
          required: field.required ?? false,
          ...(field.placeholder && { "helper-text": field.placeholder }),
        });
        break;

      case "Dropdown":
        children.push({
          type: "Dropdown",
          label: field.label,
          name: key,
          required: field.required ?? true,
          "data-source": (field.options || []).map((opt, i) => ({
            id: `${key}_opt_${i}`,
            title: opt,
          })),
        });
        break;

      case "RadioButtonsGroup":
        children.push({
          type: "RadioButtonsGroup",
          label: field.label,
          name: key,
          required: field.required ?? true,
          "data-source": (field.options || []).map((opt, i) => ({
            id: `${key}_opt_${i}`,
            title: opt,
          })),
        });
        break;

      case "CheckboxGroup":
        children.push({
          type: "CheckboxGroup",
          label: field.label,
          name: key,
          required: field.required ?? false,
          "data-source": (field.options || []).map((opt, i) => ({
            id: `${key}_opt_${i}`,
            title: opt,
          })),
        });
        break;

      case "DatePicker":
        children.push({
          type: "DatePicker",
          label: field.label,
          name: key,
          required: field.required ?? false,
        });
        break;

      case "Image":
        // Static image — no payload key needed
        delete payload[key];
        children.push({
          type: "Image",
          src: field.src, // base64 or URL
          width: field.width || 300,
          height: field.height || 200,
          "scale-type": field.scaleType || "contain",
        });
        break;

      case "TextBody":
        delete payload[key];
        children.push({
          type: "TextBody",
          text: field.label,
        });
        break;

      case "TextCaption":
        delete payload[key];
        children.push({
          type: "TextCaption",
          text: field.label,
        });
        break;

      default:
        break;
    }
  }

  // Footer / Submit button
  children.push({
    type: "Footer",
    label: "Submit",
    "on-click-action": {
      name: "complete",
      payload,
    },
  });

  return {
    version: "6.0", // latest 2026
    screens: [
      {
        id: "FORM_SCREEN",
        title: formName,
        terminal: true,
        success: true,
        layout: {
          type: "SingleColumnLayout",
          children,
        },
      },
    ],
  };
}

// ─── SYNC FLOWS FROM META → DB ────────────────────────────────────────────────
router.get(
  "/sync-forms",
  validateUser,
  checkPlan,
  checkWaForms,
  async (req, res) => {
    try {
      const metaApi = await getMetaConfig(req.decode.uid);
      if (!metaApi)
        return res.json({ success: false, msg: "Meta API not configured" });

      const metaRes = await axios.get(
        `https://graph.facebook.com/${API_VERSION}/${metaApi.waba_id}/flows`,
        {
          params: {
            access_token: metaApi.access_token,
            fields: "id,name,status,categories",
          },
        },
      );

      const metaFlows = metaRes.data.data || [];
      const existingForms = await query(
        `SELECT flow_id FROM wa_forms WHERE uid = ?`,
        [req.decode.uid],
      );
      const existingFlowIds = existingForms.map((f) => f.flow_id);

      let synced = 0;
      for (const flow of metaFlows) {
        if (!existingFlowIds.includes(flow.id)) {
          await query(
            `INSERT INTO wa_forms (uid, name, description, flow_id, flow_status, fields_json, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
              req.decode.uid,
              flow.name,
              flow.categories?.join(", ") || "",
              flow.id,
              flow.status || "PUBLISHED",
              JSON.stringify([]),
            ],
          );
          synced++;
        }
      }

      res.json({
        success: true,
        msg: `Sync complete. ${synced} new form(s) imported.`,
        synced,
      });
    } catch (err) {
      logger.error(err);
      res.json({
        success: false,
        msg: err.response?.data?.error?.message || "Something went wrong",
      });
    }
  },
);

// ─── GET ALL FORMS ────────────────────────────────────────────────────────────
router.get("/get-forms", validateUser, checkPlan, async (req, res) => {
  try {
    const forms = await query(
      `SELECT * FROM wa_forms WHERE uid = ? ORDER BY createdAt DESC`,
      [req.decode.uid],
    );
    // Parse fields_json for each form
    const parsed = forms.map((f) => ({
      ...f,
      fields: (() => {
        try {
          return JSON.parse(f.fields_json || "[]");
        } catch {
          return [];
        }
      })(),
    }));
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.json({ success: false, msg: "Something went wrong", error: err });
  }
});

// ─── CREATE FORM ──────────────────────────────────────────────────────────────
router.post(
  "/create-form",
  validateUser,
  checkPlan,
  checkWaForms,
  async (req, res) => {
    try {
      const { name, description, fields = [] } = req.body;
      const metaApi = await getMetaConfig(req.decode.uid);
      if (!metaApi)
        return res.json({ success: false, msg: "Meta API not configured" });

      const headers = {
        Authorization: `Bearer ${metaApi.access_token}`,
        "Content-Type": "application/json",
      };

      // 1. Create Flow on Meta
      const createRes = await axios.post(
        `https://graph.facebook.com/${API_VERSION}/${metaApi.waba_id}/flows`,
        { name, categories: ["CONTACT_US"] },
        { headers },
      );
      const flowId = createRes.data.id;

      // 2. Upload dynamic Flow JSON
      const flowJSON = buildFlowJSON(name, fields);
      const form = new FormData();
      form.append("name", "flow.json");
      form.append("asset_type", "FLOW_JSON");
      form.append("file", Buffer.from(JSON.stringify(flowJSON)), {
        filename: "flow.json",
        contentType: "application/json",
      });

      const uploadRes = await axios.post(
        `https://graph.facebook.com/${API_VERSION}/${flowId}/assets`,
        form,
        {
          headers: {
            Authorization: `Bearer ${metaApi.access_token}`,
            ...form.getHeaders(),
          },
        },
      );

      if (uploadRes.data.validation_errors?.length > 0) {
        return res.json({
          success: false,
          msg: "Flow JSON validation failed",
          errors: uploadRes.data.validation_errors,
        });
      }

      // 3. Publish
      await axios.post(
        `https://graph.facebook.com/${API_VERSION}/${flowId}/publish`,
        {},
        { headers },
      );

      // 4. Save to DB with fields_json
      await query(
        `INSERT INTO wa_forms (uid, name, description, flow_id, flow_status, fields_json, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          req.decode.uid,
          name,
          description || "",
          flowId,
          "PUBLISHED",
          JSON.stringify(fields),
        ],
      );

      res.json({ success: true, msg: "Form created successfully", flowId });
    } catch (err) {
      logger.error(err);
      res.json({
        success: false,
        msg: err.response?.data?.error?.message || "Something went wrong",
        error: err.response?.data || err.message,
      });
    }
  },
);

// ─── SEND FORM ────────────────────────────────────────────────────────────────
router.post(
  "/send-form",
  validateUser,
  checkPlan,
  checkWaForms,
  async (req, res) => {
    try {
      const { id, to } = req.body;
      const metaApi = await getMetaConfig(req.decode.uid);
      if (!metaApi)
        return res.json({ success: false, msg: "Meta API not configured" });

      const [form] = await query(
        `SELECT * FROM wa_forms WHERE id = ? AND uid = ?`,
        [id, req.decode.uid],
      );
      if (!form) return res.json({ success: false, msg: "Form not found" });

      const response = await axios.post(
        `https://graph.facebook.com/${API_VERSION}/${metaApi.business_phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: {
            type: "flow",
            header: { type: "text", text: form.name },
            body: {
              text: form.description || "Please fill out the form below.",
            },
            footer: { text: "Powered by WhatsApp Flows" },
            action: {
              name: "flow",
              parameters: {
                flow_message_version: "3",
                flow_token: "TOKEN_" + Date.now(),
                flow_id: form.flow_id,
                flow_cta: "Open Form",
                flow_action: "navigate",
                flow_action_payload: { screen: "FORM_SCREEN" },
              },
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${metaApi.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      res.json({
        success: true,
        msg: "Form sent successfully",
        messageId: response.data.messages[0].id,
      });
    } catch (err) {
      logger.error(err);
      res.json({
        success: false,
        msg: err.response?.data?.error?.message || "Something went wrong",
      });
    }
  },
);

// ─── DELETE FORM ──────────────────────────────────────────────────────────────
router.post(
  "/delete-form",
  validateUser,
  checkPlan,
  checkWaForms,
  async (req, res) => {
    try {
      const { id } = req.body;
      const [form] = await query(
        `SELECT * FROM wa_forms WHERE id = ? AND uid = ?`,
        [id, req.decode.uid],
      );
      if (!form) return res.json({ success: false, msg: "Form not found" });

      const metaApi = await getMetaConfig(req.decode.uid);
      if (metaApi && form.flow_id) {
        await axios
          .delete(`https://graph.facebook.com/${API_VERSION}/${form.flow_id}`, {
            headers: { Authorization: `Bearer ${metaApi.access_token}` },
          })
          .catch(() => {});
      }

      await query(`DELETE FROM wa_forms WHERE id = ? AND uid = ?`, [
        id,
        req.decode.uid,
      ]);
      res.json({ success: true, msg: "Form deleted" });
    } catch (err) {
      res.json({ success: false, msg: "Something went wrong", error: err });
    }
  },
);

// ─── RECEIVE SUBMISSION (Webhook handler — call from your main webhook) ────────
router.post("/submit", async (req, res) => {
  try {
    // Called from your main WhatsApp webhook when flow_token matches
    const { uid, flow_id, form_name, from_phone, payload } = req.body;

    await query(
      `INSERT INTO wa_form_submissions (uid, flow_id, form_name, from_phone, raw_payload, createdAt) VALUES (?, ?, ?, ?, ?, NOW())`,
      [uid, flow_id, form_name, from_phone, JSON.stringify(payload)],
    );

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err });
  }
});

// ─── GET SUBMISSIONS ──────────────────────────────────────────────────────────
router.get("/submissions", validateUser, async (req, res) => {
  try {
    const data = await query(
      `SELECT * FROM wa_form_submissions WHERE uid = ? ORDER BY createdAt DESC`,
      [req.decode.uid],
    );
    // Parse raw_payload for frontend
    const parsed = data.map((s) => ({
      ...s,
      payload: (() => {
        try {
          return JSON.parse(s.raw_payload || "{}");
        } catch {
          return {};
        }
      })(),
    }));
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.json({ success: false, msg: "Something went wrong", error: err });
  }
});

// ─── DELETE SUBMISSIONS (bulk) ────────────────────────────────────────────────
router.post("/delete-submissions", validateUser, async (req, res) => {
  try {
    const { ids } = req.body; // array of submission IDs
    if (!Array.isArray(ids) || ids.length === 0)
      return res.json({ success: false, msg: "No IDs provided" });

    // Build placeholders: ?, ?, ?
    const placeholders = ids.map(() => "?").join(", ");
    await query(
      `DELETE FROM wa_form_submissions WHERE uid = ? AND id IN (${placeholders})`,
      [req.decode.uid, ...ids],
    );

    res.json({ success: true, msg: `${ids.length} submission(s) deleted` });
  } catch (err) {
    logger.error(err);
    res.json({ success: false, msg: "Something went wrong", error: err });
  }
});

module.exports = router;
