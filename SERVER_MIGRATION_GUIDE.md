# Windows 服务器迁移部署指南

运输订单管理系统从开发环境 (`d:\transFormation`) 迁移到生产服务器 (`c:\transform`) 的完整指南。

---

## 📋 目录

1. [系统要求](#系统要求)
2. [快速开始](#快速开始)
3. [详细部署步骤](#详细部署步骤)
4. [配置说明](#配置说明)
5. [数据库初始化](#数据库初始化)
6. [生产环境配置](#生产环境配置)
7. [维护与监控](#维护与监控)
8. [故障排查](#故障排查)
9. [安全建议](#安全建议)

---

## 系统要求

### 硬件要求
- **CPU**: 2 核及以上
- **内存**: 4GB RAM（推荐 8GB 或更多）
- **磁盘**: 20GB 可用空间

### 软件要求

| 软件 | 版本 | 下载链接 |
|------|------|--------|
| Windows Server | 2016+ | 操作系统自带 |
| Node.js | 14.0+ | https://nodejs.org/ |
| MySQL | 5.7+ 或 8.0+ | https://dev.mysql.com/downloads/ |
| Git（可选）| 最新版 | https://git-scm.com/ |

### 网络要求
- MySQL 可访问（通常为 localhost:3306）
- 服务器可被客户端访问（端口 3000）

---

## 快速开始

### 一键部署（推荐）

如果您使用的是 Windows Server 环境，最简单的方法是运行部署脚本：

```bash
# 在项目根目录运行
deploy-server.bat
```

该脚本会自动：
1. ✓ 检查 Node.js 和 npm
2. ✓ 验证 MySQL 服务
3. ✓ 创建部署目录 (`C:\transform`)
4. ✓ 安装 npm 依赖
5. ✓ 初始化数据库表

### 手动部署

如果需要手动部署，请按以下步骤操作：

```powershell
# 1. 进入项目目录
cd d:\transFormation

# 2. 复制配置文件
copy env.server .env

# 3. 编辑 .env，更新数据库密码等信息
notepad .env

# 4. 安装依赖
npm install --production

# 5. 初始化数据库
node setup_db_server.js

# 6. 启动应用
npm start
```

---

## 详细部署步骤

### 步骤 1：准备服务器环境

#### 1.1 安装 Node.js

1. 访问 https://nodejs.org/ 
2. 下载 LTS 版本（v18 或 v20）
3. 运行安装程序，选择以下选项：
   - ✓ Add to PATH（自动）
   - ✓ Automatically install necessary tools
4. 验证安装：
   ```powershell
   node --version    # 应显示 v18.x.x 或更高版本
   npm --version     # 应显示 9.x.x 或更高版本
   ```

#### 1.2 安装 MySQL

1. 访问 https://dev.mysql.com/downloads/mysql/
2. 下载 Windows 版本（推荐使用 MSI Installer）
3. 运行安装程序：
   - 选择 "Setup Type: Developer Default" 或 "Custom"
   - 配置 MySQL Server：
     - Port: `3306`（默认）
     - Config Server as Windows Service: ✓ 勾选
   - 配置数据库用户：
     - Root 用户密码：设置一个强密码
4. 验证安装：
   ```powershell
   mysql --version
   ```

### 步骤 2：克隆或复制代码

选择以下方式之一：

**选项 A：使用 Git 克隆（推荐）**

```powershell
# 进入目标目录
cd C:\

# 克隆项目
git clone <your-repository-url> transform

# 进入项目
cd C:\transform
```

**选项 B：手动文件复制**

```powershell
# 创建目录
mkdir C:\transform
cd C:\transform

# 从 d:\transFormation 复制所有文件
xcopy d:\transFormation\* . /E /I /Y
```

### 步骤 3：配置环境变量

```powershell
# 进入项目目录
cd C:\transform

# 复制配置模板
copy env.server .env

# 编辑 .env 文件
notepad .env
```

**需要修改的项**：

```ini
# 数据库连接信息
DB_HOST=localhost              # 如果 MySQL 在本地，保持不变
DB_PORT=3306                   # MySQL 端口
DB_USER=root                   # MySQL 用户名
DB_PASSWORD=your_password      # 👈 改为您的 MySQL root 密码
DB_NAME=order_system           # 数据库名

USER_DB_PASSWORD=your_password # 👈 同上

# 应用配置
PORT=3000                      # 应用端口
HOST=0.0.0.0                   # 绑定所有网络接口
NODE_ENV=production            # 生产环境

# CORS 配置（允许哪些客户端访问）
CORS_ORIGIN=http://150.158.52.86:3000  # 👈 改为您的服务器 IP
```

### 步骤 4：安装依赖

```powershell
cd C:\transform

# 安装 npm 依赖（只安装生产依赖）
npm install --production

# 验证关键依赖
npm list express mysql2 dotenv
```

关键依赖说明：
- `express`: Web 框架
- `mysql2`: MySQL 数据库驱动
- `dotenv`: 环境变量管理
- `cors`: 跨域资源共享
- `multer`: 文件上传
- `xlsx`: Excel 文件处理

### 步骤 5：初始化数据库

运行数据库初始化脚本，自动创建所有需要的表：

```powershell
cd C:\transform

# 执行初始化脚本
node setup_db_server.js
```

**预期输出**：

```
╔════════════════════════════════════════════════════════════════╗
║                   数据库初始化脚本                              ║
║               正在连接数据库并创建所需表结构...                  ║
╚════════════════════════════════════════════════════════════════╝

✓ 已连接到数据库服务器
[1/3] 正在创建数据库...
✓ 数据库 'order_system' 已创建或已存在
✓ 数据库 'user_system' 已创建或已存在

[2/3] 正在创建 'order_system' 数据库的表结构...
  • 创建 orders 表...
    ✓ orders 表已创建
  • 创建 package 表...
    ✓ package 表已创建
  ...更多表...

[3/3] 正在创建 'user_system' 数据库的表结构...
  ...更多表...

✓ 数据库初始化成功！
```

**如果初始化失败，常见原因**：

| 错误信息 | 原因 | 解决方案 |
|---------|------|--------|
| `connect ECONNREFUSED` | MySQL 服务未启动 | 启动 MySQL: `net start MySQL80` |
| `Access denied for user 'root'` | 密码错误 | 检查 `.env` 中的密码是否正确 |
| `ER_DBACCESS_DENIED_ERROR` | 权限不足 | 使用有权限的数据库账户 |

### 步骤 6：启动应用

#### 开发环境（测试用）

```powershell
cd C:\transform

# 启动应用（前台运行）
npm start
```

预期输出：
```
Server running on port 3000
Database connections established
```

浏览器访问：http://localhost:3000

#### 生产环境（推荐）

使用 PM2 进程管理器在后台运行应用：

```powershell
# 全局安装 PM2
npm install -g pm2

# 启动应用
cd C:\transform
pm2 start ecosystem.config.js --env production

# 设置开机自启（需要管理员权限）
pm2 startup windows
pm2 save
```

**PM2 常用命令**：

```powershell
pm2 list              # 查看所有进程
pm2 status            # 查看进程状态
pm2 logs              # 查看实时日志
pm2 stop all          # 停止所有进程
pm2 restart all       # 重启所有进程
pm2 delete all        # 删除所有进程
pm2 monit             # 监控进程资源占用
```

---

## 配置说明

### .env 环境变量详解

```ini
# ========== 应用配置 ==========
NODE_ENV=production          # development（开发）或 production（生产）
PORT=3000                    # 应用监听端口
HOST=0.0.0.0                 # 绑定地址（0.0.0.0 表示所有网卡）

# ========== 数据库配置（order_system） ==========
DB_HOST=localhost            # 数据库主机
DB_PORT=3306                 # 数据库端口
DB_USER=root                 # 数据库用户
DB_PASSWORD=your_password    # 数据库密码
DB_NAME=order_system         # 数据库名

# ========== 数据库配置（user_system） ==========
USER_DB_HOST=localhost       # 用户系统数据库主机
USER_DB_PORT=3306            # 用户系统数据库端口
USER_DB_USER=root            # 用户系统数据库用户
USER_DB_PASSWORD=your_password  # 用户系统数据库密码
USER_DB_NAME=user_system     # 用户系统数据库名

# ========== 连接池配置 ==========
DB_CONNECTION_LIMIT=10       # 最大连接数
DB_QUEUE_LIMIT=0             # 等待队列限制
DB_CONNECT_TIMEOUT=60000     # 连接超时时间（毫秒）
DB_SSL=false                 # 是否使用 SSL（通常为 false）

# ========== CORS 安全配置 ==========
CORS_ORIGIN=http://localhost:3000  # 允许访问的源
ALLOW_NULL_ORIGIN=false      # 是否允许 null origin
```

### 环境变量优先级

应用会按以下优先级读取配置：

1. **系统环境变量**（最高）
2. **.env 文件**（中等）
3. **代码中的默认值**（最低）

### 多数据库支持

如果 order_system 和 user_system 分别使用不同的 MySQL 实例：

```ini
# order_system 数据库（实例 1）
DB_HOST=db1.company.com
DB_PORT=3306
DB_USER=user1
DB_PASSWORD=pass1

# user_system 数据库（实例 2）
USER_DB_HOST=db2.company.com
USER_DB_PORT=3306
USER_DB_USER=user2
USER_DB_PASSWORD=pass2
```

---

## 数据库初始化

### 自动初始化

最简单的方式是使用提供的脚本：

```powershell
node setup_db_server.js
```

此脚本会自动：
- ✓ 创建 `order_system` 数据库（如果不存在）
- ✓ 创建 `user_system` 数据库（如果不存在）
- ✓ 创建所有 10 个数据表
- ✓ 设置字符编码为 UTF-8
- ✓ 创建必要的索引

### 手动初始化

如果需要手动创建数据库，可以运行以下 SQL 命令：

```sql
-- 创建数据库
CREATE DATABASE IF NOT EXISTS order_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS user_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建用户（可选，推荐）
CREATE USER 'app_user'@'localhost' IDENTIFIED BY 'secure_password';
GRANT ALL PRIVILEGES ON order_system.* TO 'app_user'@'localhost';
GRANT ALL PRIVILEGES ON user_system.* TO 'app_user'@'localhost';
FLUSH PRIVILEGES;
```

### 数据库结构

#### order_system 数据库

| 表名 | 说明 |
|------|------|
| orders | 订单信息表 |
| package | 包裹信息表 |
| pickup_transport_tracking | 提货运输跟踪表 |
| products | 产品信息表 |
| transfer | 运输流转信息表 |

#### user_system 数据库

| 表名 | 说明 |
|------|------|
| users | 用户表 |
| guests | 客户信息表 |
| sender_info | 发件人信息库 |
| customer_info | 客户信息库 |
| customs_clearance_tracking | 报关信息维护跟踪表 |

### 重新初始化数据库

**警告：以下操作会删除所有数据，请先备份！**

```powershell
# 删除数据库
mysql -u root -p -e "DROP DATABASE order_system; DROP DATABASE user_system;"

# 重新初始化
node setup_db_server.js
```

---

## 生产环境配置

### PM2 进程管理

PM2 是一个 Node.js 进程管理工具，可以：
- ✓ 自动重启崩溃的应用
- ✓ 负载均衡（多进程）
- ✓ 日志管理
- ✓ 开机自启

**安装 PM2**：

```powershell
npm install -g pm2
```

**启动应用**：

```powershell
cd C:\transform
pm2 start ecosystem.config.js --env production
```

**ecosystem.config.js 配置示例**：

```javascript
module.exports = {
  apps: [{
    name: 'transport-order-system',
    script: './backend/server.js',
    instances: 'max',  // 自动使用 CPU 核心数
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

### Windows 防火墙配置

允许应用访问网络：

```powershell
# 以管理员身份运行 PowerShell
New-NetFirewallRule -DisplayName "Allow Node.js Port 3000" `
  -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 3000
```

### IIS 反向代理（可选）

如果使用 IIS 作为反向代理：

1. 安装 IIS 模块：
   ```powershell
   # 需要管理员权限
   Import-Module WebAdministration
   New-WebApplication -Name "app" -Site "Default Web Site" `
     -PhysicalPath "C:\transform" -ApplicationPool "DefaultAppPool"
   ```

2. 配置 web.config：
   ```xml
   <configuration>
     <system.webServer>
       <httpPlatform processPath="C:\Program Files\nodejs\node.exe"
         arguments="C:\transform\backend\server.js" />
     </system.webServer>
   </configuration>
   ```

---

## 维护与监控

### 日志管理

应用日志存储在 `C:\transform\logs` 目录：

```
logs/
├── pm2.log          # PM2 系统日志
├── pm2-error.log    # PM2 错误日志
└── pm2-out.log      # PM2 输出日志
```

**查看日志**：

```powershell
# 实时日志
pm2 logs

# 查看特定应用日志
pm2 logs transport-order-system

# 查看错误日志
Get-Content C:\transform\logs\pm2-error.log -Tail 50
```

**日志轮转**（防止日志太大）：

```powershell
# 安装日志轮转模块
npm install -g pm2-logrotate

# 启用日志轮转
pm2 install pm2-logrotate
```

### 监控性能

```powershell
# 实时监控
pm2 monit

# 查看应用状态
pm2 status

# 查看内存和 CPU 使用情况
pm2 show transport-order-system
```

### 定期备份

**数据库备份**：

```powershell
# 备份所有数据库
mysqldump -u root -p --all-databases > "C:\backup\backup_$(Get-Date -Format 'yyyyMMdd').sql"

# 备份特定数据库
mysqldump -u root -p order_system user_system > "C:\backup\databases.sql"
```

**自动备份脚本** (`C:\backup\backup.bat`)：

```batch
@echo off
set BACKUP_DIR=C:\backup
set DATE=%date:~0,4%%date:~5,2%%date:~8,2%

if not exist %BACKUP_DIR% mkdir %BACKUP_DIR%

mysqldump -u root -p your_password order_system user_system > "%BACKUP_DIR%\backup_%DATE%.sql"

echo Backup completed: %DATE%
```

在 Windows 任务计划程序中设置定时运行此脚本。

---

## 故障排查

### 常见问题

#### 问题 1：无法连接到 MySQL

**症状**：
```
Error: connect ECONNREFUSED 127.0.0.1:3306
```

**解决方案**：

1. 检查 MySQL 服务状态：
   ```powershell
   Get-Service MySQL80  # 或其他版本
   Start-Service MySQL80  # 启动服务
   ```

2. 验证连接参数：
   ```powershell
   mysql -h localhost -u root -p
   ```

3. 检查防火墙：
   ```powershell
   netstat -ano | findstr :3306
   ```

#### 问题 2：数据库密码错误

**症状**：
```
Error: Access denied for user 'root'@'localhost'
```

**解决方案**：

1. 检查 `.env` 中的密码：
   ```bash
   notepad .env  # 查看 DB_PASSWORD
   ```

2. 重置 MySQL root 密码（Windows）：
   ```powershell
   # 停止 MySQL 服务
   net stop MySQL80
   
   # 启动不登录模式
   mysqld --skip-grant-tables
   
   # 另一个终端重置密码
   mysql -u root
   FLUSH PRIVILEGES;
   ALTER USER 'root'@'localhost' IDENTIFIED BY 'newpassword';
   EXIT;
   ```

#### 问题 3：端口已被占用

**症状**：
```
Error: listen EADDRINUSE :::3000
```

**解决方案**：

```powershell
# 找出占用端口的进程
netstat -ano | findstr :3000

# 终止进程
taskkill /PID <PID> /F

# 或改用其他端口
$env:PORT=8080
npm start
```

#### 问题 4：权限不足

**症状**：
```
Error: EACCES or Access denied
```

**解决方案**：

```powershell
# 以管理员身份运行 PowerShell
# 再次运行命令
node setup_db_server.js

# 或修改目录权限
icacls "C:\transform" /grant:r "%username%":F /t
```

#### 问题 5：应用启动后立即崩溃

**症状**：
```
app crashed
process offline
```

**解决方案**：

```powershell
# 查看详细错误
pm2 logs --err

# 在前台运行以查看错误
npm start

# 检查 Node 版本是否兼容
node --version

# 检查依赖是否完整
npm install
```

### 诊断工具

```powershell
# 运行诊断脚本
.\diagnose.ps1  # 如果项目中有此文件

# 检查 Node.js
node --version
npm --version
npm list --depth=0

# 检查 MySQL
mysql --version
mysql -u root -e "SELECT @@version;"

# 检查网络连接
Test-NetConnection localhost -Port 3000

# 检查进程
Get-Process node | Select-Object Id, WorkingSet, Handles
```

---

## 安全建议

### 1. 数据库安全

**删除默认用户**：

```sql
-- 删除匿名用户
DELETE FROM mysql.user WHERE User = '';

-- 删除远程 root 访问
DELETE FROM mysql.user WHERE User = 'root' AND Host != 'localhost';
```

**创建专用应用用户**：

```sql
-- 创建只有必要权限的用户
CREATE USER 'app_user'@'localhost' IDENTIFIED BY 'StrongPassword123!';

-- 只授予必要权限
GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON order_system.* TO 'app_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON user_system.* TO 'app_user'@'localhost';

FLUSH PRIVILEGES;
```

### 2. 应用安全

**环境变量**：
```ini
# 不要在版本控制中提交 .env 文件
# 添加到 .gitignore
echo ".env" >> .gitignore
```

**HTTPS 支持**：
```javascript
// 在 backend/server.js 中启用 HTTPS
const https = require('https');
const fs = require('fs');

const cert = fs.readFileSync('path/to/cert.pem');
const key = fs.readFileSync('path/to/key.pem');

https.createServer({cert, key}, app).listen(443);
```

### 3. 网络安全

**防火墙配置**：
- 只允许必要的端口（如 3000）
- 限制数据库访问到本地或可信 IP
- 配置 VPN 访问敏感服务

**反向代理**：
```ini
# 使用 Nginx 或 IIS 作为反向代理
# 并启用速率限制、请求验证等
```

### 4. 定期更新

```powershell
# 更新 npm 依赖
npm update

# 检查安全漏洞
npm audit

# 修复安全问题
npm audit fix
```

---

## 常用命令速查

```powershell
# ========== 启动/停止 ==========
npm start                          # 前台运行（开发用）
pm2 start ecosystem.config.js --env production  # 后台运行
pm2 stop all                       # 停止所有进程
pm2 restart all                    # 重启所有进程

# ========== 日志 ==========
pm2 logs                           # 查看实时日志
pm2 logs --err                     # 查看错误日志
Get-Content logs/pm2-error.log     # 查看错误日志文件

# ========== 数据库 ==========
node setup_db_server.js            # 初始化数据库
mysql -u root -p order_system      # 连接数据库

# ========== 依赖 ==========
npm install --production           # 安装依赖
npm update                         # 更新依赖
npm audit                          # 检查安全漏洞

# ========== 调试 ==========
npm start -- --inspect             # 启用 Node.js 调试器
pm2 status                         # 查看进程状态
pm2 show transport-order-system    # 查看详细信息
```

---

## 获取帮助

有问题？请检查以下资源：

1. **文档**：查看项目中的 README.md 和其他 .md 文件
2. **日志**：检查 `C:\transform\logs` 目录下的日志文件
3. **官方文档**：
   - https://nodejs.org/docs/
   - https://dev.mysql.com/doc/
   - https://pm2.keymetrics.io/docs/

---

**最后更新**：2026 年 3 月 25 日

**版本**：1.0

**维护者**：运维团队
