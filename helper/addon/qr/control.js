function hi() {
  console.log("HI");
}

function fetchProfileUrl(session, jid, nonHd) {
  return new Promise(async (resolve) => {
    try {
      const ppUrl = nonHd
        ? await session.profilePictureUrl(jid)
        : await session.profilePictureUrl(jid, "image");

      if (ppUrl?.data == 404) {
        return resolve(null);
      }

      if (ppUrl) {
        resolve(ppUrl);
      } else {
        resolve(null);
      }
    } catch (err) {
      console.log("error found in fetchProfileUrl()");
      console.log(err);
      resolve(null);
    }
  });
}

function fetchGroupMeta(session, jid) {
  return new Promise(async (resolve) => {
    try {
      const metadata = await session.groupMetadata(jid);

      if (metadata) {
        resolve(metadata);
      } else {
        resolve(null);
      }
    } catch (err) {
      console.log("error found in fetchGroupMeta()");
      console.log(err);
      resolve(err);
    }
  });
}

function fetchPersonStatus(session, jid) {
  return new Promise(async (resolve) => {
    try {
      const status = await session.fetchStatus(jid);

      if (status) {
        resolve(status);
      } else {
        resolve(null);
      }
    } catch (err) {
      console.log("error found in fetchPersonStatus()");
      console.log(err);
      resolve(err);
    }
  });
}

function fetchBusinessprofile(session, jid) {
  return new Promise(async (resolve) => {
    try {
      const busPro = await session.getBusinessProfile(jid);

      if (busPro) {
        resolve(busPro);
      } else {
        resolve(null);
      }
    } catch (err) {
      console.log("error found in fetchBusinessprofile()");
      console.log(err);
      resolve(err);
    }
  });
}

function fetchPersonPresence(session, jid) {
  return new Promise(async (resolve) => {
    try {
      const presence = await session.presenceSubscribe(jid);

      console.log({ presence });

      if (presence) {
        resolve(presence);
      } else {
        resolve(null);
      }
    } catch (err) {
      console.log("error found in fetchPersonPresence()");
      console.log(err);
      resolve(err);
    }
  });
}

module.exports = {
  hi,
  fetchProfileUrl,
  fetchGroupMeta,
  fetchPersonStatus,
  fetchPersonPresence,
  fetchBusinessprofile,
};
