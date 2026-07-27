// mongoSession.js
const { MongoClient, ServerApiVersion } = require("mongodb");
const { curve } = require("libsignal");
const { randomBytes } = require("crypto");

let client = null;
let db = null;
let sessionsCollection = null;

// ============= UTILITY FUNCTIONS =============

const generateKeyPair = () => {
  const { pubKey, privKey } = curve.generateKeyPair();
  return {
    private: Buffer.from(privKey),
    public: Buffer.from(pubKey.slice(1)),
  };
};

const generateSignalPubKey = (pubKey) => {
  return pubKey.length === 33
    ? pubKey
    : Buffer.concat([Buffer.from([5]), pubKey]);
};

const sign = (privateKey, buf) => {
  return curve.calculateSignature(privateKey, buf);
};

const signedKeyPair = (identityKeyPair, keyId) => {
  const preKey = generateKeyPair();
  const pubKey = generateSignalPubKey(preKey.public);
  const signature = sign(identityKeyPair.private, pubKey);
  return { keyPair: preKey, signature, keyId };
};

const BufferJSON = {
  replacer: (_, value) => {
    if (
      Buffer.isBuffer(value) ||
      value instanceof Uint8Array ||
      value?.type === "Buffer"
    ) {
      return {
        type: "Buffer",
        data: Buffer.from(value?.data || value).toString("base64"),
      };
    }
    return value;
  },
  reviver: (_, value) => {
    if (
      typeof value === "object" &&
      !!value &&
      (value.buffer === true || value.type === "Buffer")
    ) {
      const val = value.data || value.value;
      if (typeof val === "string") {
        return Buffer.from(val, "base64");
      }
      return Buffer.from(val || []);
    }
    return value;
  },
};

const initAuthCreds = () => {
  const identityKey = generateKeyPair();
  return {
    noiseKey: generateKeyPair(),
    pairingEphemeralKeyPair: generateKeyPair(),
    signedIdentityKey: identityKey,
    signedPreKey: signedKeyPair(identityKey, 1),
    registrationId: Uint16Array.from(randomBytes(2))[0] & 16383,
    advSecretKey: randomBytes(32).toString("base64"),
    processedHistoryMessages: [],
    nextPreKeyId: 1,
    firstUnuploadedPreKeyId: 1,
    accountSyncCounter: 0,
    accountSettings: {
      unarchiveChats: false,
    },
    registered: false,
    pairingCode: undefined,
    lastPropHash: undefined,
    routingInfo: undefined,
  };
};

const fromObject = (args) => {
  const f = {
    ...args.fingerprint,
    deviceIndexes: Array.isArray(args.fingerprint?.deviceIndexes)
      ? args.fingerprint.deviceIndexes
      : [],
  };

  const parseTimestamp = (timestamp) => {
    if (typeof timestamp === "string") return parseInt(timestamp, 10);
    if (typeof timestamp === "number") return timestamp;
    return timestamp;
  };

  const allocate = (str) => {
    let p = str.length;
    if (!p) return new Uint8Array(1);
    let n = 0;
    while (--p % 4 > 1 && str.charAt(p) === "=") ++n;
    return new Uint8Array(Math.ceil(str.length * 3) / 4 - n).fill(0);
  };

  const message = {
    keyData: Array.isArray(args.keyData) ? args.keyData : new Uint8Array(),
    fingerprint: {
      rawId: f.rawId || 0,
      currentIndex: f.currentIndex || 0,
      deviceIndexes: f.deviceIndexes,
    },
    timestamp: parseTimestamp(args.timestamp),
  };

  if (typeof args.keyData === "string") {
    message.keyData = allocate(args.keyData);
  }

  return message;
};

// ============= MONGODB CONNECTION =============

/**
 * Initialize MongoDB connection with optimized settings
 */
async function initMongoConnection(uri, dbName = "whatsapp_sessions") {
  if (!client) {
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      maxPoolSize: 50,
      minPoolSize: 5,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 60000,
      retryWrites: true,
      retryReads: true,
      compressors: ["zlib"],
    });

    await client.connect();
    db = client.db(dbName);
    sessionsCollection = db.collection("sessions");

    // console.log("✅ MongoDB connected successfully for session storage");

    // Create optimized compound indexes for faster queries
    await sessionsCollection.createIndexes([
      {
        key: { sessionId: 1, dataKey: 1 },
        unique: true,
        name: "session_key_unique",
      },
      { key: { sessionId: 1 }, name: "session_index" },
      {
        key: { updatedAt: 1 },
        name: "updated_index",
        expireAfterSeconds: 2592000,
      }, // 30 days TTL
    ]);

    // console.log("✅ MongoDB indexes created successfully");
  }

  return db;
}

/**
 * Close MongoDB connection
 */
async function closeMongoConnection() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    sessionsCollection = null;
    console.log("MongoDB connection closed");
  }
}

// ============= MONGODB AUTH STATE =============

/**
 * MongoDB-based authentication state storage for Baileys (Optimized)
 */
const useMongoDBAuthState = async (config) => {
  const { mongoUri, session, dbName = "whatsapp_sessions" } = config;

  if (!mongoUri) throw new Error("MongoDB URI is required");
  if (!session) throw new Error("Session identifier is required");

  // Initialize connection
  await initMongoConnection(mongoUri, dbName);

  // In-memory cache for faster access
  const cache = new Map();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const cacheTimestamps = new Map();

  /**
   * Read data from MongoDB with caching
   */
  const readData = async (dataKey) => {
    try {
      // Check cache first
      if (cache.has(dataKey)) {
        const timestamp = cacheTimestamps.get(dataKey);
        if (Date.now() - timestamp < CACHE_TTL) {
          return cache.get(dataKey);
        }
      }

      const doc = await sessionsCollection.findOne(
        { sessionId: session, dataKey },
        { projection: { value: 1, _id: 0 } }
      );

      if (!doc || !doc.value) return null;

      const parsed = JSON.parse(doc.value, BufferJSON.reviver);

      // Update cache
      cache.set(dataKey, parsed);
      cacheTimestamps.set(dataKey, Date.now());

      return parsed;
    } catch (error) {
      console.error(`❌ Error reading data for ${dataKey}:`, error.message);
      return null;
    }
  };

  /**
   * Write data to MongoDB with caching (Optimized with bulk operations)
   */
  const writeData = async (dataKey, value) => {
    try {
      const valueStr = JSON.stringify(value, BufferJSON.replacer);
      const now = new Date();

      await sessionsCollection.updateOne(
        { sessionId: session, dataKey },
        {
          $set: { value: valueStr, updatedAt: now },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );

      // Update cache
      cache.set(dataKey, value);
      cacheTimestamps.set(dataKey, Date.now());
    } catch (error) {
      console.error(`❌ Error writing data for ${dataKey}:`, error.message);
      throw error;
    }
  };

  /**
   * Bulk write for better performance
   */
  const bulkWrite = async (operations) => {
    try {
      if (operations.length === 0) return;

      const bulkOps = operations.map(({ dataKey, value }) => {
        const valueStr = JSON.stringify(value, BufferJSON.replacer);
        const now = new Date();

        // Update cache
        cache.set(dataKey, value);
        cacheTimestamps.set(dataKey, Date.now());

        return {
          updateOne: {
            filter: { sessionId: session, dataKey },
            update: {
              $set: { value: valueStr, updatedAt: now },
              $setOnInsert: { createdAt: now },
            },
            upsert: true,
          },
        };
      });

      await sessionsCollection.bulkWrite(bulkOps, { ordered: false });
    } catch (error) {
      console.error(`❌ Error in bulk write:`, error.message);
      throw error;
    }
  };

  /**
   * Remove specific data
   */
  const removeData = async (dataKey) => {
    try {
      await sessionsCollection.deleteOne({ sessionId: session, dataKey });
      cache.delete(dataKey);
      cacheTimestamps.delete(dataKey);
    } catch (error) {
      console.error(`❌ Error removing data for ${dataKey}:`, error.message);
      throw error;
    }
  };

  /**
   * Clear all data except credentials
   */
  const clearAll = async () => {
    try {
      await sessionsCollection.deleteMany({
        sessionId: session,
        dataKey: { $ne: "creds" },
      });

      // Clear cache except creds
      for (const key of cache.keys()) {
        if (key !== "creds") {
          cache.delete(key);
          cacheTimestamps.delete(key);
        }
      }
    } catch (error) {
      console.error("❌ Error clearing session data:", error.message);
      throw error;
    }
  };

  /**
   * Remove all session data including credentials
   */
  const removeAll = async () => {
    try {
      await sessionsCollection.deleteMany({ sessionId: session });
      cache.clear();
      cacheTimestamps.clear();
    } catch (error) {
      console.error("❌ Error removing all session data:", error.message);
      throw error;
    }
  };

  // Load or initialize credentials
  const creds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds: creds,
      keys: {
        /**
         * Get multiple keys (Optimized with parallel reads)
         */
        get: async (type, ids) => {
          const data = {};

          // Parallel reads for better performance
          const results = await Promise.allSettled(
            ids.map(async (id) => {
              const dataKey = `${type}-${id}`;
              let value = await readData(dataKey);

              if (type === "app-state-sync-key" && value) {
                value = fromObject(value);
              }

              return { id, value };
            })
          );

          results.forEach((result) => {
            if (result.status === "fulfilled") {
              data[result.value.id] = result.value.value;
            }
          });

          return data;
        },

        /**
         * Set multiple keys (Optimized with bulk operations)
         */
        set: async (data) => {
          const operations = [];
          const deleteOps = [];

          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const dataKey = `${category}-${id}`;

              if (value) {
                operations.push({ dataKey, value });
              } else {
                deleteOps.push(dataKey);
              }
            }
          }

          // Bulk write for inserts/updates
          if (operations.length > 0) {
            await bulkWrite(operations);
          }

          // Bulk delete
          if (deleteOps.length > 0) {
            await sessionsCollection.deleteMany({
              sessionId: session,
              dataKey: { $in: deleteOps },
            });
            deleteOps.forEach((key) => {
              cache.delete(key);
              cacheTimestamps.delete(key);
            });
          }
        },
      },
    },

    /**
     * Save credentials
     */
    saveCreds: async () => {
      await writeData("creds", creds);
    },

    /**
     * Clear all except credentials
     */
    clear: async () => {
      await clearAll();
    },

    /**
     * Remove all including credentials
     */
    removeCreds: async () => {
      await removeAll();
    },

    /**
     * Get collection for custom queries
     */
    collection: () => sessionsCollection,

    /**
     * Clear cache manually if needed
     */
    clearCache: () => {
      cache.clear();
      cacheTimestamps.clear();
    },
  };
};

// ============= SESSION MANAGEMENT HELPERS =============

/**
 * Get all active sessions from MongoDB
 */
const getAllSessions = async () => {
  try {
    if (!sessionsCollection) {
      throw new Error("MongoDB not initialized");
    }

    const sessions = await sessionsCollection
      .aggregate([
        {
          $group: {
            _id: "$sessionId",
            lastUpdated: { $max: "$updatedAt" },
          },
        },
        { $sort: { lastUpdated: -1 } },
      ])
      .toArray();

    return sessions.map((s) => s._id);
  } catch (error) {
    console.error("Error getting all sessions:", error);
    return [];
  }
};

/**
 * Delete a session from MongoDB
 */
const deleteSessionFromDB = async (sessionId) => {
  try {
    if (!sessionsCollection) {
      throw new Error("MongoDB not initialized");
    }

    const result = await sessionsCollection.deleteMany({ sessionId });
    // console.log(
    //   `✅ Deleted ${result.deletedCount} documents for session ${sessionId}`
    // );
    return result.deletedCount;
  } catch (error) {
    console.error(`Error deleting session ${sessionId}:`, error);
    throw error;
  }
};

// ============= EXPORTS =============

module.exports = {
  useMongoDBAuthState,
  initMongoConnection,
  closeMongoConnection,
  getAllSessions,
  deleteSessionFromDB,
};
