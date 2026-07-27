importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js",
);

let messaging = null;

const DB_NAME = "fcm_sw_config";
const STORE_NAME = "config";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e);
  });
}

async function saveConfig(config) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(config, "firebase");
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

async function loadConfig() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get("firebase");
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = reject;
  });
}

function initMessaging(config) {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }
    messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title || "New Notification";
      const options = {
        body: payload.notification?.body || "",
        icon: "/logo192.png",
        badge: "/logo192.png",
        data: payload.data || {},
        vibrate: [200, 100, 200],
      };
      self.registration.showNotification(title, options);
    });
  } catch (e) {
    // already initialized is fine
    if (!e.message?.includes("already")) {
      console.error("❌ [SW] Init error:", e);
    }
  }
}

// ── Boot immediately every time SW wakes up ───────────────────────────────────
async function bootMessaging() {
  const config = await loadConfig();
  if (config) {
    initMessaging(config);
  } else {
    console.warn("⚠️ [SW] No cached config found — open the app tab first");
  }
}

bootMessaging(); // ← runs on every SW startup, not just install

// ── Activate — just claim clients ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// ── Message from tab — normalize keys, save, init ────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "FIREBASE_CONFIG") {
    const raw = event.data.config;

    // Strip fcm_ prefix — Firebase needs plain keys
    const normalized = {
      apiKey: raw.fcm_apiKey || raw.apiKey,
      authDomain: raw.fcm_authDomain || raw.authDomain,
      projectId: raw.fcm_projectId || raw.projectId,
      storageBucket: raw.fcm_storageBucket || raw.storageBucket,
      messagingSenderId: raw.fcm_messagingSenderId || raw.messagingSenderId,
      appId: raw.fcm_appId || raw.appId,
      measurementId: raw.fcm_measurementId || raw.measurementId,
    };

    saveConfig(normalized).then(() => {
      initMessaging(normalized);
    });
  }
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        return clients.openWindow("/");
      }),
  );
});
