// index.js (您的代码是完美的，无需修改)
require('dotenv').config();
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const cron    = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const fs      = require('fs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHANNEL_ID;
const PERIOD    = process.env.HEATMAP_PERIOD || '24h';
const CRON_EXPR = process.env.SCRAPE_CRON || '*/5 * * * *';

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('请设置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHANNEL_ID');
  process.exit(1);
}
const bot = new TelegramBot(BOT_TOKEN);

async function captureHeatmap() {
  console.log(`[${new Date().toLocaleString()}] Starting capture for period: ${PERIOD}`);
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    const url = `https://www.coinglass.com/pro/futures/LiquidationHeatMap?period=${PERIOD}`;
    console.log(`Navigating to ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // 等待Canvas渲染出来
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
  if (!file) {
    await bot.sendMessage(CHAT_ID, `❌ Heatmap 捕获失败\n时间: ${new Date().toLocaleString()}`).catch(console.error);
    return;
  }
  
  const caption = `📊 **Coinglass Heatmap (${PERIOD})**\n_${new Date().toLocaleString()}_`;
  
  await bot.sendPhoto(CHAT_ID, file, { caption: caption, parse_mode: 'Markdown' }).catch(console.error);
  console.log('Photo sent to Telegram.');
  
  fs.unlinkSync(file);
}

// 启动时立即执行一次，以便快速验证
console.log('Bot started. Performing initial run...');
sendHeatmap();

// 设置定时任务
cron.schedule(CRON_EXPR, () => {
  console.log(`[${new Date().toLocaleString()}] Cron job triggered.`);
  sendHeatmap();
}, {
  timezone: "Etc/UTC" // 建议明确指定时区
});

console.log(`Scheduled to run with cron expression: "${CRON_EXPR}"`);
