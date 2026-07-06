# 快速启动指南

## 🚀 5分钟快速部署

### 0. 使用本地 MySQL（推荐）

确保你当前机器的 MySQL 服务已经启动，并存在以下数据库：

```sql
CREATE DATABASE IF NOT EXISTS order_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS user_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

项目后端默认读取 `.env` 里的 MySQL 配置并连接本机 `127.0.0.1:3306`。

### 1. 准备环境变量

```bash
# 复制模板文件
cp env.template .env

# 编辑 .env 文件，至少修改以下内容：
# - DB_HOST: 127.0.0.1
# - USER_DB_HOST: 127.0.0.1
# - DB_PASSWORD: 数据库密码
# - USER_DB_PASSWORD: 用户数据库密码
# - CORS_ORIGIN: 前端访问地址（如：http://192.168.1.100:3000）
```

### 2. 运行部署脚本

**Linux/Mac:**
```bash
chmod +x deploy.sh
./deploy.sh
```

**Windows:**
```cmd
deploy.bat
```

### 3. 启动服务

```bash
# 使用 PM2（推荐）
pm2 start ecosystem.config.js --env production

# 或使用 npm
npm run pm2:start
```

### 4. 验证服务

访问：`http://服务器IP:3000`

---

## 📋 部署检查清单

- [ ] Node.js 已安装（v14+）
- [ ] MySQL 已安装并运行
- [ ] 数据库已创建（order_system, user_system）
- [ ] `.env` 文件已配置
- [ ] 依赖包已安装（`npm install --production`）
- [ ] 日志目录已创建（`logs/`, `uploads/`）
- [ ] PM2 已安装（可选但推荐）
- [ ] 防火墙端口已开放（默认 3000）
- [ ] 服务已启动并运行正常

---

## 🔧 常用命令

```bash
# 启动服务
pm2 start ecosystem.config.js --env production

# 停止服务
pm2 stop transport-order-management

# 重启服务
pm2 restart transport-order-management

# 查看日志
pm2 logs transport-order-management

# 查看状态
pm2 status

# 监控
pm2 monit
```

---

## ⚠️ 重要提示

1. **安全**: 确保 `.env` 文件不被提交到版本控制系统
2. **密码**: 生产环境必须使用强密码
3. **CORS**: 配置正确的 CORS_ORIGIN 以允许前端访问
4. **备份**: 定期备份数据库
5. **日志**: 定期检查日志文件

---

## 📚 详细文档

查看 `DEPLOYMENT.md` 获取完整的部署文档。
