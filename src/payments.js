const config = require("./config");
const { Payment, User, getSettings } = require("./models");
const { t } = require("./i18n");
const { telegramApi } = require("./telegram/api");

async function grantStarsPayment({ telegramId, payload, chargeId, stars }) {
  const match = /^pkg:[A-Za-z0-9_-]+:(\d+)$/.exec(String(payload || ""));
  if (!match || !chargeId) return { ok: false, error: "payload" };
  const coins = Number(match[1]);
  if (!Number.isInteger(coins) || coins < 1 || coins > 1000000) return { ok: false, error: "payload" };
  try {
    await Payment.create({
      telegramId: String(telegramId),
      coins,
      stars: Number(stars) || 0,
      chargeId: String(chargeId),
      payload: String(payload),
    });
  } catch (err) {
    if (err && err.code === 11000) return { ok: true, duplicate: true, coins };
    throw err;
  }
  const user = await User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { $inc: { coins } },
    { new: true }
  );
  return { ok: true, user, coins };
}

async function createInvoiceLink(user, packageId) {
  const settings = await getSettings();
  const pack = (settings.packages || []).find((item) => item.id === packageId);
  if (!pack) {
    const err = new Error("error_generic");
    err.code = "error_generic";
    throw err;
  }
  const lang = user.language || "uz";
  const payload = `pkg:${pack.id}:${pack.coins}`;
  const link = await telegramApi(config.botToken, "createInvoiceLink", {
    title: t(lang, "invoice_title", { coins: pack.coins }).slice(0, 32),
    description: t(lang, "invoice_desc", { coins: pack.coins, stars: pack.stars }).slice(0, 255),
    payload,
    currency: "XTR",
    prices: [{ label: String(pack.coins), amount: pack.stars }],
  });
  return { link, coins: pack.coins, stars: pack.stars };
}

module.exports = { grantStarsPayment, createInvoiceLink };
