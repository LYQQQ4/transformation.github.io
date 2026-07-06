#!/usr/bin/env powershell

<#
  Windows 服务器迁移验证脚本
  检查环境、配置和数据库状态
#>

Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║           Windows 服务器迁移环境验证脚本                      ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$errors = @()
$warnings = @()
$success = @()

# 1. 检查 Node.js
Write-Host "[1/5] 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = & node --version 2>$null
    if ($nodeVersion) {
        $success += "✓ Node.js $nodeVersion 已安装"
    } else {
        $errors += "✗ Node.js 未安装"
    }
} catch {
    $errors += "✗ Node.js 未安装或不在 PATH 中"
}

# 2. 检查 npm
Write-Host "[2/5] 检查 npm..." -ForegroundColor Yellow
try {
    $npmVersion = & npm --version 2>$null
    if ($npmVersion) {
        $success += "✓ npm $npmVersion 已安装"
    } else {
        $errors += "✗ npm 未安装"
    }
} catch {
    $errors += "✗ npm 未安装或不在 PATH 中"
}

# 3. 检查 MySQL
Write-Host "[3/5] 检查 MySQL..." -ForegroundColor Yellow
try {
    $mysqlVersion = & mysql --version 2>$null
    if ($mysqlVersion) {
        $success += "✓ MySQL 已安装：$mysqlVersion"
        
        # 检查 MySQL 服务状态
        $mysqlService = Get-Service | Where-Object {$_.Name -like "*MySQL*"}
        if ($mysqlService) {
            if ($mysqlService.Status -eq "Running") {
                $success += "✓ MySQL 服务已启动"
            } else {
                $warnings += "⚠ MySQL 服务未运行：$($mysqlService.Name)"
            }
        }
    } else {
        $warnings += "⚠ MySQL 未安装（如已安装，请确保在 PATH 中）"
    }
} catch {
    $warnings += "⚠ 无法检查 MySQL：$($_.Exception.Message)"
}

# 4. 检查项目文件
Write-Host "[4/5] 检查项目文件..." -ForegroundColor Yellow
$projectFiles = @(
    "package.json",
    "backend/server.js",
    "setup_db_server.js",
    "env.server",
    "deploy-server.bat",
    "SERVER_MIGRATION_GUIDE.md",
    "QUICK_SERVER_SETUP.md",
    "SERVER_MIGRATION_SUMMARY.md"
)

foreach ($file in $projectFiles) {
    if (Test-Path $file) {
        $success += "✓ $file 已找到"
    } else {
        $warnings += "⚠ $file 未找到"
    }
}

# 5. 检查 .env 配置
Write-Host "[5/5] 检查配置..." -ForegroundColor Yellow
if (Test-Path ".env") {
    $success += "✓ .env 文件已存在"
    
    # 检查是否包含必要的配置
    $envContent = Get-Content ".env" -Raw
    $requiredVars = @("DB_PASSWORD", "USER_DB_PASSWORD", "CORS_ORIGIN")
    
    foreach ($var in $requiredVars) {
        if ($envContent -match $var) {
            $success += "✓ $var 已配置"
        } else {
            $warnings += "⚠ $var 未在 .env 中配置"
        }
    }
} else {
    if (Test-Path "env.server") {
        $warnings += "⚠ .env 文件不存在，但 env.server 存在"
        $warnings += "  请运行: copy env.server .env"
    } else {
        $errors += "✗ 既无 .env 也无 env.server 文件"
    }
}

# 输出结果
Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                    验证结果摘要                                ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if ($success.Count -gt 0) {
    Write-Host "✓ 成功检查项 ($($success.Count))：" -ForegroundColor Green
    foreach ($item in $success) {
        Write-Host "  $item" -ForegroundColor Green
    }
    Write-Host ""
}

if ($warnings.Count -gt 0) {
    Write-Host "⚠ 警告 ($($warnings.Count))：" -ForegroundColor Yellow
    foreach ($item in $warnings) {
        Write-Host "  $item" -ForegroundColor Yellow
    }
    Write-Host ""
}

if ($errors.Count -gt 0) {
    Write-Host "✗ 错误 ($($errors.Count))：" -ForegroundColor Red
    foreach ($item in $errors) {
        Write-Host "  $item" -ForegroundColor Red
    }
    Write-Host ""
}

# 总体状态
Write-Host "┌────────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
if ($errors.Count -eq 0) {
    Write-Host "│  ✓ 环境检查通过！可以开始部署                               │" -ForegroundColor Green
    Write-Host "└────────────────────────────────────────────────────────────────┘" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "后续步骤：" -ForegroundColor Cyan
    Write-Host "  1. 运行部署脚本："
    Write-Host "     .\deploy-server.bat"
    Write-Host ""
    Write-Host "  或手动部署："
    Write-Host "     copy env.server .env"
    Write-Host "     notepad .env"
    Write-Host "     npm install --production"
    Write-Host "     node setup_db_server.js"
    Write-Host ""
    exit 0
} else {
    Write-Host "│  ✗ 环境检查失败！请解决上述错误后重试                       │" -ForegroundColor Red
    Write-Host "└────────────────────────────────────────────────────────────────┘" -ForegroundColor Red
    exit 1
}
