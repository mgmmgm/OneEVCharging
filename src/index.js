require("dotenv").config();

const stationMonitor = require("./services/stationMonitor");
const { startBot } = require("./bot/telegramBot");
const { startWebServer } = require("./web/server");
const logger = require("./logger");

async function main() {
  logger.info("=== OneEV Charging Monitor starting ===");

  // 1. Start the station monitor (fetches data + caches + polls every 5 min)
  await stationMonitor.start();

  // 2. Start the web dashboard
  startWebServer();

  // 3. Start the Telegram bot
  startBot();

  logger.info("=== All services running ===");
}

// Graceful shutdown
process.on("SIGINT", () => {
  logger.info("Shutting down...");
  stationMonitor.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Shutting down...");
  stationMonitor.stop();
  process.exit(0);
});

main().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
