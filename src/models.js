const mongoose = require("mongoose");
const config = require("./config");

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: String, unique: true, required: true, index: true },
    username: { type: String, default: "" },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    language: { type: String, default: "" },
    phone: { type: String, default: "" },
    nationality: { type: String, default: "" },
    pending: { type: String, default: "" },
    coins: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    banned: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const gameSchema = new mongoose.Schema(
  {
    white: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    black: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    whiteTg: { type: String, default: "" },
    blackTg: { type: String, default: "" },
    whiteName: { type: String, default: "" },
    blackName: { type: String, default: "" },
    stake: { type: Number, required: true },
    state: { type: mongoose.Schema.Types.Mixed, required: true },
    moves: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: { type: String, default: "active", index: true },
    result: { type: String, default: "" },
    reason: { type: String, default: "" },
    deadline: { type: Number, default: 0 },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const paymentSchema = new mongoose.Schema(
  {
    telegramId: { type: String, index: true },
    coins: Number,
    stars: Number,
    chargeId: { type: String, unique: true },
    payload: String,
  },
  { timestamps: true }
);

const settingSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "global" },
    welcomeCoins: { type: Number, default: 200 },
    minStake: { type: Number, default: 10 },
    maxStake: { type: Number, default: 1000 },
    moveSeconds: { type: Number, default: 60 },
    packages: {
      type: [
        {
          id: String,
          coins: Number,
          stars: Number,
        },
      ],
      default: undefined,
    },
    maintenance: { type: Boolean, default: false },
    adminIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

const loginCodeSchema = new mongoose.Schema({
  telegramId: { type: String, index: true },
  codeHash: String,
  expiresAt: { type: Date, index: true },
});

const auditSchema = new mongoose.Schema(
  {
    adminTelegramId: String,
    action: String,
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Game = mongoose.model("Game", gameSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const Setting = mongoose.model("Setting", settingSchema);
const LoginCode = mongoose.model("LoginCode", loginCodeSchema);
const Audit = mongoose.model("Audit", auditSchema);

const defaultPackages = [
  { id: "c100", coins: 100, stars: 25 },
  { id: "c500", coins: 500, stars: 100 },
  { id: "c1200", coins: 1200, stars: 200 },
];

let settingsCache = null;
let settingsCachedAt = 0;

function clearSettingsCache() {
  settingsCache = null;
  settingsCachedAt = 0;
}

async function getSettings() {
  if (settingsCache && Date.now() - settingsCachedAt < 8000) return settingsCache;
  let doc = await Setting.findById("global");
  if (!doc) {
    doc = await Setting.create({
      _id: "global",
      welcomeCoins: 200,
      minStake: 10,
      maxStake: 1000,
      moveSeconds: 60,
      packages: defaultPackages,
      maintenance: false,
      adminIds: config.adminIds,
    });
  }
  settingsCache = doc;
  settingsCachedAt = Date.now();
  return doc;
}

async function ensureDefaults() {
  const doc = await getSettings();
  const ids = new Set([...(doc.adminIds || []), ...config.adminIds]);
  doc.adminIds = [...ids];
  if (!doc.packages || !doc.packages.length) doc.packages = defaultPackages;
  await doc.save();
  return doc;
}

function isAdminId(telegramId, settings) {
  const id = String(telegramId);
  if (config.adminIds.includes(id)) return true;
  return (settings?.adminIds || []).map(String).includes(id);
}

module.exports = {
  User,
  Game,
  Payment,
  Setting,
  LoginCode,
  Audit,
  getSettings,
  clearSettingsCache,
  ensureDefaults,
  isAdminId,
  defaultPackages,
};
