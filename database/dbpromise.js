const con = require("./config");

function query(sql, arr) {
  return new Promise((resolve, reject) => {
    if (!sql) {
      return reject(new Error("No SQL query provided"));
    }

    const params = arr || [];

    con.query(sql, params, (err, result) => {
      if (err) {
        console.error("Query error:", err);
        return reject(err);
      }
      return resolve(result);
    });
  });
}

module.exports = { query };
