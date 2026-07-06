# 📦 Windows 服务器迁移总结

运输订单管理系统从开发环境迁移到 Windows Server 生产环境的完整方案。

---

## 核心内容

### 🎯 迁移目标

| 项目 | 值 |
|------|-----|
| 源路径 | `d:\transFormation` |
| 目标路径 | `C:\transform` |
| 目标平台 | Windows Server 2016+ |
| 数据库 | MySQL 5.7+ / 8.0+ |
| 运行时 | Node.js 14+ |

### 📝 创建的文件

| 文件 | 用途 | 说明 |
|------|------|------|
| `setup_db_server.js` | 数据库初始化 | 自动创建 2 个数据库和 10 个表 |
| `env.server` | 配置模板 | 环境变量示例配置 |
| `deploy-server.bat` | 部署脚本 | 一键式 Windows 部署脚本 |
| `SERVER_MIGRATION_GUIDE.md` | 详细指南 | 完整的部署步骤和说明 |
| `QUICK_SERVER_SETUP.md` | 快速参考 | 快速上手指南 |

### 🗄️ 数据库结构

#### order_system（订单系统）

```sql
orders                      -- 订单信息表
  ├── id (PK)
  ├── company_name
  ├── customer_id
  ├── serial_number (UNIQUE)
  └── ... (20 个字段)

package                     -- 包裹信息表
  ├── id (PK)
  ├── serial_number (UNIQUE FK)
  └── ... (16 个字段)

pickup_transport_tracking   -- 提货运输跟踪表
  ├── id (PK)
  ├── serial_number (UNIQUE FK)
  └── ... (16 个字段)

products                    -- 产品信息表
  ├── id (PK)
  ├── product_id (UNIQUE)
  └── ... (8 个字段)

transfer                    -- 运输流转信息表
  ├── id (PK)
  ├── serial_number (UNIQUE)
  ├── tracking_number (UNIQUE)
  └── ... (18 个字段)
```

#### user_system（用户系统）

```sql
users                       -- 用户表
  ├── id (PK)
  ├── username (UNIQUE)
  ├── password
  └── ... (6 个字段)

guests                      -- 客户信息表
  ├── guest_id (PK)
  ├── company_cn
  └── ... (13 个字段)

sender_info                 -- 发件人信息库
  ├── sender_id (PK)
  └── ... (5 个字段)

customer_info               -- 客户信息库
  ├── customer_id (PK)
  └── ... (5 个字段)

customs_clearance_tracking  -- 报关信息维护跟踪表
  ├── id (PK)
  ├── serial_number
  └── ... (10 个字段)
```

**总计：10 个数据表，90+ 个字段**

---

## 🚀 部署流程

### 阶段 1：环境准备（1 小时）

```powershell
# 1. 安装 Node.js
# 下载：https://nodejs.org/
# 验证：node --version  (应≥14)

# 2. 安装 MySQL
# 下载：https://dev.mysql.com/downloads/
# 设置密码并启动服务

# 3. 准备部署目录
mkdir C:\transform
```

### 阶段 2：项目部署（5-10 分钟）

```powershell
# 方法 A：一键部署（推荐）
cd d:\transFormation
.\deploy-server.bat

# 方法 B：手动部署
cd d:\transFormation
copy env.server .env
notepad .env                    # 修改数据库密码
npm install --production
node setup_db_server.js
npm start
```

### 阶段 3：启动和验证（5 分钟）

```powershell
# 开发环境测试
npm start
# 访问：http://localhost:3000

# 生产环境部署
npm install -g pm2
pm2 start ecosystem.config.js --env production
```

---

## 🔧 配置详解

### .env 文件（最重要的配置）

```ini
# 【必须修改】数据库密码
DB_PASSWORD=your_mysql_root_password          # 修改为实际密码
USER_DB_PASSWORD=your_mysql_root_password     # 修改为实际密码

# 【必须修改】CORS 源（前端访问地址）
CORS_ORIGIN=http://192.168.1.100:3000        # 改为实际服务器 IP

# 【可选】其他配置
NODE_ENV=production                           # 生产环境
PORT=3000                                     # 应用端口
DB_HOST=localhost                             # 数据库主机
DB_PORT=3306                                  # 数据库端口
DB_USER=root                                  # 数据库用户
```

### 环境变量优先级

1. **系统环境变量** ← 最高优先级
2. **.env 文件**
3. **代码默认值** ← 最低优先级

---

## 📊 数据库初始化详解

### 自动初始化流程

```
setup_db_server.js
    ↓
连接 MySQL（使用 .env 配置）
    ↓
创建数据库
    ├── order_system （如果不存在）
    └── user_system  （如果不存在）
    ↓
创建 order_system 表
    ├── orders
    ├── package
    ├── pickup_transport_tracking
    ├── products
    └── transfer
    ↓
创建 user_system 表
    ├── users
    ├── guests
    ├── sender_info
    ├── customer_info
    └── customs_clearance_tracking
    ↓
✓ 完成
```

### 脚本特点

- ✓ **幂等性**：可安全重复运行
- ✓ **自动化**：无需手动 SQL 执行
- ✓ **安全**：使用参数化查询
- ✓ **跨平台**：从 .env 读取配置
- ✓ **中文注释**：清晰的表和字段注释

---

## 💻 PM2 生产环境配置

### 安装 PM2

```powershell
npm install -g pm2
```

### 启动应用

```powershell
cd C:\transform
pm2 start ecosystem.config.js --env production
```

### PM2 常用命令

| 命令 | 说明 |
|------|------|
| `pm2 list` | 列出所有进程 |
| `pm2 status` | 显示进程状态 |
| `pm2 logs` | 查看实时日志 |
| `pm2 stop all` | 停止所有进程 |
| `pm2 restart all` | 重启所有进程 |
| `pm2 delete all` | 删除所有进程 |
| `pm2 monit` | 监控 CPU 和内存 |

### 开机自启设置

```powershell
pm2 startup windows
pm2 save
```

---

## 🔍 关键技术细节

### 数据库连接池

```javascript
// 配置
const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'password',
  waitForConnections: true,
  connectionLimit: 10,        // 最大连接数
  queueLimit: 0               // 等待队列
};
```

### 字符编码

```sql
-- 优先使用 UTF-8 编码，支持中文
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
```

### 日志目录

```
C:\transform\logs\
  ├── pm2.log          (PM2 系统日志)
  ├── pm2-error.log    (错误日志)
  └── pm2-out.log      (输出日志)
```

---

## 🛡️ 安全检查清单

### 数据库安全

- [ ] 修改 MySQL root 密码
- [ ] 删除匿名用户
- [ ] 创建专用应用用户（可选）
- [ ] 限制远程连接

### 应用安全

- [ ] 使用 HTTPS 证书（生产环境）
- [ ] 设置强 CORS 限制
- [ ] 定期备份数据库
- [ ] 隐藏 .env 文件（不提交到 git）

### 系统安全

- [ ] 配置防火墙规则
- [ ] 定期更新 Node.js 和 npm
- [ ] 检查 npm 依赖漏洞（`npm audit`）
- [ ] 启用 Windows 自动更新

---

## 🐛 常见问题

### Q1：如何修改数据库密码？

```sql
mysql -u root -p
ALTER USER 'root'@'localhost' IDENTIFIED BY 'NewPassword123!';
FLUSH PRIVILEGES;
```

### Q2：如何增加数据库连接数？

编辑 `.env` 文件：
```ini
DB_CONNECTION_LIMIT=20
```

### Q3：如何备份数据库？

```powershell
mysqldump -u root -p order_system user_system > backup.sql
```

### Q4：如何恢复数据库？

```powershell
mysql -u root -p order_system < backup.sql
```

### Q5：应用占用内存过多怎么办？

```powershell
# 查看内存占用
pm2 show transport-order-system

# 重启应用
pm2 restart all

# 或查看进程内存
Get-Process node | Select-Object Id, WorkingSet
```

---

## 📈 性能优化建议

| 优化项 | 建议值 | 说明 |
|--------|--------|------|
| 数据库连接池 | 10-20 | 根据并发用户数调整 |
| Node.js 实例 | CPU 核心数 | PM2 设为 `max` |
| 内存限制 | 1-2GB | 防止内存泄漏 |
| 请求超时 | 30s | 根据业务调整 |

---

## 📚 相关文件说明

| 文件 | 位置 | 说明 |
|------|------|------|
| 详细指南 | `\SERVER_MIGRATION_GUIDE.md` | 完整的部署步骤（8000+ 字） |
| 快速参考 | `\QUICK_SERVER_SETUP.md` | 快速上手指南 |
| 数据库脚本 | `\setup_db_server.js` | 自动创建数据库和表 |
| 部署脚本 | `\deploy-server.bat` | 一键部署脚本 |
| 配置模板 | `\env.server` | 环境变量配置示例 |

---

## 🎓 学习资源

### 官方文档
- [Node.js 官方文档](https://nodejs.org/docs/)
- [Express.js 官方文档](https://expressjs.com/)
- [MySQL 官方文档](https://dev.mysql.com/doc/)

### PM2 相关
- [PM2 官方网站](https://pm2.keymetrics.io/)
- [PM2 Windows 指南](https://pm2.keymetrics.io/docs/runtime/windows-startup)

### 数据库
- [MySQL 字符编码](https://dev.mysql.com/doc/refman/8.0/en/charset.html)
- [MySQL 连接池](https://dev.mysql.com/doc/connector-nodejs/en/connector-nodejs-connection-pool.html)

---

## 📞 支持

如遇到问题：

1. **检查日志**
   ```powershell
   pm2 logs
   Get-Content C:\transform\logs\pm2-error.log
   ```

2. **查看详细指南**
   - [完整部署指南](SERVER_MIGRATION_GUIDE.md)
   - [快速参考](QUICK_SERVER_SETUP.md)

3. **运行诊断**
   ```powershell
   node --version
   npm --version
   mysql --version
   pm2 status
   ```

---

## ✅ 验证清单

部署完成后，请验证以下项目：

- [ ] 浏览器访问 `http://localhost:3000` 正常
- [ ] 数据库两个库都已创建：
  ```powershell
  mysql -u root -p -e "SHOW DATABASES;"
  ```
- [ ] 所有 10 个表都已创建：
  ```powershell
  mysql -u root -p order_system -e "SHOW TABLES;"
  mysql -u root -p user_system -e "SHOW TABLES;"
  ```
- [ ] PM2 显示应用在线：
  ```powershell
  pm2 status
  ```
- [ ] 无错误日志：
  ```powershell
  pm2 logs --err
  ```

---

**迁移完成！** 🎉

现在您的应用已在 Windows Server 的 `C:\transform` 路径运行，所有数据库表已自动创建。

**部署时间**：约 15-30 分钟
**维护难度**：低（使用 PM2 自动管理）
**数据安全**：已配置 UTF-8，支持中文和备份

祝您使用愉快！
