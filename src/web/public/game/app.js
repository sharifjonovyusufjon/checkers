const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor("#16352a");
    tg.setBackgroundColor("#16352a");
  } catch (err) {}
}
const initData = (tg && tg.initData) || "";
const app = document.getElementById("app");
const state = {
  user: null,
  game: null,
  queue: null,
  rules: null,
  strings: {},
  meta: {},
  selected: null,
  stake: 50,
  custom: false,
  toast: "",
  confirm: false,
  tab: "play",
  top: [],
  lang: "uz",
};

function text(key, vars) {
  let value = state.strings[key] || key;
  if (vars) {
    for (const [name, item] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(item));
  }
  return value;
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
async function loadStrings(lang) {
  const res = await fetch(`/api/i18n/${lang || "uz"}`);
  state.strings = await res.json();
  state.lang = lang || "uz";
}
async function call(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Init-Data": initData },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}
function applyState(data) {
  if (!data || !data.user) return;
  const nextLang = data.user.language || "uz";
  state.user = data.user;
  state.game = data.game;
  state.queue = data.queue;
  state.rules = data.rules;
  if (state.rules && (state.stake < state.rules.minStake || state.stake > state.rules.maxStake)) state.stake = state.rules.minStake;
  if (nextLang !== state.lang) loadStrings(nextLang).then(render);
  render();
}
let socket;
function connect() {
  if (!initData) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ type: "auth", initData }));
  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "state") applyState(msg);
    if (msg.type === "error") {
      state.toast = msg.message || msg.error || "";
      render();
    }
  };
  socket.onclose = () => setTimeout(connect, 1500);
}
function send(type, extra) {
  const payload = { type, ...extra };
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
    return;
  }
  call("/api/action", payload).then(applyState).catch((err) => {
    state.toast = err.message || text(err.error || "error_generic");
    render();
  });
}
function names(game) {
  const you = game.yourColor === "w" ? game.whiteName : game.blackName;
  const opp = game.yourColor === "w" ? game.blackName : game.whiteName;
  return { you, opp };
}
function boardHtml(game) {
  const order = game.yourColor === "b" ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const legal = game.legal || [];
  let html = '<div class="board">';
  for (const r of order) {
    for (const c of order) {
      const piece = game.board[r][c];
      const selected = state.selected && state.selected[0] === r && state.selected[1] === c;
      const dest = state.selected && legal.some((move) => move.from[0] === state.selected[0] && move.from[1] === state.selected[1] && move.to[0] === r && move.to[1] === c);
      const last = game.lastMove && ((game.lastMove.from[0] === r && game.lastMove.from[1] === c) || (game.lastMove.to[0] === r && game.lastMove.to[1] === c));
      html += `<button type="button" class="sq ${(r + c) % 2 ? "dark" : "light"} ${selected ? "sel" : ""} ${dest ? "dest" : ""} ${last ? "last" : ""}" data-r="${r}" data-c="${c}">`;
      if (piece) html += `<span class="piece ${piece.color === "w" ? "white" : "black"}">${piece.king ? "♛" : ""}</span>`;
      html += "</button>";
    }
  }
  return html + "</div>";
}
function onSquare(r, c) {
  const game = state.game;
  if (!game || game.status !== "active" || !game.youToMove) return;
  const legal = game.legal || [];
  if (state.selected) {
    const move = legal.find((item) => item.from[0] === state.selected[0] && item.from[1] === state.selected[1] && item.to[0] === r && item.to[1] === c);
    if (move) {
      send("move", { from: move.from, to: move.to, capture: move.capture });
      state.selected = null;
      tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred("light");
      return;
    }
  }
  state.selected = legal.some((item) => item.from[0] === r && item.from[1] === c) ? [r, c] : null;
  render();
}
function lobby() {
  const user = state.user;
  const rules = state.rules || { minStake: 10, maxStake: 1000, packages: [] };
  const presets = [10, 25, 50, 100, 250].filter((n) => n >= rules.minStake && n <= rules.maxStake);
  if (state.tab === "top") {
    const rows = state.top.length
      ? state.top.map((row) => `<div><span>${row.n}. ${esc(row.name)}</span><b>${row.wins}</b></div>`).join("")
      : `<p class="muted">${esc(text("empty_top"))}</p>`;
    return `<section class="card" style="padding:14px"><h2>${esc(text("leaderboard"))}</h2><div class="list">${rows}</div></section>`;
  }
  if (state.tab === "profile") {
    return `<section class="card" style="padding:14px">
      <h2>${esc(text("profile"))}</h2>
      <div class="list">
        <div><span>${esc(text("username"))}</span><b>@${esc(user.username || "—")}</b></div>
        <div><span>${esc(text("phone"))}</span><b>${esc(user.phone || "—")}</b></div>
        <div><span>${esc(text("nationality"))}</span><b>${esc(user.nationalityLabel || "—")}</b></div>
      </div>
      <div class="lang" style="margin-top:12px">
        ${["uz", "ru", "en", "ko"].map((lang) => `<button class="chip ${state.lang === lang ? "on" : ""}" data-act="lang" data-lang="${lang}">${lang.toUpperCase()}</button>`).join("")}
      </div>
      <div class="packages">
        ${(rules.packages || []).map((pack) => `<button class="btn" data-act="buy" data-id="${esc(pack.id)}">${pack.coins} · ${pack.stars} ⭐</button>`).join("")}
      </div>
    </section>`;
  }
  const chips = presets.map((n) => `<button class="chip ${!state.custom && state.stake === n ? "on" : ""}" data-act="stake" data-stake="${n}">${n}</button>`).join("");
  return `<section>
    <div class="stakes">${chips}<button class="chip ${state.custom ? "on" : ""}" data-act="custom">${esc(text("custom"))}</button></div>
    ${state.custom ? `<p><input id="custom-stake" type="number" min="${rules.minStake}" max="${rules.maxStake}" value="${state.stake}"></p>` : ""}
    <button class="btn" data-act="find">${esc(text("find"))}</button>
    ${state.toast ? `<p class="toast">${esc(state.toast)}</p>` : ""}
  </section>`;
}
function render() {
  if (!initData) {
    const bot = state.meta.gameBot ? `https://t.me/${state.meta.gameBot}` : "#";
    app.innerHTML = `<section class="gate"><h1>${esc(text("play_title"))}</h1><p>${esc(text("need_telegram"))}</p><a class="btn" style="display:block;text-align:center;text-decoration:none" href="${bot}">${esc(text("open_telegram"))}</a></section>`;
    return;
  }
  if (!state.user) {
    app.innerHTML = `<section class="gate"><h1>${esc(text("play_title"))}</h1></section>`;
    return;
  }
  const user = state.user;
  if (!user.ready) {
    const bot = state.meta.gameBot ? `https://t.me/${state.meta.gameBot}` : "#";
    app.innerHTML = `<section class="gate"><h1>${esc(text("play_title"))}</h1><p>${esc(text("not_ready"))}</p><a class="btn" style="display:block;text-align:center;text-decoration:none" href="${bot}">${esc(text("open_telegram"))}</a></section>`;
    return;
  }
  const head = `<header class="top"><div><h1>${esc(text("play_title"))}</h1></div><div class="coins"><b>${user.coins}</b><span>${esc(text("coins_word"))}</span></div></header>
    <div class="stats"><div><span>${esc(text("wins"))}</span><b>${user.wins}</b></div><div><span>${esc(text("losses"))}</span><b>${user.losses}</b></div><div><span>${esc(text("draws"))}</span><b>${user.draws}</b></div></div>`;
  if (state.queue != null && (!state.game || state.game.status !== "active")) {
    app.innerHTML = `${head}<section class="card" style="padding:16px"><p>${esc(text("searching", { stake: state.queue }))}</p><button class="btn" data-act="cancel">${esc(text("cancel"))}</button></section>`;
    return;
  }
  if (state.game && (state.game.status === "active" || state.game.status === "finished")) {
    const game = state.game;
    const who = names(game);
    const side = game.yourColor === "w" ? text("you_white") : text("you_black");
    const turn = game.status === "active" ? (game.youToMove ? text("your_turn") : text("opp_turn")) : "";
    let modal = "";
    if (game.status === "finished") {
      const title = game.result === "draw" ? text("draw_result") : ((game.result === "white" && game.yourColor === "w") || (game.result === "black" && game.yourColor === "b") ? text("won") : text("lost"));
      modal = `<div class="modal"><div class="panel"><h2>${esc(title)}</h2><p>${esc(text("stake"))}: ${game.stake}</p><button class="btn" data-act="ack">${esc(text("lobby"))}</button><button class="ghost" data-act="rematch" style="margin-top:8px">${esc(text("rematch"))}</button></div></div>`;
    } else if (state.confirm) {
      modal = `<div class="modal"><div class="panel"><h2>${esc(text("resign"))}</h2><p>${esc(text("confirm_resign"))}</p><button class="btn" data-act="resign-yes">${esc(text("yes"))}</button><button class="ghost" data-act="resign-no" style="margin-top:8px">${esc(text("no"))}</button></div></div>`;
    }
    app.innerHTML = `${head}<section class="board-wrap"><div class="who"><div><b>${esc(who.opp)}</b><div class="muted">${esc(text("opponent"))}</div></div><div class="timer" data-timer></div></div>${boardHtml(game)}<div class="who" style="margin-top:8px"><div><b>${esc(who.you)}</b><div class="muted">${esc(side)} · ${esc(text("stake"))} ${game.stake}</div></div><button class="ghost" data-act="resign">${esc(text("resign"))}</button></div><p class="turn">${esc(turn)}</p>${state.toast ? `<p class="toast">${esc(state.toast)}</p>` : ""}${modal}</section>`;
    tick();
    return;
  }
  app.innerHTML = `${head}<nav class="tabs"><button class="${state.tab === "play" ? "on" : ""}" data-act="tab" data-tab="play">${esc(text("menu_play") === "menu_play" ? text("find") : text("play_title"))}</button><button class="${state.tab === "top" ? "on" : ""}" data-act="tab" data-tab="top">${esc(text("leaderboard"))}</button><button class="${state.tab === "profile" ? "on" : ""}" data-act="tab" data-tab="profile">${esc(text("profile"))}</button></nav>${lobby()}`;
}
function tick() {
  const el = document.querySelector("[data-timer]");
  if (!el || !state.game || state.game.status !== "active") return;
  const left = Math.max(0, Math.ceil((state.game.deadline - Date.now()) / 1000));
  el.textContent = `${left}s`;
}
setInterval(tick, 250);
app.addEventListener("click", async (ev) => {
  const square = ev.target.closest(".sq");
  if (square) return onSquare(Number(square.dataset.r), Number(square.dataset.c));
  const node = ev.target.closest("[data-act]");
  if (!node) return;
  const act = node.dataset.act;
  if (act === "stake") {
    state.custom = false;
    state.stake = Number(node.dataset.stake);
    state.toast = "";
    render();
  } else if (act === "custom") {
    state.custom = true;
    render();
  } else if (act === "find") {
    const input = document.getElementById("custom-stake");
    if (input) state.stake = Number(input.value);
    state.toast = "";
    send("queue", { stake: state.stake });
  } else if (act === "cancel") send("cancel");
  else if (act === "resign") {
    state.confirm = true;
    render();
  } else if (act === "resign-no") {
    state.confirm = false;
    render();
  } else if (act === "resign-yes") {
    state.confirm = false;
    send("resign");
  } else if (act === "ack") send("ack");
  else if (act === "rematch") {
    const stake = state.game ? state.game.stake : state.stake;
    send("ack");
    setTimeout(() => send("queue", { stake }), 250);
  } else if (act === "tab") {
    state.tab = node.dataset.tab;
    state.toast = "";
    if (state.tab === "top") {
      try { state.top = (await call("/api/leaderboard")).items || []; } catch (err) { state.top = []; }
    }
    render();
  } else if (act === "lang") send("lang", { lang: node.dataset.lang });
  else if (act === "buy") {
    try {
      const invoice = await call("/api/invoice", { packageId: node.dataset.id });
      if (tg && tg.openInvoice) tg.openInvoice(invoice.link, () => call("/api/state").then(applyState));
      else state.toast = text("buy_coins");
    } catch (err) {
      state.toast = err.message || text("error_generic");
    }
    render();
  }
});
async function boot() {
  try { state.meta = await fetch("/api/meta").then((res) => res.json()); } catch (err) { state.meta = {}; }
  await loadStrings("uz");
  render();
  if (!initData) return;
  connect();
  try { applyState(await call("/api/state")); } catch (err) { state.toast = err.message || ""; render(); }
}
boot();
