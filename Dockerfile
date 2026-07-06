# 使用官方 Node.js 运行时作为基础镜像
# 说明：项目依赖包含 sqlite3（native 模块），需要 node-gyp 编译环境（python/make/g++）。
# alpine 需要额外的 musl 编译链，踩坑较多；这里改用 Debian 系镜像更稳。
FROM node:18-bullseye-slim

# 设置工作目录
WORKDIR /app

# 安装 sqlite3 / node-gyp 所需的编译依赖
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
# 说明：当前仓库的 package-lock.json 与 package.json 不同步，npm ci 会失败；
# 为了保证 Docker 构建可用，这里统一使用 npm install（仅生产依赖）。
RUN npm config set registry https://registry.npmmirror.com \
  && npm install --omit=dev --no-audit --no-fund

# 复制应用代码
COPY . .

# 创建必要的目录
RUN mkdir -p logs uploads backend/uploads

# 暴露端口
EXPOSE 3000

# 启动脚本
CMD ["node", "backend/server.js"]
