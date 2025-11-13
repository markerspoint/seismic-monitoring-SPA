// server.js
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_URL = 'https://earthquake.phivolcs.dost.gov.ph/';

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Create an axios instance that ignores SSL certificate errors
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({  
    rejectUnauthorized: false
  }),
  timeout: 30000 // 30 second timeout
});

// Cache for earthquake data
let cachedData = null;
let lastFetchTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Function to fetch and parse PHIVOLCS data
async function fetchEarthquakeData() {
  try {
    console.log('Fetching data from PHIVOLCS...');
    
    const response = await axiosInstance.get(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
      }
    });

    console.log('Successfully fetched HTML, parsing...');
    
    // Save HTML for debugging
    fs.writeFileSync('debug_response.html', response.data);
    console.log('Saved HTML to debug_response.html');
    
    const $ = cheerio.load(response.data);
    const earthquakes = [];

    // Find all tables
    const allTables = $('table.MsoNormalTable');
    console.log(`Found ${allTables.length} MsoNormalTable(s)`);

    // Find the table with earthquake data (has Date-Time header)
    let dataTable = null;
    allTables.each((i, table) => {
      const text = $(table).text();
      if (text.includes('Date - Time') || text.includes('Philippine Time')) {
        dataTable = $(table);
        console.log(`Found data table at index ${i}`);
        return false; // break
      }
    });

    if (!dataTable) {
      throw new Error('Could not find earthquake data table');
    }

    // Get all rows from the data table
    const rows = dataTable.find('tr');
    console.log(`Found ${rows.length} rows in data table`);

    // Process each row
    let dataCount = 0;
    rows.each((index, row) => {
      const cells = $(row).find('td');
      
      // Skip if not enough cells (header row or empty row)
      if (cells.length < 6) {
        return;
      }

      // Extract data from cells
      const dateTimeCell = $(cells[0]);
      const latitudeCell = $(cells[1]);
      const longitudeCell = $(cells[2]);
      const depthCell = $(cells[3]);
      const magnitudeCell = $(cells[4]);
      const locationCell = $(cells[5]);

      // Get the date/time text (may be in a link)
      let dateTime = dateTimeCell.find('a').text().trim();
      const href = dateTimeCell.find('a').attr('href');
      let detailLink = null;
      if (href) {
        const normalizedPath = href.replace(/\\/g, '/').trim();
        try {
          detailLink = new URL(normalizedPath, BASE_URL).href;
        } catch (e) {
          detailLink = normalizedPath;
        }
      }
      if (!dateTime) {
        dateTime = dateTimeCell.text().trim();
      }

      // Get other values
      const latitude = latitudeCell.text().trim();
      const longitude = longitudeCell.text().trim();
      const depth = depthCell.text().trim();
      const magnitude = magnitudeCell.text().trim();
      const location = locationCell.text().trim();

      // Validate that this is a data row (has valid date and magnitude)
      if (dateTime && magnitude && 
          dateTime.length > 10 && 
          !dateTime.toLowerCase().includes('date') &&
          !isNaN(parseFloat(magnitude))) {
        
        earthquakes.push({
          dateTime,
          detailLink,
          latitude,
          longitude,
          depth,
          magnitude,
          location
        });
        dataCount++;
      }
    });

    console.log(`Successfully parsed ${earthquakes.length} earthquakes`);

    // Log first few for verification
    if (earthquakes.length > 0) {
      console.log('First earthquake:', JSON.stringify(earthquakes[0], null, 2));
      console.log('Last earthquake:', JSON.stringify(earthquakes[earthquakes.length - 1], null, 2));
    }

    if (earthquakes.length === 0) {
      throw new Error('No earthquake data found in table. Check debug_response.html');
    }

    return earthquakes;

  } catch (error) {
    console.error('Error fetching earthquake data:', error.message);
    throw error;
  }
}

// API endpoint to get earthquake data
app.get('/api/earthquakes', async (req, res) => {
  try {
    // Check if we have cached data and it's still fresh
    const now = Date.now();
    if (cachedData && lastFetchTime && (now - lastFetchTime) < CACHE_DURATION) {
      console.log('Returning cached data');
      return res.json({
        success: true,
        data: cachedData,
        cached: true,
        lastUpdated: new Date(lastFetchTime).toISOString(),
        count: cachedData.length
      });
    }

    // Fetch fresh data
    const earthquakes = await fetchEarthquakeData();
    
    // Update cache
    cachedData = earthquakes;
    lastFetchTime = now;

    res.json({
      success: true,
      data: earthquakes,
      cached: false,
      lastUpdated: new Date(lastFetchTime).toISOString(),
      count: earthquakes.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to fetch earthquake data from PHIVOLCS',
      hint: 'Check server console and debug_response.html file for more details'
    });
  }
});

// Endpoint to force refresh cache
app.get('/api/earthquakes/refresh', async (req, res) => {
  try {
    console.log('Force refresh requested');
    const earthquakes = await fetchEarthquakeData();
    
    // Update cache
    cachedData = earthquakes;
    lastFetchTime = Date.now();

    res.json({
      success: true,
      data: earthquakes,
      lastUpdated: new Date(lastFetchTime).toISOString(),
      count: earthquakes.length,
      message: 'Cache refreshed successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Check server console and debug_response.html file for more details'
    });
  }
});

// Debug endpoint to view raw HTML
app.get('/api/debug/html', (req, res) => {
  try {
    if (fs.existsSync('debug_response.html')) {
      const html = fs.readFileSync('debug_response.html', 'utf8');
      res.type('html').send(html);
    } else {
      res.status(404).json({ error: 'No debug file found. Make a request to /api/earthquakes first.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    cacheStatus: cachedData ? 'populated' : 'empty',
    lastFetch: lastFetchTime ? new Date(lastFetchTime).toISOString() : 'never',
    cachedCount: cachedData ? cachedData.length : 0
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'PHIVOLCS Earthquake Data API',
    endpoints: {
      '/api/earthquakes': 'Get earthquake data (cached for 5 minutes)',
      '/api/earthquakes/refresh': 'Force refresh earthquake data',
      '/api/debug/html': 'View raw HTML from PHIVOLCS (for debugging)',
      '/health': 'Health check'
    },
    status: 'ready'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/earthquakes`);
  console.log(`🔄 Refresh endpoint: http://localhost:${PORT}/api/earthquakes/refresh`);
  console.log(`🐛 Debug HTML: http://localhost:${PORT}/api/debug/html`);
});