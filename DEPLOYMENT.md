# 本机运行与临时访问指南

本文档用于在 Windows 或 macOS 电脑上直接运行运输订单管理系统，并通过
`cloudflared` 创建临时公网访问地址。

本文档不包含服务器部署、开机自启、PM2 守护进程、固定 Cloudflare Tunnel、
Docker 或防火墙端口开放配置。关闭本地程序或 `cloudflared` 窗口后，临时访问地址
即失效。

## 运行方式

项目由 Node.js 后端同时提供 API 和 `frontend` 目录下的网页：

```text
浏览器 -> cloudflared 临时地址 -> 本机 http://127.0.0.1:3000
                                      |
                                      -> 本机 MySQL:3306
```

需要准备：

- Node.js 14 或更高版本，建议使用 Node.js LTS
- npm
- MySQL 5.7 或 8.0+
- `cloudflared`
- 项目代码

项目根目录应包含 `package.json`、`backend`、`frontend` 和
`setup_db_server.js`。

## Windows

以下命令在 PowerShell 中执行。

### 1. 安装依赖

1. 安装 Node.js LTS，并确认 `node` 和 `npm` 已加入 PATH。
2. 安装并启动 MySQL。确认可以使用本机 MySQL 账户登录。
3. 安装 `cloudflared`：

```powershell
winget install --id Cloudflare.cloudflared
```

重新打开 PowerShell 后检查：

```powershell
node --version
npm --version
mysql --version
cloudflared --version
```

如果系统没有 `winget`，请从 Cloudflare 官方发布页下载 Windows 版本的
`cloudflared.exe`，并将其所在目录加入 PATH。

### 2. 进入项目目录

将项目放到本机任意目录，然后进入项目根目录。例如：

```powershell
cd "E:\transFormation"
```

后续命令都应在包含 `package.json` 的项目根目录执行。

### 3. 配置本机环境

首次运行时复制环境变量模板：

```powershell
Copy-Item .\env.template .\.env
notepad .\.env
```

至少确认 `.env` 中的数据库配置与本机 MySQL 一致：

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=改成本机MySQL密码
DB_NAME=order_system

USER_DB_HOST=127.0.0.1
USER_DB_PORT=3306
USER_DB_USER=root
USER_DB_PASSWORD=改成本机MySQL密码
USER_DB_NAME=user_system

CORS_ORIGIN=http://localhost:3000
DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=0
DB_CONNECT_TIMEOUT=60000
DB_SSL=false
```

如果本机 MySQL 的 root 账户没有密码，将 `DB_PASSWORD` 和
`USER_DB_PASSWORD` 留空即可。

不要把 `.env` 提交到 Git。

### 4. 安装 Node.js 依赖

```powershell
npm install
New-Item -ItemType Directory -Force .\logs, .\uploads, .\backend\uploads
```

### 5. 初始化数据库

首次运行或数据库表尚未创建时执行：

```powershell
node .\setup_db_server.js
```

脚本会连接 `.env` 中配置的 MySQL，并创建 `order_system`、
`user_system` 数据库及应用所需的数据表。数据库初始化成功后，不需要每次
启动都重复执行此命令。

### 6. 启动本机应用

在第一个 PowerShell 窗口执行：

```powershell
npm start
```

保持此窗口运行。看到服务监听 `3000` 后，在本机浏览器访问：

```text
http://127.0.0.1:3000
```

也可以检查 API：

```powershell
Invoke-WebRequest http://127.0.0.1:3000/api/test
```

### 7. 创建临时访问地址

保持应用窗口运行，再打开第二个 PowerShell 窗口，执行：

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

命令输出类似下面的临时地址：

```text
https://xxxx-xxxx.trycloudflare.com
```

将该 `https` 地址发给需要访问的人员。远程访问时必须使用
`cloudflared` 输出的地址，不要使用对方电脑上的 `localhost`。

### 8. 停止运行

1. 在 `cloudflared` 窗口按 `Ctrl+C`，停止临时访问地址。
2. 在 `npm start` 窗口按 `Ctrl+C`，停止本机应用。
3. 下次启动时重新执行 `npm start` 和 `cloudflared tunnel --url ...`；
   Quick Tunnel 地址通常会变化。

## macOS

以下命令在 Terminal 中执行。

### 1. 安装依赖

如果尚未安装 Homebrew，先按 Homebrew 官方说明安装。然后执行：

```bash
brew install node mysql cloudflared
```

启动 MySQL：

```bash
brew services start mysql
```

检查依赖：

```bash
node --version
npm --version
mysql --version
cloudflared --version
```

如果 MySQL 不是通过 Homebrew 安装，请使用对应方式启动，并确保服务监听
`127.0.0.1:3306`。

### 2. 进入项目目录

将项目放到本机任意目录，然后进入项目根目录。例如：

```bash
cd ~/transFormation
```

后续命令都应在包含 `package.json` 的项目根目录执行。

### 3. 配置本机环境

首次运行时复制环境变量模板：

```bash
cp env.template .env
nano .env
```

至少确认 `.env` 中的数据库配置与本机 MySQL 一致：

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=改成本机MySQL密码
DB_NAME=order_system

USER_DB_HOST=127.0.0.1
USER_DB_PORT=3306
USER_DB_USER=root
USER_DB_PASSWORD=改成本机MySQL密码
USER_DB_NAME=user_system

CORS_ORIGIN=http://localhost:3000
DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=0
DB_CONNECT_TIMEOUT=60000
DB_SSL=false
```

如果本机 MySQL 的 root 账户没有密码，将 `DB_PASSWORD` 和
`USER_DB_PASSWORD` 留空即可。

不要把 `.env` 提交到 Git。

### 4. 安装 Node.js 依赖

```bash
npm install
mkdir -p logs uploads backend/uploads
```

### 5. 初始化数据库

首次运行或数据库表尚未创建时执行：

```bash
node setup_db_server.js
```

脚本会连接 `.env` 中配置的 MySQL，并创建 `order_system`、
`user_system` 数据库及应用所需的数据表。数据库初始化成功后，不需要每次
启动都重复执行此命令。

### 6. 启动本机应用

在第一个 Terminal 窗口执行：

```bash
npm start
```

保持此窗口运行。看到服务监听 `3000` 后，在本机浏览器访问：

```text
http://127.0.0.1:3000
```

也可以检查 API：

```bash
curl http://127.0.0.1:3000/api/test
```

### 7. 创建临时访问地址

保持应用窗口运行，再打开第二个 Terminal 窗口，执行：

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

命令输出类似下面的临时地址：

```text
https://xxxx-xxxx.trycloudflare.com
```

将该 `https` 地址发给需要访问的人员。远程访问时必须使用
`cloudflared` 输出的地址，不要使用对方电脑上的 `localhost`。

### 8. 停止运行

1. 在 `cloudflared` 窗口按 `Control+C`，停止临时访问地址。
2. 在 `npm start` 窗口按 `Control+C`，停止本机应用。
3. 下次启动时重新执行 `npm start` 和 `cloudflared tunnel --url ...`；
   Quick Tunnel 地址通常会变化。

## 常见问题

### MySQL 连接失败

确认：

- MySQL 服务正在运行
- `.env` 中的 `DB_HOST`、`DB_PORT`、用户名和密码正确
- `DB_NAME` 为 `order_system`
- `USER_DB_NAME` 为 `user_system`

可以先单独测试登录：

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p
```

Windows 使用 PowerShell，macOS 使用 Terminal；命令本身相同。

### 端口 3000 被占用

Windows：

```powershell
netstat -ano | findstr :3000
```

macOS：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

可以停止占用端口的程序，或者将 `.env` 中的 `PORT` 改为其他端口，
然后让 `cloudflared` 使用相同端口。例如：

```bash
cloudflared tunnel --url http://127.0.0.1:3001
```

### `cloudflared` 地址打不开

确认以下两点：

- `npm start` 窗口仍在运行
- `cloudflared` 命令中的端口与 `.env` 的 `PORT` 一致

Quick Tunnel 是临时连接，关闭命令窗口、网络中断或进程退出后，地址会失效。

### 远程页面打开但 API 报错

必须直接打开 `cloudflared` 输出的完整 `https` 地址。不要把前端文件单独
用 `file://` 打开，也不要把页面和 API 分别放在不同地址。

项目会根据当前页面地址自动请求同一地址下的 `/api`，因此正常情况下不需要
把每次生成的 Quick Tunnel 域名写入 `CORS_ORIGIN`。

## 安全注意事项

- Quick Tunnel 适合临时演示、测试和短时间协作，不适合作为正式生产入口。
- 访问地址一旦发出，任何拿到地址的人都可能尝试访问应用。
- 不要在 `.env`、命令输出或聊天记录中公开数据库密码。
- 使用完成后立即停止 `cloudflared` 和 Node.js 进程。
- 不需要为本步骤配置服务器、防火墙入站规则、PM2 或固定 Tunnel。

**最后更新**：2026年8月
