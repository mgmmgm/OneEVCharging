const axios = require("axios");
const EventEmitter = require("events");
const config = require("../config");
const logger = require("../logger");
const { getAllSocketInfo } = require("./afconAuth");

class StationMonitor extends EventEmitter {
  constructor() {
    super();
    // Cached station data keyed by station ID
    this.cache = new Map();
    // Track previous statuses for transition detection
    this.previousStatuses = new Map();
    // Track when each station transitioned to PAUSED (done charging)
    this.pausedAtTimes = new Map();
    // Charging info per station: { totalKw, duration, durationFormatted }
    this.chargingInfo = new Map();
    this.lastFetchTime = null;
    this.polling = false;
  }

  /**
   * Fetch all station data from the AFCon API in a single request.
   */
  async fetchStations() {
    try {
      logger.info("Fetching station data from AFCon API...");
      const response = await axios.post(
        `${config.API_BASE_URL}/stationFacade/findStationsByIds`,
        { filterByIds: config.STATION_IDS },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        }
      );

      // API wraps the array in { success, errors, data }
      const stations = response.data.data;
      logger.info(`Received data for ${stations.length} stations`);
      return stations;
    } catch (error) {
      logger.error(`Failed to fetch stations: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch charging info (totalKw, duration) for all sockets via authenticated API.
   */
  async fetchChargingInfo() {
    try {
      const infoMap = await getAllSocketInfo();
      this.chargingInfo = infoMap;
      logger.info(`Charging info updated for ${infoMap.size} station(s)`);
    } catch (error) {
      logger.error(`Failed to fetch charging info: ${error.message}`);
    }
  }

  /**
   * Update the cache and detect status transitions.
   * Emits "station-paused" when a station transitions to PAUSED
   * while all other stations are CHARGING (none available).
   */
  updateCache(stations) {
    // Save previous statuses before updating
    for (const [id, data] of this.cache) {
      this.previousStatuses.set(id, data.stationStatusId);
    }

    // Update cache with fresh data
    for (const station of stations) {
      this.cache.set(station.id, station);
    }
    this.lastFetchTime = new Date();

    // Detect transitions: station changed to PAUSED
    for (const station of stations) {
      const prevStatus = this.previousStatuses.get(station.id);
      const currStatus = station.stationStatusId;

      // Record timestamp when station transitions to PAUSED (done charging)
      if (currStatus === "PAUSED" && prevStatus && prevStatus !== "PAUSED") {
        this.pausedAtTimes.set(station.id, new Date());
        logger.info(
          `Station "${station.caption}" (${station.id}) transitioned from ${prevStatus} to PAUSED – checking availability of other stations`
        );
        this.checkAvailabilityAndNotify(station);
      }

      // Clear the timestamp when station leaves PAUSED
      if (currStatus !== "PAUSED" && this.pausedAtTimes.has(station.id)) {
        this.pausedAtTimes.delete(station.id);
      }
    }
  }

  /**
   * When a station finishes charging (moves to PAUSED), check if any
   * other stations are AVAILABLE. Emit an event so the Telegram bot
   * can send a notification.
   */
  checkAvailabilityAndNotify(pausedStation) {
    const otherStations = [];
    for (const [id, data] of this.cache) {
      if (id !== pausedStation.id) {
        otherStations.push(data);
      }
    }

    const availableStations = otherStations.filter(
      (s) => s.stationStatusId === "AVAILABLE"
    );

    this.emit("station-paused", {
      pausedStation,
      availableStations,
      allOtherCharging: availableStations.length === 0,
    });
  }

  /**
   * Return all cached stations as an array, sorted by caption.
   */
  getAllStations() {
    const stations = Array.from(this.cache.values());
    stations.sort((a, b) => a.caption.localeCompare(b.caption));
    return stations;
  }

  /**
   * Return the timestamp of the last successful fetch.
   */
  getLastFetchTime() {
    return this.lastFetchTime;
  }

  /**
   * Return the time a station transitioned to PAUSED, or null.
   */
  getPausedAtTime(stationId) {
    return this.pausedAtTimes.get(stationId) || null;
  }

  /**
   * Return charging info for a station, or null.
   */
  getChargingInfo(stationId) {
    return this.chargingInfo.get(stationId) || null;
  }

  /**
   * Perform a single poll: fetch stations + charging info, then update cache.
   */
  async poll() {
    try {
      const stations = await this.fetchStations();
      this.updateCache(stations);
      // Fetch charging details for stations that are currently charging
      await this.fetchChargingInfo();
    } catch {
      logger.error("Poll cycle failed – will retry on next interval");
    }
  }

  /**
   * Start the periodic polling loop.
   */
  async start() {
    if (this.polling) return;
    this.polling = true;

    // Initial fetch immediately
    await this.poll();

    // Schedule recurring fetches
    this.intervalId = setInterval(() => this.poll(), config.POLL_INTERVAL_MS);
    logger.info(
      `Station monitor started – polling every ${config.POLL_INTERVAL_MS / 1000}s`
    );
  }

  /**
   * Stop the polling loop.
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.polling = false;
    logger.info("Station monitor stopped");
  }
}

// Export a singleton so all parts of the app share the same cache
module.exports = new StationMonitor();
