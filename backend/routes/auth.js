const express = require("express");
const {
  clearSessionCookie,
  getSessionToken,
  hashSessionToken,
  requireSession,
  sendError
} = require("../lib/request_auth");

const router = express.Router();

module.exports = (db) => {
  router.get("/me", requireSession, (req, res) => {
    res.json({ user: req.user });
  });

  router.post("/logout", async (req, res) => {
    try {
      if (req.session) {
        await db.execute(
          "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL",
          [hashSessionToken(getSessionToken(req))]
        );
      }
      clearSessionCookie(res);
      res.json({ message: "Logged out" });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
};
