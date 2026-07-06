const express = require("express");
const router = express.Router();

module.exports = (db) => {
  // GET all users
  router.get("/", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM users");
      res.json({ users: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET single user by id
  router.get("/:id", async (req, res) => {
    try {
      const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [req.params.id]);
      if (rows.length === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ user: rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create new user
  router.post("/", async (req, res) => {
    try {
      console.log("Register request body:", req.body);
      let { username, password, role, email } = req.body;

      // Basic validation
      if (!username || !password) {
        return res.status(400).json({ error: "username and password are required" });
      }

      // Convert undefined optional fields to null for mysql2
      if (typeof email === 'undefined') email = null;
      if (typeof role === 'undefined' || role === null) role = 'user';

      const sql = "INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)";
      const [result] = await db.execute(sql, [username, password, role, email]);
      res.json({ id: result.insertId, message: "User created successfully" });
    } catch (err) {
      console.error('Error in POST /api/users:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update user
  router.put("/:id", async (req, res) => {
    try {
      const { username, password, role } = req.body;
      const sql = "UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?";
      const [result] = await db.execute(sql, [username, password, role, req.params.id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ message: "User updated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE user
  router.delete("/:id", async (req, res) => {
    try {
      const [result] = await db.execute("DELETE FROM users WHERE id = ?", [req.params.id]);
      if (result.affectedRows === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ message: "User deleted successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST login
  router.post("/login", async (req, res) => {
    try {
      console.log("Login request body:", req.body);
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      // 检查用户是否存在
      const [rows] = await db.execute("SELECT id, username, password, role FROM users WHERE username = ?", [username]);

      if (rows.length === 0) {
        return res.status(401).json({ error: "用户名不存在" });
      }

      const user = rows[0];

      // 简单密码验证（生产环境应该使用哈希）
      if (user.password !== password) {
        return res.status(401).json({ error: "密码错误" });
      }

      // 登录成功，返回用户信息（不包含密码）
      res.json({
        message: "Login successful",
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
