require("dotenv").config();

const adminIds = String(process.env.ADMIN_TELEGRAM_IDS || "6019708243")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

module.exports = {
  botToken: process.env.BOT_TOKEN || "",
  adminBotToken: process.env.ADMIN_BOT_TOKEN || "",
  adminIds,
  mongoUrl: process.env.MONGO_URL || "",
  port: Number(process.env.PORT || 7791),
  webappUrl: process.env.WEBAPP_URL || "https://lms.yusufjon.uz",
  adminUrl: process.env.ADMIN_URL || "https://bot.yusufjon.uz",
  gameHost: (process.env.GAME_HOST || "lms.yusufjon.uz").toLowerCase(),
  adminHost: (process.env.ADMIN_HOST || "bot.yusufjon.uz").toLowerCase(),
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  trustProxy: process.env.TRUST_PROXY !== "0",
};
