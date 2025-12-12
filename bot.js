/**
 * Binance Candle Based Accurate RSI BOT + Target + StopLoss + Candle Time
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

// ----------------------- CONSTANTS -----------------------
const RSI_LENGTH = 14;
const INTERVAL = 5000; // 5 sec loop

// ----------------------- BOT INIT ------------------------
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ----------------------- STORAGE -------------------------
const DATA_FILE = path.join(__dirname, "data.json");
let data = { chats: {} };

function load() {
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
}
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
load();

function ensure(chatId) {
  if (!data.chats[chatId]) {
    data.chats[chatId] = {
      enabled: false,
      rsiLow: 30,
      rsiHigh: 70,
      priceAlerts: [],
      targetPrice: null,
      stopLoss: null,
      awaiting: null,
      _last: null,
    };
    save();
  }
  return data.chats[chatId];
}

/* ---------------------- FORMAT CANDLE TIME ---------------------- */
function formatCandleTime(ms) {
  return new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* ---------------------- GET FULL CANDLES ---------------------- */
async function getCandles() {
  try {
    const res = await axios.get("https://api.binance.com/api/v3/klines", {
      params: {
        symbol: "BTCUSDT",
        interval: "15m",
        limit: 200
      }
    });
    return res.data;
  } catch {
    console.log("Candle Fetch Error");
    return null;
  }
}

/* ---------------------- ACCURATE RSI FUNCTION ---------------------- */
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  gains /= period;
  losses /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];

    gains = (gains * (period - 1) + (diff > 0 ? diff : 0)) / period;
    losses = (losses * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }

  if (losses === 0) return 100;

  const RS = gains / losses;
  return 100 - 100 / (1 + RS);
}

/* ---------------------- MENU ---------------------- */
function menu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💹 Live Price", callback_data: "price" }],
        [
          { text: "🔔 RSI <30 Alert", callback_data: "low" },
          { text: "🔔 RSI >70 Alert", callback_data: "high" }
        ],
        [{ text: "💰 Set Price Alert", callback_data: "priceAlert" }],
        [{ text: "🎯 Set Target Price", callback_data: "target" }],
        [{ text: "🛑 Set Stop Loss", callback_data: "stopLoss" }],
        [{ text: "❌ Stop All Alerts", callback_data: "stopAll" }]
      ]
    }
  };
}

/* ---------------------- START ---------------------- */
bot.onText(/\/start/, msg => {
  const id = msg.chat.id.toString();
  ensure(id);
  bot.sendMessage(id, "🤖 BTC RSI BOT (Binance 15m Candle Based) Started!", menu());
});

/* ---------------------- CALLBACK ACTIONS ---------------------- */
bot.on("callback_query", async q => {
  const id = q.message.chat.id.toString();
  const chat = ensure(id);

  if (q.data === "price") {
    const candles = await getCandles();
    if (!candles) return bot.sendMessage(id, "Error fetching price.");

    const lastCandle = candles[candles.length - 1];
    const price = parseFloat(lastCandle[4]);

    return bot.sendMessage(id, `BTC Price: ${price}`);
  }

  if (q.data === "low") {
    chat.enabled = true;
    chat.rsiLow = 30;
    save();
    return bot.sendMessage(id, "🔔 RSI <30 alert enabled!");
  }

  if (q.data === "high") {
    chat.enabled = true;
    chat.rsiHigh = 70;
    save();
    return bot.sendMessage(id, "🔔 RSI >70 alert enabled!");
  }

  if (q.data === "priceAlert") {
    chat.awaiting = "priceAlert";
    save();
    return bot.sendMessage(id, "💰 Enter price for alert:");
  }

  if (q.data === "target") {
    chat.awaiting = "target";
    save();
    return bot.sendMessage(id, "🎯 Enter Target Price:");
  }

  if (q.data === "stopLoss") {
    chat.awaiting = "stopLoss";
    save();
    return bot.sendMessage(id, "🛑 Enter Stop Loss Price:");
  }

  if (q.data === "stopAll") {
    chat.enabled = false;
    chat.priceAlerts = [];
    chat.targetPrice = null;
    chat.stopLoss = null;
    chat._last = null;
    save();
    return bot.sendMessage(id, "❌ All alerts stopped.");
  }

  bot.answerCallbackQuery(q.id);
});

/* ---------------------- USER INPUT HANDLER ---------------------- */
bot.on("message", msg => {
  const id = msg.chat.id.toString();
  const chat = ensure(id);

  if (!chat.awaiting) return;

  if (chat.awaiting === "priceAlert") {
    const p = parseFloat(msg.text);
    if (isNaN(p)) return bot.sendMessage(id, "❌ Invalid price");

    chat.priceAlerts.push(p);
    chat.awaiting = null;
    save();
    return bot.sendMessage(id, `💰 Price alert set at ${p}`);
  }

  if (chat.awaiting === "target") {
    const t = parseFloat(msg.text);
    if (isNaN(t)) return bot.sendMessage(id, "❌ Invalid target price");

    chat.targetPrice = t;
    chat.awaiting = null;
    save();
    return bot.sendMessage(id, `🎯 Target Price set at ${t}`);
  }

  if (chat.awaiting === "stopLoss") {
    const s = parseFloat(msg.text);
    if (isNaN(s)) return bot.sendMessage(id, "❌ Invalid stop loss");

    chat.stopLoss = s;
    chat.awaiting = null;
    save();
    return bot.sendMessage(id, `🛑 Stop Loss set at ${s}`);
  }
});

/* ---------------------- MAIN LOOP ---------------------- */
async function loop() {
  const candles = await getCandles();
  if (!candles) return;

  const closes = candles.map(c => parseFloat(c[4]));
  const lastCandle = candles[candles.length - 1];

  const price = parseFloat(lastCandle[4]);
  const openTime = lastCandle[0];

  const rsi = calculateRSI(closes, RSI_LENGTH);

  for (let id of Object.keys(data.chats)) {
    const chat = data.chats[id];
    if (!chat.enabled || !rsi) continue;

    /* PRICE ALERT */
    for (let target of chat.priceAlerts) {
      if (price >= target) {
        bot.sendMessage(
          id,
          `🚨 PRICE HIT!\nPrice: ${price}\nTarget: ${target}\n🕒 Candle Time: ${formatCandleTime(openTime)}`
        );
        chat.priceAlerts = chat.priceAlerts.filter(x => x !== target);
        save();
      }
    }

    /* TARGET HIT */
    if (chat.targetPrice && price >= chat.targetPrice) {
      bot.sendMessage(
        id,
        `🎯 TARGET HIT!\nPrice: ${price}\nTarget: ${chat.targetPrice}\n🕒 Candle Time: ${formatCandleTime(openTime)}`
      );
      chat.targetPrice = null;
      save();
    }

    /* STOP LOSS HIT */
    if (chat.stopLoss && price <= chat.stopLoss) {
      bot.sendMessage(
        id,
        `🛑 STOP LOSS HIT!\nPrice: ${price}\nSL: ${chat.stopLoss}\n🕒 Candle Time: ${formatCandleTime(openTime)}`
      );
      chat.stopLoss = null;
      save();
    }

    /* BUY SIGNAL */
    if (rsi <= chat.rsiLow && chat._last !== "buy") {
      bot.sendMessage(
        id,
        `🔵 BUY SIGNAL\nRSI: ${rsi.toFixed(2)}\nPrice: ${price}\n🕒 Candle Time: ${formatCandleTime(openTime)}`
      );
      chat._last = "buy";
      save();
    }

    /* SELL SIGNAL */
    if (rsi >= chat.rsiHigh && chat._last !== "sell") {
      bot.sendMessage(
        id,
        `🔴 SELL SIGNAL\nRSI: ${rsi.toFixed(2)}\nPrice: ${price}\n🕒 Candle Time: ${formatCandleTime(openTime)}`
      );
      chat._last = "sell";
      save();
    }
  }
}

setInterval(loop, INTERVAL);

console.log("⚡ RSI BOT Running using Binance Candle Data…");
