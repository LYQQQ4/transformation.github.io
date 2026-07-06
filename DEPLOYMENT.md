# 企业内网部署指南

本文档说明如何将运输订单管理系统部署到企业内网环境。

## 📋 目录

1. [系统要求](#系统要求)
2. [部署前准备](#部署前准备)
3. [安装步骤](#安装步骤)
4. [配置说明](#配置说明)
5. [启动服务](#启动服务)
6. [维护与监控](#维护与监控)
7. [故障排查](#故障排查)
8. [安全建议](#安全建议)

---

## 系统要求

### 服务器要求
- **操作系统**: Windows Server 2016+ / Linux (Ubuntu 18.04+, CentOS 7+)
- **Node.js**: v14.0.0 或更高版本
- **MySQL**: 5.7+ 或 8.0+
- **内存**: 至少 2GB RAM
- **磁盘空间**: 至少 10GB 可用空间

### 网络要求
- 服务器需要能够访问 MySQL 数据库
- 客户端需要能够访问服务器 IP 和端口（默认 3000）

---

## 部署前准备

### 1. 数据库准备

确保 MySQL 数据库已安装并运行，创建所需的数据库：

```sql
-- 创建订单系统数据库
CREATE DATABASE IF NOT EXISTS order_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建用户系统数据库
CREATE DATABASE IF NOT EXISTS user_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. 创建数据库用户（推荐）

为了安全，建议创建专用数据库用户而不是使用 root：

```sql
-- 创建订单系统用户
CREATE USER 'order_user'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON order_system.* TO 'order_user'@'localhost';

-- 创建用户系统用户
CREATE USER 'user_admin'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON user_system.* TO 'user_admin'@'localhost';

FLUSH PRIVILEGES;
```

### 3. 准备部署目录

在服务器上创建应用目录：

```bash
# Linux
mkdir -p /opt/transport-order-management
cd /opt/transport-order-management

# Windows
mkdir D:\Apps\transport-order-management
cd D:\Apps\transport-order-management
```

---

## 安装步骤

### 步骤 1: 上传代码

将项目文件上传到服务器部署目录，或使用 Git 克隆：

```bash
git clone <your-repository-url> .
```

### 步骤 2: 安装 Node.js 依赖

```bash
npm install --production
```

### 步骤 3: 安装 PM2（进程管理工具）

```bash
# 全局安装 PM2
npm install -g pm2

# Windows 系统可以使用 pm2-windows-startup 或 pm2-windows-service
```

### 步骤 4: 创建环境变量文件

在项目根目录创建 `.env` 文件：

```bash
# 复制模板文件（如果存在）
cp .env.example .env

# 或手动创建 .env 文件
```

编辑 `.env` 文件，配置以下内容：

```env
# 环境配置
NODE_ENV=production

# 服务器配置
PORT=3000
HOST=0.0.0.0

# 数据库配置 - 订单系统
DB_HOST=localhost
DB_PORT=3306
DB_USER=order_user
DB_PASSWORD=your_secure_password_here
DB_NAME=order_system

# 数据库配置 - 用户系统
USER_DB_HOST=localhost
USER_DB_PORT=3306
USER_DB_USER=user_admin
USER_DB_PASSWORD=your_secure_password_here
USER_DB_NAME=user_system

# 安全配置
# CORS允许的源（企业内网IP或域名，多个用逗号分隔）
# 例如: CORS_ORIGIN=http://192.168.1.100:3000,http://orders.company.local
CORS_ORIGIN=http://localhost:3000

# 连接池配置
DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=0
DB_CONNECT_TIMEOUT=60000

# SSL配置（如果数据库需要SSL）
DB_SSL=false
```

**⚠️ 重要**: 
- 不要将 `.env` 文件提交到版本控制系统
- 确保 `.env` 文件权限设置正确（Linux: `chmod 600 .env`）

### 步骤 5: 创建日志目录

```bash
mkdir -p logs
mkdir -p uploads
mkdir -p backend/uploads
```

---

## 配置说明

### 环境变量说明

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| `NODE_ENV` | 运行环境 | `development` | 是 |
| `PORT` | 服务器端口 | `3000` | 否 |
| `HOST` | 监听地址 | `0.0.0.0` | 否 |
| `DB_HOST` | 数据库主机 | `localhost` | 是 |
| `DB_PORT` | 数据库端口 | `3306` | 否 |
| `DB_USER` | 数据库用户名 | `root` | 是 |
| `DB_PASSWORD` | 数据库密码 | - | 是 |
| `DB_NAME` | 订单数据库名 | `order_system` | 是 |
| `USER_DB_*` | 用户数据库配置 | 同 DB_* | 否 |
| `CORS_ORIGIN` | 允许的跨域来源 | - | 建议设置 |

### CORS 配置

在企业内网环境中，建议限制 CORS 来源以提高安全性：

```env
# 单个来源
CORS_ORIGIN=http://192.168.1.100:3000

# 多个来源（用逗号分隔）
CORS_ORIGIN=http://192.168.1.100:3000,http://orders.company.local,http://10.0.0.50:3000
```

---

## 启动服务

### 方式 1: 使用 PM2（推荐）

PM2 提供进程管理、自动重启、日志管理等功能。

```bash
# 启动应用
npm run pm2:start
# 或
pm2 start ecosystem.config.js --env production

# 查看状态
pm2 status

# 查看日志
npm run pm2:logs
# 或
pm2 logs transport-order-management

# 停止应用
npm run pm2:stop

# 重启应用
npm run pm2:restart

# 设置开机自启（Linux）
pm2 startup
pm2 save
```

### 方式 2: 直接启动

```bash
# 开发环境
npm start

# 生产环境
npm run start:prod
```

### 方式 3: Windows 服务（Windows Server）

可以使用 `node-windows` 或 `pm2-windows-service` 将应用注册为 Windows 服务。

---

## 维护与监控

### 查看日志

```bash
# PM2 日志
pm2 logs transport-order-management

# 应用日志（如果配置了文件日志）
tail -f logs/pm2-combined.log
```

### 监控应用状态

```bash
# PM2 监控面板
pm2 monit

# 查看详细信息
pm2 describe transport-order-management
```

### 更新应用

1. 停止服务：`pm2 stop transport-order-management`
2. 备份当前版本和数据
3. 更新代码
4. 安装依赖：`npm install --production`
5. 检查 `.env` 配置是否需要更新
6. 启动服务：`pm2 start transport-order-management`

### 数据库备份

定期备份数据库：

```bash
# 备份订单数据库
mysqldump -u order_user -p order_system > backup_order_$(date +%Y%m%d).sql

# 备份用户数据库
mysqldump -u user_admin -p user_system > backup_user_$(date +%Y%m%d).sql
```

---

## 故障排查

### 常见问题

#### 1. 无法连接到数据库

**检查项**:
- MySQL 服务是否运行
- 数据库用户名和密码是否正确
- 数据库主机和端口是否正确
- 防火墙是否允许连接
- 数据库用户是否有足够权限

**测试连接**:
```bash
mysql -h localhost -u order_user -p order_system
```

#### 2. 端口被占用

**检查端口占用**:
```bash
# Linux
netstat -tulpn | grep 3000
# 或
lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

**解决方案**: 修改 `.env` 文件中的 `PORT` 值

#### 3. CORS 错误

如果前端无法访问 API，检查：
- `CORS_ORIGIN` 配置是否包含前端地址
- 前端请求的 URL 是否正确

#### 4. 应用无法启动

**检查日志**:
```bash
pm2 logs transport-order-management --err
```

**常见原因**:
- 环境变量配置错误
- 数据库连接失败
- 端口被占用
- 依赖包缺失

---

## 安全建议

### 1. 数据库安全

- ✅ 使用专用数据库用户，不要使用 root
- ✅ 使用强密码
- ✅ 限制数据库用户权限（只授予必要的权限）
- ✅ 定期更新数据库密码
- ✅ 如果可能，启用 SSL 连接

### 2. 应用安全

- ✅ 使用环境变量存储敏感信息，不要硬编码
- ✅ 限制 CORS 来源
- ✅ 定期更新依赖包：`npm audit` 和 `npm update`
- ✅ 设置适当的文件权限
- ✅ 使用 HTTPS（如果可能，通过反向代理）

### 3. 服务器安全

- ✅ 配置防火墙规则
- ✅ 定期更新操作系统和软件
- ✅ 限制服务器访问权限
- ✅ 启用日志审计
- ✅ 定期备份数据

### 4. 密码安全

**⚠️ 重要**: 当前版本密码以明文存储，建议：

1. 实施密码哈希（使用 bcrypt）
2. 实施会话管理（JWT 或 session）
3. 添加登录失败限制
4. 实施密码复杂度要求

### 5. 网络安全

- 如果可能，使用反向代理（Nginx/Apache）
- 配置 SSL/TLS 证书
- 限制内网访问

---

## 性能优化建议

1. **数据库连接池**: 已配置，可根据负载调整 `DB_CONNECTION_LIMIT`
2. **PM2 集群模式**: 如需更高性能，可启用 PM2 集群模式
3. **反向代理**: 使用 Nginx 作为反向代理，提供静态文件服务
4. **缓存**: 考虑添加 Redis 缓存层
5. **CDN**: 静态资源可考虑使用 CDN

---

## 联系支持

如遇到问题，请：
1. 查看日志文件
2. 检查本文档的故障排查部分
3. 联系系统管理员

---

**最后更新**: 2024年
