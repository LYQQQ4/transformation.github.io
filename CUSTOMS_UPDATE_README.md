# 报关信息维护跟踪功能 - 数据库更新说明

## 更新内容

已更新以下文件以支持报关信息维护跟踪功能：

### 前端修改
- `frontend/index.html` - 报关信息维护跟踪页面（仿照包装信息维护的格式）
- `frontend/app.js` - 报关信息的完整CRUD功能，包括自动加载功能

### 后端修改
- `backend/routes/customs_clearance.js` - 报关信息API路由
- `backend/server.js` - 注册报关信息API路由

### 数据库修改
- `setup_db.js` - 添加了 `customs_clearance_tracking` 表
- `setup_db_docker.js` - 添加了 `customs_clearance_tracking` 表

## 数据库表结构

```sql
CREATE TABLE customs_clearance_tracking (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  serial_number VARCHAR(50) NOT NULL COMMENT '流水号',
  customs_start_time DATETIME DEFAULT NULL COMMENT '开始报关时间',
  tax_payment_time DATETIME DEFAULT NULL COMMENT '付税时间',
  release_time DATETIME DEFAULT NULL COMMENT '放行时间',
  customs_declaration_number VARCHAR(100) DEFAULT NULL COMMENT '报关单号',
  customs_supplier VARCHAR(200) DEFAULT NULL COMMENT '报关供应商',
  remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1',
  remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_serial_number (serial_number),
  INDEX idx_customs_start_time (customs_start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 如何更新数据库

### 方法1: 在本地数据库中添加表（推荐）

如果您的数据库运行在本地：

```bash
node add_customs_clearance_table.js
```

### 方法2: 使用Docker重新初始化数据库

如果您使用Docker，可以通过以下步骤更新：

#### 选项A: 在Docker容器中运行迁移脚本

```bash
# 1. 将迁移脚本复制到容器中
docker cp add_customs_clearance_table.js transFormation-app-1:/app/

# 2. 在容器中执行脚本
docker exec transFormation-app-1 node add_customs_clearance_table.js
```

#### 选项B: 重新初始化数据库（会清空现有数据）

```bash
# 停止并删除容器和数据卷
docker-compose down -v

# 重新启动服务
docker-compose up -d
```

#### 选项C: 在运行的容器中直接执行SQL

```bash
# 连接到MySQL容器
docker exec -it transFormation-db-1 mysql -uroot -p

# 输入密码（默认: rootpassword123）
# 然后执行以下SQL命令：

USE order_system;

CREATE TABLE IF NOT EXISTS customs_clearance_tracking (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  serial_number VARCHAR(50) NOT NULL COMMENT '流水号',
  customs_start_time DATETIME DEFAULT NULL COMMENT '开始报关时间',
  tax_payment_time DATETIME DEFAULT NULL COMMENT '付税时间',
  release_time DATETIME DEFAULT NULL COMMENT '放行时间',
  customs_declaration_number VARCHAR(100) DEFAULT NULL COMMENT '报关单号',
  customs_supplier VARCHAR(200) DEFAULT NULL COMMENT '报关供应商',
  remark1 VARCHAR(1000) DEFAULT NULL COMMENT '备注1',
  remark2 VARCHAR(1000) DEFAULT NULL COMMENT '备注2',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_serial_number (serial_number),
  INDEX idx_customs_start_time (customs_start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 功能特点

报关信息维护跟踪功能完全仿照包装信息维护的格式和功能：

1. ✅ 动态表单 - 点击"修改报关信息"按钮打开表单
2. ✅ 自动加载 - 输入流水号后自动加载该流水号的报关信息
3. ✅ 智能保存 - 如果流水号已存在则更新，否则创建新记录
4. ✅ 完整CRUD - 支持创建、读取、更新、删除操作
5. ✅ 搜索功能 - 按流水号、报关单号或供应商搜索
6. ✅ 数据验证 - 流水号为必填项

## 验证安装

更新数据库后，您可以通过以下方式验证：

1. 启动应用程序
2. 登录系统
3. 点击左侧菜单"报关信息维护跟踪"
4. 尝试添加或修改报关信息

如有问题，请检查浏览器控制台和服务器日志。
