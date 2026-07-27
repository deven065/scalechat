const isLogging = process.env.NODE_ENV === "logs";

const logger = {
  log: (...args) => {
    if (isLogging) console.log(...args);
  },
  error: (...args) => {
    if (isLogging) console.error(...args);
  },
  warn: (...args) => {
    if (isLogging) console.warn(...args);
  },
  dir: (obj, options) => {
    if (isLogging) console.dir(obj, options);
  },
};

module.exports = logger;
