#!/bin/sh
# Docker 容器启动脚本

echo "=========================================="
echo "运输订单管理系统 - Docker 启动脚本"
echo "=========================================="

# 等待数据库就绪
echo "等待数据库就绪..."
node wait-for-db.js

# 初始化数据库
echo "初始化数据库..."
node setup_db_docker.js

# 启动应用
echo "启动应用服务器..."
node backend/server.js
