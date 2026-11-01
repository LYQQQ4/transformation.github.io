# 运输订单管理系统生产部署指南

本文档适用于将项目部署到云服务器，并通过域名和 HTTPS 提供访问。推荐使用 Linux 云服务器和 Docker Compose。以下命令以 Ubuntu 22.04/24.04 LTS 为例。

## 1. 购买服务器

### 推荐配置

适合约 5～50 名内部用户、日常订单管理和 Excel 导入：

| 项目 | 推荐配置 | 最低配置 |
| --- | --- | --- |
| CPU | 2 核 | 1 核 |
| 内存 | 8 GB | 4 GB |
| 系统盘 | 40 GB SSD | 20 GB SSD |
| 数据盘 | 50 GB SSD 起 | 与系统盘共用 |
| 公网 IP | 1 个 IPv4 | 需要 |
| 操作系统 | Ubuntu 22.04/24.04 LTS 64 位 | Ubuntu 20.04+ |
| 带宽 | 3～5 Mbps | 2 Mbps |

如果会频繁导入大 Excel、保存大量附件或用户超过 50 人，选择 4 核 8～16 GB，并将数据盘扩展到 100 GB 以上。磁盘空间主要消耗在 MySQL 数据、上传文件、备份和日志。

### 购买时的设置

1. 选择按量或包年包月的云服务器实例。
2. 选择 Ubuntu 22.04 LTS 或 Ubuntu 24.04 LTS，64 位。
3. 设置服务器登录方式。推荐 SSH 密钥；临时使用密码时，部署完成后应关闭密码登录。
4. 创建安全组/防火墙规则，仅开放 `22/TCP`、`80/TCP`、`443/TCP`。其中 22 端口只允许管理员固定公网 IP。
5. 不要开放 `3306/TCP`、`3000/TCP` 和 Docker 数据库端口到公网。
6. 记下服务器公网 IP，例如 `203.0.113.10`。

## 2. 准备域名

在域名服务商添加一条 `A` 记录：主机记录为 `orders`，记录值为服务器公网 IP。下文以 `orders.example.com` 为例，请替换成自己的域名。

在本地 PowerShell 确认解析：

```powershell
nslookup orders.example.com
```

## 3. 初始化服务器

在本地 PowerShell 登录：

```powershell
ssh root@203.0.113.10
```

在服务器执行：

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw nginx openssl
timedatectl set-timezone Asia/Shanghai
```

将 `YOUR_ADMIN_IP` 替换为管理员公网 IP：

```bash
ufw allow from YOUR_ADMIN_IP to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
```

如果管理员 IP 经常变化，可以暂时使用 `ufw allow 22/tcp`，但部署完成后应收紧规则。

## 4. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version
docker compose version
```

创建非 root 部署用户并重新登录：

```bash
adduser deploy
usermod -aG sudo,docker deploy
exit
ssh deploy@203.0.113.10
```

## 5. 上传项目

### 从 Git 仓库拉取

```bash
sudo mkdir -p /opt/transport-order-management
sudo chown -R deploy:deploy /opt/transport-order-management
git clone YOUR_GIT_REPOSITORY /opt/transport-order-management
cd /opt/transport-order-management
```

### 从本地复制

在本地项目根目录执行。上传前请确认复制内容中没有 `.env`、`node_modules`、日志和本地数据库目录；生产服务器上的 `.env` 应按下一节单独创建：

```powershell
scp -r . deploy@203.0.113.10:/tmp/transport-order-management
```

在服务器执行：

```bash
sudo mkdir -p /opt/transport-order-management
sudo cp -a /tmp/transport-order-management/. /opt/transport-order-management/
sudo chown -R deploy:deploy /opt/transport-order-management
cd /opt/transport-order-management
```

确认目录包含 `docker-compose.yml`、`Dockerfile`、`package.json` 和 `backend`。

## 6. 创建生产配置

在项目根目录生成强密码并创建 `.env`：

```bash
cd /opt/transport-order-management
openssl rand -base64 32
nano .env
```

写入以下内容，并把密码替换为刚才生成的随机密码：

```dotenv
MYSQL_ROOT_PASSWORD=替换为随机生成的强密码
CORS_ORIGIN=https://orders.example.com
ALLOW_NULL_ORIGIN=false
```

保存后执行：

```bash
chmod 600 .env
```

同时把 `docker-compose.yml` 中的 `CORS_ORIGIN` 改成实际 HTTPS 域名：

```yaml
CORS_ORIGIN: "https://orders.example.com"
```

不要使用 `CORS_ORIGIN: "*"` 作为长期生产配置。

## 7. 启动应用和数据库

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

看到应用监听 `3000` 且数据库连接成功后，按 `Ctrl+C` 退出日志查看。在服务器本机测试：

```bash
curl http://127.0.0.1:3000/api/test
```

预期返回包含 `API is working` 的 JSON。Node.js 的 3000 端口不应直接对公网开放。

## 8. 配置 Nginx

创建 `/etc/nginx/sites-available/transport-order-management`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name orders.example.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用并检查：

```bash
sudo ln -s /etc/nginx/sites-available/transport-order-management /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 9. 配置 HTTPS

确认域名已解析到服务器后执行：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d orders.example.com
sudo certbot renew --dry-run
```

按提示选择将 HTTP 自动跳转到 HTTPS。HTTPS 正常后确认 CORS 使用 `https://orders.example.com`，再重启：

```bash
docker compose up -d
```

## 10. 首次验收

- [ ] `https://orders.example.com` 可以打开登录页。
- [ ] 用户登录、退出正常。
- [ ] 新建和查询订单正常。
- [ ] Excel 导入正常。
- [ ] 文件上传和下载正常。
- [ ] 报关、包装、转运等功能正常。
- [ ] `docker compose ps` 中 `app` 和 `db` 均为运行状态。
- [ ] 外网无法访问 `3306` 和 `3000`。

## 11. 日常运维

```bash
cd /opt/transport-order-management
docker compose ps
docker compose logs --tail=200 app
docker compose restart app
git pull
docker compose up -d --build
```

停止服务时只执行 `docker compose down`。不要使用 `docker compose down -v`，否则会删除 MySQL 数据卷。

## 12. 数据备份

创建备份目录：

```bash
sudo mkdir -p /var/backups/transport-order-management
sudo chown deploy:deploy /var/backups/transport-order-management
```

备份两个数据库：

```bash
cd /opt/transport-order-management
set -a; . ./.env; set +a
docker compose exec -T db mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --databases order_system user_system | gzip > "/var/backups/transport-order-management/mysql_$(date +%F_%H-%M-%S).sql.gz"
ls -lh /var/backups/transport-order-management
```

至少保留一份服务器以外的备份。建议每天备份、保留 7～30 天，并定期实际恢复一次验证备份可用。

## 13. 常见问题

### 应用无法启动

```bash
docker compose logs app
docker compose logs db
docker compose ps
```

重点检查 `.env` 是否存在、密码是否一致、数据库是否已经通过健康检查。

### 页面打不开

```bash
sudo systemctl status nginx
sudo nginx -t
curl http://127.0.0.1:3000/api/test
```

同时检查云安全组和 UFW 是否允许 80/443。

### 上传失败

确认 Nginx 的 `client_max_body_size` 足够，并确认项目目录存在 `uploads`、`backend/uploads` 和 `logs`。

### 更新后数据库报错

先备份，再查看项目中的迁移脚本或更新说明。不要为了修复应用而删除 MySQL 数据卷。

## 14. 生产安全要求

1. 修改默认数据库密码，并确保 `.env` 权限为 `600`。
2. 不对公网开放 MySQL、Node.js 端口。
3. 使用 HTTPS，不在聊天工具或代码仓库中发送 `.env`。
4. 使用 SSH 密钥并关闭 root 远程登录和密码登录。
5. 定期安装系统安全更新：`sudo apt update && sudo apt upgrade -y`。
6. 定期检查磁盘：`df -h`，尤其关注上传目录、日志和备份目录。
7. 定期测试数据库恢复流程。

## 15. 服务器端安全加固操作手册

本节只处理服务器、Docker、Nginx、SSH、防火墙和备份配置，不替代项目代码中的登录认证改造。执行前请确认已经拥有：

- 云服务器管理员权限；
- 域名 `orders.example.com` 的管理权限；
- 管理员固定公网 IP（下文记为 `YOUR_ADMIN_IP`）；
- 可用的 SSH 密钥；
- 数据库备份和回滚窗口。

下文中的域名、IP、用户名和路径均为示例，请替换为实际值。

### 15.1 执行前检查和备份

保持当前 SSH 会话不要关闭，先在服务器执行：

```bash
cd /opt/transport-order-management
sudo cp docker-compose.yml "docker-compose.yml.bak.$(date +%F-%H%M%S)"
sudo cp .env ".env.bak.$(date +%F-%H%M%S)"
sudo ss -lntp
docker compose ps
docker compose config > "/tmp/transport-order-management-compose.$(date +%F-%H%M%S).yml"
```

重点确认当前是否有 `0.0.0.0:3000`、`0.0.0.0:3306` 或其他不需要的公网监听端口。不要执行 `docker compose down -v`，该命令会删除数据库数据卷。

### 15.2 云安全组和 UFW

云平台安全组只保留以下入站规则：

| 端口 | 来源 | 用途 |
| --- | --- | --- |
| 22/TCP | `YOUR_ADMIN_IP/32` | SSH 管理 |
| 80/TCP | `0.0.0.0/0` | HTTP 跳转 HTTPS、证书签发 |
| 443/TCP | `0.0.0.0/0` | HTTPS 业务访问 |

删除 3000、3306、MySQL 容器端口和其他不需要的入站规则。然后在服务器执行：

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw delete allow 3000/tcp || true
sudo ufw delete allow 3306/tcp || true
sudo ufw allow from YOUR_ADMIN_IP to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status numbered
```

Docker 可能独立修改 iptables 规则，因此不能只依赖 UFW；必须同时删除云安全组中的 3000 和 3306。

### 15.3 生产环境变量和 Docker 端口

生产 `.env` 必须使用随机强密码，且不提交到 Git：

```bash
cd /opt/transport-order-management
openssl rand -base64 32
sudo nano .env
sudo chmod 600 .env
sudo chown deploy:deploy .env
```

至少确认配置包含：

```dotenv
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
MYSQL_ROOT_PASSWORD=替换为服务器上生成的随机密码
CORS_ORIGIN=https://orders.example.com
ALLOW_NULL_ORIGIN=false
```

同时确认 `docker-compose.yml` 使用以下安全原则：

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

不要使用以下配置：

```yaml
ports:
  - "3000:3000"
CORS_ORIGIN: "*"
MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-rootpassword123}
```

推荐使用必填变量，避免忘记 `.env` 时自动回退到弱密码：

```yaml
MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD must be set}
DB_PASSWORD: ${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD must be set}
USER_DB_PASSWORD: ${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD must be set}
CORS_ORIGIN: ${CORS_ORIGIN:?CORS_ORIGIN must be set}
ALLOW_NULL_ORIGIN: "false"
```

如果现有 MySQL 数据库已经初始化，修改 Compose 中的环境变量不会自动修改数据库内的 root 密码。密码轮换必须先制定数据库操作窗口并完成备份，再同步更新 `.env`。

### 15.4 验证 Compose 配置并重启

```bash
cd /opt/transport-order-management
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=200 db
```

检查 `docker compose config` 输出：

- 没有 `CORS_ORIGIN: "*"`;
- 没有弱默认数据库密码；
- 应用端口绑定为 `127.0.0.1:3000:3000`；
- `ALLOW_NULL_ORIGIN` 为 `false`。

应用重启后，在服务器本机测试：

```bash
curl -fsS http://127.0.0.1:3000/api/test
sudo ss -lntp | grep -E ':(3000|3306)\b'
```

公网测试应确认 `3000` 和 `3306` 无法连接。不要将本机 `curl` 成功误认为公网端口已经关闭。

### 15.5 Nginx 反向代理和 HTTPS

创建或修改 `/etc/nginx/sites-available/transport-order-management`。证书签发前可先使用 HTTP 配置；证书签发后应启用 HTTPS 并将 HTTP 重定向：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name orders.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name orders.example.com;

    client_max_body_size 20m;
    server_tokens off;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

只有在 HTTPS 已经稳定可用、域名下没有需要 HTTP 的其他服务时才启用 HSTS。检查并加载配置：

```bash
sudo ln -s /etc/nginx/sites-available/transport-order-management \
  /etc/nginx/sites-enabled/transport-order-management 2>/dev/null || true
sudo nginx -t
sudo systemctl reload nginx
```

证书申请和续期检查：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d orders.example.com
sudo certbot renew --dry-run
```

### 15.6 SSH 加固

确认新 SSH 密钥登录成功后，再修改 `/etc/ssh/sshd_config`：

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
AllowUsers deploy
```

检查并重启：

```bash
sudo sshd -t
sudo systemctl restart ssh
```

执行重启前必须保留当前会话，并使用另一个终端验证：

```bash
ssh deploy@服务器公网IP
```

### 15.7 防暴力破解和系统更新

SSH 防护可以使用 fail2ban，但它不能替代项目登录接口的账号/IP 限流：

```bash
sudo apt update
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
sudo fail2ban-client status
sudo apt upgrade -y
```

生产服务器不应使用共享账号；部署用户应使用最小必要的 sudo 权限。

### 15.8 数据库备份和备份文件保护

备份包含用户、客户联系方式、手机号、地址和账单等敏感数据：

```bash
sudo mkdir -p /var/backups/transport-order-management
sudo chown deploy:deploy /var/backups/transport-order-management
sudo chmod 700 /var/backups/transport-order-management

cd /opt/transport-order-management
set -a
. ./.env
set +a
docker compose exec -T db mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" \
  --single-transaction --databases order_system user_system \
  | gzip > "/var/backups/transport-order-management/mysql_$(date +%F-%H%M%S).sql.gz"
chmod 600 /var/backups/transport-order-management/*.sql.gz
```

备份要求：

1. 不要将备份放在 `frontend`、Nginx Web 根目录或公开下载目录。
2. 至少保留一份异地备份。
3. 备份文件应加密传输和存储。
4. 定期在隔离环境执行恢复测试。
5. 不要把 `.env` 内容、数据库密码或备份文件发送到聊天工具或代码仓库。

### 15.9 凭据轮换

如果数据库密码、固定用户密码、SSH 密钥或测试凭据曾经出现在代码、日志、备份或 Git 历史中，应视为已泄露并轮换：

1. 先备份数据库和当前配置；
2. 为固定业务账号设置全新强密码；
3. 按数据库变更流程轮换 MySQL 密码；
4. 撤销不再使用的 SSH 密钥；
5. 清理服务器上不需要的明文凭据文件；
6. 重新构建镜像，避免旧文件继续进入镜像层；
7. 检查 Git 历史和访问日志。

不要自动删除数据库卷，不要使用 `docker compose down -v`。

### 15.10 加固后验收清单

- [ ] 云安全组只开放 22、80、443，且 22 仅允许管理员 IP。
- [ ] UFW 已启用并拒绝其他入站连接。
- [ ] `docker compose config` 不含 `CORS_ORIGIN: "*"` 或弱默认密码。
- [ ] 应用端口绑定为 `127.0.0.1:3000:3000`。
- [ ] 公网无法访问 3000 和 3306。
- [ ] HTTP 自动跳转 HTTPS。
- [ ] HTTPS 证书有效且已配置续期测试。
- [ ] Nginx 反向代理可以访问本机应用。
- [ ] SSH 禁止 root 登录和密码登录。
- [ ] `.env` 权限为 `600`，备份目录权限为 `700`。
- [ ] 数据库备份可以生成，并完成过一次恢复验证。
- [ ] 已轮换曾经暴露的数据库、用户和 SSH 凭据。
- [ ] 项目代码侧的 session、密码哈希、接口鉴权和登录限流改造已完成。

## 16. 当前生产部署记录（2026-10-29）

本节记录本次服务器终端输出和人工验收结果，不代表第 15 节所有加固项目均已完成。

### 16.1 运行版本与入口

| 项目 | 当前值 |
| --- | --- |
| 域名 | `transformation.icu` |
| 公网 IP | `47.117.106.202` |
| 部署目录 | `/opt/transport-order-management` |
| 应用镜像 | `transport-order-management-app:20261029-1` |
| 应用镜像 ID（服务器显示） | `3859cfc05447` |
| 旧版回退镜像 | `transport-order-management-app:rollback-20261029` |
| MySQL 镜像 | `mysql:8.0` |
| 应用宿主机端口 | `127.0.0.1:3000` |
| Nginx 站点配置 | `/etc/nginx/sites-available/transport-order-management` |
| 证书目录 | `/etc/letsencrypt/live/transformation.icu/` |
| 当前证书到期日 | `2027-01-27` |

本次采用本地构建、导出镜像、SCP 上传、服务器 `docker load` 的方式，服务器不构建应用镜像。服务器 Compose 的 `app` 使用明确的版本标签，不包含 `build`。仓库中的 Compose 仍保留本地构建配置，不要用它直接覆盖服务器配置。

### 16.2 已通过的检查

- [x] ICP 备案已完成，公网 ACME 验证文件返回 `200`。
- [x] HTTPS 接口返回 `200`，HTTP 返回 `301` 跳转到 HTTPS。
- [x] Certbot 模拟续期通过，`certbot.timer` 已安排自动运行。
- [x] 新版应用容器运行，MySQL 健康检查通过。
- [x] 登录后可读取当前用户信息；指定账号的管理员角色已确认更新。
- [x] 用户信息库建档、订单新增、列表查询、修改及刷新后持久化验证通过。
- [x] 输入建议接口、Excel 模板下载和单行订单导入验证通过。
- [x] 包装信息、送货运输跟踪、报关信息保存及刷新后持久化验证通过。
- [x] 从管理员本地网络连接服务器 `3000`、`3306` 均失败；该结果仅代表此测试来源。
- [x] 已生成更新前、更新后的数据库和配置备份。
- [x] 更新后的加密备份已下载到本地，SHA256 一致；解密及归档目录读取通过。
- [x] 更新后备份已在本地隔离 MySQL 中实际导入，数据读取、16 张表检查及四项业务关联检查通过；详见 16.6。

### 16.3 本次故障与修复

1. **登录成功但后续接口返回 401**：应用使用 UTC，MySQL 使用北京时间；会话到期值以应用本地时间写入 `DATETIME` 后，与 MySQL 当前时间比较，导致 8 小时有效期几乎被时差抵消。本次保持 MySQL 配置不变，在 `app.environment` 增加 `TZ: Asia/Shanghai` 并重新创建应用容器。后续部署必须确认应用和 MySQL 的时区仍一致。
2. **输入建议接口返回 500**：`order_system.products` 缺失。服务器已按项目正式定义补建；本地 `setup_db_docker.js` 已补上 `CREATE TABLE IF NOT EXISTS products`，供后续镜像构建使用。
3. **新增订单返回 500**：统一用户信息库为空，所填客户 ID 无法通过后端校验。完成客户建档并使用已存在的 ID 后，订单创建验证通过。登录账号“用户管理”与客户、发件人使用的“用户信息库”是两套不同的数据。
4. **普通账号访问用户管理被拒绝**：该页面要求 `admin` 角色，不应通过取消接口鉴权解决。已按管理员明确授权调整指定账号，并撤销其旧会话。

应用的生产配置还包括 `CORS_ORIGIN=https://transformation.icu`、`ALLOW_NULL_ORIGIN=false`、`TRUST_PROXY=true`。后者仅适用于当前可信 Nginx 代理及受限应用入口，不适用于直接向公网暴露 Node.js 的部署。

以上本地修复是在 `20261029-1` 镜像构建之后加入的，不会修改已上传镜像，也尚未作为新镜像部署。当前服务器已通过手动修复恢复；下次发布请构建新的版本标签，不必为同步文档重复重启当前生产服务。

### 16.4 备份位置

- 更新前：`/var/backups/transport-order-management/pre-update-20261029-193449`。
- 更新后：`/var/backups/transport-order-management/post-update-20261029-211120`。
- 加密包：`/var/backups/transport-order-management/post-update-20261029-211120.tar.gz.enc`。
- 本地副本：`tmp/server-backups/post-update-20261029-211120.tar.gz.enc`，属于 Git 和 Docker 构建上下文已忽略的 `tmp` 目录。
- 加密包 SHA256：`4b8780af9314f21168dc9bde3efc81f165f2fe7c1a2fdb5d89606a7e5a58109a`。

更新后备份包含 `databases.sql`、`.env`、`docker-compose.yml`、`nginx-site.conf`。加密参数为 AES-256-CBC、PBKDF2、200000 次迭代；密码由管理员单独保管，不写入仓库或聊天。备份目录权限为 `700`，文件权限为 `600`。该备份不包含上传目录、证书私钥或系统级完整配置。

### 16.5 尚待单独完成或确认

- [x] 将应用连接到本地独立恢复库，完成登录、订单查询、修改保存及刷新后持久化验收；不代表全部业务或整站灾难恢复验收完成。详见 16.9。
- [ ] 附件上传、下载功能验收；上传目录已纳入服务器本地自动备份，当前两个目录均为空。
- [ ] 退出登录、普通账号权限边界、计费和其他未逐项测试的业务流程。
- [x] 已配置数据库和上传目录的服务器本地每日自动备份及 14 天保留策略；2026-10-31、2026-11-01 定时运行成功。原始备份仍未加密；已手动生成并下载一个批次的加密副本，详见 16.10、16.11。
- [ ] 自动加密及定期异地同步；自动上传脚本已接入备份 service，显式批次上传下载恢复校验及新批次 systemd 手动联动通过；尚待接入后的真实定时运行复查。详见 16.15 至 16.18。
- [x] 完成 SSH 加固并复验；UFW 和用户提供的入站规则已核对，`deploy` 专用密钥登录及 sudo 已通过，已确认关闭 root 登录和 SSH 密码认证。SSH 来源仍未收紧，本次未修改。详见 16.7。
- [ ] 在维护窗口处理系统更新及服务器提示的待重启事项，重启后重新验收。

### 16.6 数据库恢复基础验收（2026-10-29）

使用本地加密备份 `post-update-20261029-211120.tar.gz.enc`，流式解密并导入本地测试容器 `transport-order-restore-check-20261029`。恢复容器使用与生产相同的 MySQL 镜像 ID `7dcddc01f13b`、独立匿名数据卷及 `--network none`，未操作生产数据库。

- SQL 导入完成，返回 `RESTORE_IMPORT_OK`。
- 两个数据库共 16 张表可读取，`CHECK TABLE` 全部返回 `status OK`。镜像内未找到 `mysqlcheck` 命令，因此改用 SQL 检查。
- `orders`、`package`、`transfer`、`pickup_transport_tracking`、`customs_clearance_tracking` 各有 2 条记录；`products` 为 0 条。
- `users`、`user_profiles` 各有 1 条记录，管理员账号数为 1。
- `missing_customer`、`missing_sender`、`orders_missing_details`、`details_without_order` 四项问题计数均为 0。

结论：该备份通过数据库基础恢复验收；尚未逐字段比对备份快照与恢复数据，也未验证应用连接恢复库后的完整业务流程，不能据此宣称整站灾难恢复已完成。

清理检查：测试容器停止成功；后续删除命令返回容器不存在。核对本地 Docker context 为 `desktop-linux`，容器查询无匹配项，`docker volume ls --filter dangling=true` 列表为空。当前环境未发现该测试容器或未被容器引用的遗留数据卷，无需继续删除；不能单凭此结果追溯原匿名卷的具体删除过程。加密备份应继续保留，密码单独保管。

### 16.7 续接进度：SSH 加固已确认（2026-10-30）

以下均根据用户返回的终端输出记录，不代表已远程执行尚未确认的步骤。

- 上传目录 `uploads`、`backend/uploads` 均正确绑定到宿主机，目前各有 0 个文件；磁盘检查时可用空间约 28 GB。尚未验收附件流程或设置上传文件自动备份。
- UFW 已启用，默认拒绝入站，仅允许 TCP 22、80、443，IPv4 和 IPv6 均有规则。
- 用户提供的控制台入站规则为 TCP 22、80、443 和 ICMP，来源均为 `0.0.0.0/0`；SSH 来源尚未收紧。
- 应用仅监听 `127.0.0.1:3000`，宿主机未见 3306 监听；`BT-Panel` 另监听 `0.0.0.0:34441`，从用户本地网络测试该端口连接失败。外部端口测试仅代表当次测试来源。
- 已保留原有 `id_rsa` 公钥，另生成专用 Ed25519 密钥。本机私钥路径为 `C:\Users\31770\.ssh\transformation_deploy_ed25519`，公钥为同名 `.pub` 文件；不得上传私钥或记录密钥口令。
- 新公钥已上传到 `/root/transformation_deploy_ed25519.pub`，指纹与本机一致；已保留原有授权公钥并将新公钥安装到 `/home/deploy/.ssh/authorized_keys`，权限检查步骤执行成功。
- `deploy` 为已有账号，属于 `sudo`、`docker` 等组，未重建或重置密码。已从新的 Windows PowerShell 窗口强制公钥认证登录成功，`whoami` 返回 `deploy`，`sudo whoami` 返回 `root`。

随后在保底会话中创建并确认 `/etc/ssh/sshd_config.d/00-transport-order-management.conf`，内容为：

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
```

- 文件属主和权限为 `root:root`、`644`，内容核对为四行预期配置。
- `sudo /usr/sbin/sshd -t` 返回码为 `0`；`sshd -T` 有效值为 `permitrootlogin no`、`passwordauthentication no`、`kbdinteractiveauthentication no`、`pubkeyauthentication yes`。
- `sudo systemctl reload ssh` 执行成功，`sudo systemctl is-active ssh` 返回 `active`。
- 从全新的本地 PowerShell 窗口使用专用 Ed25519 密钥连接成功，`whoami` 返回 `deploy`，`sudo whoami` 返回 `root`。
- 保底 SSH 会话未关闭；本次未禁用其他登录方式，也未修改 SSH 防火墙来源。

后续仍需按步骤完成备份加密与异地同步、其余业务验收，以及维护窗口内的系统更新与重启。不要升级 Ubuntu 大版本或直接重启生产服务器。继续遵循“完成一步并反馈，再进入下一步”。

### 16.8 服务器本地自动备份（2026-10-30）

- Root 专用脚本：`/usr/local/sbin/transport-order-management-backup`，权限为 `700`。
- 每次备份导出 `order_system`、`user_system` 两个数据库，并归档 `uploads`、`backend/uploads`；同批生成 SHA-256 清单。
- 备份目录为 `/var/backups/transport-order-management`，属主 `root:root`、权限 `700`；生成文件属主 `root:root`、权限 `600`。脚本按 14 天保留策略清理其管理的数据库归档、上传归档和校验清单；已有加密部署备份不受清理规则影响。
- 自动生成的数据库与上传归档当前未加密；`600` 权限仅限制本机文件访问，静态加密和异地加密副本仍待完成。
- `transport-order-management-backup.service` 已通过 systemd 实际运行，返回 `backup-ok`。
- `transport-order-management-backup.timer` 已启用并处于 active；每日服务器本地时间约 02:30 运行，设置最多 15 分钟随机延迟及 `Persistent=true`。验收时显示下次运行时间为 `2026-10-31 02:36:15 CST`。
- 手动及 systemd 备份均成功。最新清单中数据库和上传归档校验均为 `OK`；数据库 gzip 完整性和上传 tar 目录结构检查通过。`mysqldump` 命令行密码警告已通过调整脚本消除。

截至 2026-10-30，该自动备份以未加密文件保存在同一台服务器，不能替代静态加密或异地副本。后续定时运行复查、本地应用恢复验收和单批次加密下载结果见 16.9 至 16.11；自动加密、定期异地同步及附件上传/下载验收仍未完成。

### 16.9 本地应用恢复验收与清理（2026-11-01）

以下仅记录用户反馈的已确认结果，未操作生产数据库。

- 恢复批次为 `20261030-151756`，本地备份位于 `E:\transFormation\tmp\server-backups\restore-check-20261030`。SHA256、SQL 导入、两个数据库共 16 张表的 `CHECK TABLE`、主要记录数及四项业务关联检查通过；上传归档仅包含空目录 `uploads/`、`backend/uploads/`。
- 恢复数据库容器为 `transport-order-restore-check-20261030`，独立数据卷为 `transport-order-restore-data-20261030`。应用使用镜像 `sha256:3859cfc054479114b88319efa93225c6aad0f4b53b44dc6b6e80b6ca856d499f`，未挂载生产目录；两个数据库均指向测试网络别名 `db`，使用 `TZ=Asia/Shanghai`、开发模式和独立 Cookie 名 `transport_restore_session`。
- 数据库和原测试应用均在 `2026-11-01 04:30:10 UTC` 退出，退出码为 `255`；现有日志未确定退出原因。仅启动应用时曾出现 `getaddrinfo EAI_AGAIN db`；随后依次启动数据库和应用，容器内 `/api/test` 返回 `200`。
- 应用仅接入内部网络 `transport-order-restore-net-20261030` 时，端口绑定配置存在，但运行时没有发布端口。新建测试应用容器 `transport-order-restore-app-20261030-port` 后仍出现相同现象。将恢复数据库及新测试应用接入普通桥接网络 `transport-order-restore-host-net-20261030` 后，`docker port` 确认 `3000/tcp -> 127.0.0.1:3106`。此阶段并非完全断网测试，不应将其描述为始终无外部路由的环境。
- 本机 `3106` TCP 测试成功，`http://127.0.0.1:3106/api/test` 返回 `API is working`；浏览器登录、订单查询、临时字段修改保存及刷新后持久化均获用户确认。未确认临时字段已恢复原值。
- 三个测试容器已停止并删除，两个测试网络已删除；最终容器清点无匹配项。数据卷 `transport-order-restore-data-20261030` 仍存在，未删除，可能保留测试修改。原始备份不受影响。
- 服务器恢复暂存目录 `/home/deploy/restore-check-20261030.jo7Oad` 已清理，不存在检查返回 `CLEANUP_OK`。

结论：该批次通过数据库基础恢复及上述应用流程验收；附件、全部业务、逐字段数据一致性和整站灾难恢复仍未全部验收。

### 16.10 定时备份运行复查（2026-11-01）

- `transport-order-management-backup.timer` 为 `enabled`、`active (waiting)`；复查时显示下次运行时间为 `2026-11-02 02:36:14 CST`。
- service 日志确认 `2026-10-31 02:36:15 CST` 启动，返回 `backup-ok 20261031-023615`；`2026-11-01 02:39:38 CST` 返回 `backup-ok 20261101-023938`，两次均正常完成。
- 两次定时批次的数据库压缩包、上传归档和清单均已生成，文件列表显示为 `root:root`、权限 `600`。
- 对 `manifest_20261101-023938.sha256` 执行校验，`mysql_20261101-023938.sql.gz`、`uploads_20261101-023938.tar.gz` 均返回 `OK`。本次未重新执行最新批次的 SQL 导入或附件内容恢复。

### 16.11 单批次加密及本机副本（2026-11-01）

- 已创建 `/var/backups/transport-order-management/encrypted`，创建命令指定权限 `700`。未修改原始备份、自动备份脚本或定时任务。
- 手动将批次 `20261101-023938` 的数据库压缩包、上传归档及 SHA256 清单打包并加密；使用 AES-256-CBC、PBKDF2、200000 次迭代和 salt，命令设置 `umask 077`。密码由管理员自行输入并单独保管，不写入文档或聊天。
- 首次口令确认失败留下的 0 字节文件已删除；重试返回 `ENCRYPT_OK`。服务器流式解密、归档目录检查返回预期的 3 个文件名和 `DECRYPT_CHECK_OK`，未将解密内容落地。
- 正式加密副本：`/var/backups/transport-order-management/encrypted/backup_20261101-023938.tar.gz.enc`。
- 通过专用 `deploy` 密钥 SCP 下载到 `E:\transFormation\tmp\server-backups\backup_20261101-023938.tar.gz.enc`，传输完成，大小为 5664 字节。
- 服务器与本机完整 SHA256 一致：`1344e8601fa1c583bd1defc3bed0a055ba728f7ba10e4b39b4de4aa071ef485c`。
- 下载暂存目录 `/home/deploy/backup-export-20261101.70FKqn` 内的加密副本已删除，空目录已通过 `rmdir` 删除；不存在检查返回 `CLEANUP_OK`。服务器正式加密副本和本机副本仍保留。
- 本机使用已有 MySQL 镜像 `7dcddc01f13b` 内的 OpenSSL 3.5.1 验证下载的加密包；临时容器设置 `--network none`、`--pull=never`、备份文件只读绑定及 `--rm`。流式解密并列出归档目录成功，返回预期的 3 个文件名及 `LOCAL_DECRYPT_CHECK_OK`，未将解密文件落地。

边界：目前仅完成这一批次的手动加密、服务器及本机解密目录检查、本机下载校验；本机解密后未重新校验包内 SHA256 清单，也未对该最新批次重新执行数据库恢复。每日原始备份仍是明文，自动加密、定期异地同步及加密副本保留策略尚未配置，不得据此标记全部备份加固已完成。

### 16.12 OSS 异地备份目的地配置（2026-11-01）

以下根据用户控制台操作反馈及本机下载校验记录，尚未通过 API 复核全部配置。

- 用户确认生产服务器位于上海；后续在轻量应用服务器控制台找到 `47.117.106.202`，并非此前按 ECS 入口查找的实例。备份 Bucket 选择华北 2（北京），填写名称 `transformation-backup-bj-20261101` 后确认创建成功。
- 创建时用户确认选择标准存储、同城冗余（ZRS）、私有访问、开启阻止公共访问及版本控制，服务端加密采用 OSS 完全托管（SSE-OSS）、AES256。
- 生命周期规则按前缀 `daily/` 匹配。用户逐项确认当前版本最后修改 30 天后删除、历史版本成为历史版本 7 天后永久删除、未完成上传的分片 7 天后清理，不配置存储类型转换，并确认保存成功；随后反馈规则启用状态、前缀及三项保留天数均核对一致。
- 上述为当前版本 30 天加历史版本 7 天缓冲的配置，不代表上传满 30 天即永久删除；不代表不可变备份或已经验证生命周期实际执行。
- 用户确认已创建 `daily/` 目录。首次上传的加密文件位于 OSS 的另一目录（用户称 `server-backups`，也曾拼写为 `serber-backups`），用户确认该目录只有该加密文件，没有其他内容；尚未确认清理此重复副本，该位置不匹配 `daily/` 生命周期前缀。
- 随后将 `backup_20261101-023938.tar.gz.enc` 单独上传至 `daily/`，用户确认文件直接显示在该目录内，并从该目录下载到 `C:\Users\31770\Downloads\backup_20261101-023938.tar.gz.enc`。
- OSS 下载副本的完整 SHA256 为 `1344e8601fa1c583bd1defc3bed0a055ba728f7ba10e4b39b4de4aa071ef485c`，与服务器正式加密副本及本机原始下载文件一致。该批次手动上传、下载及字节完整性校验通过，未另行对 OSS 下载副本执行解密或数据库恢复。

边界：本节仅记录单批次控制台手动 OSS 上传和下载校验。后续服务器专用身份及命令行上传验证见 16.13；自动加密、定期异地同步及服务器本地加密副本自动保留策略仍未配置。

### 16.13 专用上传身份及服务器上传验证（2026-11-01）

- 用户确认创建 RAM 用户 `transport-backup-uploader`，创建时未勾选控制台访问或永久 AccessKey 访问；随后单独创建 AccessKey，并反馈已自行妥善保存。不得将 ID、Secret 或完整配置记录到仓库或聊天。
- 用户确认创建并授权自定义策略 `TransportBackupDailyUploadOnly`。该策略仅含 `oss:PutObject`，资源为 `acs:oss:*:*:transformation-backup-bj-20261101/daily/*`，未在该策略内授予读取、删除或 Bucket 管理权限。本次未执行拒绝权限测试。
- 服务器架构为 `x86_64`，原先未找到 `ossutil`。从官方地址下载 `ossutil-2.4.1-linux-amd64.zip`，SHA256 为 `57ee4c56796a40144acd6b0b96b53b4ba75e5cec09c01d8d0313c09a5524022f`，与官方公布值一致；解压后安装到 `/usr/local/bin/ossutil`，`ossutil version` 返回 `2.4.1`。
- 配置目录 `/etc/transport-order-management-backup` 已检查为 `700 root:root`。通过 `umask 077` 下的交互配置，将凭据写入独立文件 `/etc/transport-order-management-backup/ossutilconfig`；配置后权限检查为 `600 root:root`，未读取或记录文件内容。
- 首次 `ossutil api put-object` 报 `invalid field, Endpoint`；仅重设 Endpoint 为 `https://oss-cn-beijing.aliyuncs.com` 后重试，命令未报错。未扩大授权或重填密钥；后续配置文件权限复核及修正见 16.14。
- 使用该服务器配置，将既有加密文件 `backup_20261101-023938.tar.gz.enc` 上传为 OSS 对象 `daily/server-upload-check-20261101.tar.gz.enc`。用户随后从该位置下载到 `C:\Users\31770\Downloads\server-upload-check-20261101.tar.gz.enc`。
- 服务器上传测试副本的下载 SHA256 为 `1344e8601fa1c583bd1defc3bed0a055ba728f7ba10e4b39b4de4aa071ef485c`，与服务器正式加密文件及之前副本一致。服务器专用身份的手动上传、OSS 下载及字节完整性校验通过，未另行对该下载副本解密或导入 SQL。

边界：自动加密与定期异地同步仍未配置，现有备份脚本和 timer 未因这些上传测试而修改。服务器加密文件、OSS 测试副本及重复副本尚未确认清理；保留的恢复测试数据卷不得擅自删除。

### 16.14 age 安装、公钥配置及凭据权限复查（2026-11-01）

以下仅记录已确认的准备工作，不代表公钥加密或自动上传已完成。

- 本机 Windows `age.exe`、`age-keygen.exe` 位于 `C:\Users\31770\Tools\age-v1.3.2\age`，两者版本均确认是 `v1.3.2`。Windows amd64 安装包 SHA256 为 `f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7`，此前已与官方公布值核对。
- 本机生成私钥 `C:\Users\31770\transport-backup-keys\identity.txt`。生成时出现 `world-readable file` 警告；随后 Windows ACL 输出仅显示目录授予当前账户 `LYQ\31770` 完全控制，私钥文件继承该权限。未读取或记录私钥内容，未据此断言警告原因或实际泄露；私钥尚未确认另行加密或离线备份。
- 使用 `age-keygen -y` 单独导出公钥到 `C:\Users\31770\Downloads\transport-backup-public.txt`，本机及服务器读取结果均为 `age12w9qd5fwzslek4ygvnket3mgvu4lf9j0p56xw7rwwppfpjj7w9gqhpc7tp`。仅上传公钥文件，未上传私钥。
- 公钥上传首次遇到 SSH `Permission denied (publickey)`；两端部署 SSH 公钥指纹一致，随后指定 `IdentitiesOnly=yes` 的 SSH 测试认证成功，`whoami` 返回 `deploy`，SCP 重试成功。现有证据未确定首次失败原因；本轮未修改 SSH 配置或授权列表。
- 服务器公钥已安装为 `/etc/transport-order-management-backup/age-recipients.txt`，权限复核为 `600 root:root`。同次检查发现 `ossutilconfig` 为 `644 root:root`，已执行 `chmod 600`，再次检查确认是 `600 root:root`；未输出配置内容，不能仅凭该文件此前为 `644` 就认定凭据泄露。
- 服务器未找到 `age`。软件源查询返回候选版本 `1.1.1-1ubuntu0.24.04.3`，本轮未通过 apt 安装；改用官方 `v1.3.2` Linux amd64 发行包。服务器直连 GitHub 下载失败，随后由本机下载，经专用部署密钥 SCP 上传到 `/home/deploy/age-v1.3.2-linux-amd64.tar.gz`。
- Linux 安装包在本机及服务器上的 SHA256 均为 `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10`，与官方公布值一致。解压目录为 `/home/admin/age-install.ePOQOu`，安装命令指定 `/usr/local/bin/age` 为 `root:root`、权限 `755`；执行 `/usr/local/bin/age --version` 返回 `v1.3.2`。

边界：本节准备工作结束时，尚未使用该公钥完成备份加密、本机私钥解密或包内清单校验，后续结果见 16.15。私钥离线备份及恢复验证仍待完成。每日原始备份仍未加密，自动备份脚本和 timer 均未修改。公钥上传暂存文件、安装包、解压目录及服务器失败下载可能留下的文件尚未确认清理；不得清理现有正式备份或保留的恢复测试数据卷。

### 16.15 单批次 age 加密与本机解密完整性验收（2026-11-01）

- 用户明确要求暂缓私钥独立备份，继续单批次加密验收；该待办未完成，不代表已消除本机私钥单点丢失风险。
- 对既有批次 `20261101-023938` 的原始清单执行 SHA256 校验，数据库压缩包及上传归档均为 `OK`。使用服务器公钥将两份归档和清单打包，经 `age` 加密后生成 `/var/backups/transport-order-management/encrypted/backup_20261101-023938.tar.gz.age`，返回 `AGE_ENCRYPT_OK`。命令启用 `pipefail`、`umask 077` 和防覆盖，以 `.part` 暂存后通过硬链接发布正式文件，再移除暂存链接；未修改原始备份。
- 创建下载暂存目录 `/home/deploy/age-export-20261101.um7Kn4`，复制密文时指定 `deploy:deploy`、权限 `600`。通过专用部署密钥 SCP 下载到 `E:\transFormation\tmp\server-backups\backup_20261101-023938.tar.gz.age`，传输完成，大小为 5842 字节。
- 服务器与本机密文完整 SHA256 均为 `d448710a4e141f7befbc214dd10389e6ad7638af9237522f3e7ccfc6c8ffde91`。
- 本机新建验收目录 `C:\Users\31770\transport-age-check-20261101`，移除继承权限后，ACL 复核仅显示当前账户 `LYQ\31770` 的完全控制权限。使用本机私钥将密文解密为该目录下的 `backup_20261101-023938.tar.gz`，退出码为 `0`，未输出或上传私钥。
- 解密后归档目录检查仅含 `mysql_20261101-023938.sql.gz`、`uploads_20261101-023938.tar.gz`、`manifest_20261101-023938.sha256`。
- 在本机已有镜像 `7dcddc01f13b` 的一次性容器中复核包内清单：使用 `--network none`、`--pull=never`、`--rm`，解密归档只读挂载；解压位置 `/var/backups` 为临时 `tmpfs`，未挂载私钥、启动数据库或导入 SQL。两份包内文件均为 `OK`，返回 `INNER_HASH_OK`。

- 使用服务器专用上传身份，将该密文上传为 `daily/backup_20261101-023938.tar.gz.age`，启用 `--forbid-overwrite true`，命令成功返回。用户从 OSS 下载到本机 `Downloads` 后，完整 SHA256 仍为 `d448710a4e141f7befbc214dd10389e6ad7638af9237522f3e7ccfc6c8ffde91`。此副本与已解密、已校验包内清单的密文逐字节一致；未另行对 OSS 下载副本执行解密或 SQL 导入。
- 服务器下载暂存文件已精确删除，空目录 `/home/deploy/age-export-20261101.um7Kn4` 已通过 `rmdir` 删除；不存在检查返回 `CLEANUP_OK`。

结论与边界：该批次通过 age 公钥加密、本机私钥解密、密文传输校验、包内 SHA256 及 OSS 上传下载校验；未对该批次重新执行 SQL 恢复。本机受限目录仍留有解密后的明文归档。自动备份脚本与 timer 未修改，每日自动加密、自动异地上传和加密副本自动保留仍待完成。

### 16.16 自动异地上传准备与本机脚本验证（2026-11-01）

- 用户已确认继续完成自动上传；私钥独立备份仍按用户要求暂缓，不得标记完成。
- 生产 service 查询结果：`Type=oneshot`、`User=root`、`ExecStart=/usr/local/sbin/transport-order-management-backup`，未显示已有 `ExecStartPost`。隔离设置为 `ProtectSystem=full`、`PrivateTmp=yes`、`PrivateNetwork=no`、`ReadWritePaths=`，启动超时为 30 分钟。
- 修改前留存目录为 `/var/backups/transport-order-management/before-offsite-20261101.UnhKBX`。用户命令已复制原备份脚本，并将 service、timer 的 `systemctl cat` 合并输出保存为 `units.txt`；尚未修改生产脚本、service 或 timer。
- 本机新增 `scripts/transport-order-management-offsite.sh`，拟由原备份成功后的 `ExecStartPost` 调用，不替换原备份脚本或 timer。该脚本只读取已生成的备份文件，不连接数据库；默认要求最新清单在 30 分钟内，显式批次参数用于人工复核。
- 脚本先检查目录、配置及源文件权限，再验证清单恰好覆盖数据库和上传归档；通过公钥流式加密到权限 `600` 的临时密文，并防覆盖发布。目标为 `daily/automatic/backup_<批次>_<随机串>.tar.gz.age`，仍匹配已有 `daily/` 授权和生命周期规则。
- 上传最多尝试 3 次，每次有超时限制；失败保留密文及受限日志、返回非零，不写入成功回执。成功后记录密文 SHA256、对象 key 和回执；仅对专属 `encrypted/automatic` 目录中超过 14 天、回执与密文校验均一致的已确认上传副本执行清理，不清理原始备份、手动加密文件或未确认上传的密文。
- 本机测试脚本为 `scripts/transport-order-management-offsite-test.sh`。使用已有 `docker.m.daocloud.io/library/node:18-bookworm-slim` 镜像、`--network none`、`--pull=never`、`--rm`；脚本和公开 age 安装包只读挂载，测试写入 tmpfs。只生成临时测试数据和临时测试密钥，未挂载真实备份、用户私钥或 OSS 配置，未启动数据库。
- 隔离测试 16 项通过，返回 `OFFSITE_FIXTURE_TESTS_OK`：真实 age 加解密与权限、第三次重试成功、上传持续失败保留密文、加密失败清理暂存、源校验失败、凭据宽权限拒绝、配置符号链接拒绝、非法批次拒绝、过期清单拒绝、默认批次选择、并发锁、保留期清理范围、损坏回执拒绝清理、变更密文拒绝清理、输出目录符号链接拒绝及不完整清单拒绝。

边界：以上测试使用模拟 OSS 上传，不代表真实 ossutil 上传、生产 systemd 沙箱或定时执行已验收。自动上传脚本尚未上传、安装或接入生产；后续仍需逐步完成服务器校验、显式批次上传、OSS 下载核验、service 接入、手动联动验收，以及下一次真实定时运行复查。主动失败告警尚未配置。服务器原始备份仍为明文，本机明文验收归档、安装暂存文件和 OSS 重复测试副本清理尚待确认；保留的恢复测试数据卷不得擅自删除。

### 16.17 自动上传脚本安装与真实单批次验收（2026-11-01）

- 用户通过专用部署密钥将脚本上传至 `/home/deploy/transport-order-management-offsite.sh`，服务器 SHA256 为 `cec7a3de057414ddae7fd20b5a739777416787b696a7fe783f5665ffef94219a`，与本机一致；`bash -n` 返回 `SYNTAX_OK`。
- 安装至 `/usr/local/sbin/transport-order-management-offsite`，权限复核为 `700 root:root`。服务器 `ossutil api put-object --help` 确认支持 `--forbid-overwrite`、`--retry-times`、`--connect-timeout`、`--read-timeout`。
- 用户显式指定既有批次 `20261101-023938` 运行脚本，第一次上传即成功，返回 `offsite-upload-ok` 和 `offsite-ok 20261101-023938`。未通过该命令操作生产数据库。
- 本次对象 key 为 `daily/automatic/backup_20261101-023938_2LfJLRtwdY.tar.gz.age`，日志中密文 SHA256 为 `bb894220d5850470b5756665838420154d35f44c6e7a07e83cd001832ab692f7`。
- 从 OSS 下载至本机 `Downloads` 后，完整 SHA256 与上传日志一致。使用本机私钥解密至受限目录中的 `C:\Users\31770\transport-age-check-20261101\automatic_2LfJLRtwdY.tar.gz`，退出码为 `0`；未上传或输出私钥。
- 对该解密归档运行断网临时 Docker 校验，归档只读挂载、解压位置为 tmpfs；数据库压缩包和上传归档均返回 `OK`，最后返回 `INNER_HASH_OK`。未启动数据库或重新导入 SQL。

边界：真实单批次加密上传、OSS 下载、解密及包内校验已通过；service、timer 尚未接入新脚本，systemd 联动和下一次真实定时运行仍待验收，不能标记自动异地备份已完成。私钥独立备份仍暂缓，主动失败告警未配置。两份本机解密验收归档仍待清理，生产原始备份仍为明文；保留的恢复测试数据卷不作删除。

### 16.18 systemd 接入及新批次手动联动验收（2026-11-01）

- 用户创建 `/etc/systemd/system/transport-order-management-backup.service.d`，并通过防覆盖写入 `20-offsite.conf`；读回内容为 `[Service]` 和 `ExecStartPost=/usr/local/sbin/transport-order-management-offsite`。
- 执行 `systemctl daemon-reload` 后，`systemctl show` 确认 `DropInPaths` 为上述文件、`ExecStartPost` 指向已安装上传脚本且 `ignore_errors=no`。未替换原备份脚本或 timer，未重启应用。
- 用户手动启动 `transport-order-management-backup.service`，日志确认 `2026-11-01 18:27:15 CST` 返回 `backup-ok 20261101-182715`；随后首次上传即成功，`18:27:16 CST` 返回 `offsite-upload-ok` 和 `offsite-ok 20261101-182715`。
- 本次对象 key 为 `daily/automatic/backup_20261101-182715_AjYonAKyYm.tar.gz.age`，上传日志记录密文 SHA256 为 `3831e373f3e9af28293e5b7637a5b0f82e000a34230ec8755cd8facb2d2f4270`。service 随后显示 `Deactivated successfully`、`Finished`。

- 接入后再次查询 timer，确认为 `enabled`、`active (waiting)`，显示下次计划运行时间为 `2026-11-02 02:40:41 CST`。该时间是本次状态查询结果，不代表已执行；后续计划时间以实时状态为准。

结论与边界：自动加密上传配置及 systemd 手动完整联动验收已完成，接入后 timer 状态已复查；本次备份是人工触发，不得登记为真实定时运行。下一次真实定时加密上传仍待复查。未另行下载、解密或恢复本次新批次；先前批次的 OSS 下载、解密及包内校验见 16.17。私钥独立备份仍暂缓，主动失败告警及清理待办不因此标记完成。
