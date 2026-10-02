const mongoose = require("mongoose");
const { User, Game, getSettings, isAdminId } = require("../models");
const { applyMove, legalMoves, newGameState } = require("./engine");
const { t, natLabel } = require("../i18n");

const queues = new Map();
const queueUsers = new Map();
const games = new Map();
const byUser = new Map();
const sockets = new Map();
const profiles = new Map();
const finishedFor = new Map();
const locks = new Map();
let lobbyTimer = null;
let lobbyJson = "";
let notifier = async () => {};
let chain = Promise.resolve();

function setNotifier(fn) {
  notifier = fn;
}

function fail(code, vars) {
  const err = new Error(code);
  err.code = code;
  err.vars = vars;
  return err;
}

function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    id,
    run.then(
      () => {},
      () => {}
    )
  );
  return run;
}

function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

function bind(userId, ws) {
  const id = String(userId);
  if (!sockets.has(id)) sockets.set(id, new Set());
  sockets.get(id).add(ws);
  scheduleLobby();
}

function unbind(userId, ws) {
  const id = String(userId);
  const set = sockets.get(id);
  if (!set) return;
  set.delete(ws);
  if (!set.size) sockets.delete(id);
  scheduleLobby();
}

function remember(user) {
  if (!user) return;
  profiles.set(String(user._id), {
    name: displayName(user),
    coins: user.coins || 0,
    telegramId: String(user.telegramId || ""),
  });
}

function presence(admin) {
  const people = [];
  for (const [id, set] of sockets) {
    let live = false;
    for (const ws of set) {
      if (ws.readyState === 1) {
        live = true;
        break;
      }
    }
    if (!live) continue;
    const profile = profiles.get(id) || { name: "—", coins: 0, telegramId: "" };
    const gameId = byUser.get(id);
    const game = gameId ? games.get(gameId) : null;
    const playing = Boolean(game && game.status === "active");
    const row = {
      id,
      name: profile.name,
      coins: profile.coins,
      stake: queueUsers.has(id) ? queueUsers.get(id) : null,
      playing,
      versus: playing ? (String(game.white) === id ? game.blackName || "" : game.whiteName || "") : "",
      game: playing ? gameId : "",
    };
    if (admin) row.telegramId = profile.telegramId || "";
    people.push(row);
  }
  people.sort((a, b) => {
    const waitingA = a.stake == null ? 1 : 0;
    const waitingB = b.stake == null ? 1 : 0;
    if (waitingA !== waitingB) return waitingA - waitingB;
    if (a.stake != null && b.stake != null && a.stake !== b.stake) return b.stake - a.stake;
    return b.coins - a.coins || a.name.localeCompare(b.name);
  });
  return { online: people.length, people };
}

function scheduleLobby() {
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    const json = JSON.stringify({ type: "lobby", ...presence(false) });
    if (json === lobbyJson) return;
    lobbyJson = json;
    for (const set of sockets.values()) {
      for (const ws of set) {
        if (ws.readyState === 1) ws.send(json);
      }
    }
  }, 250);
}

function queueSize() {
  let total = 0;
  for (const list of queues.values()) total += list.length;
  return total;
}

function displayName(user) {
  if (!user) return "—";
  if (user.firstName) return user.firstName;
  if (user.username) return `@${user.username}`;
  return String(user.telegramId || "");
}

function publicUser(user) {
  const lang = user.language || "uz";
  return {
    id: String(user._id),
    telegramId: user.telegramId,
    username: user.username || "",
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    language: user.language || "",
    phone: user.phone || "",
    nationality: user.nationality || "",
    nationalityLabel: natLabel(lang, user.nationality),
    coins: user.coins || 0,
    wins: user.wins || 0,
    losses: user.losses || 0,
    draws: user.draws || 0,
    ready: Boolean(user.language && user.phone && user.nationality),
    banned: Boolean(user.banned),
  };
}

function presentGame(game, userId) {
  const youWhite = String(game.white) === String(userId);
  const yourColor = youWhite ? "w" : "b";
  const state = game.state || {};
  const yours = game.status === "active" && state.turn === yourColor;
  return {
    id: String(game._id),
    yourColor,
    turn: state.turn,
    board: state.board,
    continueFrom: state.continueFrom,
    lastMove: state.lastMove,
    legal: yours ? legalMoves(state) : [],
    result: game.result || "",
    reason: game.reason || "",
    stake: game.stake,
    deadline: game.deadline || 0,
    status: game.status,
    whiteName: game.whiteName || "",
    blackName: game.blackName || "",
    youToMove: Boolean(yours),
  };
}

async function rules() {
  const settings = await getSettings();
  return {
    minStake: settings.minStake,
    maxStake: settings.maxStake,
    moveSeconds: settings.moveSeconds,
    packages: settings.packages || [],
    maintenance: Boolean(settings.maintenance),
  };
}

async function view(user) {
  const activeId = byUser.get(String(user._id));
  const game = (activeId && games.get(activeId)) || finishedFor.get(String(user._id)) || null;
  remember(user);
  scheduleLobby();
  return {
    user: publicUser(user),
    game: game ? presentGame(game, user._id) : null,
    queue: queueUsers.has(String(user._id)) ? queueUsers.get(String(user._id)) : null,
    rules: await rules(),
    ...presence(false),
  };
}

async function push(userId) {
  const set = sockets.get(String(userId));
  if (!set || !set.size) return;
  const user = await User.findById(userId);
  if (!user) return;
  const payload = JSON.stringify({ type: "state", ...(await view(user)) });
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

async function tell(userId, key, vars) {
  const user = await User.findById(userId);
  if (!user) return;
  try {
    await notifier(user.telegramId, t(user.language || "uz", key, vars));
  } catch (err) {
    console.error("notify", err.message);
  }
}

function resultKey(userId, game) {
  const youWhite = String(game.white) === String(userId);
  const youWin = (game.result === "white" && youWhite) || (game.result === "black" && !youWhite);
  if (game.result === "draw") return "you_draw";
  if (youWin) {
    if (game.reason === "timeout") return "timeout_opp";
    if (game.reason === "resign") return "resign_opp";
    return "you_won";
  }
  if (game.reason === "timeout") return "timeout_you";
  if (game.reason === "resign") return "resign_you";
  return "you_lost";
}

async function settle(game, result, reason, countStats) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const fresh = await Game.findOne({ _id: game._id, status: "active" }).session(session);
    if (!fresh) {
      await session.abortTransaction();
      return false;
    }
    const stake = fresh.stake;
    const whiteInc = {};
    const blackInc = {};
    if (result === "draw") {
      whiteInc.coins = stake;
      blackInc.coins = stake;
      if (countStats) {
        whiteInc.draws = 1;
        blackInc.draws = 1;
      }
    } else if (result === "white") {
      whiteInc.coins = stake * 2;
      if (countStats) {
        whiteInc.wins = 1;
        blackInc.losses = 1;
      }
    } else if (result === "black") {
      blackInc.coins = stake * 2;
      if (countStats) {
        blackInc.wins = 1;
        whiteInc.losses = 1;
      }
    } else {
      throw fail("error_generic");
    }
    if (Object.keys(whiteInc).length) await User.updateOne({ _id: fresh.white }, { $inc: whiteInc }, { session });
    if (Object.keys(blackInc).length) await User.updateOne({ _id: fresh.black }, { $inc: blackInc }, { session });
    fresh.status = "finished";
    fresh.result = result;
    fresh.reason = reason;
    fresh.finishedAt = new Date();
    fresh.state = game.state;
    fresh.moves = game.moves || [];
    fresh.markModified("state");
    fresh.markModified("moves");
    await fresh.save({ session });
    await session.commitTransaction();
    return true;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

async function finish(game, result, reason, countStats = true) {
  if (!game || game.status === "finished") return false;
  const ok = await settle(game, result, reason, countStats);
  if (!ok) return false;
  game.status = "finished";
  game.result = result;
  game.reason = reason;
  byUser.delete(String(game.white));
  byUser.delete(String(game.black));
  games.delete(String(game._id));
  finishedFor.set(String(game.white), game);
  finishedFor.set(String(game.black), game);
  await push(game.white);
  await push(game.black);
  await tell(game.white, resultKey(game.white, game), { n: game.stake });
  await tell(game.black, resultKey(game.black, game), { n: game.stake });
  return true;
}

async function createMatch(idA, idB, stake) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const settings = await getSettings();
    const a = await User.findOneAndUpdate(
      { _id: idA, coins: { $gte: stake }, banned: { $ne: true } },
      { $inc: { coins: -stake } },
      { session, new: true }
    );
    const b = await User.findOneAndUpdate(
      { _id: idB, coins: { $gte: stake }, banned: { $ne: true } },
      { $inc: { coins: -stake } },
      { session, new: true }
    );
    if (!a || !b) {
      await session.abortTransaction();
      throw fail("not_enough");
    }
    const swap = Math.random() < 0.5;
    const white = swap ? b : a;
    const black = swap ? a : b;
    const created = await Game.create(
      [
        {
          white: white._id,
          black: black._id,
          whiteTg: white.telegramId,
          blackTg: black.telegramId,
          whiteName: displayName(white),
          blackName: displayName(black),
          stake,
          state: newGameState(),
          moves: [],
          status: "active",
          deadline: Date.now() + settings.moveSeconds * 1000,
        },
      ],
      { session }
    );
    await session.commitTransaction();
    const doc = created[0];
    games.set(String(doc._id), doc);
    byUser.set(String(doc.white), String(doc._id));
    byUser.set(String(doc.black), String(doc._id));
    await push(doc.white);
    await push(doc.black);
    await tell(doc.white, "game_found", { name: doc.blackName, stake });
    await tell(doc.black, "game_found", { name: doc.whiteName, stake });
    return doc;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

function pull(userId) {
  const id = String(userId);
  const stake = queueUsers.get(id);
  queueUsers.delete(id);
  if (stake == null) return;
  const list = queues.get(stake) || [];
  queues.set(
    stake,
    list.filter((item) => item !== id)
  );
}

async function tryMatch(stake) {
  const list = queues.get(stake) || [];
  while (list.length >= 2) {
    const a = list.shift();
    const b = list.shift();
    queueUsers.delete(a);
    queueUsers.delete(b);
    if (byUser.has(a) || byUser.has(b) || a === b) continue;
    try {
      await createMatch(a, b, stake);
    } catch (err) {
      console.error("match", err.message);
      await push(a);
      await push(b);
    }
  }
  queues.set(stake, list);
}

async function joinQueue(user, rawStake) {
  return enqueue(async () => {
    const settings = await getSettings();
    if (settings.maintenance && !isAdminId(user.telegramId, settings)) throw fail("maintenance");
    if (user.banned) throw fail("banned");
    if (!user.language || !user.phone || !user.nationality) throw fail("need_reg");
    if (byUser.has(String(user._id))) throw fail("already_game");
    const stake = Math.round(Number(rawStake));
    if (!Number.isInteger(stake) || stake < settings.minStake || stake > settings.maxStake) {
      throw fail("stake_bad", { min: settings.minStake, max: settings.maxStake });
    }
    const fresh = await User.findById(user._id);
    if (!fresh || fresh.coins < stake) throw fail("not_enough");
    pull(user._id);
    if (!queues.has(stake)) queues.set(stake, []);
    const id = String(user._id);
    queues.get(stake).push(id);
    queueUsers.set(id, stake);
    await tryMatch(stake);
    await push(user._id);
  });
}

async function acceptOffer(user, targetId) {
  return enqueue(async () => {
    const settings = await getSettings();
    if (settings.maintenance && !isAdminId(user.telegramId, settings)) throw fail("maintenance");
    if (user.banned) throw fail("banned");
    if (!user.language || !user.phone || !user.nationality) throw fail("need_reg");
    const me = String(user._id);
    const id = String(targetId || "");
    if (!id || id === me) throw fail("offer_gone");
    if (byUser.has(me)) throw fail("already_game");
    const stake = queueUsers.get(id);
    if (stake == null || byUser.has(id)) throw fail("offer_gone");
    const fresh = await User.findById(me);
    if (!fresh || fresh.coins < stake) throw fail("not_enough");
    pull(me);
    pull(id);
    try {
      await createMatch(me, id, stake);
    } catch (err) {
      if (!byUser.has(id)) {
        const other = await User.findById(id);
        if (other && !other.banned && other.coins >= stake) {
          if (!queues.has(stake)) queues.set(stake, []);
          queues.get(stake).push(id);
          queueUsers.set(id, stake);
        }
      }
      await push(me);
      await push(id);
      throw err;
    }
  });
}

async function cancelQueue(user) {
  return enqueue(async () => {
    pull(user._id);
    await push(user._id);
  });
}

async function move(user, body) {
  const id = byUser.get(String(user._id));
  if (!id) throw fail("illegal");
  return withLock(id, async () => {
    const game = games.get(id);
    if (!game || game.status !== "active") throw fail("illegal");
    const youWhite = String(game.white) === String(user._id);
    if (!youWhite && String(game.black) !== String(user._id)) throw fail("illegal");
    const color = youWhite ? "w" : "b";
    if (game.state.turn !== color) throw fail("illegal");
    const applied = applyMove(game.state, body || {});
    if (!applied.ok) throw fail("illegal");
    game.state = applied.state;
    game.moves = game.moves || [];
    game.moves.push({
      from: applied.state.lastMove.from,
      to: applied.state.lastMove.to,
      capture: applied.state.lastMove.capture,
      at: Date.now(),
    });
    game.markModified("state");
    game.markModified("moves");
    if (applied.state.result) {
      await finish(game, applied.state.result, applied.state.reason || "no_moves");
      return;
    }
    if (!applied.state.continueFrom) {
      const settings = await getSettings();
      game.deadline = Date.now() + settings.moveSeconds * 1000;
    }
    await game.save();
    await push(game.white);
    await push(game.black);
  });
}

async function resign(user) {
  const id = byUser.get(String(user._id));
  if (!id) throw fail("illegal");
  return withLock(id, async () => {
    const game = games.get(id);
    if (!game || game.status !== "active") throw fail("illegal");
    const youWhite = String(game.white) === String(user._id);
    if (!youWhite && String(game.black) !== String(user._id)) throw fail("illegal");
    await finish(game, youWhite ? "black" : "white", "resign");
  });
}

async function ack(user) {
  finishedFor.delete(String(user._id));
  await push(user._id);
}

async function setLang(user, lang) {
  if (!["uz", "ru", "en", "ko"].includes(lang)) throw fail("error_generic");
  user.language = lang;
  await user.save();
  await push(user._id);
}

async function setNationality(user, value) {
  const text = String(value || "").trim().slice(0, 40);
  const known = ["uz", "kr", "ru", "kz", "kg", "tj"];
  if (!known.includes(text) && text.length < 2) throw fail("error_generic");
  user.nationality = text;
  user.pending = "";
  await user.save();
  await push(user._id);
}

async function loadActive() {
  const rows = await Game.find({ status: "active" });
  for (const game of rows) {
    if (!game.deadline || game.deadline < Date.now() + 20000) game.deadline = Date.now() + 20000;
    games.set(String(game._id), game);
    byUser.set(String(game.white), String(game._id));
    byUser.set(String(game.black), String(game._id));
  }
  console.log("active games", rows.length);
}

function startClock() {
  setInterval(() => {
    for (const game of games.values()) {
      if (game.status !== "active" || !game.deadline || Date.now() <= game.deadline) continue;
      const id = String(game._id);
      withLock(id, async () => {
        const current = games.get(id);
        if (!current || current.status !== "active" || Date.now() <= current.deadline) return;
        const result = current.state.turn === "w" ? "black" : "white";
        await finish(current, result, "timeout");
      }).catch((err) => console.error("timeout", err.message));
    }
  }, 1000);
}

async function adminSettle(gameId, result, countStats) {
  const id = String(gameId);
  return withLock(id, async () => {
    let game = games.get(id);
    if (!game) game = await Game.findById(id);
    if (!game || game.status !== "active") throw fail("illegal");
    games.set(id, game);
    await finish(game, result, "admin", countStats);
  });
}

async function leaderboard() {
  const filter = { banned: { $ne: true } };
  const [rows, total] = await Promise.all([
    User.find(filter).sort({ wins: -1, coins: -1 }).limit(20).select("firstName username wins losses draws coins telegramId"),
    User.countDocuments(filter),
  ]);
  return {
    total,
    items: rows.map((user, index) => ({
      n: index + 1,
      name: displayName(user),
      wins: user.wins || 0,
      losses: user.losses || 0,
      draws: user.draws || 0,
      coins: user.coins || 0,
    })),
  };
}

module.exports = {
  setNotifier,
  bind,
  unbind,
  queueSize,
  presence,
  view,
  push,
  joinQueue,
  acceptOffer,
  cancelQueue,
  move,
  resign,
  ack,
  setLang,
  setNationality,
  loadActive,
  startClock,
  adminSettle,
  leaderboard,
  publicUser,
  displayName,
};
