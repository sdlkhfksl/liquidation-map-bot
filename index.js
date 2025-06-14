// index.js (Production-Grade Version)

require('dotenv').config();
const puppeteer     = require('puppeteer-core');
const cron          = require('node-cron');
const TelegramBot   = require('node-telegram-bot-api');
const express       = require('express');
const fs            = require('fs');

// --- Configuration ---
const {
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_CHANNEL_ID: CHAT_ID,
  HEATMAP_PERIOD: PERIOD = '24h',
  SCRAPE_CRON: CRON_EXPR = '*/5 * * * *',
  PORT = 8080,
  DEBUG_MODE = 'false'
} = process.env;

// Simple logger that only prints when DEBUG_MODE is true
const log = (message) => {
  if (DEBUG_MODE === 'true') console.log(`[DEBUG] ${message}`);
};

// --- Validation ---
if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID.');
  process.exit(1);
}

// --- Initialization ---
const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const app = express();

app.get('/health', (_req, res) => res.status(200).send('OK'));
app.listen(PORT, () => console.log(`Health check on http://0.0.0.0:${PORT}/health`));

/**
 * Captures and sends the heatmap, with robust error handling.
 */
async function captureAndSendHeatmap() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Task start for period=${PERIOD}`);
  let browser = null;
  let page = null;
  let screenshotPath;
  let debugPath;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      args: [
        '--headless',                   // legacy headless for stability
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
      ],
      timeout: 90000,
    });
    log('Browser launched.');

    page = await browser.newPage();
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      log('Viewport set.');
    } catch (vpErr) {
      console.error('Viewport setting failed, continuing without:', vpErr);
    }

    const url = `https://www.coinglass.com/pro/futures/LiquidationHeatMap?period=${PERIOD}`;
    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    log('Page loaded.');

    const canvasSelector = 'canvas[data-zr-dom-id^="zr_"]';
    await page.waitForSelector(canvasSelector, { timeout: 30000 });
    log('Canvas selector found.');
    const canvas = await page.$(canvasSelector);
    if (!canvas) throw new Error('Canvas not found');

    screenshotPath = `/tmp/heatmap_${Date.now()}.png`;
    await canvas.screenshot({ path: screenshotPath });
    console.log(`Saved heatmap to ${screenshotPath}`);

    // Send to Telegram
    const caption = `📊 Coinglass Heatmap (${PERIOD})\n${new Date().toUTCString()}`;
    await bot.sendPhoto(CHAT_ID, screenshotPath, { caption });
    console.log('Heatmap sent.');

  } catch (err) {
    console.error('Task error:', err);
    const errorMsg = `❌ Heatmap Capture Failed\n*Time:* ${new Date().toUTCString()}\n*Error:* ${err.message}`;
    await bot.sendMessage(CHAT_ID, errorMsg, { parse_mode: 'Markdown' }).catch(console.error);
    if (page) {
      try {
        debugPath = `/tmp/debug_${Date.now()}.png`;
        await page.screenshot({ path: debugPath, fullPage: true });
        console.log(`Debug screenshot at ${debugPath}`);
        await bot.sendPhoto(CHAT_ID, debugPath, { caption: '🛠 Debug Screenshot' });
      } catch (dbgErr) {
        console.error('Debug screenshot failed:', dbgErr);
      }
    }
  } finally {
    if (browser) await browser.close();
    [screenshotPath, debugPath].forEach(p => p && fs.existsSync(p) && fs.unlinkSync(p));
    log('Cleanup done.');
  }
}

// Initial invocation
captureAndSendHeatmap();
// Scheduled
cron.schedule(CRON_EXPR, captureAndSendHeatmap, { timezone: 'Etc/UTC' });
console.log(`Scheduled with cron: ${CRON_EXPR}`);
