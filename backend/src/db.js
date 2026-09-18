const sql = require("mssql");
require("dotenv").config();

const config = {
  server: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "ColdChainDB",
  options: {
    encrypt: String(process.env.DB_ENCRYPT).toLowerCase() === "true",
    trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE || "true").toLowerCase() === "true"
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  connectionTimeout: 10000,
  requestTimeout: 30000
};

const poolPromise = new sql.ConnectionPool(config).connect().then((pool) => {
  console.log("SQL Server connected!");
  return pool;
});
poolPromise.catch((error) => console.error("SQL Server connection failed:", error.message));
module.exports = poolPromise;
