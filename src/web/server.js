const express = require("express");
const path = require("path");
const config = require("../config");
const stationMonitor = require("../services/stationMonitor");
const logger = require("../logger");

// Attach pausedAt timestamp and charging info to each station in the response
function buildStationResponse() {
  const stations = stationMonitor.getAllStations().map((s) => ({
    ...s,
    pausedAt: stationMonitor.getPausedAtTime(s.id),
    chargingInfo: stationMonitor.getChargingInfo(s.id),
  }));
  return {
    stations,
    lastFetchTime: stationMonitor.getLastFetchTime(),
    stationCount: stations.length,
  };
}

function startWebServer() {
  const app = express();
  const port = config.PORT;
  const host = config.HOST;

  // Serve the dashboard UI
  app.use(express.static(path.join(__dirname, "public")));

  // API endpoint – returns cached station data
  app.get("/api/stations", (_req, res) => {
    res.json(buildStationResponse());
  });

  // Force a fresh fetch from the API and update the cache
  app.post("/api/stations/refresh", async (_req, res) => {
    try {
      logger.info("Manual refresh triggered from dashboard");
      await stationMonitor.poll();
      res.json(buildStationResponse());
    } catch (err) {
      logger.error(`Manual refresh failed: ${err.message}`);
      res.status(500).json({ error: "Failed to refresh station data" });
    }
  });

  app.listen(port, host, () => {
    logger.info(`Web dashboard running on ${host}:${port}`);
    logger.info("If running on Railway, open your generated railway.app domain to access the UI");
  });

  return app;
}

module.exports = { startWebServer };
