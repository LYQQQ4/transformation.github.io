#!/bin/bash
# Linux 快速部署脚本

echo "=========================================="
echo "运输订单管理系统 - 企业部署脚本"
echo "=========================================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"

# 检查 MySQL
if ! command -v mysql &> /dev/null; then
    echo "⚠️  警告: 未找到 MySQL 客户端，请确保 MySQL 服务正在运行"
fi

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "📝 创建 .env 文件..."
    if [ -f env.template ]; then
        cp env.template .env
        echo "✅ 已从模板创建 .env 文件，请编辑 .env 文件填写配置"
    else
        echo "❌ 错误: 未找到 env.template 文件"
        exit 1
    fi
else
    echo "✅ .env 文件已存在"
fi

# 安装依赖
echo "📦 安装依赖包..."
npm install --production

# 创建必要目录
echo "📁 创建必要目录..."
mkdir -p logs
mkdir -p uploads
mkdir -p backend/uploads

# 检查 PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 安装 PM2..."
    npm install -g pm2
else
    echo "✅ PM2 已安装"
fi

echo ""
echo "=========================================="
echo "部署准备完成！"
echo "=========================================="
echo ""
echo "下一步操作："
echo "1. 编辑 .env 文件，填写数据库配置等信息"
echo "2. 确保 MySQL 数据库已创建并运行"
echo "3. 运行以下命令启动服务："
echo "   pm2 start ecosystem.config.js --env production"
echo "   或"
echo "   npm run pm2:start"
echo ""
echo "查看日志："
echo "   pm2 logs transport-order-management"
echo ""
