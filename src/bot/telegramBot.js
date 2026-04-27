const TelegramBot = require("node-telegram-bot-api");
const config = require("../config");
const stationMonitor = require("../services/stationMonitor");
const logger = require("../logger");

// Status emoji mapping for nice display
const STATUS_EMOJI = {
  AVAILABLE: "\u2705",       // green check
  CHARGING: "\u26A1",        // lightning bolt
  PAUSED: "\u{1F7E0}",      // orange circle – done charging, stands out
  UNKNOWN: "\u2753",         // question mark
};

const STATUS_LABEL = {
  AVAILABLE: "Available",
  CHARGING: "Charging",
  PAUSED: "Done Charging",
  UNKNOWN: "Unknown",
};

/**
 * Extract station number from caption (e.g. "מיקרופוקוס 8" -> 8).
 */
function getStationNumber(caption) {
  const match = caption.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Get display name for a station (e.g. "Station 8").
 */
function getStationDisplayName(station) {
  const num = getStationNumber(station.caption);
  return num ? `Station ${num}` : station.caption;
}

/**
 * Get max power across all sockets for a station.
 */
function getMaxPower(station) {
  if (!station.stationSockets || station.stationSockets.length === 0) return 0;
  return station.stationSockets.reduce((max, sock) => Math.max(max, sock.maximumPower || 0), 0);
}

/**
 * Format a single station line for Telegram (Markdown).
 */
function formatStationLine(station) {
  const emoji = STATUS_EMOJI[station.stationStatusId] || "\u2753";
  const label = STATUS_LABEL[station.stationStatusId] || station.stationStatusId;
  const name = getStationDisplayName(station);
  const power = getMaxPower(station);
  let line = `${emoji}  *${name}*  \u2014  ${label}  (${power}kW)`;

  // Show charging details (total KW, duration, speed) if available
  const chargingInfo = stationMonitor.getChargingInfo(station.id);
  if (chargingInfo) {
    const parts = [];
    if (chargingInfo.totalKw != null) parts.push(`\u26A1 Total KW: ${chargingInfo.totalKw}`);
    if (chargingInfo.durationFormatted) parts.push(`\u{23F1}\uFE0F Duration: ${chargingInfo.durationFormatted}`);
    if (chargingInfo.rateEstimation != null) parts.push(`\u{1F680} Speed: ${chargingInfo.rateEstimation.toFixed(2)} kW`);
    if (parts.length > 0) {
      line += "\n" + parts.map((p) => `      ${p}`).join("\n");
    }
  }

  // Show done-since time for stations that finished charging
  if (station.stationStatusId === "PAUSED") {
    const pausedAt = stationMonitor.getPausedAtTime(station.id);
    if (pausedAt) {
      const time = pausedAt.toLocaleTimeString("en-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
      line += `\n      \u{1F552} Done since ${time}`;
    }
  }

  return line;
}

/**
 * Build the full status message for all stations.
 */
function buildStatusMessage(stations) {
  if (!stations || stations.length === 0) {
    return "\u26A0\uFE0F  No station data available yet. Please wait for the first poll.";
  }

  // Sort by station number
  stations.sort((a, b) => getStationNumber(a.caption) - getStationNumber(b.caption));

  const available = stations.filter((s) => s.stationStatusId === "AVAILABLE");
  const charging = stations.filter((s) => s.stationStatusId === "CHARGING");
  const paused = stations.filter((s) => s.stationStatusId === "PAUSED");

  const lines = [];
  lines.push("\u{1F50C} *OneEV Charging Station Status*");
  lines.push("");

  // Summary counts
  lines.push(
    `\u2705 Available: ${available.length}  |  \u26A1 Charging: ${charging.length}  |  \u{1F7E0} Done: ${paused.length}`
  );
  lines.push("");

  // Individual station lines
  for (const station of stations) {
    lines.push(formatStationLine(station));
  }

  lines.push("");
  const lastFetch = stationMonitor.getLastFetchTime();
  if (lastFetch) {
    lines.push(`\u{1F552} Last updated: ${lastFetch.toLocaleString("en-IL", { timeZone: "Asia/Jerusalem" })}`);
  }

  return lines.join("\n");
}

/**
 * Initialize and start the Telegram bot.
 */
function startBot() {
  if (!config.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN === "your_telegram_bot_token_here") {
    logger.warn("Telegram bot token not configured – bot will not start");
    return null;
  }

  const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
  logger.info("Telegram bot started");

  // Global error handlers to prevent crashes
  bot.on("polling_error", (err) => {
    logger.error(`Telegram polling error: ${err.message}`);
  });

  bot.on("error", (err) => {
    logger.error(`Telegram bot error: ${err.message}`);
  });

  // Track chat IDs that want automatic notifications
  const subscribedChats = new Set();

  // /start command
  bot.onText(/\/start$/, (msg) => {
    const chatId = msg.chat.id;
    logger.info(`Telegram /start from chat ${chatId}`);
    bot.sendMessage(
      chatId,
      "\u{1F44B} Welcome to the *OneEV Charging Monitor Bot*!\n\n" +
      "Commands:\n" +
      "/status \u2013 Show all station statuses\n" +
      "/subscribe \u2013 Get automatic alerts when a station finishes charging\n" +
      "/unsubscribe \u2013 Stop automatic alerts\n",
      { parse_mode: "Markdown" }
    ).catch((err) => logger.error(`Failed to send /start reply: ${err.message}`));
  });

  // /status command – fetch fresh data from API and show statuses
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    logger.info(`Telegram /status requested by chat ${chatId} – fetching fresh data`);
    try {
      await stationMonitor.poll();
    } catch {
      // If fresh fetch fails, fall back to cached data
      logger.warn("Fresh fetch failed for /status – using cached data");
    }
    const stations = stationMonitor.getAllStations();
    const text = buildStatusMessage(stations);
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" })
      .catch((err) => logger.error(`Failed to send /status reply: ${err.message}`));
  });

  // /subscribe – opt in to automatic notifications
  bot.onText(/\/subscribe/, (msg) => {
    const chatId = msg.chat.id;
    subscribedChats.add(chatId);
    logger.info(`Chat ${chatId} subscribed to notifications`);
    bot.sendMessage(
      chatId,
      "\u{1F514} You are now subscribed to station alerts.\nYou will be notified when a station finishes charging.",
      { parse_mode: "Markdown" }
    ).catch((err) => logger.error(`Failed to send /subscribe reply: ${err.message}`));
  });

  // /unsubscribe – opt out
  bot.onText(/\/unsubscribe/, (msg) => {
    const chatId = msg.chat.id;
    subscribedChats.delete(chatId);
    logger.info(`Chat ${chatId} unsubscribed from notifications`);
    bot.sendMessage(
      chatId,
      "\u{1F515} You have been unsubscribed from station alerts.",
      { parse_mode: "Markdown" }
    ).catch((err) => logger.error(`Failed to send /unsubscribe reply: ${err.message}`));
  });

  // Handle plain text messages asking about status
  bot.on("message", async (msg) => {
    if (msg.text && !msg.text.startsWith("/")) {
      const lower = msg.text.toLowerCase();
      if (
        lower.includes("status") ||
        lower.includes("station") ||
        lower.includes("available") ||
        lower.includes("charging") ||
        lower.includes("מצב") ||
        lower.includes("תחנ")
      ) {
        const chatId = msg.chat.id;
        logger.info(`Telegram natural language status query from chat ${chatId}: "${msg.text}" – fetching fresh data`);
        try {
          await stationMonitor.poll();
        } catch {
          logger.warn("Fresh fetch failed for NL query – using cached data");
        }
        const stations = stationMonitor.getAllStations();
        const text = buildStatusMessage(stations);
        bot.sendMessage(chatId, text, { parse_mode: "Markdown" })
          .catch((err) => logger.error(`Failed to send NL reply: ${err.message}`));
      }
    }
  });

  // Listen for station-paused events from the monitor and notify subscribers
  stationMonitor.on("station-paused", ({ pausedStation, availableStations, allOtherCharging }) => {
    if (subscribedChats.size === 0) return;

    const name = getStationDisplayName(pausedStation);
    let text;
    if (allOtherCharging) {
      text =
        `\u{1F6A8} *Station finished charging!*\n\n` +
        `\u{1F7E0}  *${name}* is now done charging.\n\n` +
        `\u274C  *No available stations* \u2013 all other stations are currently charging.`;
    } else {
      const availList = availableStations
        .map((s) => `  \u2705 ${getStationDisplayName(s)}`)
        .join("\n");
      text =
        `\u2705 *Station finished charging!*\n\n` +
        `\u{1F7E0}  *${name}* is now done charging.\n\n` +
        `\u2705  *${availableStations.length} station(s) available:*\n${availList}`;
    }

    for (const chatId of subscribedChats) {
      bot.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch((err) => {
        logger.error(`Failed to send notification to chat ${chatId}: ${err.message}`);
      });
    }

    logger.info(
      `Sent pause notification for "${name}" to ${subscribedChats.size} subscriber(s)`
    );
  });

  return bot;
}

module.exports = { startBot };
