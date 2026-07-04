module.exports = {
  apps: [
    {
      name: "side-bets",
      script: "dist/server/server/index.js",
      cwd: "/var/www/side-bets/current",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "4123"
      }
    }
  ]
};
