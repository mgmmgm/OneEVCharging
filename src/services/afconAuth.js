const axios = require("axios");
const cheerio = require("cheerio");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const config = require("../config");
const logger = require("../logger");

// Cookie jar maintains the session across requests
const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

let csrfToken = null;
let loggedIn = false;

/**
 * Log in to the AFCon website and obtain a session + CSRF token.
 */
async function login() {
  const loginUrl = `${config.API_BASE_URL}/login`;

  try {
    logger.info("AFCon auth: fetching login page for CSRF token...");
    const getResponse = await client.get(loginUrl, { timeout: 15000 });
    const $ = cheerio.load(getResponse.data);
    csrfToken = $('meta[name="_csrf"]').attr("content");

    if (!csrfToken) {
      throw new Error("Could not extract CSRF token from login page");
    }
    logger.info("AFCon auth: CSRF token obtained");

    // Build form data exactly as Spring Security expects
    const payload = new URLSearchParams();
    payload.append("username", config.AFCONEV_USERNAME);
    payload.append("password", config.AFCONEV_PASSWORD);
    payload.append("_spring_security_remember_me", "true");
    payload.append("_csrf", csrfToken);

    logger.info("AFCon auth: sending login request...");
    const postResponse = await client.post(loginUrl, payload, {
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "X-Ajax-Call": "true",
        "X-App-Type": "WEB",
        "X-CSRF-TOKEN": csrfToken,
        Referer: loginUrl,
      },
      validateStatus: (status) => status >= 200 && status < 500,
      timeout: 15000,
    });

    if (postResponse.status === 200 && postResponse.data && !postResponse.data.error) {
      loggedIn = true;
      logger.info("AFCon auth: login successful");
      return true;
    }

    logger.error(`AFCon auth: login failed – status ${postResponse.status}`);
    return false;
  } catch (error) {
    logger.error(`AFCon auth: login error – ${error.message}`);
    return false;
  }
}

/**
 * Ensure we have a valid session. Re-login if needed.
 */
async function ensureLoggedIn() {
  if (!loggedIn) {
    return login();
  }
  return true;
}

/**
 * Format milliseconds or seconds into HH:MM:SS string.
 */
function formatDuration(msOrSeconds) {
  const totalSeconds = msOrSeconds > 1e6
    ? Math.floor(msOrSeconds / 1000)
    : Math.floor(msOrSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((v) => String(v).padStart(2, "0")).join(":");
}

/**
 * Fetch charging estimation data for a single socket.
 * Returns { totalKw, duration, durationFormatted } or null if unavailable.
 */
async function getSocketInfo(socketId) {
  try {
    const url = `${config.API_BASE_URL}/stationFacade/findCurrentTransactionBillingChargingEstimation`;

    const body = new URLSearchParams({ socketId: String(socketId) });

    const response = await client.post(url, body.toString(), {
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "accept-language": "he",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-app-type": "WEB",
        "x-csrf-token": csrfToken,
        "x-json-types": "None",
        "x-requested-with": "XMLHttpRequest",
        "x-ajax-call": "true",
        referer: `${config.API_BASE_URL}/findCharger`,
      },
      withCredentials: true,
      validateStatus: (status) => status >= 200 && status < 500,
      timeout: 10000,
    });

    const payload = response.data;

    // If session expired (redirect to login), re-login and retry once
    if (response.status === 401 || response.status === 403 ||
      (typeof payload === "string" && payload.includes("<html"))) {
      logger.warn(`AFCon auth: session expired for socket ${socketId}, re-logging in...`);
      loggedIn = false;
      const ok = await login();
      if (!ok) return null;
      return getSocketInfo(socketId); // retry once
    }

    if (!payload || payload.success !== true) {
      return null;
    }

    const { totalKw, duration, rateEstimation } = payload.data || {};
    return {
      totalKw: totalKw ?? null,
      duration: duration ?? null,
      durationFormatted: typeof duration === "number" ? formatDuration(duration) : null,
      rateEstimation: rateEstimation ?? null,
    };
  } catch (error) {
    logger.error(`Failed to get socket info for ${socketId}: ${error.message}`);
    return null;
  }
}

/**
 * Fetch charging info for all sockets.
 * Returns a Map of stationId -> { totalKw, duration, durationFormatted }.
 */
async function getAllSocketInfo() {
  const ok = await ensureLoggedIn();
  if (!ok) {
    logger.error("Cannot fetch socket info – not logged in");
    return new Map();
  }

  const results = new Map();

  // Fetch all sockets sequentially to avoid hammering the server
  for (let i = 0; i < config.STATION_IDS.length; i++) {
    const stationId = config.STATION_IDS[i];
    const socketId = config.SOCKET_IDS[i];
    const info = await getSocketInfo(socketId);
    if (info) {
      results.set(stationId, info);
    }
  }

  logger.info(`Fetched socket info for ${results.size} station(s) with active data`);
  return results;
}

module.exports = { login, getAllSocketInfo, getSocketInfo, formatDuration };
