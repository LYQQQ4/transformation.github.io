@echo off
REM ============================================
REM Windows 服务器部署脚本
REM 用于将项目部署到 C:\transform
REM ============================================

setlocal enabledelayedexpansion
chcp 65001 > nul

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║           运输订单管理系统 - Windows 服务器部署脚本            ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

REM 设置部署目录
set "DEPLOY_DIR=C:\transform"
set "TIMESTAMP=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~5,2%%time:~8,2%"

REM ============================================
REM 第一步：检查 Node.js 和 npm
REM ============================================
echo [1/5] 检查环境...
echo.

node --version > nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: Node.js 未安装或不在 PATH 中
    echo 请从 https://nodejs.org/ 下载并安装 Node.js (v14+)
    pause
    exit /b 1
)

npm --version > nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: npm 未安装或不在 PATH 中
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i

echo ✓ Node.js %NODE_VERSION% 已安装
echo ✓ npm %NPM_VERSION% 已安装
echo.

REM ============================================
REM 第二步：检查 MySQL 服务
REM ============================================
echo [2/5] 检查 MySQL 数据库...
echo.

tasklist | findstr /I "mysqld" > nul
if errorlevel 1 (
    echo ⚠ 警告: MySQL 服务未启动
    echo 请确保 MySQL 服务已启动后继续
    echo.
    set /p "CONTINUE=是否继续部署？(Y/N): "
    if /I not "!CONTINUE!"=="Y" (
        echo 部署已取消
        exit /b 1
    )
) else (
    echo ✓ MySQL 服务已运行
    echo.
)

REM ============================================
REM 第三步：准备部署目录
REM ============================================
echo [3/5] 准备部署目录: %DEPLOY_DIR%
echo.

if not exist "%DEPLOY_DIR%" (
    echo 创建部署目录...
    mkdir "%DEPLOY_DIR%"
    if errorlevel 1 (
        echo ❌ 错误: 无法创建 %DEPLOY_DIR% 目录
        echo 请检查权限或创建目录后重试
        pause
        exit /b 1
    )
    echo ✓ 目录已创建
) else (
    echo ✓ 目录已存在
)

REM 创建必需的子目录
for %%D in (logs uploads backend frontend) do (
    if not exist "%DEPLOY_DIR%\%%D" (
        mkdir "%DEPLOY_DIR%\%%D"
        echo ✓ 已创建 %%D 目录
    )
)
echo.

REM ============================================
REM 第四步：复制文件并安装依赖
REM ============================================
echo [4/5] 配置应用文件...
echo.

REM 检查 package.json
if not exist "package.json" (
    echo ❌ 错误: 当前目录缺少 package.json
    echo 请在项目根目录运行此脚本
    pause
    exit /b 1
)

REM 检查 .env 文件
if not exist ".env" (
    if exist "env.server" (
        echo 复制 .env 配置文件...
        copy env.server .env > nul
        echo ✓ .env 已创建（请修改数据库密码等配置）
        echo.
        echo ⚠ 重要: 请编辑 .env 文件并更新以下信息：
        echo    - DB_PASSWORD: 数据库密码
        echo    - USER_DB_PASSWORD: 用户系统数据库密码
        echo    - CORS_ORIGIN: 服务器访问地址
        echo.
        set /p "EDIT_ENV=是否立即编辑 .env 文件？(Y/N): "
        if /I "!EDIT_ENV!"=="Y" (
            notepad .env
        )
    )
) else (
    echo ✓ .env 文件已存在
)
echo.

REM 安装 npm 依赖
echo 安装 npm 依赖（这可能需要几分钟）...
call npm install --production
if errorlevel 1 (
    echo ❌ 错误: npm install 失败
    pause
    exit /b 1
)
echo ✓ npm 依赖已安装
echo.

REM ============================================
REM 第五步：初始化数据库
REM ============================================
echo [5/5] 初始化数据库...
echo.

if exist "setup_db_server.js" (
    echo 执行数据库初始化脚本...
    call node setup_db_server.js
    if errorlevel 1 (
        echo ❌ 错误: 数据库初始化失败
        echo 请检查：
        echo   1. MySQL 服务是否已启动
        echo   2. .env 中的数据库配置是否正确
        echo   3. 数据库用户是否有创建数据库的权限
        pause
        exit /b 1
    )
    echo ✓ 数据库初始化成功
) else (
    echo ⚠ 警告: setup_db_server.js 不存在，跳过数据库初始化
    echo 可以后续手动运行: node setup_db_server.js
)
echo.

REM ============================================
REM 部署完成
REM ============================================
echo ╔════════════════════════════════════════════════════════════════╗
echo ║                  ✓ 部署完成！                                  ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
echo 后续步骤：
echo.
echo 1. 开发环境启动：
echo    npm start
echo.
echo 2. 生产环境启动（需要先安装 PM2）：
echo    npm install -g pm2
echo    pm2 start ecosystem.config.js --env production
echo    pm2 save
echo.
echo 3. 查看运行状态：
echo    pm2 status
echo    pm2 logs
echo.
echo 应用地址：http://localhost:3000
echo 更多信息请查看 SERVER_MIGRATION_GUIDE.md
echo.
pause
