const { checkInsta } = require("../helper/addon/insta/insta.js");
const { checkTelePlugin } = require("../helper/addon/telegram/tele.js");
const { checkWebPush } = require("../helper/addon/web-notification/webPush.js");

function returnAddons() {
  const { checkQr } = require("../helper/addon/qr/index.js");
  const { checkWebhook } = require("../helper/addon/webhook/index.js");
  const { checkWaCall } = require("../helper/addon/wacall/wacall.js");
  const { checkEmbed } = require("../helper/addon/embed/index.js");
  const { addON } = require("../env.js");

  const qrCheck = checkQr();
  const wooCheck = checkWebhook();
  const waCallChceck = checkWaCall();
  const embedCheck = checkEmbed();
  const checkTele = checkTelePlugin();
  const webPush = checkWebPush();
  const checkInstagram = checkInsta();

  const finalAddon = [
    wooCheck && "WEBHOOK",
    addON?.includes("AI_BOT") && "AI_BOT",
    qrCheck && "QR",
    waCallChceck && "WACALL",
    embedCheck && "EMBED",
    checkTele && "TELEGRAM",
    webPush && "WEB_NOTIFICATION",
    checkInstagram && "INSTAGRAM",
  ].filter(Boolean);

  return finalAddon;
}

module.exports = { returnAddons };
