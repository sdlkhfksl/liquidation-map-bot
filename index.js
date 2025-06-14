// index.js

require('dotenv').config();

// We use puppeteer-core, the lightweight version without a bundled browser.
const puppeteer     = require('puppeteer-core');
const cron          = require('node-cron');
const TelegramBot   = require('node-telegram-bot-api');
const express       = require('express');
const fs            = require('fs');

// --- Configuration from Environment Variables ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHANNEL_ID;
const PERIOD    = process.env.HEATMAP_PERIOD || '24h';
const CRON_EXPR = process.env.SCRAPE_CRON   || '*/5 * * * *';
const PORT      = parseInt(process.env.PORT, 10) || 8080;

// --- Basic Validation ---
if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌ Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID environment variables.');
  process.exit(1);
}

// --- Initialize Bot and Web Server ---
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const app = express();

// Health check endpoint for Koyeb
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`Health check server listening on http://0.0.0.0:${PORT}`);
});

/**
 * Captures the Coinglass liquidation heatmap using a system-installed Chromium.
 * @returns {Promise<string|null>} The file path to the saved screenshot, or null on failure.
 */
async function captureHeatmap() {
  console.log(`[${new Date().toLocaleString()}] Starting capture for period: ${PERIOD}`);
  let browser = null;
  try {
    // This is the critical part: we launch puppeteer-core and explicitly
    // tell it where to find the Chromium browser we installed in the Dockerfile.
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      args: [
        '--headless=new',                 // Use the modern headless mode
        '--no-sandbox',                   // Required for running in a container
        '--disable-dev-shm-usage',        // Avoids memory issues in Docker
        '--window-size=1920,1080',        // Set a good resolution for the screenshot
      ],
    });

    const page = await browser.newPage();
    // Set a high device scale factor for a crisp, high-DPI screenshot
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    
    const url = `https://www.coinglass.com/pro/futures/LiquidationHeatMap?period=${PERIOD}`;
    console.log(`Navigating to ${url}`);
    
    // Navigate and wait for the network to be mostly idle
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for the canvas element to appear on the page
    await page.waitForSelector('canvas', { timeout: 15000 });
    console.log('Canvas element found.');

    const canvas = await page.$('canvas');
    // Save the screenshot to a temporary file
    const filename = `/tmp/heatmap_${Date.now()}.png`;
    await canvas.screenshot({ path: filename });
    console.log(`Screenshot saved to ${filename}`);
    return filename;

  } catch (err) {
    console.error('Capture failed:', err);
    return null;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed.');
    }
  }
}

/**
 * Sends the captured heatmap screenshot to the Telegram channel.
 */
async function sendHeatmap() {
  const file = await captureHeatmap();
  const now  = new Date().toLocaleString("en-US", { timeZone: "UTC" });
  
  if (!file) {
    const errorMessage = `❌ **Heatmap Capture Failed**\n_Time: ${now} UTC_`;
    await bot.sendMessage(CHAT_ID, errorMessage, { parse_mode: 'Markdown' }).catch(console.error);
    return;
  }
  
  const caption = `📊 **Coinglass Heatmap (${PERIOD})**\n_${now} UTC_`;
  
  await bot.sendPhoto(CHAT_ID, file, { caption, parse_mode: 'Markdown' }).catch(console.error);
  console.log('Photo sent to Telegram.');
  
  // Clean up the temporary file
  fs.unlinkSync(file);
}

// --- Start the Application ---
console.log('Bot started. Performing initial run...');
sendHeatmap();

// Schedule the recurring job
cron.schedule(CRON_EXPR, () => {
  console.log(`[${new Date().toLocaleString()}] Cron job triggered.`);
  sendHeatmap();
}, {
  timezone: "Etc/UTC" // Explicitly set timezone for consistency
});

console.log(`Scheduled to run with cron expression: "${CRON_EXPR}"`);