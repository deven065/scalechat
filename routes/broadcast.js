const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const {
  createMetaTemplet,
  getMetaNumberDetail,
} = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const { checkPlan } = require("../middlewares/plan.js");
const logger = require("../utils/logger.js");

// adding campaign
router.post("/add_new", validateUser, checkPlan, async (req, res) => {
  try {
    const { title, templet, phonebook, scheduleTimestamp, example } = req.body;

    if (!title || !templet?.name || !phonebook || !scheduleTimestamp) {
      return res.json({ success: false, msg: "Please enter all details" });
    }

    const { id } = phonebook;

    if (!id) {
      return res.json({ msg: "Invalid phonebook provided" });
    }

    const getMetaAPI = await query(`SELECT * FROM meta_api WHERE uid = ?`, [
      req.decode.uid,
    ]);

    if (getMetaAPI.length < 1) {
      return res.json({ msg: "We could not find your meta API keys" });
    }

    const getPhonebookContacts = await query(
      `SELECT * FROM contact where phonebook_id = ? AND uid = ?`,
      [id, req.decode.uid],
    );

    if (getPhonebookContacts.length < 1) {
      return res.json({
        success: false,
        msg: "The phonebook you have selected does not have any mobile number in it",
      });
    }

    const getMetaMobileDetails = await getMetaNumberDetail(
      "v18.0",
      getMetaAPI[0]?.business_phone_number_id,
      getMetaAPI[0]?.access_token,
    );

    if (getMetaMobileDetails.error) {
      return res.json({
        success: false,
        msg: "Either your meta API are invalid or your access token has been expired",
      });
    }

    const broadcast_id = randomstring.generate();

    const broadcast_logs = getPhonebookContacts.map((i) => [
      req.decode.uid,
      broadcast_id,
      templet?.name || "NA",
      getMetaMobileDetails?.display_phone_number,
      i?.mobile,
      "PENDING",
      JSON.stringify(example),
      JSON.stringify(i),
    ]);

    const getUser = await query(`SELECT * FROM user WHERE uid = ?`, [
      req.decode.uid,
    ]);

    await query(
      `
                INSERT INTO broadcast_log (
                    uid,
                    broadcast_id,
                    templet_name,
                    sender_mobile,
                    send_to,
                    delivery_status,
                    example,
                    contact
                ) VALUES ?`,
      [broadcast_logs],
    );

    const scheduleDate = scheduleTimestamp ? new Date(scheduleTimestamp) : null;

    await query(
      `INSERT INTO broadcast (broadcast_id, uid, title, templet, phonebook, status, schedule, timezone) VALUES (
            ?,?,?,?,?,?,?,?
        )`,
      [
        broadcast_id,
        req.decode.uid,
        title,
        JSON.stringify(templet),
        JSON.stringify(phonebook),
        "QUEUE",
        scheduleDate,
        getUser[0]?.timezone || "Asia/Kolkata",
      ],
    );

    res.json({ success: true, msg: "Your broadcast has been added" });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// get all campaign
router.get("/get_broadcast", validateUser, async (req, res) => {
  try {
    const data = await query(`SELECT * FROM broadcast WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// get broadcast logs by bid
router.post("/get_broadcast_logs", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    const data = await query(
      `SELECT * FROM broadcast_log WHERE broadcast_id = ? AND uid = ?`,
      [id, req.decode.uid],
    );

    const getSent = data?.filter((i) => i.delivery_status === "sent");

    const totalDelivered = data?.filter(
      (i) => i.delivery_status === "delivered",
    );

    const totalRead = data?.filter((i) => i.delivery_status === "read");
    const totalFailed = data?.filter((i) => i.delivery_status === "failed");

    const totalPending = data?.filter((i) => i.delivery_status === "PENDING");

    res.json({
      data,
      success: true,
      totalLogs: data?.length,
      getSent: getSent?.length,
      totalRead: totalRead?.length,
      totalFailed: totalFailed?.length,
      totalPending: totalPending?.length,
      totalDelivered: totalDelivered?.length,
    });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// change campaign status
router.post("/change_broadcast_status", validateUser, async (req, res) => {
  try {
    const { status, broadcast_id } = req.body;

    if (!status) {
      return res.json({ msg: "Invalid request" });
    }

    await query(
      `UPDATE broadcast SET status = ? WHERE broadcast_id = ? AND uid = ?`,
      [status, broadcast_id, req.decode.uid],
    );
    res.json({ success: true, msg: "Campaign status updated" });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

// delete a broad cast
router.post("/del_broadcast", validateUser, async (req, res) => {
  try {
    const { broadcast_id } = req.body;

    await query(`DELETE FROM broadcast WHERE uid = ? AND broadcast_id = ?`, [
      req.decode.uid,
      broadcast_id,
    ]);
    await query(
      `DELETE FROM broadcast_log WHERE uid = ? AND broadcast_id = ?`,
      [req.decode.uid, broadcast_id],
    );

    res.json({ success: true, msg: "Broadcast was deleted" });
  } catch (err) {
    logger.log(err);
    res.json({ success: false, msg: "Something went wrong", err });
  }
});

router.post(
  "/create_template_campaign",
  validateUser,
  checkPlan,
  async (req, res) => {
    try {
      const {
        template_name,
        template_language,
        template_type,
        phonebook_id,
        campaign_title,
        body_variables,
        header_variable,
        button_variables,
        carousel_cards,
        schedule,
        timezone,
      } = req.body;

      // ── Validate required ─────────────────────────────────
      if (
        !template_name ||
        !template_language ||
        !phonebook_id ||
        !campaign_title
      ) {
        return res.json({ success: false, msg: "Missing required fields" });
      }

      // ── Carousel validation ───────────────────────────────
      if (template_type === "CAROUSEL") {
        if (!carousel_cards || carousel_cards.length < 2) {
          return res.json({
            success: false,
            msg: "Carousel requires at least 2 cards",
          });
        }
        if (carousel_cards.some((c) => !c.imageUrl)) {
          return res.json({
            success: false,
            msg: "All carousel cards must have an image",
          });
        }
      }

      // ── Get phonebook ─────────────────────────────────────
      const phonebooks = await query(
        "SELECT * FROM phonebook WHERE id = ? AND uid = ?",
        [phonebook_id, req.decode.uid],
      );
      if (!phonebooks || phonebooks.length === 0) {
        return res.json({ success: false, msg: "Phonebook not found" });
      }

      // ── Get contacts ──────────────────────────────────────
      const contacts = await query(
        `SELECT 
          mobile,
          MAX(name)  as name,
          MAX(var1)  as var1,
          MAX(var2)  as var2,
          MAX(var3)  as var3,
          MAX(var4)  as var4,
          MAX(var5)  as var5
        FROM contact
        WHERE phonebook_id = ? AND uid = ?
        GROUP BY mobile`,
        [phonebook_id, req.decode.uid],
      );
      if (!contacts || contacts.length === 0) {
        return res.json({
          success: false,
          msg: "No contacts found in phonebook",
        });
      }

      const campaignId = randomstring.generate(10);

      // ── Schedule ──────────────────────────────────────────
      let mysqlSchedule = null;
      if (schedule) {
        const d = new Date(schedule);
        if (!isNaN(d.getTime())) {
          mysqlSchedule = d.toISOString().slice(0, 19).replace("T", " ");
        }
      }

      let packedHeader;

      if (template_type === "CAROUSEL") {
        packedHeader = {
          type: "CAROUSEL",
          cards: carousel_cards.map((card) => ({
            imageUrl: card.imageUrl,
            bodyVariables: card.bodyVariables || [],
            buttonVariables: card.buttonVariables || [],
          })),
        };
      } else if (template_type === "CATALOG") {
        packedHeader = {
          type: "CATALOG",
          thumbnail: header_variable?.url || null,
        };
      } else {
        // STANDARD — preserve the original media type ("image"/"video"/"document")
        packedHeader = header_variable?.url
          ? {
              templateType: "STANDARD", // discriminator (won't clash with media type)
              type: header_variable.type || "image", // "image" | "video" | "document"
              url: header_variable.url || "",
              filename: header_variable.filename || "",
            }
          : null;
      }

      // ── Transaction ───────────────────────────────────────
      await query("START TRANSACTION");

      try {
        await query(
          `INSERT INTO beta_campaign (
            campaign_id, uid, title,
            template_name, template_language,
            phonebook_id, phonebook_name,
            status, total_contacts,
            body_variables,
            header_variable,
            button_variables,
            schedule, timezone
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
          [
            campaignId,
            req.decode.uid,
            campaign_title,
            template_name,
            template_language,
            phonebook_id,
            phonebooks[0].name,
            contacts.length,
            JSON.stringify(body_variables || []), // body vars
            JSON.stringify(packedHeader), // ← packed header
            JSON.stringify(button_variables || []), // button vars
            mysqlSchedule,
            timezone || null,
          ],
        );

        // ── Batch insert logs ─────────────────────────────
        const batchSize = 1000;
        for (let i = 0; i < contacts.length; i += batchSize) {
          const batch = contacts.slice(i, i + batchSize);
          const values = batch.map((contact) => [
            req.decode.uid,
            campaignId,
            contact.name || "NA",
            contact.mobile,
            "PENDING",
          ]);
          await query(
            `INSERT INTO beta_campaign_logs
             (uid, campaign_id, contact_name, contact_mobile, status)
             VALUES ?`,
            [values],
          );
        }

        await query("COMMIT");

        logger.log(
          `✅ Campaign ${campaignId} | type: ${template_type || "STANDARD"} | contacts: ${contacts.length}`,
        );

        return res.json({
          success: true,
          msg: "Campaign created successfully",
          campaignId,
          totalContacts: contacts.length,
          templateType: template_type || "STANDARD",
        });
      } catch (err) {
        await query("ROLLBACK");
        throw err;
      }
    } catch (error) {
      logger.error("Error creating campaign:", error);
      return res.json({ success: false, msg: "An error occurred" });
    }
  },
);

// Get all campaigns for the user
router.get("/get_campaigns", validateUser, checkPlan, async (req, res) => {
  try {
    const campaigns = await query(
      "SELECT * FROM beta_campaign WHERE uid = ? ORDER BY createdAt DESC",
      [req.decode.uid],
    );

    return res.json({
      success: true,
      data: campaigns,
    });
  } catch (error) {
    logger.error("Error fetching campaigns:", error);
    return res.json({
      success: false,
      msg: "An error occurred while fetching campaigns",
    });
  }
});

// Get campaign details including logs
router.get(
  "/get_campaign_details/:campaignId",
  validateUser,
  checkPlan,
  async (req, res) => {
    try {
      const { campaignId } = req.params;

      // Get campaign
      const campaigns = await query(
        "SELECT * FROM beta_campaign WHERE campaign_id = ? AND uid = ?",
        [campaignId, req.decode.uid],
      );

      if (!campaigns || campaigns.length === 0) {
        return res.json({
          success: false,
          msg: "Campaign not found",
        });
      }

      // Get logs
      const logs = await query(
        "SELECT * FROM beta_campaign_logs WHERE campaign_id = ? ORDER BY createdAt DESC",
        [campaignId],
      );

      return res.json({
        success: true,
        campaign: campaigns[0],
        logs,
      });
    } catch (error) {
      logger.error("Error fetching campaign details:", error);
      return res.json({
        success: false,
        msg: "An error occurred while fetching campaign details",
      });
    }
  },
);

router.get("/campaigns", validateUser, async (req, res) => {
  try {
    const uid = req.decode.uid;
    const { page = 1, limit = 10, status, search } = req.query;
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereClause = "WHERE c.uid = ?";
    let queryParams = [uid];

    if (status && status !== "") {
      whereClause += " AND c.status = ?";
      queryParams.push(status);
    }

    if (search && search !== "") {
      whereClause += " AND (c.title LIKE ? OR c.template_name LIKE ?)";
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    // Get total count for pagination
    const totalCountQuery = `
      SELECT COUNT(*) as total
      FROM beta_campaign c
      ${whereClause}
    `;
    const totalResult = await query(totalCountQuery, queryParams);
    const totalCampaigns = totalResult[0].total;

    // Get campaigns with updated counts
    const campaignsQuery = `
      SELECT 
        c.campaign_id,
        c.title,
        c.template_name,
        c.template_language,
        c.status,
        c.createdAt,
        c.schedule,
        c.total_contacts,
        c.sent_count,
        c.delivered_count,
        c.read_count,
        c.failed_count,
        p.name as phonebook_name
      FROM beta_campaign c
      LEFT JOIN phonebook p ON c.phonebook_id = p.id
      ${whereClause}
      ORDER BY c.createdAt DESC
      LIMIT ? OFFSET ?
    `;

    queryParams.push(parseInt(limit), parseInt(offset));
    const campaigns = await query(campaignsQuery, queryParams);

    res.json({
      success: true,
      campaigns,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCampaigns / limit),
        totalCampaigns,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    logger.error("Error fetching campaigns:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch campaigns",
      details: error.message,
    });
  }
});

router.post("/download_csv", validateUser, async (req, res) => {
  try {
    const uid = req.decode.uid;
    const { campaignId } = req.body;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: "Campaign ID is required",
      });
    }

    // Verify campaign belongs to user
    const campaignCheck = await query(
      "SELECT campaign_id FROM beta_campaign WHERE campaign_id = ? AND uid = ?",
      [campaignId, uid],
    );

    if (!campaignCheck || campaignCheck.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Campaign not found",
      });
    }

    // Get all logs for the campaign
    const logs = await query(
      `SELECT 
        contact_name as 'Contact Name',
        contact_mobile as 'Phone Number',
        status as 'Send Status',
        delivery_status as 'Delivery Status',
        createdAt as 'Created Time',
        delivery_time as 'Sent Time',
        delivery_time as 'Delivery Time',
        error_message as 'Error Message',
        meta_msg_id as 'Message ID'
      FROM beta_campaign_logs
      WHERE campaign_id = ?
      ORDER BY createdAt DESC`,
      [campaignId],
    );

    res.json({
      success: true,
      data: logs,
      count: logs.length,
    });
  } catch (error) {
    logger.error("Error downloading CSV:", error);
    res.status(500).json({
      success: false,
      error: "Failed to download CSV",
      details: error.message,
    });
  }
});

router.get("/campaign/:campaignId", validateUser, async (req, res) => {
  try {
    const uid = req.decode.uid;
    const { campaignId } = req.params;

    // Get campaign with updated counts
    const campaignQuery = `
      SELECT 
        c.*,
        p.name as phonebook_name
      FROM beta_campaign c
      LEFT JOIN phonebook p ON c.phonebook_id = p.id
      WHERE c.campaign_id = ? AND c.uid = ?
    `;

    const campaign = await query(campaignQuery, [campaignId, uid]);

    if (!campaign || campaign.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Campaign not found",
      });
    }

    // Get hourly stats for charts
    const stats = await query(
      `SELECT 
        DATE_FORMAT(createdAt, '%Y-%m-%d %H:00:00') as hour,
        status,
        delivery_status,
        COUNT(*) as count
      FROM beta_campaign_logs
      WHERE campaign_id = ?
      GROUP BY hour, status, delivery_status
      ORDER BY hour DESC`,
      [campaignId],
    );

    // Get recent logs (last 100)
    let logs = await query(
      `SELECT 
        id,
        contact_name,
        contact_mobile,
        status,
        delivery_status,
        createdAt,
        delivery_time,
        delivery_time,
        error_message,
        meta_msg_id
      FROM beta_campaign_logs
      WHERE campaign_id = ?
      ORDER BY createdAt DESC
      LIMIT 100`,
      [campaignId],
    );

    if (logs.length > 0) {
      logs = logs.map((x) => {
        return {
          ...x,
          campaign_id: campaignId,
        };
      });
    }

    // Get real-time accurate counts - FIXED: Added backticks around 'read'
    const realTimeCounts = await query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN delivery_status = 'read' THEN 1 ELSE 0 END) as \`read\`,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending
      FROM beta_campaign_logs
      WHERE campaign_id = ?`,
      [campaignId],
    );

    // Update campaign object with real-time counts
    const updatedCampaign = {
      ...campaign[0],
      sent_count: parseInt(realTimeCounts[0]?.sent || 0),
      delivered_count: parseInt(realTimeCounts[0]?.delivered || 0),
      read_count: parseInt(realTimeCounts[0]?.read || 0),
      failed_count: parseInt(realTimeCounts[0]?.failed || 0),
      pending_count: parseInt(realTimeCounts[0]?.pending || 0),
      total_logs: parseInt(realTimeCounts[0]?.total || 0),
    };

    res.json({
      success: true,
      campaign: updatedCampaign,
      stats,
      logs,
    });
  } catch (error) {
    logger.error("Error fetching campaign details:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch campaign details",
      details: error.message,
    });
  }
});

router.get("/dashboard", validateUser, async (req, res) => {
  try {
    const uid = req.decode.uid;

    // Get total campaigns
    const totalCampaigns = await query(
      `SELECT COUNT(*) as count FROM beta_campaign WHERE uid = ?`,
      [uid],
    );

    // Get accurate message stats from logs with proper counting - FIXED: Added backticks around 'read'
    const messageStats = await query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN delivery_status = 'read' THEN 1 ELSE 0 END) as \`read\`,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending
      FROM beta_campaign_logs
      WHERE uid = ?`,
      [uid],
    );

    // Format the final message stats - ensure they're all numbers
    const finalMessageStats = {
      total: parseInt(messageStats[0]?.total || 0),
      sent: parseInt(messageStats[0]?.sent || 0),
      delivered: parseInt(messageStats[0]?.delivered || 0),
      read: parseInt(messageStats[0]?.read || 0),
      failed: parseInt(messageStats[0]?.failed || 0),
      pending: parseInt(messageStats[0]?.pending || 0),
    };

    // Get campaigns by status
    const campaignsByStatus = await query(
      `SELECT status, COUNT(*) as count
      FROM beta_campaign
      WHERE uid = ?
      GROUP BY status
      ORDER BY status`,
      [uid],
    );

    // Get daily stats for the last 7 days - FIXED: Added backticks around 'read'
    const dailyStats = await query(
      `SELECT 
        DATE(l.createdAt) as date,
        COUNT(*) as total_messages,
        SUM(CASE WHEN l.status = 'SENT' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN l.delivery_status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN l.delivery_status = 'read' THEN 1 ELSE 0 END) as \`read\`,
        SUM(CASE WHEN l.status = 'FAILED' THEN 1 ELSE 0 END) as failed
      FROM beta_campaign_logs l
      WHERE l.uid = ? 
      AND l.createdAt >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(l.createdAt)
      ORDER BY date DESC`,
      [uid],
    );

    // Get recent campaigns with updated counts from campaign table
    const recentCampaigns = await query(
      `SELECT 
        c.campaign_id,
        c.title,
        c.template_name,
        c.status,
        c.createdAt,
        c.schedule,
        c.total_contacts,
        c.sent_count,
        c.delivered_count,
        c.read_count,
        c.failed_count,
        p.name as phonebook_name
      FROM beta_campaign c
      LEFT JOIN phonebook p ON c.phonebook_id = p.id
      WHERE c.uid = ?
      ORDER BY c.createdAt DESC
      LIMIT 10`,
      [uid],
    );

    res.json({
      success: true,
      totalCampaigns: totalCampaigns[0].count,
      messageStats: finalMessageStats,
      campaignsByStatus,
      dailyStats,
      recentCampaigns,
    });
  } catch (error) {
    logger.error("Error fetching dashboard data:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard data",
      details: error.message,
    });
  }
});

// Export campaign logs to CSV
router.get("/export/:campaignId", validateUser, async (req, res) => {
  try {
    const uid = req.decode.uid;
    const { campaignId } = req.params;

    // Verify campaign belongs to user
    const campaign = await query(
      `
      SELECT * FROM beta_campaign WHERE campaign_id = ? AND uid = ?
    `,
      [campaignId, uid],
    );

    if (!campaign || campaign.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Campaign not found" });
    }

    // Get all logs
    const logs = await query(
      `
      SELECT 
        contact_name,
        contact_mobile,
        status,
        delivery_status,
        error_message,
        createdAt,
        delivery_time
      FROM beta_campaign_logs
      WHERE campaign_id = ?
      ORDER BY createdAt
    `,
      [campaignId],
    );

    // Convert to CSV format
    const fields = [
      "contact_name",
      "contact_mobile",
      "status",
      "delivery_status",
      "error_message",
      "createdAt",
      "delivery_time",
    ];
    const csv = [
      fields.join(","),
      ...logs.map((log) =>
        fields
          .map(
            (field) => `"${(log[field] || "").toString().replace(/"/g, '""')}"`,
          )
          .join(","),
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="campaign-${campaignId}.csv"`,
    );
    res.send(csv);
  } catch (error) {
    logger.error("Error exporting campaign data:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to export campaign data" });
  }
});

router.post("/del_campaign", validateUser, async (req, res) => {
  try {
    const uid = req.decode.uid;
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Campaign ID is required",
      });
    }

    // Verify campaign belongs to user
    const campaignCheck = await query(
      "SELECT campaign_id FROM beta_campaign WHERE campaign_id = ? AND uid = ?",
      [id, uid],
    );

    if (!campaignCheck || campaignCheck.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Campaign not found",
      });
    }

    // Start transaction
    await query("START TRANSACTION");

    try {
      // Delete logs first (foreign key constraint)
      await query("DELETE FROM beta_campaign_logs WHERE campaign_id = ?", [id]);

      // Delete campaign
      await query(
        "DELETE FROM beta_campaign WHERE campaign_id = ? AND uid = ?",
        [id, uid],
      );

      // Commit transaction
      await query("COMMIT");

      res.json({
        success: true,
        message: "Campaign deleted successfully",
      });
    } catch (error) {
      // Rollback on error
      await query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    logger.error("Error deleting campaign:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete campaign",
      details: error.message,
    });
  }
});

module.exports = router;
