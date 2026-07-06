# 🚀 服务器部署快速参考指南

## 一句话总结

将项目从 `d:\transFormation` 迁移到服务器 `c:\transform`，自动创建数据库表。

---

## ⚡ 5 分钟快速部署

### 前置条件
- [ ] 服务器安装了 Node.js 14+
- [ ] 服务器安装了 MySQL 5.7+
- [ ] MySQL 服务已启动
- [ ] 拥有 MySQL root 权限

### 部署步骤

```powershell
# 1. 进入项目目录
cd d:\transFormation

# 2. 运行自动部署脚本（推荐）
.\deploy-server.bat

# 或手动部署
# 3. 复制配置文件
copy env.server .env

# 4. 编辑 .env（更新数据库密码）
notepad .env

# 5. 安装依赖
npm install --production

# 6. 初始化数据库
node setup_db_server.js

# 7. 启动应用
npm start
```

应用启动后访问：**http://localhost:3000**

---

## 📋 关键配置

编辑 `.env` 文件，修改以下项：

```ini
# 最重要的три 项
DB_PASSWORD=你的MySQL密码           # ← 修改为实际密码
USER_DB_PASSWORD=你的MySQL密码      # ← 修改为实际密码
CORS_ORIGIN=http://服务器IP:3000   # ← 修改为实际服务器地址
```

---

## 📊 创建的数据库

| 数据库 | 表数 | 说明 |
|--------|------|------|
| `order_system` | 5 | 订单系统 |
| `user_system` | 5 | 用户系统 |
|  | **10 个表** | **自动创建** |

### order_system 数据库的表

1. **orders** - 订单信息
2. **package** - 包裹信息
3. **pickup_transport_tracking** - 提货运输跟踪
4. **products** - 产品信息
5. **transfer** - 运输流转信息

### user_system 数据库的表

1. **users** - 用户账户
2. **guests** - 客户信息
3. **sender_info** - 发件人信息库
4. **customer_info** - 客户信息库
5. **customs_clearance_tracking** - 报关信息跟踪

---

## 🛠️ 常用命令

### 开发环境

```powershell
# 启动应用（前台）
npm start

# 应用会运行在 http://localhost:3000
```

### 生产环境

```powershell
# 安装 PM2（第一次）
npm install -g pm2

# 启动应用
cd C:\transform
pm2 start ecosystem.config.js --env production

# 查看状态
pm2 status

# 查看日志
pm2 logs

# 停止应用
pm2 stop all

# 重启应用
pm2 restart all

# 设置开机自启
pm2 startup windows
pm2 save
```

---

## 🔧 数据库相关

```powershell
# 初始化数据库（第一次或重新初始化）
node setup_db_server.js

# 连接到 MySQL 命令行
mysql -u root -p

# 查看数据库
mysql -u root -p -e "SHOW DATABASES;"

# 备份数据库
mysqldump -u root -p order_system user_system > backup.sql

# 恢复数据库
mysql -u root -p order_system < backup.sql
```

---

## ❌ 故障排查

### 错误：ECONNREFUSED 3306

**原因**：MySQL 未启动

```powershell
# Windows 启动 MySQL
net start MySQL80  # 或其他版本

# 检查状态
Get-Service MySQL80
```

### 错误：Access denied for user 'root'

**原因**：密码错误

```powershell
# 检查 .env 文件中的密码
notepad .env

# 测试 MySQL 连接
mysql -u root -p
```

### 错误：EADDRINUSE :::3000

**原因**：端口 3000 已被占用

```powershell
# 找出占用的进程
netstat -ano | findstr :3000

# 终止进程（PID 是上面显示的数字）
taskkill /PID <PID> /F

# 或改用其他端口
$env:PORT=8080
npm start
```

### 应用启动后立即崩溃

```powershell
# 查看详细错误
pm2 logs --err

# 或前台运行
npm start

# 重新安装依赖
npm install
```

---

## 📁 文件结构

迁移后的目录结构（在 `C:\transform`）：

```
C:\transform\
├── .env                    # 环境配置（从 env.server 复制并修改）
├── backend/                # 后端代码
│   ├── server.js
│   ├── routes/
│   └── ...
├── frontend/               # 前端代码
│   ├── index.html
│   └── ...
├── setup_db_server.js      # 数据库初始化脚本
├── deploy-server.bat       # 部署脚本
├── package.json
├── ecosystem.config.js
├── logs/                   # 日志目录（自动创建）
├── uploads/                # 文件上传目录（自动创建）
└── ...
```

---

## 🔐 安全建议

1. **更改默认数据库密码**
   ```sql
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'StrongPassword123!';
   ```

2. **创建应用专用数据库用户**
   ```sql
   CREATE USER 'appuser'@'localhost' IDENTIFIED BY 'password';
   GRANT ALL PRIVILEGES ON order_system.* TO 'appuser'@'localhost';
   GRANT ALL PRIVILEGES ON user_system.* TO 'appuser'@'localhost';
   FLUSH PRIVILEGES;
   ```

3. **定期备份数据库**
   ```powershell
   mysqldump -u root -p order_system user_system > backup.sql
   ```

4. **在 .gitignore 中添加 .env**
   ```
   .env
   logs/
   uploads/
   ```

---

## 📞 需要帮助？

1. 查看详细指南：[SERVER_MIGRATION_GUIDE.md](SERVER_MIGRATION_GUIDE.md)
2. 检查日志：`C:\transform\logs\`
3. 查看官方文档：
   - Node.js: https://nodejs.org/docs/
   - MySQL: https://dev.mysql.com/doc/
   - Express: https://expressjs.com/

---

## ✅ 部署检查清单

完成以下步骤后，您的服务器应该可以正常运行：

- [ ] Node.js 已安装（运行 `node --version`）
- [ ] npm 已安装（运行 `npm --version`）
- [ ] MySQL 服务已启动（运行 `net start MySQL80`）
- [ ] 项目代码已复制到 `C:\transform`
- [ ] `.env` 文件已创建并配置正确
- [ ] npm 依赖已安装（运行 `npm install`）
- [ ] 数据库已初始化（运行 `node setup_db_server.js`）
- [ ] 应用能正常启动（运行 `npm start`）
- [ ] 能访问 http://localhost:3000
- [ ] PM2 已安装并配置（可选，生产环境推荐）

---

**祝您部署顺利！** 🎉
