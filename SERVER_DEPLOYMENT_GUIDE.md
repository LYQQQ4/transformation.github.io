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
docker compose exec -T db mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction order_system user_system | gzip > "/var/backups/transport-order-management/mysql_$(date +%F_%H-%M-%S).sql.gz"
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
  --single-transaction order_system user_system \
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
