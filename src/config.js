require("dotenv").config();

module.exports = {
  // AFCon EV API
  API_BASE_URL: process.env.API_BASE_URL || "https://account.afconev.co.il",
  STATION_IDS: [2823, 2822, 2821, 2534, 2533, 2532, 1841, 1843, 1845, 1846, 1847, 1848, 2530, 2531],

  // Socket IDs mapped to the same station order as STATION_IDS
  SOCKET_IDS: [4269, 4268, 4267, 3907, 3906, 3905, 2854, 2856, 2858, 2859, 2860, 2861, 3903, 3904],

  // AFCon login credentials
  AFCONEV_USERNAME: process.env.AFCONEV_USERNAME,
  AFCONEV_PASSWORD: process.env.AFCONEV_PASSWORD,

  // Polling interval: 5 minutes
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS, 10) || 300000,

  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,

  // Web server
  PORT: parseInt(process.env.PORT, 10) || 3000,
};
