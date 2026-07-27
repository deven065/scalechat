const { query } = require("../../../../database/dbpromise");
const { checkQr, getSession, isExists } = require("../index");
const {
  mergeObjects,
  getWarmerFromDB,
  getRandomElementFromArray,
  timeoutPromise,
  sendTyping,
  delayRandom,
  checkWarmerPlan,
} = require("./functions");

async function runWarmer(warmer) {
  try {
    const checkWarmerInPlan = await checkWarmerPlan({
      uid: warmer?.uid,
    });

    if (checkWarmerInPlan) {
      const instanceArr = JSON.parse(warmer?.instances);
      const scriptArr = warmer?.script;

      if (instanceArr.length > 1) {
        const instanceFrom = getRandomElementFromArray(instanceArr);
        const script = getRandomElementFromArray(scriptArr);
        const instanceTo = getRandomElementFromArray(instanceArr, instanceFrom);

        // Getting the target instance from DB
        const instanceToObj = await query(
          `SELECT * FROM instance WHERE uniqueId = ?`,
          [instanceTo]
        );

        // Get the session with a timeout
        let session;

        try {
          session = await timeoutPromise(getSession(instanceFrom), 15000);
        } catch (error) {
          console.error(
            `Error getting session for instance ${instanceFrom}:`,
            error
          );
          return;
        }

        if (session && instanceToObj && instanceToObj.length > 0) {
          // console.log({ instanceToObj });

          const to = `${instanceToObj[0]?.number}@s.whatsapp.net`;
          const msg = {
            text: script?.message,
          };

          console.log({ to });
          await sendTyping(session, instanceToObj[0]?.number);
          try {
            await timeoutPromise(session.sendMessage(to, msg), 10000);
          } catch (error) {
            console.error(`Error sending message to ${to}:`, error);
          }
        } else {
          console.log("Session not found for", instanceFrom);
          console.log(`Session not found: ${instanceFrom}`);
        }
      }
    }
  } catch (err) {
    console.log("Error found in runWarmer", err);
  }
}

async function warmerLoopInit() {
  try {
    // returning if qr addong is not added
    const qrCheck = checkQr();
    if (!qrCheck) {
      return;
    }

    const warmers = await getWarmerFromDB();
    // console.log(JSON.stringify(warmers));
    if (warmers.length > 0) {
      // Use allSettled so that one user's failure doesn't block others
      const promises = warmers.map((warmer) => runWarmer(warmer));
      await Promise.allSettled(promises);
    }
  } catch (err) {
    console.log("Error in warmerLoopInit:", err);
  } finally {
    await delayRandom(1, 2);
    warmerLoopInit();
  }
}

module.exports = { warmerLoopInit };
