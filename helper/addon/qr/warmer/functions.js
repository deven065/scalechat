const { query } = require("../../../../database/dbpromise");

function mergeObjects(arrayA, arrayB, idKey, passedNameKey) {
  const mergedArray = [];
  for (let objA of arrayA) {
    const matchingObjects = arrayB.filter((obj) => obj[idKey] === objA[idKey]);
    if (matchingObjects.length > 0) {
      const mergedObject = { ...objA };
      mergedObject[passedNameKey] = matchingObjects;
      mergedArray.push(mergedObject);
    } else {
      mergedArray.push(objA);
    }
  }
  return mergedArray;
}

async function getWarmerFromDB() {
  const warmer = await query(`SELECT * FROM warmers WHERE is_active = ?`, [1]);
  const warmerScript = await query(`SELECT * FROM warmer_script`, []);
  return mergeObjects(warmer, warmerScript, "uid", "script");
}

function getRandomElementFromArray(array, exclude) {
  // Silently handle invalid or empty arrays
  if (!array || !Array.isArray(array) || array.length === 0) {
    return null;
  }

  const filteredArray = array.filter((item) => item !== exclude);

  // Silently handle empty filtered array
  if (filteredArray.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * filteredArray.length);
  return filteredArray[randomIndex];
}

function timeoutPromise(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Operation timed out")), ms),
  );
  return Promise.race([promise, timeout]);
}

function delayRandom(fromSeconds, toSeconds) {
  const randomSeconds = Math.random() * (toSeconds - fromSeconds) + fromSeconds;

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, randomSeconds * 1000);
  });
}

async function sendTyping(session, jid) {
  try {
    await timeoutPromise(session.sendPresenceUpdate("composing", jid), 5000);
  } catch (error) {
    console.error("Error sending 'composing' presence:", error);
  }

  // Wait for a random delay before sending the "paused" status
  await delayRandom(5, 15);
  try {
    await timeoutPromise(session.sendPresenceUpdate("paused", jid), 5000);
  } catch (error) {
    console.error("Error sending 'paused' presence:", error);
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

module.exports = {
  mergeObjects,
  getWarmerFromDB,
  getRandomElementFromArray,
  timeoutPromise,
  sendTyping,
  delayRandom,
  checkWarmerPlan,
};
