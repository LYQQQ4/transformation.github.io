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
