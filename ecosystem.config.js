module.exports = {
  apps: [
    {
      name: "ecoSystemServer",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 5053
      }
    },
    {
      name: "ecoSystemWorker",
      script: "worker.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};