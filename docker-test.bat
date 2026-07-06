@echo off
REM Docker 配置测试脚本 (Windows)

echo ==========================================
echo Docker 配置测试
echo ==========================================
echo.

REM 检查 Docker 是否安装
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未找到 Docker，请先安装 Docker Desktop
    echo 下载地址: https://www.docker.com/products/docker-desktop
    exit /b 1
)

echo [OK] Docker 已安装
docker --version
echo.

REM 检查 Docker Compose 是否可用
docker compose version >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [警告] Docker Compose 可能不可用，尝试使用 docker-compose
    where docker-compose >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo [错误] 未找到 docker-compose
        exit /b 1
    )
)

echo [OK] Docker Compose 可用
echo.

REM 检查必要文件
echo [信息] 检查必要文件...
if not exist Dockerfile (
    echo [错误] 未找到 Dockerfile
    exit /b 1
)
echo [OK] Dockerfile 存在

if not exist docker-compose.yml (
    echo [错误] 未找到 docker-compose.yml
    exit /b 1
)
echo [OK] docker-compose.yml 存在

if not exist wait-for-db.js (
    echo [错误] 未找到 wait-for-db.js
    exit /b 1
)
echo [OK] wait-for-db.js 存在

if not exist setup_db_docker.js (
    echo [错误] 未找到 setup_db_docker.js
    exit /b 1
)
echo [OK] setup_db_docker.js 存在

if not exist package.json (
    echo [错误] 未找到 package.json
    exit /b 1
)
echo [OK] package.json 存在

echo.
echo ==========================================
echo 配置检查完成！
echo ==========================================
echo.
echo 下一步操作：
echo 1. 确保 Docker Desktop 正在运行
echo 2. 运行: docker-compose up -d
echo 3. 查看日志: docker-compose logs -f
echo 4. 访问: http://localhost:3000
echo.
pause
