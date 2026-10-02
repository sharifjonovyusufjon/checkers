const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
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
  online: 0,
  people: [],
  demoOff: false,
  topTotal: 0,
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
  if (!data) return;
  if (Array.isArray(data.people)) {
    state.people = data.people;
    state.online = typeof data.online === "number" ? data.online : data.people.length;
  }
  if (!data.user) {
    render();
    return;
  }
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
    if (msg.type === "state" || msg.type === "lobby") applyState(msg);
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
      if (piece) html += `<span class="piece ${piece.color === "w" ? "white" : "black"}${piece.king ? " king" : ""}"></span>`;
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
function sampleCrowd() {
  const seekers = [
    ["Aziza", 50], ["Javohir", 100], ["Madina", 25], ["Bekzod", 200], ["Nilufar", 50],
    ["Sardor", 10], ["Dilnoza", 100], ["Jasur", 250], ["Malika", 75], ["Oybek", 500],
  ].map(([name, stake], index) => ({ id: "demo-" + index, name, stake, playing: false }));
  return { seekers, online: 20, playing: 10 };
}
function sampleBoard() {
  const rows = [
    ["Sardor", 186], ["Madina", 164], ["Javohir", 151], ["Aziza", 143], ["Bekzod", 128],
    ["Dilnoza", 119], ["Oybek", 110], ["Nilufar", 104], ["Jasur", 97], ["Malika", 91],
    ["Shahnoza", 84], ["Ulug'bek", 79], ["Kamron", 73], ["Zarina", 68], ["Abror", 62],
    ["Gulnoza", 57], ["Temur", 51], ["Mohira", 46], ["Islom", 41], ["Sevinch", 38],
  ];
  const list = rows.map((row, index) => `<div class="board-row${index < 3 ? " podium" : ""}"><span class="place">${index + 1}</span><b>${esc(row[0])}</b><em>${row[1]}</em></div>`).join("");
  return `<section class="card"><div class="offers-head"><h2>${esc(text("leaderboard"))}</h2><span>1000</span></div><div class="demo-banner"><span>${esc(text("demo_note"))}</span></div>${list}<p class="muted board-foot">${esc(text("board_of", { n: 1000 }))}</p></section>`;
}
function useDemo() {
  if (state.demoOff || state.queue != null) return false;
  if (state.game && state.game.status === "active") return false;
  const others = (state.people || []).filter((person) => person.id && person.id !== state.user?.id);
  return others.length === 0;
}
function hallHtml() {
  const demo = useDemo();
  const sample = demo ? sampleCrowd() : null;
  const people = demo ? [] : state.people || [];
  const mine = String(state.user?.id || "");
  const seekers = sample ? sample.seekers : people.filter((person) => person.stake != null);
  const idle = demo ? [] : people.filter((person) => person.stake == null && !person.playing);
  const online = sample ? sample.online : state.online || 0;
  const playingCount = sample ? sample.playing : people.filter((person) => person.playing).length;
  const offers = seekers.length
    ? seekers.map((person) => {
        const self = person.id === mine;
        const action = self
          ? `<span class="waiting">${esc(text("waiting_offer"))}</span>`
          : `<button class="accept" data-act="accept" data-id="${esc(person.id)}">${esc(text("accept"))}</button>`;
        return `<article class="offer"><div class="who"><b>${esc(person.name)}</b></div><div class="pot"><strong>${person.stake}</strong><span>${esc(text("coins_word"))}</span></div>${action}</article>`;
      }).join("")
    : `<p class="muted">${esc(text("no_offers"))}</p>`;
  const rest = idle.length ? `<div class="idle">${idle.map((person) => `<span>${esc(person.name)} <b>${person.coins}</b></span>`).join("")}</div>` : "";
  const banner = demo
    ? `<div class="demo-banner"><span>${esc(text("demo_note"))}</span><button type="button" data-act="demo-off">${esc(text("demo_off"))}</button></div>`
    : seekers.length
      ? ""
      : `<button class="ghost demo-open" data-act="demo-on">${esc(text("demo_on"))}</button>`;
  return `<section class="card hall">${banner}<div class="pulse"><div><b>${online}</b><span>${esc(text("online"))}</span></div><div><b>${seekers.length}</b><span>${esc(text("searching_n"))}</span></div><div><b>${playingCount}</b><span>${esc(text("playing_n"))}</span></div></div><h2>${esc(text("searching_n"))}</h2>${offers}${rest}</section>`;
}
function lobby() {
  const user = state.user;
  const rules = state.rules || { minStake: 10, maxStake: 1000, packages: [] };
  const presets = [10, 25, 50, 100, 250].filter((n) => n >= rules.minStake && n <= rules.maxStake);
  if (state.tab === "top") {
    if (useDemo()) return sampleBoard();
    const total = state.topTotal || state.top.length;
    const rows = state.top.length
      ? state.top.map((row) => `<div class="board-row${row.n <= 3 ? " podium" : ""}"><span class="place">${row.n}</span><b>${esc(row.name)}</b><em>${row.wins}</em></div>`).join("")
      : `<p class="muted">${esc(text("empty_top"))}</p>`;
    const foot = total > state.top.length ? `<p class="muted board-foot">${esc(text("board_of", { n: total }))}</p>` : "";
    return `<section class="card"><div class="offers-head"><h2>${esc(text("leaderboard"))}</h2><span>${total}</span></div>${rows}${foot}</section>`;
  }
  if (state.tab === "profile") {
    return `<section class="card">
      <h2>${esc(text("profile"))}</h2>
      <div class="list">
        <div><span>${esc(text("username"))}</span><b>@${esc(user.username || "—")}</b></div>
        <div><span>${esc(text("phone"))}</span><b>${esc(user.phone || "—")}</b></div>
        <div><span>${esc(text("nationality"))}</span><b>${esc(user.nationalityLabel || "—")}</b></div>
      </div>
      <div class="choices">
        ${["uz", "ru", "en", "ko"].map((lang) => `<button class="chip ${state.lang === lang ? "on" : ""}" data-act="lang" data-lang="${lang}">${lang.toUpperCase()}</button>`).join("")}
      </div>
      <div class="packages">
        ${(rules.packages || []).map((pack) => `<button class="pack" data-act="buy" data-id="${esc(pack.id)}"><span><b>${pack.coins}</b><small>${esc(text("coins_word"))}</small></span><span class="price"><b>${pack.stars}</b><svg class="star" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.6 12.4 6.7l5.5.6-4.1 3.6 1.2 5.3L10 13.5 5 16.2l1.2-5.3L2.1 7.3l5.5-.6L10 1.6z"/></svg></span></button>`).join("")}
      </div>
    </section>`;
  }
  const chips = presets.map((n) => `<button class="chip ${!state.custom && state.stake === n ? "on" : ""}" data-act="stake" data-stake="${n}">${n}</button>`).join("");
  return `<section class="play">
    <div class="seg">${chips}<button class="chip ${state.custom ? "on" : ""}" data-act="custom">${esc(text("custom"))}</button></div>
    ${state.custom ? `<p><input id="custom-stake" type="number" min="${rules.minStake}" max="${rules.maxStake}" value="${state.stake}"></p>` : ""}
    <button class="btn" data-act="find">${esc(text("find"))}</button>
    ${state.toast ? `<p class="toast">${esc(state.toast)}</p>` : ""}
  </section>`;
}
function themeButton() {
  return `<button class="icon" data-act="theme" aria-label="theme"></button>`;
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("checkers-theme", theme);
  const bg = theme === "dark" ? "#070d1a" : "#eef3f8";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = bg;
  try {
    tg && tg.setHeaderColor && tg.setHeaderColor(bg);
    tg && tg.setBackgroundColor && tg.setBackgroundColor(bg);
  } catch (err) {}
}
function setupHtml(user) {
  const head = `<div class="bar"><div class="brand"><span class="mark"></span><strong>${esc(text("play_title"))}</strong></div>${themeButton()}</div>`;
  if (!user.language) {
    return `<section class="setup">${head}<h1>${esc(text("choose_lang"))}</h1><div class="choices">${["uz", "ru", "en", "ko"].map((lang) => `<button class="chip" data-act="lang" data-lang="${lang}">${({ uz: "O‘zbek", ru: "Русский", en: "English", ko: "한국어" })[lang]}</button>`).join("")}</div></section>`;
  }
  if (!user.phone) {
    return `<section class="setup">${head}<h1>${esc(text("ask_phone_btn"))}</h1><p class="muted">${esc(text("ask_phone"))}</p><button class="btn" data-act="phone">${esc(text("ask_phone_btn"))}</button>${state.toast ? `<p class="toast">${esc(state.toast)}</p>` : ""}</section>`;
  }
  const codes = ["uz", "kr", "ru", "kz", "kg", "tj"];
  return `<section class="setup">${head}<h1>${esc(text("ask_nationality"))}</h1><div class="choices">${codes.map((code) => `<button class="chip" data-act="nat" data-nat="${code}">${esc(text("nat_" + code))}</button>`).join("")}</div><input id="nat-custom" type="text" maxlength="40" placeholder="${esc(text("nat_other"))}"><button class="btn" data-act="nat-custom">${esc(text("nat_other_btn"))}</button></section>`;
}
let lastHtml = "";
let scrollTab = "";
function lockMenu(on) {
  document.documentElement.classList.toggle("lock", on);
}
function paint(html) {
  if (html === lastHtml) return;
  const pane = document.querySelector(".scroll");
  const keep = scrollTab === state.tab && pane;
  const top = keep ? pane.scrollTop : 0;
  scrollTab = state.tab;
  lastHtml = html;
  app.innerHTML = html;
  const next = document.querySelector(".scroll");
  if (next) next.scrollTop = top;
}
function render() {
  if (!initData) {
    lockMenu(false);
    const bot = state.meta.gameBot ? `https://t.me/${state.meta.gameBot}` : "#";
    paint(`<section class="gate"><div class="bar"><div class="brand"><span class="mark"></span><strong>${esc(text("play_title"))}</strong></div>${themeButton()}</div><h1>${esc(text("need_telegram"))}</h1><a class="btn" style="display:block;text-align:center;text-decoration:none" href="${bot}">${esc(text("open_telegram"))}</a></section>`);
    return;
  }
  if (!state.user) {
    lockMenu(false);
    paint(`<section class="gate"><h1>${esc(text("play_title"))}</h1></section>`);
    return;
  }
  const user = state.user;
  if (!user.ready) {
    lockMenu(false);
    paint(setupHtml(user));
    return;
  }
  const head = `<header class="bar"><div class="brand"><span class="mark"></span><div><strong>${esc(text("play_title"))}</strong><span>${user.wins} · ${user.losses} · ${user.draws}</span></div></div><div class="bar-actions"><span class="coin">${user.coins}</span>${themeButton()}</div></header>`;
  if (state.queue != null && (!state.game || state.game.status !== "active")) {
    lockMenu(false);
    paint(`${head}<section class="card"><p>${esc(text("searching", { stake: state.queue }))}</p><button class="btn" data-act="cancel">${esc(text("cancel"))}</button></section>${hallHtml()}`);
    return;
  }
  if (state.game && (state.game.status === "active" || state.game.status === "finished")) {
    lockMenu(false);
    const game = state.game;
    const who = names(game);
    const side = game.yourColor === "w" ? text("you_white") : text("you_black");
    const turn = game.status === "active" ? (game.youToMove ? text("your_turn") : text("opp_turn")) : "";
    let modal = "";
    if (game.status === "finished") {
      const title = game.result === "draw" ? text("draw_result") : ((game.result === "white" && game.yourColor === "w") || (game.result === "black" && game.yourColor === "b") ? text("won") : text("lost"));
      modal = `<div class="modal"><div class="sheet"><h2>${esc(title)}</h2><p class="muted">${esc(text("stake"))} ${game.stake}</p><button class="btn" data-act="ack">${esc(text("lobby"))}</button><button class="ghost" data-act="rematch">${esc(text("rematch"))}</button></div></div>`;
    } else if (state.confirm) {
      modal = `<div class="modal"><div class="sheet"><h2>${esc(text("resign"))}</h2><p>${esc(text("confirm_resign"))}</p><button class="btn" data-act="resign-yes">${esc(text("yes"))}</button><button class="ghost" data-act="resign-no">${esc(text("no"))}</button></div></div>`;
    }
    const oppPip = game.yourColor === "w" ? "b" : "w";
    paint(`${head}<section class="table"><div class="seat"><span class="pip ${oppPip}"></span><b>${esc(who.opp)}</b><span class="clock" data-timer></span></div><div class="frame">${boardHtml(game)}</div><div class="seat"><span class="pip ${game.yourColor}"></span><b>${esc(who.you)}</b><span class="muted">${esc(side)} · ${game.stake}</span><button class="ghost" data-act="resign">${esc(text("resign"))}</button></div><p class="status ${game.youToMove ? "youturn" : "wait"}">${esc(turn)}</p>${state.toast ? `<p class="toast">${esc(state.toast)}</p>` : ""}${modal}</section>`);
    tick();
    return;
  }
  lockMenu(true);
  paint(`<div class="chrome">${head}<nav class="dock"><button class="${state.tab === "play" ? "on" : ""}" data-act="tab" data-tab="play">${esc(text("find"))}</button><button class="${state.tab === "top" ? "on" : ""}" data-act="tab" data-tab="top">${esc(text("leaderboard"))}</button><button class="${state.tab === "profile" ? "on" : ""}" data-act="tab" data-tab="profile">${esc(text("profile"))}</button></nav></div><div class="scroll">${state.tab === "play" ? hallHtml() : ""}${lobby()}</div>`);
}
function tick() {
  const el = document.querySelector("[data-timer]");
  if (!el || !state.game || state.game.status !== "active") return;
  const left = Math.max(0, Math.ceil((state.game.deadline - Date.now()) / 1000));
  el.textContent = `${left}s`;
}
setInterval(tick, 500);
app.addEventListener("click", async (ev) => {
  const square = ev.target.closest(".sq");
  if (square) return onSquare(Number(square.dataset.r), Number(square.dataset.c));
  const node = ev.target.closest("[data-act]");
  if (!node) return;
  const act = node.dataset.act;
  if (act === "theme") {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    render();
    return;
  }
  if (act === "phone") {
    if (!tg || !tg.requestContact) {
      state.toast = text("need_telegram");
      render();
      return;
    }
    tg.requestContact((ok) => {
      if (!ok) return;
      const timer = setInterval(async () => {
        try {
          const data = await call("/api/state");
          applyState(data);
          if (data.user && data.user.phone) clearInterval(timer);
        } catch (err) {}
      }, 1000);
      setTimeout(() => clearInterval(timer), 20000);
    });
    return;
  }
  if (act === "nat") {
    send("nationality", { nationality: node.dataset.nat });
    return;
  }
  if (act === "nat-custom") {
    const input = document.getElementById("nat-custom");
    send("nationality", { nationality: input ? input.value : "" });
    return;
  }
  if (act === "stake") {
    state.custom = false;
    state.stake = Number(node.dataset.stake);
    state.toast = "";
    render();
  } else if (act === "custom") {
    state.custom = true;
    render();
  } else if (act === "demo-off") {
    state.demoOff = true;
    render();
  } else if (act === "demo-on") {
    state.demoOff = false;
    render();
  } else if (act === "accept") {
    if (String(node.dataset.id || "").startsWith("demo-")) {
      state.toast = text("demo_note");
      render();
      return;
    }
    state.toast = "";
    send("accept", { id: node.dataset.id });
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
      try {
        const board = await call("/api/leaderboard");
        state.top = board.items || [];
        state.topTotal = board.total || state.top.length;
      } catch (err) {
        state.top = [];
        state.topTotal = 0;
      }
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
  setTheme(document.documentElement.dataset.theme || "light");
  render();
  if (!initData) return;
  connect();
  try { applyState(await call("/api/state")); } catch (err) { state.toast = err.message || ""; render(); }
}
boot();
