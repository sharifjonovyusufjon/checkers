const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { WebSocketServer } = require("ws");
const config = require("../config");
const { t, bundle, normalizeLang } = require("../i18n");
const { User, Game, Payment, Audit, LoginCode, getSettings, isAdminId } = require("../models");
const { userFromInitData } = require("../telegram/webapp");
const { createInvoiceLink } = require("../payments");
const { telegramApi } = require("../telegram/api");
const { getMeta, getGameBot } = require("../telegram/bots");
const manager = require("../game/manager");

const publicDir = path.join(__dirname, "public");
const loginHits = new Map();

function hostName(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
}

function isAdminHost(req) {
  return hostName(req) === config.adminHost;
}

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

function tooMany(ip) {
  const row = loginHits.get(ip);
  if (!row || row.until < Date.now()) return false;
  return row.n >= 8;
}

function markFail(ip) {
  const row = loginHits.get(ip);
  if (!row || row.until < Date.now()) loginHits.set(ip, { n: 1, until: Date.now() + 10 * 60 * 1000 });
  else row.n += 1;
}

function clearFail(ip) {
  loginHits.delete(ip);
}

async function readUser(req) {
  const initData = req.get("x-init-data") || req.body?.initData || "";
  return userFromInitData(initData);
}

function sendGameError(res, lang, err) {
  const code = err.code || "error_generic";
  const status = code === "auth" ? 401 : 400;
  res.status(status).json({ error: code, message: t(lang, code, err.vars || {}) });
}

async function requireAdmin(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies.admin_token || "", config.jwtSecret);
    const settings = await getSettings();
    if (payload.role !== "admin" || !isAdminId(payload.tid, settings)) throw new Error("auth");
    req.adminId = String(payload.tid);
    next();
  } catch {
    res.status(401).json({ error: "auth" });
  }
}

function adminCookie(res, req, telegramId) {
  const token = jwt.sign({ role: "admin", tid: String(telegramId) }, config.jwtSecret, { expiresIn: "12h" });
  res.cookie("admin_token", token, {
    httpOnly: true,
    secure: Boolean(req.secure),
    sameSite: "lax",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
}

function page(req) {
  const value = Math.max(1, Math.round(Number(req.query.page) || 1));
  return { page: value, limit: 20, skip: (value - 1) * 20 };
}

function createServer() {
  const app = express();
  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "80kb" }));
  app.use(cookieParser());
  app.use("/game", express.static(path.join(publicDir, "game"), { maxAge: "1h" }));
  app.use("/admin", express.static(path.join(publicDir, "admin"), { maxAge: "1h" }));

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/meta", (req, res) => {
    res.json({ ...getMeta(), webappUrl: config.webappUrl, adminUrl: config.adminUrl });
  });

  app.get("/api/i18n/:lang", (req, res) => {
    res.json(bundle(normalizeLang(req.params.lang)));
  });

  app.post(
    "/api/admin/login",
    asyncRoute(async (req, res) => {
      const ip = clientIp(req);
      if (tooMany(ip)) return res.status(429).json({ error: "a_bad_code" });
      const code = String(req.body?.code || "").replace(/\D/g, "");
      if (code.length !== 6) {
        markFail(ip);
        return res.status(401).json({ error: "a_bad_code" });
      }
      const codeHash = crypto.createHash("sha256").update(code).digest("hex");
      const row = await LoginCode.findOne({ codeHash, expiresAt: { $gt: new Date() } });
      if (!row) {
        markFail(ip);
        return res.status(401).json({ error: "a_bad_code" });
      }
      const settings = await getSettings();
      if (!isAdminId(row.telegramId, settings)) {
        markFail(ip);
        return res.status(401).json({ error: "a_bad_code" });
      }
      await LoginCode.deleteOne({ _id: row._id });
      clearFail(ip);
      adminCookie(res, req, row.telegramId);
      await Audit.create({ adminTelegramId: row.telegramId, action: "login", meta: { ip } });
      res.json({ ok: true });
    })
  );

  app.post("/api/admin/logout", (req, res) => {
    res.clearCookie("admin_token", { path: "/" });
    res.json({ ok: true });
  });

  app.get(
    "/api/admin/me",
    requireAdmin,
    asyncRoute(async (req, res) => {
      res.json({ id: req.adminId });
    })
  );

  app.get(
    "/api/admin/stats",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const [users, active, today, coinAgg, starAgg] = await Promise.all([
        User.countDocuments(),
        Game.countDocuments({ status: "active" }),
        Game.countDocuments({ createdAt: { $gte: start } }),
        User.aggregate([{ $group: { _id: null, sum: { $sum: "$coins" } } }]),
        Payment.aggregate([{ $group: { _id: null, sum: { $sum: "$stars" } } }]),
      ]);
      let starBalance = null;
      try {
        const balance = await telegramApi(config.botToken, "getMyStarBalance");
        starBalance = balance && typeof balance === "object" ? balance.amount : balance;
      } catch {
        starBalance = null;
      }
      res.json({
        users,
        active,
        today,
        coins: coinAgg[0]?.sum || 0,
        stars: starAgg[0]?.sum || 0,
        queue: manager.queueSize(),
        starBalance,
      });
    })
  );

  app.get(
    "/api/admin/users",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const { page: current, limit, skip } = page(req);
      const q = String(req.query.q || "").trim();
      const filter = {};
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [{ username: rx }, { firstName: rx }, { lastName: rx }, { phone: rx }, { telegramId: q }];
      }
      const [items, total] = await Promise.all([
        User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        User.countDocuments(filter),
      ]);
      res.json({ items, total, page: current });
    })
  );

  app.get(
    "/api/admin/users/:id",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const user = await User.findById(req.params.id).lean();
      if (!user) return res.status(404).json({ error: "missing" });
      const games = await Game.find({ $or: [{ white: user._id }, { black: user._id }] })
        .sort({ createdAt: -1 })
        .limit(8)
        .lean();
      res.json({ user, games });
    })
  );

  app.patch(
    "/api/admin/users/:id",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: "missing" });
      const coins = Math.round(Number(req.body?.coins));
      const wins = Math.round(Number(req.body?.wins));
      const losses = Math.round(Number(req.body?.losses));
      const draws = Math.round(Number(req.body?.draws));
      if ([coins, wins, losses, draws].some((n) => !Number.isInteger(n) || n < 0 || n > 100000000)) {
        return res.status(400).json({ error: "bad" });
      }
      user.coins = coins;
      user.wins = wins;
      user.losses = losses;
      user.draws = draws;
      user.banned = Boolean(req.body?.banned);
      await user.save();
      await Audit.create({
        adminTelegramId: req.adminId,
        action: "user.update",
        meta: { id: String(user._id), coins, wins, losses, draws, banned: user.banned },
      });
      res.json({ ok: true, user });
    })
  );

  app.get(
    "/api/admin/games",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const { page: current, limit, skip } = page(req);
      const filter = {};
      if (req.query.status === "active" || req.query.status === "finished") filter.status = req.query.status;
      const [items, total] = await Promise.all([
        Game.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Game.countDocuments(filter),
      ]);
      res.json({ items, total, page: current });
    })
  );

  app.post(
    "/api/admin/games/:id/settle",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const mode = String(req.body?.mode || "");
      if (mode === "refund") await manager.adminSettle(req.params.id, "draw", false);
      else if (mode === "white") await manager.adminSettle(req.params.id, "white", true);
      else if (mode === "black") await manager.adminSettle(req.params.id, "black", true);
      else return res.status(400).json({ error: "bad" });
      await Audit.create({ adminTelegramId: req.adminId, action: "game.settle", meta: { id: req.params.id, mode } });
      res.json({ ok: true });
    })
  );

  app.get(
    "/api/admin/payments",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const { page: current, limit, skip } = page(req);
      const [items, total] = await Promise.all([
        Payment.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Payment.countDocuments(),
      ]);
      res.json({ items, total, page: current });
    })
  );

  app.get(
    "/api/admin/settings",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const settings = await getSettings();
      res.json({
        welcomeCoins: settings.welcomeCoins,
        minStake: settings.minStake,
        maxStake: settings.maxStake,
        moveSeconds: settings.moveSeconds,
        packages: settings.packages,
        maintenance: settings.maintenance,
        adminIds: settings.adminIds || [],
      });
    })
  );

  app.put(
    "/api/admin/settings",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const welcomeCoins = Math.round(Number(req.body?.welcomeCoins));
      const minStake = Math.round(Number(req.body?.minStake));
      const maxStake = Math.round(Number(req.body?.maxStake));
      const moveSeconds = Math.round(Number(req.body?.moveSeconds));
      const adminIds = String(req.body?.adminIds || "")
        .split(/[\s,]+/)
        .map((item) => item.replace(/\D/g, ""))
        .filter((item) => item.length >= 5 && item.length <= 16);
      const packages = Array.isArray(req.body?.packages) ? req.body.packages : [];
      const clean = [];
      for (const item of packages) {
        const coins = Math.round(Number(item.coins));
        const stars = Math.round(Number(item.stars));
        const id = String(item.id || `c${coins}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
        if (!id || coins < 1 || coins > 1000000 || stars < 1 || stars > 100000) continue;
        clean.push({ id, coins, stars });
      }
      if (
        welcomeCoins < 0 ||
        welcomeCoins > 1000000 ||
        minStake < 1 ||
        maxStake < minStake ||
        maxStake > 1000000 ||
        moveSeconds < 15 ||
        moveSeconds > 600 ||
        !adminIds.length ||
        !clean.length
      ) {
        return res.status(400).json({ error: "bad" });
      }
      const settings = await getSettings();
      settings.welcomeCoins = welcomeCoins;
      settings.minStake = minStake;
      settings.maxStake = maxStake;
      settings.moveSeconds = moveSeconds;
      settings.packages = clean;
      settings.maintenance = Boolean(req.body?.maintenance);
      settings.adminIds = [...new Set(adminIds)];
      settings.markModified("packages");
      await settings.save();
      await Audit.create({ adminTelegramId: req.adminId, action: "settings", meta: { welcomeCoins, minStake, maxStake, moveSeconds } });
      res.json({ ok: true });
    })
  );

  app.post(
    "/api/admin/broadcast",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const text = String(req.body?.text || "").trim();
      const lang = String(req.body?.lang || "all");
      if (text.length < 1 || text.length > 3500) return res.status(400).json({ error: "bad" });
      const bot = getGameBot();
      if (!bot) return res.status(503).json({ error: "bot" });
      const filter = lang === "all" ? {} : { language: lang };
      const users = await User.find(filter).select("telegramId banned");
      let sent = 0;
      let failed = 0;
      for (const user of users) {
        if (user.banned) continue;
        try {
          await bot.api.sendMessage(user.telegramId, text);
          sent += 1;
        } catch {
          failed += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      await Audit.create({ adminTelegramId: req.adminId, action: "broadcast", meta: { lang, sent, failed } });
      res.json({ sent, failed });
    })
  );

  app.get(
    "/api/admin/journal",
    requireAdmin,
    asyncRoute(async (req, res) => {
      const items = await Audit.find().sort({ createdAt: -1 }).limit(100).lean();
      res.json({ items });
    })
  );

  app.get(
    "/api/state",
    asyncRoute(async (req, res) => {
      const user = await readUser(req);
      if (!user) return res.status(401).json({ error: "auth", message: t("uz", "auth") });
      res.json(await manager.view(user));
    })
  );

  app.get(
    "/api/leaderboard",
    asyncRoute(async (req, res) => {
      const user = await readUser(req);
      if (!user) return res.status(401).json({ error: "auth" });
      res.json({ items: await manager.leaderboard() });
    })
  );

  app.post(
    "/api/invoice",
    asyncRoute(async (req, res) => {
      const user = await readUser(req);
      if (!user) return res.status(401).json({ error: "auth" });
      if (!user.language || !user.phone || !user.nationality) return sendGameError(res, user.language || "uz", { code: "need_reg" });
      try {
        const invoice = await createInvoiceLink(user, String(req.body?.packageId || ""));
        res.json(invoice);
      } catch (err) {
        sendGameError(res, user.language || "uz", err);
      }
    })
  );

  app.post(
    "/api/action",
    asyncRoute(async (req, res) => {
      const user = await readUser(req);
      if (!user) return res.status(401).json({ error: "auth", message: t("uz", "auth") });
      const lang = user.language || "uz";
      try {
        const type = String(req.body?.type || "");
        if (type === "queue") await manager.joinQueue(user, req.body?.stake);
        else if (type === "cancel") await manager.cancelQueue(user);
        else if (type === "move") await manager.move(user, req.body);
        else if (type === "resign") await manager.resign(user);
        else if (type === "ack") await manager.ack(user);
        else if (type === "lang") await manager.setLang(user, req.body?.lang);
        else return res.status(400).json({ error: "bad" });
        const fresh = await User.findById(user._id);
        res.json(await manager.view(fresh));
      } catch (err) {
        sendGameError(res, lang, err);
      }
    })
  );

  app.get("/", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const file = isAdminHost(req) ? "admin/index.html" : "game/index.html";
    res.sendFile(path.join(publicDir, file));
  });

  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "error_generic" });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    let userId = null;
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        if (msg.type === "auth") {
          const user = await userFromInitData(msg.initData);
          if (!user) {
            ws.send(JSON.stringify({ type: "error", error: "auth", message: t("uz", "auth") }));
            return;
          }
          if (userId) manager.unbind(userId, ws);
          userId = String(user._id);
          manager.bind(userId, ws);
          ws.send(JSON.stringify({ type: "state", ...(await manager.view(user)) }));
          return;
        }
        if (!userId) return;
        const user = await User.findById(userId);
        if (!user) return;
        if (msg.type === "queue") await manager.joinQueue(user, msg.stake);
        else if (msg.type === "cancel") await manager.cancelQueue(user);
        else if (msg.type === "move") await manager.move(user, msg);
        else if (msg.type === "resign") await manager.resign(user);
        else if (msg.type === "ack") await manager.ack(user);
        else if (msg.type === "lang") await manager.setLang(user, msg.lang);
        else return;
        const fresh = await User.findById(userId);
        ws.send(JSON.stringify({ type: "state", ...(await manager.view(fresh)) }));
      } catch (err) {
        const user = userId ? await User.findById(userId) : null;
        const lang = user?.language || "uz";
        ws.send(JSON.stringify({ type: "error", error: err.code || "error_generic", message: t(lang, err.code || "error_generic", err.vars || {}) }));
      }
    });
    ws.on("close", () => {
      if (userId) manager.unbind(userId, ws);
    });
  });

  return server;
}

module.exports = { createServer };
