const crypto = require("crypto");
const config = require("../config");
const { User, getSettings } = require("../models");

function checkInitData(initData) {
  if (!config.botToken) return null;
  const params = new URLSearchParams(String(initData || ""));
  const hash = params.get("hash") || "";
  if (!/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete("hash");
  const pairs = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const check = pairs.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(config.botToken).digest();
  const digest = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const left = Buffer.from(digest, "hex");
  const right = Buffer.from(hash, "hex");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  const authDate = Number(params.get("auth_date"));
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isFinite(authDate) || age < -30 || age > 86400) return null;
  let tgUser;
  try {
    tgUser = JSON.parse(params.get("user") || "");
  } catch {
    return null;
  }
  if (!tgUser || !tgUser.id) return null;
  return tgUser;
}

async function userFromInitData(initData) {
  const tg = checkInitData(initData);
  if (!tg) return null;
  const telegramId = String(tg.id);
  let user = await User.findOne({ telegramId });
  if (!user) {
    const settings = await getSettings();
    user = await User.create({
      telegramId,
      username: tg.username || "",
      firstName: tg.first_name || "",
      lastName: tg.last_name || "",
      coins: settings.welcomeCoins,
    });
    return user;
  }
  const username = tg.username || "";
  const firstName = tg.first_name || "";
  const lastName = tg.last_name || "";
  if (user.username !== username || user.firstName !== firstName || user.lastName !== lastName) {
    user.username = username || user.username;
    user.firstName = firstName || user.firstName;
    user.lastName = lastName;
    await user.save();
  }
  return user;
}

module.exports = { checkInitData, userFromInitData };
