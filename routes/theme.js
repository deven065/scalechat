const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const adminValidator = require("../middlewares/admin");
const logger = require("../utils/logger.js");

const THEMES_DIR = path.join(__dirname, "./themes");
const REGISTRY_FILE = path.join(THEMES_DIR, "themes-registry.json");
const ACTIVE_FILE = path.join(THEMES_DIR, "active-theme.json");
const DEFAULT_THEME_ID = "default";

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

const ensureThemesDir = () => {
  if (!fs.existsSync(THEMES_DIR)) fs.mkdirSync(THEMES_DIR, { recursive: true });
};

const readRegistry = () => {
  ensureThemesDir();
  if (!fs.existsSync(REGISTRY_FILE)) {
    const initial = { themes: [] };
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
};

const writeRegistry = (data) => {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2));
};

const readActiveThemeId = () => {
  if (!fs.existsSync(ACTIVE_FILE)) return DEFAULT_THEME_ID;
  try {
    return (
      JSON.parse(fs.readFileSync(ACTIVE_FILE, "utf8")).activeThemeId ||
      DEFAULT_THEME_ID
    );
  } catch {
    return DEFAULT_THEME_ID;
  }
};

const writeActiveThemeId = (id) => {
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ activeThemeId: id }, null, 2));
};

const themeFilePath = (id) => path.join(THEMES_DIR, `${id}.json`);

const readThemeById = (id) => {
  const fp = themeFilePath(id);
  if (!fs.existsSync(fp)) throw new Error(`Theme '${id}' not found`);
  return JSON.parse(fs.readFileSync(fp, "utf8"));
};

const writeThemeById = (id, data) => {
  fs.writeFileSync(themeFilePath(id), JSON.stringify(data, null, 2));
};

const generateId = () =>
  `theme-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const isObject = (item) =>
  item && typeof item === "object" && !Array.isArray(item);

const deepMerge = (target, source) => {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        output[key] = !(key in target)
          ? source[key]
          : deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    });
  }
  return output;
};

// ══════════════════════════════════════════════════════════════════════════════
//  SEED DEFAULT THEME ON STARTUP
// ══════════════════════════════════════════════════════════════════════════════

const seedDefaultTheme = () => {
  ensureThemesDir();
  const registry = readRegistry();
  const hasDefault = registry.themes.some((t) => t.id === DEFAULT_THEME_ID);

  if (!hasDefault) {
    const legacyDefault = path.join(__dirname, "./theme.default.json");
    const legacyTheme = path.join(__dirname, "./theme.json");

    let defaultData = {};

    if (fs.existsSync(legacyDefault)) {
      defaultData = JSON.parse(fs.readFileSync(legacyDefault, "utf8"));
    } else if (fs.existsSync(legacyTheme)) {
      // migrate existing theme.json as the default
      defaultData = JSON.parse(fs.readFileSync(legacyTheme, "utf8"));
    }

    defaultData.lastUpdated = new Date().toISOString();
    writeThemeById(DEFAULT_THEME_ID, defaultData);

    registry.themes.unshift({
      id: DEFAULT_THEME_ID,
      name: "Default Theme",
      description: "Factory default — protected and cannot be deleted",
      isProtected: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    writeRegistry(registry);
    logger.log("✅ Default theme seeded.");
  }

  if (!fs.existsSync(ACTIVE_FILE)) {
    writeActiveThemeId(DEFAULT_THEME_ID);
    logger.log("✅ Active theme pointer created → default.");
  }
};

seedDefaultTheme();

// GET /api/theme/list-themes
router.get("/list-themes", (req, res) => {
  try {
    const registry = readRegistry();
    const activeId = readActiveThemeId();
    const themes = registry.themes.map((t) => ({
      ...t,
      isActive: t.id === activeId,
    }));
    res.json({ success: true, data: themes });
  } catch (err) {
    logger.error("list-themes error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET /api/theme/active-theme
router.get("/active-theme", adminValidator, (req, res) => {
  try {
    const activeId = readActiveThemeId();
    const registry = readRegistry();
    const meta = registry.themes.find((t) => t.id === activeId) || {};
    const data = readThemeById(activeId);
    res.json({
      success: true,
      data: { ...meta, themeData: data, id: activeId },
      msg: "Active theme fetched",
    });
  } catch (err) {
    logger.error("active-theme error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/set-active-theme
router.post("/set-active-theme", adminValidator, (req, res) => {
  try {
    const { themeId } = req.body;
    if (!themeId)
      return res
        .status(400)
        .json({ success: false, msg: "themeId is required" });

    const registry = readRegistry();
    const exists = registry.themes.some((t) => t.id === themeId);
    if (!exists)
      return res.status(404).json({ success: false, msg: "Theme not found" });

    writeActiveThemeId(themeId);
    res.json({
      success: true,
      msg: `Active theme set to '${themeId}'`,
    });
  } catch (err) {
    logger.error("set-active-theme error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET /api/theme/get-theme/:id
router.get("/get-theme/:id", (req, res) => {
  try {
    const data = readThemeById(req.params.id);
    res.json({ success: true, data, msg: "Theme fetched" });
  } catch (err) {
    logger.error("get-theme error:", err);
    res.status(404).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/create-theme
router.post("/create-theme", adminValidator, (req, res) => {
  try {
    const { name, description, cloneFromId, themeData } = req.body;
    if (!name)
      return res
        .status(400)
        .json({ success: false, msg: "Theme name is required" });

    const id = generateId();
    let data = {};

    if (cloneFromId) {
      try {
        data = { ...readThemeById(cloneFromId) };
      } catch {
        // cloneFromId not found, start fresh
      }
    } else if (themeData && isObject(themeData)) {
      data = themeData;
    }

    data.lastUpdated = new Date().toISOString();
    writeThemeById(id, data);

    const registry = readRegistry();
    const now = new Date().toISOString();
    registry.themes.push({
      id,
      name,
      description: description || "",
      isProtected: false,
      createdAt: now,
      updatedAt: now,
    });
    writeRegistry(registry);

    res.json({
      success: true,
      data: { id, name, description, themeData: data },
      msg: "Theme created successfully",
    });
  } catch (err) {
    logger.error("create-theme error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/update-theme/:id
router.post("/update-theme/:id", adminValidator, (req, res) => {
  try {
    const { id } = req.params;
    const { themeData, name, description } = req.body;

    const registry = readRegistry();
    const meta = registry.themes.find((t) => t.id === id);
    if (!meta)
      return res.status(404).json({ success: false, msg: "Theme not found" });

    if (themeData) {
      themeData.lastUpdated = new Date().toISOString();
      writeThemeById(id, themeData);
    }

    if (name) meta.name = name;
    if (description !== undefined) meta.description = description;
    meta.updatedAt = new Date().toISOString();
    writeRegistry(registry);

    res.json({
      success: true,
      data: { id, ...meta },
      msg: "Theme updated successfully",
    });
  } catch (err) {
    logger.error("update-theme error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/delete-theme/:id
router.post("/delete-theme/:id", adminValidator, (req, res) => {
  try {
    const { id } = req.params;
    const registry = readRegistry();
    const meta = registry.themes.find((t) => t.id === id);

    if (!meta)
      return res.status(404).json({ success: false, msg: "Theme not found" });
    if (meta.isProtected)
      return res
        .status(403)
        .json({ success: false, msg: "Cannot delete a protected theme" });

    const activeId = readActiveThemeId();
    if (activeId === id) writeActiveThemeId(DEFAULT_THEME_ID);

    const fp = themeFilePath(id);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);

    registry.themes = registry.themes.filter((t) => t.id !== id);
    writeRegistry(registry);

    res.json({ success: true, msg: "Theme deleted successfully" });
  } catch (err) {
    logger.error("delete-theme error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/duplicate-theme/:id
router.post("/duplicate-theme/:id", adminValidator, (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const registry = readRegistry();
    const sourceMeta = registry.themes.find((t) => t.id === id);

    if (!sourceMeta)
      return res
        .status(404)
        .json({ success: false, msg: "Source theme not found" });

    const newId = generateId();
    const sourceData = readThemeById(id);
    sourceData.lastUpdated = new Date().toISOString();
    writeThemeById(newId, sourceData);

    const now = new Date().toISOString();
    const newMeta = {
      id: newId,
      name: name || `${sourceMeta.name} (Copy)`,
      description: sourceMeta.description,
      isProtected: false,
      createdAt: now,
      updatedAt: now,
    };
    registry.themes.push(newMeta);
    writeRegistry(registry);

    res.json({
      success: true,
      data: { ...newMeta, themeData: sourceData },
      msg: "Theme duplicated successfully",
    });
  } catch (err) {
    logger.error("duplicate-theme error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/rename-theme/:id
router.post("/rename-theme/:id", adminValidator, (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const registry = readRegistry();
    const meta = registry.themes.find((t) => t.id === id);

    if (!meta)
      return res.status(404).json({ success: false, msg: "Theme not found" });
    if (meta.isProtected)
      return res
        .status(403)
        .json({ success: false, msg: "Cannot rename a protected theme" });

    if (name) meta.name = name;
    if (description !== undefined) meta.description = description;
    meta.updatedAt = new Date().toISOString();
    writeRegistry(registry);

    res.json({
      success: true,
      data: meta,
      msg: "Theme renamed successfully",
    });
  } catch (err) {
    logger.error("rename-theme error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/import-theme
router.post("/import-theme", adminValidator, (req, res) => {
  try {
    const { name, description, themeData } = req.body;
    if (!themeData || !isObject(themeData))
      return res.status(400).json({ success: false, msg: "Invalid themeData" });

    const id = generateId();
    themeData.lastUpdated = new Date().toISOString();
    writeThemeById(id, themeData);

    const registry = readRegistry();
    const now = new Date().toISOString();
    registry.themes.push({
      id,
      name: name || `Imported Theme ${new Date().toLocaleDateString()}`,
      description: description || "Imported theme",
      isProtected: false,
      createdAt: now,
      updatedAt: now,
    });
    writeRegistry(registry);

    res.json({
      success: true,
      data: { id, themeData },
      msg: "Theme imported successfully",
    });
  } catch (err) {
    logger.error("import-theme error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/reset-to-default
router.post("/reset-to-default", adminValidator, (req, res) => {
  try {
    writeActiveThemeId(DEFAULT_THEME_ID);
    const data = readThemeById(DEFAULT_THEME_ID);
    res.json({
      success: true,
      data,
      msg: "Active theme reset to default successfully",
    });
  } catch (err) {
    logger.error("reset-to-default error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET /api/theme/export-theme/:id
router.get("/export-theme/:id", adminValidator, (req, res) => {
  try {
    const data = readThemeById(req.params.id);
    const registry = readRegistry();
    const meta = registry.themes.find((t) => t.id === req.params.id) || {};
    const exportPayload = { _meta: meta, ...data };
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${(meta.name || req.params.id).replace(/\s+/g, "-")}-theme.json`,
    );
    res.send(JSON.stringify(exportPayload, null, 2));
  } catch (err) {
    logger.error("export-theme/:id error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  LEGACY ROUTES — all operate on the currently active theme
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/theme/get-theme-config
router.get("/get-theme-config", (req, res) => {
  try {
    const activeId = readActiveThemeId();
    const data = readThemeById(activeId);
    res.json({
      success: true,
      data,
      msg: "Theme configuration fetched successfully",
    });
  } catch (err) {
    logger.error("get-theme-config error:", err);
    res.status(500).json({ success: false, data: null, msg: err.message });
  }
});

// POST /api/theme/update-theme-config
router.post("/update-theme-config", adminValidator, (req, res) => {
  try {
    const newTheme = req.body;
    if (!newTheme || Object.keys(newTheme).length === 0)
      return res
        .status(400)
        .json({ success: false, msg: "Theme data is required" });

    const activeId = readActiveThemeId();
    newTheme.lastUpdated = new Date().toISOString();
    writeThemeById(activeId, newTheme);

    const registry = readRegistry();
    const meta = registry.themes.find((t) => t.id === activeId);
    if (meta) {
      meta.updatedAt = new Date().toISOString();
      writeRegistry(registry);
    }

    res.json({
      success: true,
      data: newTheme,
      msg: "Theme configuration updated successfully",
    });
  } catch (err) {
    logger.error("update-theme-config error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/update-theme-partial
router.post("/update-theme-partial", adminValidator, (req, res) => {
  try {
    const updates = req.body;
    if (!updates || Object.keys(updates).length === 0)
      return res
        .status(400)
        .json({ success: false, msg: "Update data is required" });

    const activeId = readActiveThemeId();
    const existing = readThemeById(activeId);
    const merged = deepMerge(existing, updates);
    merged.lastUpdated = new Date().toISOString();
    writeThemeById(activeId, merged);

    res.json({
      success: true,
      data: merged,
      msg: "Theme partially updated successfully",
    });
  } catch (err) {
    logger.error("update-theme-partial error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET /api/theme/get-theme-section/:section
router.get("/get-theme-section/:section", (req, res) => {
  try {
    const activeId = readActiveThemeId();
    const theme = readThemeById(activeId);
    const { section } = req.params;
    if (!theme[section])
      return res
        .status(404)
        .json({ success: false, msg: `Section '${section}' not found` });

    res.json({
      success: true,
      data: theme[section],
      msg: `Section '${section}' fetched successfully`,
    });
  } catch (err) {
    logger.error("get-theme-section error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/update-theme-section/:section
router.post("/update-theme-section/:section", adminValidator, (req, res) => {
  try {
    const { section } = req.params;
    const updates = req.body;
    if (!updates || Object.keys(updates).length === 0)
      return res
        .status(400)
        .json({ success: false, msg: "Update data is required" });

    const activeId = readActiveThemeId();
    const theme = readThemeById(activeId);
    if (!theme[section])
      return res
        .status(404)
        .json({ success: false, msg: `Section '${section}' not found` });

    theme[section] =
      isObject(theme[section]) && isObject(updates)
        ? deepMerge(theme[section], updates)
        : updates;
    theme.lastUpdated = new Date().toISOString();
    writeThemeById(activeId, theme);

    res.json({
      success: true,
      data: theme[section],
      msg: `Section '${section}' updated successfully`,
    });
  } catch (err) {
    logger.error("update-theme-section error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/reset-theme-config
router.post("/reset-theme-config", adminValidator, (req, res) => {
  try {
    const defaultData = readThemeById(DEFAULT_THEME_ID);
    const activeId = readActiveThemeId();
    const resetData = {
      ...defaultData,
      lastUpdated: new Date().toISOString(),
    };
    writeThemeById(activeId, resetData);
    res.json({
      success: true,
      data: resetData,
      msg: "Theme reset to default successfully",
    });
  } catch (err) {
    logger.error("reset-theme-config error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET /api/theme/get-all-theme-sections
router.get("/get-all-theme-sections", (req, res) => {
  try {
    const activeId = readActiveThemeId();
    const theme = readThemeById(activeId);
    res.json({
      success: true,
      data: Object.keys(theme),
      msg: "Theme sections fetched successfully",
    });
  } catch (err) {
    logger.error("get-all-theme-sections error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/update-brand-colors
router.post("/update-brand-colors", adminValidator, (req, res) => {
  try {
    const { primary, secondary, accent, success, warning, error, info } =
      req.body;
    const activeId = readActiveThemeId();
    const theme = readThemeById(activeId);
    if (!theme.brandColors) theme.brandColors = {};
    if (primary) theme.brandColors.primary = primary;
    if (secondary) theme.brandColors.secondary = secondary;
    if (accent) theme.brandColors.accent = accent;
    if (success) theme.brandColors.success = success;
    if (warning) theme.brandColors.warning = warning;
    if (error) theme.brandColors.error = error;
    if (info) theme.brandColors.info = info;
    theme.lastUpdated = new Date().toISOString();
    writeThemeById(activeId, theme);
    res.json({
      success: true,
      data: theme.brandColors,
      msg: "Brand colors updated successfully",
    });
  } catch (err) {
    logger.error("update-brand-colors error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/update-typography
router.post("/update-typography", adminValidator, (req, res) => {
  try {
    const updates = req.body;
    const activeId = readActiveThemeId();
    const theme = readThemeById(activeId);
    if (!theme.typography) theme.typography = {};
    theme.typography = { ...theme.typography, ...updates };
    theme.lastUpdated = new Date().toISOString();
    writeThemeById(activeId, theme);
    res.json({
      success: true,
      data: theme.typography,
      msg: "Typography updated successfully",
    });
  } catch (err) {
    logger.error("update-typography error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/update-component-style/:component
router.post(
  "/update-component-style/:component",
  adminValidator,
  (req, res) => {
    try {
      const { component } = req.params;
      const updates = req.body;
      const activeId = readActiveThemeId();
      const theme = readThemeById(activeId);
      if (!theme[component]) theme[component] = {};
      theme[component] = deepMerge(theme[component], updates);
      theme.lastUpdated = new Date().toISOString();
      writeThemeById(activeId, theme);
      res.json({
        success: true,
        data: theme[component],
        msg: `Component '${component}' updated successfully`,
      });
    } catch (err) {
      logger.error("update-component-style error:", err);
      res.status(500).json({ success: false, msg: err.message });
    }
  },
);

// GET /api/theme/export-theme  (legacy — exports active theme)
router.get("/export-theme", (req, res) => {
  try {
    const activeId = readActiveThemeId();
    const data = readThemeById(activeId);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=theme-export-${Date.now()}.json`,
    );
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error("export-theme error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/import-theme (legacy — imports and sets as active)
router.post("/import-theme-legacy", adminValidator, (req, res) => {
  try {
    const importedTheme = req.body;
    if (!importedTheme || Object.keys(importedTheme).length === 0)
      return res
        .status(400)
        .json({ success: false, msg: "Invalid theme data" });

    const activeId = readActiveThemeId();
    importedTheme.lastUpdated = new Date().toISOString();
    writeThemeById(activeId, importedTheme);

    const registry = readRegistry();
    const meta = registry.themes.find((t) => t.id === activeId);
    if (meta) {
      meta.updatedAt = new Date().toISOString();
      writeRegistry(registry);
    }

    res.json({
      success: true,
      data: importedTheme,
      msg: "Theme imported successfully",
    });
  } catch (err) {
    logger.error("import-theme-legacy error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET /api/theme/get-theme-backups
router.get("/get-theme-backups", (req, res) => {
  try {
    const registry = readRegistry();
    const activeId = readActiveThemeId();
    const backups = registry.themes
      .filter((t) => t.id !== activeId)
      .map((t) => ({
        filename: t.id,
        name: t.name,
        created: t.createdAt,
        isProtected: t.isProtected,
      }));
    res.json({
      success: true,
      data: backups,
      msg: "Theme backups fetched successfully",
    });
  } catch (err) {
    logger.error("get-theme-backups error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// POST /api/theme/restore-theme-backup/:filename
router.post("/restore-theme-backup/:filename", adminValidator, (req, res) => {
  try {
    const { filename } = req.params;
    const registry = readRegistry();
    const exists = registry.themes.some((t) => t.id === filename);
    if (!exists)
      return res.status(404).json({ success: false, msg: "Backup not found" });

    writeActiveThemeId(filename);
    const data = readThemeById(filename);
    res.json({
      success: true,
      data,
      msg: "Theme restored from backup successfully",
    });
  } catch (err) {
    logger.error("restore-theme-backup error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// GET /api/theme/get-theme-metadata
router.get("/get-theme-metadata", (req, res) => {
  try {
    const activeId = readActiveThemeId();
    const theme = readThemeById(activeId);
    const registry = readRegistry();
    const meta = registry.themes.find((t) => t.id === activeId) || {};
    res.json({
      success: true,
      data: {
        version: theme.version || "1.0.0",
        lastUpdated: theme.lastUpdated || "Unknown",
        themeName: meta.name || "Default Theme",
        description: meta.description || "No description",
      },
      msg: "Theme metadata fetched successfully",
    });
  } catch (err) {
    logger.error("get-theme-metadata error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

module.exports = router;
