function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getRequestUserId(req) {
  return String(req.headers["x-user-id"] || "").trim();
}

async function requireAdminAccess(userDb, req, featureName = "该功能") {
  if (!userDb) {
    throw createHttpError(500, `${featureName}缺少用户数据库配置`);
  }

  const userId = getRequestUserId(req);
  if (!userId) {
    throw createHttpError(401, `请先登录后再使用${featureName}`);
  }

  const [rows] = await userDb.execute(
    "SELECT id, role FROM users WHERE id = ? LIMIT 1",
    [userId]
  );

  if (!rows.length) {
    throw createHttpError(401, "当前登录用户不存在或已失效");
  }

  if (String(rows[0].role || "").trim() !== "admin") {
    throw createHttpError(403, `${featureName}仅管理员可操作`);
  }

  return rows[0];
}

module.exports = {
  createHttpError,
  getRequestUserId,
  requireAdminAccess,
};
