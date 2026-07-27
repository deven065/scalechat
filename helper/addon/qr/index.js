const fs = require("fs");
const path = require("path");
const pino = require("pino");
const { toDataURL } = require("qrcode");
const { query } = require("../../../database/dbpromise");

// Stub functions that do nothing or return default values
function downloadMediaMessage() {}

function getUrlInfo() {}

function generateProfilePicture() {}

const isSessionExists = () => false;

const createSession = async () => {
  return "Session creation disabled";
};

const getSession = () => null;

const deleteSession = async () => {};

const isExists = async () => false;

const sendMessage = async () => {
  return Promise.reject(null);
};

const formatPhone = (phone) => {
  if (phone.endsWith("@s.whatsapp.net")) return phone;
  let formatted = phone.replace(/\D/g, "");
  return formatted + "@s.whatsapp.net";
};

const formatGroup = (group) => {
  if (group.endsWith("@g.us")) return group;
  let formatted = group.replace(/[^\d-]/g, "");
  return formatted + "@g.us";
};

const cleanup = async () => {
  console.log("Cleanup called (stub)");
};

const init = async () => {
  console.log("Init called (stub)");
};

const getGroupData = async () => {
  return Promise.reject(null);
};

const checkQr = () => false;

const getStorageConfig = async () => {
  return {
    method: "none",
    mongoUri: "not set",
    mysqlHost: "localhost",
  };
};

module.exports = {
  isSessionExists,
  createSession,
  getSession,
  deleteSession,
  isExists,
  sendMessage,
  formatPhone,
  formatGroup,
  cleanup,
  init,
  getGroupData,
  getUrlInfo,
  downloadMediaMessage,
  checkQr,
  generateProfilePicture,
  getStorageConfig,
};
