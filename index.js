// index.js (最终正确版本)

require('dotenv').config();
// 变化 1: 我们不再需要 chrome-aws-lambda 了
// const chromium      = require('chrome-aws-lambda');

// 变化 2: 我们引入完整的 puppeteer，而不是 puppeteer-core
const puppeteer     = require('puppeteer');
const cron          = require('node-cron');
const TelegramBot   = require('node-telegram-bot-api');
const express       = require('express');
const fs            = require('fs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHANNEL_ID;
const PERIOD    = process.env.HEATMAP_PERIOD || '24h';
const CRON_EXPR = process.env.SCRAPE_CRON   || '*/5 * * * *';
const PORT      = parseInt(process.env.PORT, 10) || 8080;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌ 请设置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHANNEL_ID');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const app = express();

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`Health check listening on http://0.0.0.0:${PORT}/health`);
});

async function captureHeatmap() {
  console.log(`[${new Date().toLocaleString()}] Starting capture for period: ${PERIOD}`);
  let browser = null;
  try {
    // 变化 3: 这是最关键的修改！
    // puppeteer.launch() 不再需要任何复杂的参数，因为它知道去哪里找自己绑定的浏览器。
    // 我们只需要给它一些在容器中运行的最佳实践参数。
    browser = await puppeteer.launch({
      headless: "new", // 使用现代的无头模式
      args: [
        '--no-sandbox', // 在容器中运行的必要安全选项
        '--disable-dev-shm-usage' // 避免一些内存相关的问题
      ]
    });

    const page = await browser.newPage();
    // 为截图设置一个高分辨率，让图片更清晰
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    
    const url = `https://www.coinglass.com/pro/futures/LiquidationHeatMap?period=${PERIOD}`;
    console.log(`Navigating to ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    await page.waitForSelector('canvas', { timeout: 15000 });
    console.log('Canvas found.');

    const canvas = await page.$('canvas');
    const filename = `/tmp/heatmap_${Date.now()}.png`;
    await canvas.screenshot({ path: filename });
    console.log(`Screenshot saved to ${filename}`);
    return filename;
  } catch (err) {
    console.error('Capture failed:', err);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function sendHeatmap() {
  const file = await captureHeatmap();
  const now  = new Date().toLocaleString();
  if (!file) {
    await bot.sendMessage(CHAT_ID, `❌ Heatmap 捕获失败 ${now}`).catch(console.error);
    return;
  }
  
  const caption = `📊 **Coinglass Heatmap (${PERIOD})**\n_${now}_`;
  
  await bot.sendPhoto(CHAT_ID, file, { caption: caption, parse_mode: 'Markdown' }).catch(console.error);
  console.log('Photo sent to Telegram.');
  
  fs.unlinkSync(file);
}

console.log('Bot started. Performing initial run...');
sendHeatmap();

cron.schedule(CRON_EXPR, () => {
  console.log(`[${new Date().toLocaleString()}] Cron job triggered.`);
  sendHeatmap();
}, {
  timezone: "Etc/UTC"
});

console.log(`Scheduled to run with cron expression: "${CRON_EXPR}"`);