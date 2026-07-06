#!/bin/bash
# Docker 配置测试脚本 (Linux/Mac)

echo "=========================================="
echo "Docker 配置测试"
echo "=========================================="
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: 未找到 Docker，请先安装 Docker"
    echo "安装指南: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "✅ Docker 已安装"
docker --version
echo ""

# 检查 Docker Compose 是否可用
if docker compose version &> /dev/null; then
    echo "✅ Docker Compose 可用"
    docker compose version
elif command -v docker-compose &> /dev/null; then
    echo "✅ Docker Compose 可用 (旧版本)"
    docker-compose --version
else
    echo "❌ 错误: 未找到 Docker Compose"
    exit 1
fi
echo ""

# 检查必要文件
echo "📋 检查必要文件..."
files=("Dockerfile" "docker-compose.yml" "wait-for-db.js" "setup_db_docker.js" "package.json")

for file in "${files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ 错误: 未找到 $file"
        exit 1
    fi
    echo "✅ $file 存在"
done

echo ""
echo "=========================================="
echo "配置检查完成！"
echo "=========================================="
echo ""
echo "下一步操作："
echo "1. 确保 Docker 服务正在运行"
echo "2. 运行: docker-compose up -d"
echo "3. 查看日志: docker-compose logs -f"
echo "4. 访问: http://localhost:3000"
echo ""
