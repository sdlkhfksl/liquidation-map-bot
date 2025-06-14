require('dotenv').config();
const chromium      = require('chrome-aws-lambda');
const puppeteer     = require('puppeteer-core');
const cron          = require('node-cron');
const TelegramBot   = require('node-telegram-bot-api');
const express       = require('express');
const fs            = require('fs');
const path          = require('path');

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

// 健康检查接口
app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// 启动 HTTP 服务器
app.listen(PORT, () => {
  console.log(`Health check listening on http://0.0.0.0:${PORT}/health`);
});

// 抓图并返回本地文件路径
async function captureHeatmap() {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.goto(
      `https://www.coinglass.com/pro/futures/LiquidationHeatMap?period=${PERIOD}`,
      { waitUntil: 'networkidle2' }
    );
    await page.waitForTimeout(3000);

    const canvas = await page.$('canvas');
    const timestamp = Date.now();
    const filename  = `/tmp/heatmap_${timestamp}.png`;
    await canvas.screenshot({ path: filename });
    return filename;
  } catch (err) {
    console.error('Capture failed:', err);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// 发送到 Telegram
async function sendHeatmap() {
  const file = await captureHeatmap();
  const now  = new Date().toLocaleString();
  if (!file) {
    await bot.sendMessage(CHAT_ID, `❌ Heatmap 捕获失败 ${now}`);
    return;
  }
  await bot.sendPhoto(CHAT_ID, file, {
    caption: `Coinglass Heatmap (${PERIOD})\n${now}`,
  });
  fs.unlinkSync(file);
}

// 启动时立刻跑一次
sendHeatmap();

// 按计划抓图
cron.schedule(CRON_EXPR, () => {
  console.log('Scheduled capture at', new Date().toLocaleString());
  sendHeatmap();
});
