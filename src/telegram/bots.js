const crypto = require("crypto");
const { Bot, InlineKeyboard } = require("grammy");
const config = require("../config");
const { User, LoginCode, getSettings, isAdminId } = require("../models");
const { t } = require("../i18n");
const { grantStarsPayment } = require("../payments");
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

function playButton(lang) {
  return new InlineKeyboard().webApp(t(lang, "menu_play"), config.webappUrl);
}

function wireGameBot(bot) {
  bot.catch((err) => console.error("game bot", err.message || err));

  bot.command("start", async (ctx) => {
    const user = await upsert(ctx);
    if (user.banned) return;
    await ctx.reply(t(user.language || "uz", "menu_play"), { reply_markup: playButton(user.language || "uz") });
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
    if (granted.user) await manager.push(granted.user._id);
    else await manager.push(user._id);
  });

  bot.on("message:contact", async (ctx) => {
    const contact = ctx.message.contact;
    if (String(contact.user_id || "") !== String(ctx.from.id)) return;
    const user = await upsert(ctx);
    user.phone = String(contact.phone_number || "");
    await user.save();
    await manager.push(user._id);
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
    const panel = `${config.adminUrl}/?v=2`;
    await ctx.reply(code, {
      reply_markup: new InlineKeyboard().url("Admin", panel),
    });
  });
}

async function configureGame(bot) {
  const me = await bot.api.getMe();
  meta.gameBot = me.username || "";
  const play = [
    { command: "start", description: "Play" },
  ];
  for (const language_code of ["uz", "ru", "en", "ko"]) {
    await bot.api.setMyCommands(play, { language_code }).catch((err) => console.error("commands", err.message));
  }
  await bot.api.setChatMenuButton({
    menu_button: { type: "web_app", text: "Play", web_app: { url: config.webappUrl } },
  }).catch((err) => console.error("menu", err.message));
}

async function configureAdmin(bot) {
  const me = await bot.api.getMe();
  meta.adminBot = me.username || "";
  const panel = `${config.adminUrl}/?v=2`;
  await bot.api.setChatMenuButton({
    menu_button: { type: "web_app", text: "Admin", web_app: { url: panel } },
  }).catch((err) => console.error("admin menu", err.message));
  for (const id of config.adminIds) {
    await bot.api.setChatMenuButton({
      chat_id: Number(id),
      menu_button: { type: "web_app", text: "Admin", web_app: { url: panel } },
    }).catch(() => {});
  }
}

async function startBots() {
  if (!config.botToken || !config.adminBotToken) throw new Error("Bot token yo'q");
  gameBot = new Bot(config.botToken);
  adminBot = new Bot(config.adminBotToken);
  wireGameBot(gameBot);
  wireAdminBot(adminBot);
  manager.setNotifier(async () => {});
  await configureGame(gameBot);
  await configureAdmin(adminBot);
  console.log("bots", meta.gameBot, meta.adminBot);
  await Promise.all([gameBot.start(), adminBot.start()]);
}

module.exports = { startBots, getMeta, getGameBot };
