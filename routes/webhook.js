const router = require("express").Router();

router.get("/get_webhooks", (req, res) => {
  res.json({ msg: "plugin required", success: false });
});

router.post("/add_webhook", (req, res) => {
  res.json({ msg: "plugin required", success: false });
});

router.post("/update_webhook", (req, res) => {
  res.json({ msg: "plugin required", success: false });
});

router.post("/delete_webhook", (req, res) => {
  res.json({ msg: "plugin required", success: false });
});

router.post("/webhook/:webhook_id", (req, res) => {
  res.json({ msg: "plugin required", success: false });
});

router.get("/webhook/:webhook_id", (req, res) => {
  res.json({ msg: "plugin required", success: false });
});

router.get("/get_webhook_logs", (req, res) => {
  res.json({ msg: "plugin required", success: false });
});

router.post("/delete_webhook_logs", (req, res) => {
  res.json({ msg: "plugin required", success: false });
});

module.exports = router;
