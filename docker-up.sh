#!/bin/bash
# Docker 快速启动脚本 (Linux/Mac)

echo "=========================================="
echo "启动 Docker 容器"
echo "=========================================="
echo ""

# 检查 Docker 是否运行
if ! docker ps &> /dev/null; then
    echo "❌ 错误: Docker 未运行，请先启动 Docker 服务"
    exit 1
fi

echo "📦 构建并启动容器..."
docker-compose up -d --build

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ 启动成功！"
    echo "=========================================="
    echo ""
    echo "查看日志: docker-compose logs -f"
    echo "停止服务: docker-compose down"
    echo "访问应用: http://localhost:3000"
    echo ""
else
    echo ""
    echo "❌ 启动失败，请查看上面的错误信息"
    echo ""
    exit 1
fi
