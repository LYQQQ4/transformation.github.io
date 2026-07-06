@echo off
REM Docker 快速启动脚本 (Windows)

echo ==========================================
echo 启动 Docker 容器
echo ==========================================
echo.

REM 检查 Docker 是否运行
docker ps >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] Docker 未运行，请先启动 Docker Desktop
    pause
    exit /b 1
)

echo [信息] 构建并启动容器...
docker-compose up -d --build

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ==========================================
    echo 启动成功！
    echo ==========================================
    echo.
    echo 查看日志: docker-compose logs -f
    echo 停止服务: docker-compose down
    echo 访问应用: http://localhost:3000
    echo.
) else (
    echo.
    echo [错误] 启动失败，请查看上面的错误信息
    echo.
)

pause
