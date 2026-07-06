运行说明 — 在其他电脑上运行本项目

目的
- 使项目在其他人的电脑上可直接运行，避免宿主机 MySQL 端口冲突。

默认行为
- `docker-compose.yml` 不会将数据库端口映射到宿主（不占用宿主的 3306/3307）。
- 应用服务仍然监听容器端口 `3000`，并映射为宿主 `3000`（请确保宿主 `3000` 未被占用）。

如何在目标电脑上运行
1. 安装 Docker Desktop 并确保已启动（或 Docker Engine 可用）。
2. 在项目根目录运行：

```powershell
docker-compose up -d
```

3. 检查容器状态：

```powershell
docker ps
docker-compose ps
```

4. 访问应用：

- 在浏览器或通过 `Invoke-WebRequest` 访问 `http://127.0.0.1:3000/api/test`。

可选：如果你需要在目标宿主上直接访问 MySQL（例如用本地 MySQL 客户端），在启动时添加可选的 compose 文件以发布端口：

```powershell
# 会把容器的 3306 映射到宿主 3307
docker-compose -f docker-compose.yml -f docker-compose.host.yml up -d
```

如果要改回 `3306`，请先确保宿主上没有运行 MySQL 服务并修改 `docker-compose.host.yml` 的端口映射。

其他说明
- 如果需要在目标机器上允许防火墙访问端口（例如远程访问），请以管理员身份配置防火墙规则，而不是在脚本中关闭防火墙。 
- 我已删除 `version:` 和 `container_name` 的默认值，以减少在不同机器上的命名/兼容问题。

遇到问题请把 `docker-compose ps`、`docker-compose logs` 输出贴给我，我会远程继续协助调试。