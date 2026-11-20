const express = require("express");
const { createHttpError, requireAdminSession, sendError } = require("../lib/request_auth");
const { normalizedCompanySql, validateCompanyName } = require("../lib/order_access");

module.exports = (userDb, orderDb) => {
  const router = express.Router();

  function userId(value) {
    if (!/^[1-9]\d*$/.test(String(value))) throw createHttpError(400, "Invalid user ID");
    return String(value);
  }

  async function requireTarget(db, id, lock = false) {
    const [rows] = await db.execute(
      `SELECT id FROM users WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [id]
    );
    if (!rows.length) throw createHttpError(404, "User not found");
  }

  async function readCompanies(db, id) {
    const [rows] = await db.execute(
      "SELECT company_name FROM user_order_companies WHERE user_id = ? ORDER BY company_name", [id]
    );
    return rows.map((row) => row.company_name);
  }

  router.get("/order-companies", requireAdminSession, async (_req, res) => {
    try {
      const expression = normalizedCompanySql("company_name");
      const [rows] = await orderDb.execute(
        `SELECT DISTINCT CAST(${expression} AS BINARY) AS company_name
         FROM orders WHERE CHAR_LENGTH(${expression}) BETWEEN 1 AND 200
         ORDER BY company_name`
      );
      res.json({ companies: rows.map((row) =>
        Buffer.isBuffer(row.company_name) ? row.company_name.toString("utf8") : row.company_name
      ).filter((name) => !name.includes("\0")) });
    } catch (error) {
      sendError(res, error, "Unable to load order companies");
    }
  });

  router.get("/:id/order-companies", requireAdminSession, async (req, res) => {
    try {
      const id = userId(req.params.id);
      await requireTarget(userDb, id);
      res.json({ user_id: id, companies: await readCompanies(userDb, id) });
    } catch (error) {
      sendError(res, error, "Unable to load order permissions");
    }
  });

  async function mutate(req, res, mode) {
    let connection;
    let started = false;
    try {
      const id = userId(req.params.id);
      let companies;
      if (mode === "replace") {
        if (!Array.isArray(req.body?.companies)) throw createHttpError(400, "companies must be an array");
        companies = [...new Set(req.body.companies.map(validateCompanyName))];
      } else {
        companies = [validateCompanyName(req.body?.company_name)];
      }
      connection = await userDb.getConnection();
      await connection.beginTransaction();
      started = true;
      // Serialize all permission changes for a user, including an empty whitelist.
      await requireTarget(connection, id, true);
      if (mode === "replace") {
        await connection.execute("DELETE FROM user_order_companies WHERE user_id = ?", [id]);
      }
      if (mode === "delete") {
        await connection.execute(
          "DELETE FROM user_order_companies WHERE user_id = ? AND company_name = ?", [id, companies[0]]
        );
      } else {
        for (const company of companies) {
          await connection.execute(
            `INSERT INTO user_order_companies (user_id, company_name) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE company_name = VALUES(company_name)`, [id, company]
          );
        }
      }
      const saved = await readCompanies(connection, id);
      await connection.commit();
      started = false;
      res.json({ message: "Order permissions saved", user_id: id, companies: saved });
    } catch (error) {
      if (connection && started) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("Order permission rollback failed:", rollbackError.code || "database_error");
          connection.destroy();
          connection = null;
        }
      }
      sendError(res, error, "Unable to save order permissions");
    } finally {
      if (connection) connection.release();
    }
  }

  router.put("/:id/order-companies", requireAdminSession, (req, res) => mutate(req, res, "replace"));
  router.post("/:id/order-companies", requireAdminSession, (req, res) => mutate(req, res, "add"));
  router.delete("/:id/order-companies", requireAdminSession, (req, res) => mutate(req, res, "delete"));
  return router;
};
