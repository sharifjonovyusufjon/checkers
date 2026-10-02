const app = document.getElementById("app");
const state = {
  authed: false,
  lang: localStorage.getItem("admin-lang") || "uz",
  strings: {},
  page: location.hash.replace("#/", "") || "dash",
  meta: {},
  data: null,
  q: "",
  listPage: 1,
  edit: null,
  toast: "",
  form: null,
};

function text(key, vars) {
  let value = state.strings[key] || key;
  if (vars) for (const [name, item] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(item));
  return value;
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
async function loadStrings() {
  state.strings = await fetch(`/api/i18n/${state.lang}`).then((res) => res.json());
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    state.authed = false;
    render();
    throw data;
  }
  if (!res.ok) throw data;
  return data;
}
function shell(body) {
  const items = [
    ["dash", "a_dashboard"],
    ["users", "a_users"],
    ["games", "a_games"],
    ["payments", "a_payments"],
    ["settings", "a_settings"],
    ["broadcast", "a_broadcast"],
    ["journal", "a_journal"],
  ];
  const dark = document.documentElement.dataset.theme === "dark";
  return `<div class="shell"><nav><h1>Checkers</h1>${items.map(([id, key]) => `<button class="${state.page === id ? "on" : ""}" data-go="${id}">${esc(text(key))}</button>`).join("")}<button data-act="theme">${dark ? "Light" : "Dark"}</button><button data-act="logout">${esc(text("a_logout"))}</button><div class="langs">${["uz", "ru", "en", "ko"].map((lang) => `<button class="${state.lang === lang ? "on" : ""}" data-lang="${lang}">${lang}</button>`).join("")}</div></nav><main>${body}</main></div>`;
}
function login() {
  const dark = document.documentElement.dataset.theme === "dark";
  const bot = state.meta.adminBot ? `https://t.me/${state.meta.adminBot}` : "#";
  app.innerHTML = `<section class="login"><form class="card" id="login-form"><h1>${esc(text("a_login"))}</h1><p>${esc(text("a_help"))}</p><p><a href="${bot}" target="_blank" rel="noreferrer">${esc(text("a_open_bot"))}</a></p><label>${esc(text("a_code"))}<br><input name="code" inputmode="numeric" maxlength="6" required></label><div class="toolbar"><button class="btn" type="submit">${esc(text("a_enter"))}</button></div>${state.toast ? `<p class="err">${esc(state.toast)}</p>` : ""}<div class="langs">${["uz", "ru", "en", "ko"].map((lang) => `<button type="button" data-lang="${lang}">${lang}</button>`).join("")}<button type="button" data-act="theme">${dark ? "Light" : "Dark"}</button></div></form></section>`;
}
function table(headers, rows) {
  return `<div class="box" style="overflow:auto"><table><thead><tr>${headers.map((item) => `<th>${esc(item)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">${esc(text("a_empty"))}</td></tr>`}</tbody></table></div>`;
}
function pager(total) {
  const pages = Math.max(1, Math.ceil(total / 20));
  return `<div class="toolbar"><button class="ghost" data-act="prev">${esc(text("a_prev"))}</button><span>${state.listPage} / ${pages}</span><button class="ghost" data-act="next" data-pages="${pages}">${esc(text("a_next"))}</button></div>`;
}
async function show() {
  state.toast = "";
  if (state.page === "dash") {
    state.data = await api("/api/admin/stats");
  } else if (state.page === "users") {
    state.data = await api(`/api/admin/users?page=${state.listPage}&q=${encodeURIComponent(state.q)}`);
  } else if (state.page === "games") {
    state.data = await api(`/api/admin/games?page=${state.listPage}`);
  } else if (state.page === "payments") {
    state.data = await api(`/api/admin/payments?page=${state.listPage}`);
  } else if (state.page === "settings") {
    state.form = await api("/api/admin/settings");
  } else if (state.page === "journal") {
    state.data = await api("/api/admin/journal");
  }
  render();
}
function render() {
  if (!state.authed) return login();
  let body = "";
  if (state.page === "dash" && state.data) {
    const d = state.data;
    const cards = [
      ["a_users_n", d.users],
      ["a_active", d.active],
      ["a_today", d.today],
      ["a_circulation", d.coins],
      ["a_revenue", d.stars],
      ["a_online", d.online || 0],
      ["a_queue", d.queue],
      ["a_star_balance", d.starBalance ?? "—"],
    ];
    const people = d.people || [];
    const seekers = people.filter((person) => person.stake != null);
    const seekerRows = seekers.map((person) => `<tr><td>${esc(person.telegramId || "—")}</td><td>${esc(person.name)}</td><td>${person.stake}</td><td>${person.coins}</td></tr>`).join("");
    const onlineRows = people.map((person) => `<tr><td>${esc(person.telegramId || "—")}</td><td>${esc(person.name)}</td><td>${person.stake == null ? "—" : person.stake}</td><td>${person.coins}</td></tr>`).join("");
    body = `<h2>${esc(text("a_dashboard"))}</h2><div class="grid">${cards.map(([key, value]) => `<div class="stat"><span>${esc(text(key))}</span><b>${esc(value)}</b></div>`).join("")}</div><h3>${esc(text("a_seekers"))}</h3>${table(["Telegram", text("a_name"), text("a_stake"), text("a_coins")], seekerRows)}<h3>${esc(text("a_online"))}</h3>${table(["Telegram", text("a_name"), text("a_stake"), text("a_coins")], onlineRows)}`;
  } else if (state.page === "users" && state.data) {
    const rows = state.data.items.map((user) => `<tr><td>${esc(user.telegramId)}</td><td>${esc(user.firstName)} ${esc(user.lastName)}<br>@${esc(user.username || "—")}</td><td>${esc(user.phone || "—")}<br>${esc(user.nationality || "—")}</td><td>${user.coins}</td><td>${user.wins}/${user.losses}/${user.draws}</td><td>${user.banned ? esc(text("a_banned")) : user.language || "—"}</td><td><button class="ghost" data-edit="${user._id}">${esc(text("a_edit"))}</button></td></tr>`).join("");
    body = `<h2>${esc(text("a_users"))}</h2><form class="toolbar" id="search"><input name="q" value="${esc(state.q)}" placeholder="${esc(text("a_search"))}"><button class="btn">${esc(text("a_search"))}</button></form>${table(["ID", text("a_name"), text("a_phone"), text("a_coins"), "W/L/D", text("a_status"), ""], rows)}${pager(state.data.total)}`;
  } else if (state.page === "games" && state.data) {
    const rows = state.data.items.map((game) => `<tr><td>${esc(game.whiteName)} / ${esc(game.blackName)}</td><td>${game.stake}</td><td>${esc(game.status)} ${esc(game.result || "")}</td><td>${esc(game.reason || "")}</td><td>${esc(new Date(game.createdAt).toLocaleString())}</td><td>${game.status === "active" ? `<button class="ghost" data-settle="refund" data-id="${game._id}">${esc(text("a_cancel"))}</button> <button class="ghost" data-settle="white" data-id="${game._id}">${esc(text("a_award_w"))}</button> <button class="ghost" data-settle="black" data-id="${game._id}">${esc(text("a_award_b"))}</button>` : ""}</td></tr>`).join("");
    body = `<h2>${esc(text("a_games"))}</h2>${table([text("a_name"), text("a_stake"), text("a_status"), text("a_result"), text("a_created"), ""], rows)}${pager(state.data.total)}`;
  } else if (state.page === "payments" && state.data) {
    const rows = state.data.items.map((pay) => `<tr><td>${esc(pay.telegramId)}</td><td>${pay.coins}</td><td>${pay.stars}</td><td>${esc(pay.chargeId)}</td><td>${esc(new Date(pay.createdAt).toLocaleString())}</td></tr>`).join("");
    body = `<h2>${esc(text("a_payments"))}</h2>${table(["Telegram", text("a_coins"), text("a_stars"), "ID", text("a_created")], rows)}${pager(state.data.total)}`;
  } else if (state.page === "settings" && state.form) {
    const form = state.form;
    const packs = (form.packages || []).map((pack, index) => `<div class="toolbar"><input data-pack="id" data-i="${index}" value="${esc(pack.id)}"><input data-pack="coins" data-i="${index}" type="number" value="${pack.coins}"><input data-pack="stars" data-i="${index}" type="number" value="${pack.stars}"><button type="button" class="ghost" data-remove="${index}">${esc(text("a_remove"))}</button></div>`).join("");
    body = `<h2>${esc(text("a_settings"))}</h2><form id="settings" class="box">
      <div class="toolbar"><label>${esc(text("a_welcome"))}<br><input name="welcomeCoins" type="number" value="${form.welcomeCoins}"></label>
      <label>${esc(text("a_min"))}<br><input name="minStake" type="number" value="${form.minStake}"></label>
      <label>${esc(text("a_max"))}<br><input name="maxStake" type="number" value="${form.maxStake}"></label>
      <label>${esc(text("a_seconds"))}<br><input name="moveSeconds" type="number" value="${form.moveSeconds}"></label></div>
      <label><input name="maintenance" type="checkbox" ${form.maintenance ? "checked" : ""}> ${esc(text("a_maintenance"))}</label>
      <p><label>${esc(text("a_admin_ids"))}<br><input name="adminIds" value="${esc((form.adminIds || []).join(", "))}" style="width:min(520px,100%)"></label></p>
      <h3>${esc(text("a_packages"))}</h3>${packs}
      <div class="toolbar"><button type="button" class="ghost" data-act="add-pack">${esc(text("a_add"))}</button><button class="btn" type="submit">${esc(text("a_save"))}</button></div>
      ${state.toast ? `<p>${esc(state.toast)}</p>` : ""}
    </form>`;
  } else if (state.page === "broadcast") {
    body = `<h2>${esc(text("a_broadcast"))}</h2><form id="broadcast" class="box"><label>${esc(text("a_lang"))}<br><select name="lang"><option value="all">${esc(text("a_all"))}</option><option>uz</option><option>ru</option><option>en</option><option>ko</option></select></label><p><textarea name="text" placeholder="${esc(text("a_message"))}"></textarea></p><button class="btn" type="submit">${esc(text("a_send"))}</button>${state.toast ? `<p>${esc(state.toast)}</p>` : ""}</form>`;
  } else if (state.page === "journal" && state.data) {
    const rows = state.data.items.map((item) => `<tr><td>${esc(new Date(item.createdAt).toLocaleString())}</td><td>${esc(item.adminTelegramId)}</td><td>${esc(item.action)}</td><td>${esc(JSON.stringify(item.meta || {}))}</td></tr>`).join("");
    body = `<h2>${esc(text("a_journal"))}</h2>${table([text("a_created"), "Admin", text("a_status"), ""], rows)}`;
  } else body = `<p>${esc(text("a_empty"))}</p>`;
  let modal = "";
  if (state.edit) {
    const user = state.edit.user;
    modal = `<div class="modal"><form class="card" id="edit-user"><h2>${esc(user.firstName || user.telegramId)}</h2>
      <div class="toolbar"><label>${esc(text("a_coins"))}<br><input name="coins" type="number" value="${user.coins}"></label>
      <label>${esc(text("a_wins"))}<br><input name="wins" type="number" value="${user.wins}"></label>
      <label>${esc(text("a_losses"))}<br><input name="losses" type="number" value="${user.losses}"></label>
      <label>${esc(text("a_draws"))}<br><input name="draws" type="number" value="${user.draws}"></label></div>
      <label><input name="banned" type="checkbox" ${user.banned ? "checked" : ""}> ${esc(text("a_banned"))}</label>
      <div class="list">${(state.edit.games || []).map((game) => `<div>${esc(game.whiteName)} / ${esc(game.blackName)} · ${game.stake} · ${esc(game.result || game.status)}</div>`).join("")}</div>
      <div class="toolbar"><button class="btn" type="submit">${esc(text("a_save"))}</button><button class="ghost" type="button" data-act="close">${esc(text("a_close"))}</button></div></form></div>`;
  }
  app.innerHTML = shell(body) + modal;
}
app.addEventListener("click", async (ev) => {
  if (ev.target.closest("[data-act='theme']")) {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("checkers-theme", next);
    render();
    return;
  }
  const lang = ev.target.closest("[data-lang]");
  if (lang) {
    state.lang = lang.dataset.lang;
    localStorage.setItem("admin-lang", state.lang);
    await loadStrings();
    render();
    return;
  }
  const go = ev.target.closest("[data-go]");
  if (go) {
    state.page = go.dataset.go;
    state.listPage = 1;
    state.edit = null;
    location.hash = "#/" + state.page;
    await show();
    return;
  }
  if (ev.target.closest("[data-act='logout']")) {
    await api("/api/admin/logout", { method: "POST", body: {} });
    state.authed = false;
    render();
    return;
  }
  if (ev.target.closest("[data-act='close']")) {
    state.edit = null;
    render();
    return;
  }
  if (ev.target.closest("[data-act='prev']") && state.listPage > 1) {
    state.listPage -= 1;
    await show();
    return;
  }
  const next = ev.target.closest("[data-act='next']");
  if (next && state.listPage < Number(next.dataset.pages || 1)) {
    state.listPage += 1;
    await show();
    return;
  }
  const edit = ev.target.closest("[data-edit]");
  if (edit) {
    state.edit = await api("/api/admin/users/" + edit.dataset.edit);
    render();
    return;
  }
  const settle = ev.target.closest("[data-settle]");
  if (settle) {
    await api(`/api/admin/games/${settle.dataset.id}/settle`, { method: "POST", body: { mode: settle.dataset.settle } });
    await show();
    return;
  }
  if (ev.target.closest("[data-act='add-pack']")) {
    state.form.packages.push({ id: "c" + Date.now(), coins: 100, stars: 20 });
    render();
    return;
  }
  const remove = ev.target.closest("[data-remove]");
  if (remove) {
    state.form.packages.splice(Number(remove.dataset.remove), 1);
    render();
  }
});
app.addEventListener("input", (ev) => {
  const field = ev.target.dataset.pack;
  if (!field || !state.form) return;
  state.form.packages[Number(ev.target.dataset.i)][field] = ev.target.value;
});
app.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (form.id === "login-form") {
    try {
      await api("/api/admin/login", { method: "POST", body: { code: new FormData(form).get("code") } });
      state.authed = true;
      state.toast = "";
      await show();
    } catch (err) {
      state.toast = text("a_bad_code");
      render();
    }
    return;
  }
  if (form.id === "search") {
    state.q = new FormData(form).get("q") || "";
    state.listPage = 1;
    await show();
    return;
  }
  if (form.id === "edit-user" && state.edit) {
    const data = new FormData(form);
    await api("/api/admin/users/" + state.edit.user._id, {
      method: "PATCH",
      body: {
        coins: Number(data.get("coins")),
        wins: Number(data.get("wins")),
        losses: Number(data.get("losses")),
        draws: Number(data.get("draws")),
        banned: data.get("banned") === "on",
      },
    });
    state.edit = null;
    await show();
    return;
  }
  if (form.id === "settings") {
    const data = new FormData(form);
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        body: {
          welcomeCoins: Number(data.get("welcomeCoins")),
          minStake: Number(data.get("minStake")),
          maxStake: Number(data.get("maxStake")),
          moveSeconds: Number(data.get("moveSeconds")),
          maintenance: data.get("maintenance") === "on",
          adminIds: data.get("adminIds"),
          packages: state.form.packages,
        },
      });
      state.toast = text("a_saved");
      state.form = await api("/api/admin/settings");
    } catch (err) {
      state.toast = text("error_generic");
    }
    render();
    return;
  }
  if (form.id === "broadcast") {
    const data = new FormData(form);
    const result = await api("/api/admin/broadcast", { method: "POST", body: { text: data.get("text"), lang: data.get("lang") } });
    state.toast = text("a_sent", result);
    render();
  }
});
async function boot() {
  try { state.meta = await fetch("/api/meta").then((res) => res.json()); } catch (err) { state.meta = {}; }
  await loadStrings();
  try {
    await api("/api/admin/me");
    state.authed = true;
    await show();
  } catch (err) {
    state.authed = false;
    render();
  }
}
setInterval(() => {
  if (state.authed && state.page === "dash" && !state.edit) show().catch(() => {});
}, 5000);
boot();
