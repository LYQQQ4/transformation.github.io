module.exports = {
  apps: [{
    name: 'transport-order-management',
    script: './backend/server.js',
    instances: 1, // 单实例，如需多实例可改为 'max' 或具体数字
    exec_mode: 'fork', // 或 'cluster' 模式
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // 日志配置
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // 自动重启配置
    watch: false, // 生产环境建议设为 false
    ignore_watch: ['node_modules', 'logs', 'uploads'],
    max_memory_restart: '500M',
    
    // 其他配置
    autorestart: true,
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // 环境变量文件
    env_file: '.env'
  }]
};
