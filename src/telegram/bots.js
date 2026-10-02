const crypto = require("crypto");
const { Bot, InlineKeyboard, Keyboard } = require("grammy");
const config = require("../config");
const { User, LoginCode, getSettings, isAdminId } = require("../models");
const { t, natLabel } = require("../i18n");
const { grantStarsPayment } = require("../payments");
const { telegramApi } = require("./api");
const manager = require("../game/manager");

const meta = { gameBot: "", adminBot: "" };
let gameBot = null;
let adminBot = null;

function getMeta() {
  return meta;
}

function getGameBot() {
  return gameBot;
}

async function upsert(ctx) {
  const telegramId = String(ctx.from.id);
  let user = await User.findOne({ telegramId });
  if (!user) {
    const settings = await getSettings();
    user = await User.create({
      telegramId,
      username: ctx.from.username || "",
      firstName: ctx.from.first_name || "",
      lastName: ctx.from.last_name || "",
      coins: settings.welcomeCoins,
    });
    return user;
  }
  user.username = ctx.from.username || user.username || "";
  user.firstName = ctx.from.first_name || user.firstName || "";
  user.lastName = ctx.from.last_name || "";
  await user.save();
  return user;
}

function langKeyboard() {
  return new InlineKeyboard()
    .text("O'zbek", "lang:uz")
    .text("Русский", "lang:ru")
    .row()
    .text("English", "lang:en")
    .text("한국어", "lang:ko");
}

function natKeyboard(lang) {
  const kb = new InlineKeyboard();
  ["uz", "kr", "ru", "kz", "kg", "tj", "other"].forEach((code, index) => {
    kb.text(t(lang, code === "other" ? "nat_other_btn" : `nat_${code}`), `nat:${code}`);
    if (index % 2 === 1) kb.row();
  });
  return kb;
}

function mainKeyboard(lang) {
  return new InlineKeyboard()
    .webApp(t(lang, "menu_play"), config.webappUrl)
    .row()
    .text(t(lang, "menu_balance"), "menu:balance")
    .text(t(lang, "menu_stats"), "menu:stats")
    .row()
    .text(t(lang, "menu_buy"), "menu:buy")
    .text(t(lang, "menu_top"), "menu:top")
    .row()
    .text(t(lang, "menu_profile"), "menu:profile")
    .text(t(lang, "menu_lang"), "menu:lang");
}

function phoneKeyboard(lang) {
  return new Keyboard().requestContact(t(lang, "ask_phone_btn")).resized().oneTime();
}

async function allowed(ctx, user) {
  const settings = await getSettings();
  const lang = user.language || "uz";
  if (settings.maintenance && !isAdminId(ctx.from.id, settings)) {
    await ctx.reply(t(lang, "maintenance"));
    return false;
  }
  if (user.banned) {
    await ctx.reply(t(lang, "banned"));
    return false;
  }
  return true;
}

async function sendStep(ctx, user, removeKeyboard) {
  if (!(await allowed(ctx, user))) return;
  const lang = user.language || "uz";
  if (!user.language) {
    await ctx.reply(t("uz", "choose_lang"), { reply_markup: langKeyboard() });
    return;
  }
  if (!user.phone) {
    await ctx.reply(t(lang, "ask_phone"), { reply_markup: phoneKeyboard(lang) });
    return;
  }
  if (removeKeyboard) {
    await ctx.reply(t(lang, "phone_ok"), { reply_markup: { remove_keyboard: true } });
  }
  if (!user.nationality) {
    if (user.pending === "nationality_text") {
      await ctx.reply(t(lang, "nat_other"));
      return;
    }
    await ctx.reply(t(lang, "ask_nationality"), { reply_markup: natKeyboard(lang) });
    return;
  }
  await ctx.reply(t(lang, "welcome", { name: user.firstName || "—", coins: user.coins }), {
    reply_markup: mainKeyboard(lang),
  });
}

async function showBuy(ctx, user) {
  const settings = await getSettings();
  const lang = user.language || "uz";
  const kb = new InlineKeyboard();
  for (const pack of settings.packages || []) {
    kb.text(`${pack.coins} · ${pack.stars} ⭐`, `buy:${pack.id}`).row();
  }
  await ctx.reply(t(lang, "buy_title"), { reply_markup: kb });
}

async function showTop(ctx, user) {
  const lang = user.language || "uz";
  const rows = await manager.leaderboard();
  if (!rows.length) {
    await ctx.reply(t(lang, "top_empty"));
    return;
  }
  const lines = [t(lang, "top_title"), ...rows.slice(0, 10).map((row) => t(lang, "top_line", row))];
  await ctx.reply(lines.join("\n"));
}

function wireGameBot(bot) {
  bot.catch((err) => console.error("game bot", err.message || err));

  bot.command("start", async (ctx) => {
    const user = await upsert(ctx);
    await sendStep(ctx, user);
  });

  bot.command(["play", "language", "balance", "stats", "buy"], async (ctx) => {
    const user = await upsert(ctx);
    if (!(await allowed(ctx, user))) return;
    const cmd = ctx.message.text.split(/\s/)[0].slice(1);
    if (!user.language || !user.phone || !user.nationality) return sendStep(ctx, user);
    const lang = user.language;
    if (cmd === "language") return ctx.reply(t(lang, "choose_lang"), { reply_markup: langKeyboard() });
    if (cmd === "balance") return ctx.reply(t(lang, "balance_text", { coins: user.coins }));
    if (cmd === "stats") return ctx.reply(t(lang, "stats_text", user));
    if (cmd === "buy") return showBuy(ctx, user);
    return ctx.reply(t(lang, "menu_play"), { reply_markup: new InlineKeyboard().webApp(t(lang, "open_game"), config.webappUrl) });
  });

  bot.callbackQuery(/^lang:(uz|ru|en|ko)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsert(ctx);
    user.language = ctx.match[1];
    await user.save();
    await sendStep(ctx, user);
  });

  bot.callbackQuery(/^nat:(uz|kr|ru|kz|kg|tj|other)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsert(ctx);
    if (!user.language) return sendStep(ctx, user);
    if (ctx.match[1] === "other") {
      user.pending = "nationality_text";
      user.nationality = "";
      await user.save();
      await ctx.reply(t(user.language, "nat_other"));
      return;
    }
    user.nationality = ctx.match[1];
    user.pending = "";
    await user.save();
    await sendStep(ctx, user);
  });

  bot.callbackQuery(/^menu:(balance|stats|buy|top|profile|lang)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsert(ctx);
    if (!(await allowed(ctx, user))) return;
    if (!user.language || !user.phone || !user.nationality) return sendStep(ctx, user);
    const lang = user.language;
    const action = ctx.match[1];
    if (action === "lang") return ctx.reply(t(lang, "choose_lang"), { reply_markup: langKeyboard() });
    if (action === "balance") return ctx.reply(t(lang, "balance_text", { coins: user.coins }));
    if (action === "stats") return ctx.reply(t(lang, "stats_text", user));
    if (action === "buy") return showBuy(ctx, user);
    if (action === "top") return showTop(ctx, user);
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";
    return ctx.reply(
      t(lang, "profile_text", {
        name,
        username: user.username || "—",
        phone: user.phone || "—",
        nationality: natLabel(lang, user.nationality),
        coins: user.coins,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
      })
    );
  });

  bot.callbackQuery(/^buy:([A-Za-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = await upsert(ctx);
    if (!(await allowed(ctx, user))) return;
    const settings = await getSettings();
    const pack = (settings.packages || []).find((item) => item.id === ctx.match[1]);
    if (!pack) return;
    const lang = user.language || "uz";
    await telegramApi(config.botToken, "sendInvoice", {
      chat_id: ctx.chat.id,
      title: t(lang, "invoice_title", { coins: pack.coins }).slice(0, 32),
      description: t(lang, "invoice_desc", { coins: pack.coins, stars: pack.stars }).slice(0, 255),
      payload: `pkg:${pack.id}:${pack.coins}`,
      currency: "XTR",
      prices: [{ label: String(pack.coins), amount: pack.stars }],
    });
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const payload = ctx.preCheckoutQuery.invoice_payload || "";
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    const settings = await getSettings();
    const ok = /^pkg:[A-Za-z0-9_-]+:\d+$/.test(payload)
      && ctx.preCheckoutQuery.currency === "XTR"
      && user
      && !user.banned
      && (!settings.maintenance || isAdminId(ctx.from.id, settings));
    await ctx.answerPreCheckoutQuery(ok, ok ? undefined : "Unavailable");
  });

  bot.on("message:successful_payment", async (ctx) => {
    const pay = ctx.message.successful_payment;
    const user = await upsert(ctx);
    const granted = await grantStarsPayment({
      telegramId: ctx.from.id,
      payload: pay.invoice_payload,
      chargeId: pay.telegram_payment_charge_id,
      stars: pay.total_amount,
    });
    const lang = user.language || "uz";
    if (!granted.ok) return ctx.reply(t(lang, "error_generic"));
    const balance = granted.user ? granted.user.coins : user.coins;
    await ctx.reply(t(lang, "paid_ok", { coins: granted.coins, balance }));
  });

  bot.on("message:contact", async (ctx) => {
    const user = await upsert(ctx);
    const lang = user.language || "uz";
    if (String(ctx.message.contact.user_id || "") !== String(ctx.from.id)) {
      await ctx.reply(t(lang, "phone_self"));
      return;
    }
    user.phone = String(ctx.message.contact.phone_number || "");
    await user.save();
    await sendStep(ctx, user, true);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    const user = await upsert(ctx);
    if (user.pending !== "nationality_text") return;
    const text = ctx.message.text.trim().slice(0, 40);
    if (text.length < 2) return ctx.reply(t(user.language || "uz", "nat_other"));
    user.nationality = text;
    user.pending = "";
    await user.save();
    await sendStep(ctx, user);
  });
}

function wireAdminBot(bot) {
  bot.catch((err) => console.error("admin bot", err.message || err));
  bot.command("start", async (ctx) => {
    const settings = await getSettings();
    const telegramId = String(ctx.from.id);
    if (!isAdminId(telegramId, settings)) {
      await ctx.reply(`Ruxsat yo'q.\nID: ${telegramId}`);
      return;
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    await LoginCode.deleteMany({ telegramId });
    await LoginCode.create({
      telegramId,
      codeHash,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    await ctx.reply(`Admin panel: ${config.adminUrl}\nKod: ${code}\n5 daqiqa amal qiladi.`);
  });
}

async function configureGame(bot) {
  const me = await bot.api.getMe();
  meta.gameBot = me.username || "";
  const commands = {
    uz: [
      { command: "start", description: "Boshlash" },
      { command: "play", description: "O'ynash" },
      { command: "balance", description: "Balans" },
      { command: "buy", description: "Tanga olish" },
      { command: "stats", description: "Statistika" },
      { command: "language", description: "Til" },
    ],
    ru: [
      { command: "start", description: "Старт" },
      { command: "play", description: "Играть" },
      { command: "balance", description: "Баланс" },
      { command: "buy", description: "Купить монеты" },
      { command: "stats", description: "Статистика" },
      { command: "language", description: "Язык" },
    ],
    en: [
      { command: "start", description: "Start" },
      { command: "play", description: "Play" },
      { command: "balance", description: "Balance" },
      { command: "buy", description: "Buy coins" },
      { command: "stats", description: "Statistics" },
      { command: "language", description: "Language" },
    ],
    ko: [
      { command: "start", description: "시작" },
      { command: "play", description: "대국" },
      { command: "balance", description: "잔액" },
      { command: "buy", description: "코인 구매" },
      { command: "stats", description: "전적" },
      { command: "language", description: "언어" },
    ],
  };
  for (const [language_code, list] of Object.entries(commands)) {
    await bot.api.setMyCommands(list, { language_code });
  }
  await bot.api.setChatMenuButton({
    menu_button: { type: "web_app", text: "Play", web_app: { url: config.webappUrl } },
  });
}

async function startBots() {
  if (!config.botToken || !config.adminBotToken) throw new Error("Bot token yo'q");
  gameBot = new Bot(config.botToken);
  adminBot = new Bot(config.adminBotToken);
  wireGameBot(gameBot);
  wireAdminBot(adminBot);
  manager.setNotifier(async (telegramId, text) => {
    await gameBot.api.sendMessage(telegramId, text, {
      reply_markup: new InlineKeyboard().webApp("Play", config.webappUrl),
    });
  });
  await configureGame(gameBot);
  const adminMe = await adminBot.api.getMe();
  meta.adminBot = adminMe.username || "";
  console.log("bots", meta.gameBot, meta.adminBot);
  await Promise.all([gameBot.start(), adminBot.start()]);
}

module.exports = { startBots, getMeta, getGameBot };
