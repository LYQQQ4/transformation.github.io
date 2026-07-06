# Docker 部署指南

本文档说明如何使用 Docker 容器部署运输订单管理系统。

## 📋 前置要求

- **Docker**: 20.10+ 
- **Docker Compose**: 1.29+（通常包含在 Docker Desktop 中）

### 安装 Docker

- **Windows**: 下载并安装 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
- **Linux**: 参考 [Docker 官方安装文档](https://docs.docker.com/engine/install/)
- **Mac**: 下载并安装 [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop)

## 🚀 快速开始

### 1. 测试配置（可选）

在启动前，可以运行测试脚本检查配置：

**Windows:**
```bash
docker-test.bat
```

**Linux/Mac:**
```bash
chmod +x docker-test.sh
./docker-test.sh
```

### 2. 启动服务

**方式 1: 使用快速启动脚本（推荐）**

**Windows:**
```bash
docker-up.bat
```

**Linux/Mac:**
```bash
chmod +x docker-up.sh
./docker-up.sh
```

**方式 2: 手动启动**

在项目根目录运行：

```bash
docker-compose up -d
```

这个命令会：
- 自动构建应用镜像
- 启动 MySQL 数据库容器
- 启动应用容器
- 自动初始化数据库表结构

### 3. 查看日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 只查看应用日志
docker-compose logs -f app

# 只查看数据库日志
docker-compose logs -f db
```

### 4. 访问应用

打开浏览器访问：`http://localhost:3000`

## 📝 常用命令

### 启动服务
```bash
docker-compose up -d
```

### 停止服务
```bash
docker-compose down
```

### 重启服务
```bash
docker-compose restart
```

### 查看运行状态
```bash
docker-compose ps
```

### 查看日志
```bash
docker-compose logs -f app
```

### 进入容器
```bash
# 进入应用容器
docker-compose exec app sh

# 进入数据库容器
docker-compose exec db mysql -u root -p
```

### 重新构建镜像
```bash
docker-compose build --no-cache
docker-compose up -d
```

## ⚙️ 配置说明

### 修改数据库密码

编辑 `docker-compose.yml` 文件，修改 `MYSQL_ROOT_PASSWORD` 环境变量：

```yaml
environment:
  MYSQL_ROOT_PASSWORD: your_secure_password_here
```

同时需要修改 `app` 服务中的 `DB_PASSWORD` 和 `USER_DB_PASSWORD`。

或者创建 `.env` 文件：

```env
MYSQL_ROOT_PASSWORD=your_secure_password_here
```

### 修改端口

如果需要修改应用端口，编辑 `docker-compose.yml`：

```yaml
ports:
  - "8080:3000"  # 将本地 8080 端口映射到容器的 3000 端口
```

### 修改 CORS 配置

编辑 `docker-compose.yml` 中的 `CORS_ORIGIN` 环境变量：

```yaml
environment:
  CORS_ORIGIN: "http://localhost:3000,http://192.168.1.100:3000"
```

## 💾 数据持久化

数据库数据存储在 Docker volume `mysql_data` 中，即使删除容器，数据也不会丢失。

### 备份数据库

```bash
# 导出数据库
docker-compose exec db mysqldump -u root -p order_system > backup_order.sql
docker-compose exec db mysqldump -u root -p user_system > backup_user.sql
```

### 恢复数据库

```bash
# 恢复数据库
docker-compose exec -T db mysql -u root -p order_system < backup_order.sql
docker-compose exec -T db mysql -u root -p user_system < backup_user.sql
```

## 🔧 故障排查

### 1. 容器无法启动

检查日志：
```bash
docker-compose logs app
```

### 2. 数据库连接失败

确保数据库容器已启动并健康：
```bash
docker-compose ps
```

等待数据库就绪（应用会自动等待，最多 60 秒）。

### 3. 端口被占用

修改 `docker-compose.yml` 中的端口映射，使用其他端口。

### 4. 权限问题

确保 Docker 有足够权限访问项目目录。

## 📦 打包分发

### 方式 1: 直接分发项目文件夹

将整个项目文件夹（包含 Docker 配置文件）打包发送给其他人。

接收方只需：
1. 解压文件
2. 运行 `docker-compose up -d`

### 方式 2: 导出镜像

```bash
# 构建并导出镜像
docker-compose build
docker save transport-order-management_app:latest -o app-image.tar
docker save mysql:8.0 -o mysql-image.tar
```

接收方导入镜像：
```bash
docker load -i app-image.tar
docker load -i mysql-image.tar
docker-compose up -d
```

## 🔒 安全建议

1. **修改默认密码**: 生产环境必须修改 `MYSQL_ROOT_PASSWORD`
2. **限制 CORS**: 配置正确的 `CORS_ORIGIN`，不要使用 `*`
3. **使用 HTTPS**: 通过反向代理（如 Nginx）配置 HTTPS
4. **定期备份**: 定期备份数据库数据
5. **更新镜像**: 定期更新基础镜像以获取安全补丁

## 📚 更多信息

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- 查看 `DEPLOYMENT.md` 了解非 Docker 部署方式
