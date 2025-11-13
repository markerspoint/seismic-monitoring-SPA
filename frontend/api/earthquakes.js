const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");

const BASE_URL = "https://earthquake.phivolcs.dost.gov.ph/";

let cachedData = null;
let lastFetchTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 30000,
});

async function fetchEarthquakeData() {
  const response = await axiosInstance.get(BASE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html",
    },
  });

  const $ = cheerio.load(response.data);
  const earthquakes = [];

  const allTables = $("table.MsoNormalTable");
  let dataTable = null;

  allTables.each((i, table) => {
    const text = $(table).text();
    if (text.includes("Date - Time") || text.includes("Philippine Time")) {
      dataTable = $(table);
      return false; // break
    }
  });

  if (!dataTable) throw new Error("Could not find earthquake data table");

  const rows = dataTable.find("tr");

  rows.each((index, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;

    const dateTimeCell = $(cells[0]);
    const latitudeCell = $(cells[1]);
    const longitudeCell = $(cells[2]);
    const depthCell = $(cells[3]);
    const magnitudeCell = $(cells[4]);
    const locationCell = $(cells[5]);

    let dateTime = dateTimeCell.find("a").text().trim();
    if (!dateTime) dateTime = dateTimeCell.text().trim();

    const magnitude = magnitudeCell.text().trim();

    if (
      dateTime &&
      magnitude &&
      dateTime.length > 10 &&
      !dateTime.toLowerCase().includes("date") &&
      !isNaN(parseFloat(magnitude))
    ) {
      earthquakes.push({
        dateTime,
        latitude: latitudeCell.text().trim(),
        longitude: longitudeCell.text().trim(),
        depth: depthCell.text().trim(),
        magnitude,
        location: locationCell.text().trim(),
      });
    }
  });

  if (!earthquakes.length) {
    throw new Error("No earthquake data found in table");
  }

  return earthquakes;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const now = Date.now();

    if (cachedData && lastFetchTime && now - lastFetchTime < CACHE_DURATION) {
      return res.status(200).json({
        success: true,
        data: cachedData,
        cached: true,
        lastUpdated: new Date(lastFetchTime).toISOString(),
        count: cachedData.length,
      });
    }

    const earthquakes = await fetchEarthquakeData();

    cachedData = earthquakes;
    lastFetchTime = now;

    return res.status(200).json({
      success: true,
      data: earthquakes,
      cached: false,
      lastUpdated: new Date(lastFetchTime).toISOString(),
      count: earthquakes.length,
    });
  } catch (error) {
    console.error("Error in /api/earthquakes:", error.message);

    return res.status(500).json({
      success: false,
      error: error.message,
      details: "Failed to fetch earthquake data from PHIVOLCS",
    });
  }
};
