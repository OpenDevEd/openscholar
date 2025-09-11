module.exports = {
  apps: [
    {
      name: 'openalex-worker',
      script: './scripts/run-worker.sh',
      interpreter: 'bash',
      instances: 'max', // Use all available CPU cores for parallel processing
      exec_mode: 'fork', // Use fork mode for better tsx compatibility
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // Logging configuration
      log_file: './logs/worker.log',
      out_file: './logs/worker-out.log',
      error_file: './logs/worker-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // Restart configuration
      max_memory_restart: '512M', // Lower memory limit per instance
      restart_delay: 2000, // Faster restart delay for multiple instances
      // Auto restart on file changes in development
      watch: false, // Set to true in development if needed
      ignore_watch: ['node_modules', 'logs', '.git'],
      // Environment file
      env_file: '.env',
      // Health checks
      health_check: {
        enabled: true,
        interval: 15000, // Check every 15 seconds for faster response
        timeout: 3000,   // 3 second timeout for quicker detection
        unhealthy_restart_threshold: 2 // Restart after 2 failed checks
      },
      // Graceful shutdown
      kill_timeout: 8000, // 8 seconds to gracefully shutdown multiple instances
      wait_ready: false, // Disabled for BullMQ workers (no port listening)
      // Bash-specific settings for parallel processing
      merge_logs: true, // Merge logs from all instances
      time: true // Add timestamps to logs
    }
  ]
};
