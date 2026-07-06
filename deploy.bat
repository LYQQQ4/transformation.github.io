@echo off
REM Windows 快速部署脚本

echo ==========================================
echo 运输订单管理系统 - 企业部署脚本
echo ==========================================
echo.

REM 检查 Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    exit /b 1
)

echo [OK] Node.js 版本:
node -v
echo.

REM 检查 .env 文件
if not exist .env (
    echo [信息] 创建 .env 文件...
    if exist env.template (
        copy env.template .env >nul
        echo [OK] 已从模板创建 .env 文件，请编辑 .env 文件填写配置
    ) else (
        echo [错误] 未找到 env.template 文件
        exit /b 1
    )
) else (
    echo [OK] .env 文件已存在
)
echo.

REM 安装依赖
echo [信息] 安装依赖包...
call npm install --production
echo.

REM 创建必要目录
echo [信息] 创建必要目录...
if not exist logs mkdir logs
if not exist uploads mkdir uploads
if not exist backend\uploads mkdir backend\uploads
echo.

REM 检查 PM2
where pm2 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [信息] 安装 PM2...
    call npm install -g pm2
) else (
    echo [OK] PM2 已安装
)
echo.

echo ==========================================
echo 部署准备完成！
echo ==========================================
echo.
echo 下一步操作：
echo 1. 编辑 .env 文件，填写数据库配置等信息
echo 2. 确保 MySQL 数据库已创建并运行
echo 3. 运行以下命令启动服务：
echo    pm2 start ecosystem.config.js --env production
echo    或
echo    npm run pm2:start
echo.
echo 查看日志：
echo    pm2 logs transport-order-management
echo.
pause
