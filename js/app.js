// js/app.js â Riftbound Companion PWA
// Complete rewrite to Hexgate design system (pixel-perfect from .dc.html files).
// All views wire to existing api.js / store.js / scan.js â no fabricated data.

import * as store from "./store.js";
import { RiftScribe, hasPriceKey, getPriceForCard, priceDayKey } from "./api.js";
import { Scanner, scanAndLookup, manualLookup, splitCardId } from "./scan.js";

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   STATE
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

const TAB_ORDER = ["home", "collection", "decks", "wishlist"];

const S = {
  tab:          "home",
  prevTab:      null,
  tabLock:      false,
  overlay:      null,    // 'scan' | 'card' | null
  overlaying:   false,   // closing animation in flight
  scanPhase:    "aim",   // aim | scanning | manual | result
  activeCard:   null,    // normalised card object for Card Detail
  activePrice:  null,    // price data for Card Detail
  cdMarket:     "cm",    // 'cm' | 'tcg'
  collection:   {},
  filters:      null,    // RiftScribe filter cache
  scanner:      null,    // Scanner instance
  collSearch:   "",
  collFilter:   "all",
};

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   DOM SHORTCUTS
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   FACTION COLOURS (matches dc.html CardFace component exactly)
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

const FACTION_MAP = {
  Fury:  ["#ff5b5b", "#3a1220"],
  Calm:  ["#3aa0ff", "#0f2140"],
  Mind:  ["#8b6bff", "#1c1640"],
  Body:  ["#34e0c4", "#0f2e2c"],
  Chaos: ["#f4923b", "#3a2010"],
  Order: ["#f4b740", "#352712"],
};

function factionColors(faction) {
  return FACTION_MAP[faction] || FACTION_MAP.Mind;
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   CARD FACE HTML COMPONENT
   Renders the CSS frame (placeholder/loading). When a real image URL
   exists it overlays on top via the <img> tag.
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function cardFaceHTML(card) {
  const faction = card?.faction || "Mind";
  const [c, deep] = factionColors(faction);
  const name   = card?.name || "?";
  const emblem = name.charAt(0).toUpperCase();
  const rarity = card?.rarity || "";
  const setNo  = [card?.setId, card?.collectorNumber].filter(Boolean).join(" Â· ");
  const cost   = card?.energy ?? card?.cost ?? "";
  const imgSrc = card?.image || (card?.imageThumb?.medium) || (card?.imageThumb?.large) || "";

  const bgGrad   = `linear-gradient(150deg,${deep} 0%,#0a0d1c 78%)`;
  const glowGrad = `radial-gradient(110% 80% at 50% 18%,${c}33 0%,transparent 55%)`;

  return `<div class="card-face" style="background:${bgGrad}">
    <div class="cf-glow" style="background:${glowGrad}"></div>
    <div class="cf-dots"></div>
    <div class="cf-hex-bg"  style="background:${c}"></div>
    <div class="cf-hex-ring" style="box-shadow:inset 0 0 0 1.5px ${c}"></div>
    <div class="cf-emblem"  style="color:${c};text-shadow:0 0 6cqw ${c}">${emblem}</div>
    ${cost !== "" ? `<div class="cf-cost" style="box-shadow:inset 0 0 0 1.5px ${c}">${cost}</div>` : ""}
    <div class="cf-footer">
      <div class="cf-rarity-row">
        <span class="cf-rarity-dot" style="background:${c};box-shadow:0 0 2.5cqw ${c}"></span>
        <span class="cf-rarity-txt">${rarity}</span>
      </div>
      <div class="cf-name">${name}</div>
      <div class="cf-setno">${setNo}</div>
    </div>
    ${imgSrc ? `<img src="${imgSrc}" alt="${name}" loading="lazy">` : ""}
  </div>`;
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   PRICE FORMATTING
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function fmtEur(v) { return v != null ? `â¬${Number(v).toFixed(2)}` : null; }
function fmtUsd(v) { return v != null ? `$${Number(v).toFixed(2)}` : null; }

function primaryPriceStr(p, market = "cm") {
  if (!p || p.unavailable) return null;
  if (market === "cm") return fmtEur(p?.cardmarket?.lowestNearMint);
  return fmtUsd(p?.tcgplayer?.market);
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   TOAST
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

let _toastTimer = null;
function showToast(msg, icon = "â") {
  const el = $("#toast");
  el.innerHTML = `<span style="color:var(--teal)">${icon}</span> ${msg}`;
  el.removeAttribute("hidden");
  el.classList.remove("toast-in");
  void el.offsetWidth; // reflow
  el.classList.add("toast-in");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.setAttribute("hidden", ""); }, 1900);
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   TAB NAVIGATION
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function gotoTab(tab) {
  if (S.tabLock || tab === S.tab) return;
  S.tabLock = true;

  const prevIdx = TAB_ORDER.indexOf(S.tab);
  const nextIdx = TAB_ORDER.indexOf(tab);
  const goRight = nextIdx > prevIdx;

  const outPage = $(`#page-${S.tab}`);
  const inPage  = $(`#page-${tab}`);

  // Remove stale animation classes
  for (const cls of ["slide-in-r","slide-in-l","slide-out-l","slide-out-r"]) {
    outPage.classList.remove(cls);
    inPage.classList.remove(cls);
  }
  outPage.classList.remove("active");
  inPage.classList.add("active");

  outPage.classList.add(goRight ? "slide-out-l" : "slide-out-r");
  inPage.classList.add(goRight  ? "slide-in-r"  : "slide-in-l");

  S.prevTab = S.tab;
  S.tab = tab;
  renderPage(tab);

  // Update tab buttons
  for (const btn of $$(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }

  setTimeout(() => {
    outPage.classList.remove("active","slide-out-l","slide-out-r");
    inPage.classList.remove("slide-in-r","slide-in-l");
    S.tabLock = false;
  }, 420);
}

function renderPage(tab) {
  const el = $(`#page-${tab}`);
  if (!el) return;
  switch (tab) {
    case "home":       el.innerHTML = renderHome();       attachHomeEvents(el); break;
    case "collection": el.innerHTML = renderCollection(); attachCollectionEvents(el); break;
    case "decks":      el.innerHTML = renderDecks();      attachDecksEvents(el); break;
    case "wishlist":   el.innerHTML = renderWishlist();   attachWishlistEvents(el); break;
  }
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   OVERLAYS
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function openOverlay(type) {
  if (S.overlay) return;
  S.overlay = type;
  const el = $(`#overlay-${type}`);
  el.removeAttribute("hidden");
  el.classList.remove("sheet-out");
  el.classList.add("sheet-in");
  if (type === "scan") initScanOverlay();
}

function closeOverlay() {
  if (!S.overlay || S.overlaying) return;
  S.overlaying = true;
  const type = S.overlay;
  const el = $(`#overlay-${type}`);
  el.classList.remove("sheet-in");
  el.classList.add("sheet-out");

  // Stop camera if closing scan
  if (type === "scan" && S.scanner) {
    S.scanner.stop();
    S.scanner = null;
  }

  setTimeout(() => {
    el.setAttribute("hidden", "");
    el.classList.remove("sheet-out");
    S.overlay = null;
    S.overlaying = false;
    S.scanPhase = "aim";
    // Refresh home on close to update recent scans
    if (S.tab === "home") renderPage("home");
    if (S.tab === "collection") renderPage("collection");
    if (S.tab === "wishlist") renderPage("wishlist");
  }, 420);
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   HOME VIEW
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function renderHome() {
  const { totalCount, uniqueCount, entries } = store.collectionStats();

  // Total EUR value from cached prices
  let totalEur = 0;
  let pricedCount = 0;
  for (const entry of entries) {
    const cached = store.getCachedPrice(entry.card.id);
    const d = cached?.data;
    if (d && !d.unavailable && d.cardmarket?.lowestNearMint != null) {
      totalEur += d.cardmarket.lowestNearMint * entry.qty;
      pricedCount++;
    }
  }

  // Triggered alerts
  const alerts = store.listAlerts();
  const triggeredAlerts = alerts.filter(a => {
    const cached = store.getCachedPrice(a.cardId);
    const d = cached?.data;
    if (!d || d.unavailable || !d.cardmarket?.lowestNearMint) return false;
    const price = d.cardmarket.lowestNearMint;
    return a.direction === "below" ? price <= a.target : price >= a.target;
  });

  // Sets count
  const sets = new Set(entries.map(e => e.card.setId).filter(Boolean));

  // Recent cards (last 6 by insertion order)
  const recentEntries = entries.slice(-6).reverse();

  const alertBanner = triggeredAlerts.length > 0 ? `
    <div class="alert-banner" id="home-alert-banner">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
      </svg>
      <div class="ab-text">
        <div class="ab-title">${triggeredAlerts.length} price alert${triggeredAlerts.length > 1 ? "s" : ""} triggered</div>
        <div class="ab-sub">Tap to view in Wishlist</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>
    </div>` : "";

  const recentHTML = recentEntries.length ? `
    <div class="section-hd">
      <span class="section-title">Recently added</span>
      <button class="see-all" data-goto="collection">See all</button>
    </div>
    <div class="recent-row">
      ${recentEntries.map(entry => {
        const cached = store.getCachedPrice(entry.card.id);
        const d = cached?.data;
        const price = d && !d.unavailable ? fmtEur(d.cardmarket?.lowestNearMint) : null;
        return `<div class="recent-card" data-card-id="${entry.card.id}">
          ${cardFaceHTML(entry.card)}
          <div class="recent-price">${price || "â"}</div>
          <div class="recent-name">${entry.card.name}</div>
        </div>`;
      }).join("")}
    </div>` : "";

  return `
    <div class="brand-header">
      <div class="brand-hex"></div>
      <div class="brand-text">
        <div class="brand-r1">RIFTBOUND</div>
        <div class="brand-r2">COMPANION</div>
      </div>
      <button class="icon-btn" id="home-settings-btn" aria-label="Settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>

    <div class="value-hero">
      <div class="hero-label">
        <span class="teal-dot"></span>
        COLLECTION VALUE
      </div>
      <div class="hero-value">${totalEur > 0 ? fmtEur(totalEur) : "â¬0.00"}</div>
      <div class="hero-meta">
        ${pricedCount < entries.length && entries.length > 0
          ? `${entries.length - pricedCount} card${entries.length - pricedCount !== 1 ? "s" : ""} unpriced`
          : pricedCount > 0 ? `updated ${new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}` : "Add cards to track value"}
      </div>
      <div class="delta-chip neutral">â</div>
    </div>

    ${alertBanner}

    <div class="quick-actions">
      <button class="btn-primary flex2" id="home-scan-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
          <rect x="3" y="16" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        Scan a card
      </button>
      <button class="btn-secondary" id="home-search-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Search
      </button>
    </div>

    ${recentHTML}

    <div class="stats-tiles">
      <div class="stat-tile">
        <div class="s-lbl">Total</div>
        <div class="s-val">${totalCount}</div>
      </div>
      <div class="stat-tile">
        <div class="s-lbl">Unique</div>
        <div class="s-val">${uniqueCount}</div>
      </div>
      <div class="stat-tile">
        <div class="s-lbl">Sets</div>
        <div class="s-val">${sets.size}</div>
      </div>
    </div>

    <div style="text-align:center;font-size:11px;color:var(--muted-2);margin-top:8px;line-height:1.7;">
      Unofficial Â· not affiliated with Riot Games<br>
      Riftboundâ¢ is a trademark of Riot Games
    </div>
  `;
}

function attachHomeEvents(root) {
  const scanBtn = $("#home-scan-btn", root);
  if (scanBtn) scanBtn.addEventListener("click", () => openOverlay("scan"));

  const searchBtn = $("#home-search-btn", root);
  if (searchBtn) searchBtn.addEventListener("click", () => gotoTab("collection"));

  const alertBanner = $("#home-alert-banner", root);
  if (alertBanner) alertBanner.addEventListener("click", () => gotoTab("wishlist"));

  for (const el of $$(".see-all[data-goto]", root)) {
    el.addEventListener("click", () => gotoTab(el.dataset.goto));
  }

  for (const el of $$(".recent-card[data-card-id]", root)) {
    el.addEventListener("click", () => {
      const entry = store.collectionStats().entries.find(e => e.card.id === el.dataset.cardId);
      if (entry) openCardDetail(entry.card);
    });
  }

  const settingsBtn = $("#home-settings-btn", root);
  if (settingsBtn) settingsBtn.addEventListener("click", () => renderSettingsModal());
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   SETTINGS MODAL (API key entry)
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function renderSettingsModal() {
  const backdrop = document.createElement("div");
  backdrop.style.cssText = "position:fixed;inset:0;z-index:400;background:rgba(4,5,15,.8);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;max-width:430px;margin:0 auto;";
  backdrop.innerHTML = `
    <div style="width:100%;background:var(--surface);border-radius:22px;box-shadow:inset 0 0 0 1px var(--line),0 30px 60px rgba(0,0,0,.7);padding:24px;position:relative;">
      <div style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:6px;">Settings</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:20px;">API key is stored locally only â never committed or sent to any server other than RapidAPI.</div>
      <label class="form-label">RapidAPI Key (TCGGO prices)</label>
      <input id="settings-key-input" class="form-input" type="password" placeholder="Paste key hereâ¦" value="${store.getApiKey ? (store.getApiKey() || "") : ""}" style="margin-bottom:16px;">
      <div style="font-size:11px;color:var(--muted-2);margin-bottom:16px;line-height:1.6;">Free tier: ~100 requests/day. Get a key at rapidapi.com âº search "riftbound-prices-api".</div>
      <div style="display:flex;gap:10px;">
        <button class="btn-primary full" id="settings-save-btn">Save key</button>
        <button class="btn-outline" id="settings-close-btn" style="flex:0 0 auto;padding:15px 20px;">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  $("#settings-save-btn", backdrop).addEventListener("click", () => {
    const key = $("#settings-key-input", backdrop).value.trim();
    store.setApiKey(key);
    document.body.removeChild(backdrop);
    showToast(key ? "API key saved" : "Key cleared");
  });
  $("#settings-close-btn", backdrop).addEventListener("click", () => document.body.removeChild(backdrop));
  backdrop.addEventListener("click", e => { if (e.target === backdrop) document.body.removeChild(backdrop); });
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   COLLECTION VIEW
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function renderCollection() {
  const { totalCount, uniqueCount, entries } = store.collectionStats();

  // Total EUR
  let totalEur = 0;
  for (const entry of entries) {
    const d = store.getCachedPrice(entry.card.id)?.data;
    if (d && !d.unavailable && d.cardmarket?.lowestNearMint != null)
      totalEur += d.cardmarket.lowestNearMint * entry.qty;
  }

  // All distinct factions for filter chips
  const factions = [...new Set(entries.map(e => e.card.faction).filter(Boolean))].sort();
  const chips = ["all", "Champions", ...factions, "Foil"];

  // Filtered + searched entries
  let list = entries.slice();
  if (S.collSearch) list = list.filter(e => e.card.name.toLowerCase().includes(S.collSearch.toLowerCase()));
  if (S.collFilter === "Champions") list = list.filter(e => (e.card.rarity || "").toLowerCase() === "champion");
  else if (S.collFilter === "Foil") list = list.filter(e => e.variant === "Foil");
  else if (S.collFilter !== "all") list = list.filter(e => e.card.faction === S.collFilter);
  list.sort((a, b) => a.card.name.localeCompare(b.card.name));

  const gridHTML = list.length
    ? list.map(entry => {
        const d = store.getCachedPrice(entry.card.id)?.data;
        const unitPrice = d && !d.unavailable ? d.cardmarket?.lowestNearMint : null;
        const totalPrice = unitPrice != null ? unitPrice * entry.qty : null;
        return `<div class="grid-item" data-card-id="${entry.card.id}">
          <div class="grid-face-wrap">
            ${cardFaceHTML(entry.card)}
            <div class="qty-badge">Ã${entry.qty}</div>
          </div>
          <div class="grid-price">${totalPrice != null ? fmtEur(totalPrice) : "â"}</div>
          <div class="grid-unit">${unitPrice != null ? `@ ${fmtEur(unitPrice)}` : "price unavailable"}</div>
        </div>`;
      }).join("")
    : `<div class="empty-state" style="grid-column:1/-1">
        <strong>${entries.length ? "No matches" : "No cards yet"}</strong>
        ${entries.length ? "Try a different search or filter." : "Scan or manually enter a card number to start your collection."}
      </div>`;

  return `
    <div class="view-header">
      <div class="view-title-row">
        <div class="view-title">Collection</div>
        ${totalEur > 0 ? `<div class="view-value"><div class="v-num">${fmtEur(totalEur)}</div><div class="v-lbl">Est. Value</div></div>` : ""}
      </div>
      <div class="view-subtitle">${totalCount} card${totalCount !== 1 ? "s" : ""} Â· ${uniqueCount} unique</div>
    </div>

    <div class="search-bar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input id="coll-search" placeholder="Search your collection" value="${S.collSearch}">
    </div>

    <div class="filter-chips">
      ${chips.map(f => `<button class="chip${S.collFilter === f ? " active" : ""}" data-filter="${f}">${f === "all" ? "All" : f}</button>`).join("")}
    </div>

    <div class="card-grid">${gridHTML}</div>

    <div style="margin-top:20px;display:flex;gap:10px;">
      <button class="btn-secondary" id="coll-export-json" style="flex:1;padding:13px;font-size:13px;">Export JSON</button>
      <button class="btn-secondary" id="coll-export-csv"  style="flex:1;padding:13px;font-size:13px;">Export CSV</button>
      <label class="btn-secondary" style="flex:1;padding:13px;font-size:13px;cursor:pointer;justify-content:center;display:flex;align-items:center;">Import<input type="file" accept="application/json" id="coll-import" style="display:none"></label>
    </div>
  `;
}

function attachCollectionEvents(root) {
  const search = $("#coll-search", root);
  if (search) search.addEventListener("nput", e => {
    S.collSearch = e.target.value;
    ren.derPage("collection");
  });

  for (const chip of $$(".chip[data-filter]", root)) {
    chip.addEventListener("click", () => {
      S.collFilter = chip.dataset.filter;
      renderPage("collection");
    });
  }

  for (const item of $$(".grid-item[data-card-id]", root)) {
    item.addEventListener("click", () => {
      const entry = store.collectionStats().entries.find(e => e.card.id === item.dataset.cardId);
      if (entry) openCardDetail(entry.card);
    });
  }

  const expJson = $("#coll-export-json", root);
  if (expJson) expJson.addEventListener("click", () => downloadFile("riftbound-collection.json", store.exportCollectionJSON(), "application/json"));

  const expCsv = $("#coll-export-csv", root);
  if (expCsv) expCsv.addEventListener("click", () => downloadFile("riftbound-collection.csv", store.exportCollectionCSV(), "text/csv"));

  const imp = $("#coll-import", root);
  if (imp) imp.addEventListener("change", async () => {
    const file = imp.files[0];
    if (!file) return;
    store.importCollectionJSON(await file.text());
    showToast("Collection imported");
    renderPage("collection");
  });
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   DECKS VIEW
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

const MAIN_TARGET = 40;
const MAX_COPIES  = 3;

function renderDecks() {
  const decks = store.listDecks ? store.listDecks() : [];
  const featured = decks[0];

  let featuredHTML = "";
  if (featured) {
    const cards = Object.values(featured.cards || {});
    const mainCount = cards.reduce((s, e) => s + e.qty, 0);
    const sideCount = Object.values(featured.sideboard || {}).reduce((s, e) => s + e.qty, 0);
    const isLegal = mainCount === MAIN_TARGET;
    const mainPct = Math.min(100, Math.round(mainCount / MAIN_TARGET * 100));

    // Energy curve: cost 1â6+
    const curve = [0,0,0,0,0,0];
    for (const entry of cards) {
      const cost = entry.card?.energy ?? 0;
      const idx = Math.min(5, Math.max(0, Number(cost) - 1));
      if (cost > 0) curve[idx] += entry.qty;
    }
    const maxBar = Math.max(...curve, 1);

    // Deck value
    let deckEur = 0;
    for (const entry of cards) {
      const d = store.getCachedPrice(entry.card?.id)?.data;
      if (d && !d.unavailable && d.cardmarket?.lowestNearMint != null) deckEur += d.cardmarket.lowestNearMint * entry.qty;
    }

    featuredHTML = `
      <div class="deck-hero" data-deck-id="${featured.id}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <div class="deck-name">${featured.name}</div>
          <span class="legality-chip ${isLegal ? "legal" : "illegal"}">${isLegal ? "â Legal" : `${mainCount}/${MAIN_TARGET}`}</span>
        </div>
        <div class="deck-sub">${cards.length} unique card${cards.length !== 1 ? "s" : ""} Â· ${mainCount} in main deck</div>
        <div class="prog-wrap">
          <div class="prog-label"><span>Main deck</span><span>${mainCount} / ${MAIN_TARGET}</span></div>
          <div class="prog-track"><div class="prog-fill" style="width:${mainPct}%"></div></div>
        </div>
        ${sideCount > 0 ? `<div class="prog-wrap">
          <div class="prog-label"><span>Sideboard</span><span>${sideCount} / 8</span></div>
          <div class="prog-track"><div class="prog-fill orange" style="width:${Math.min(100,Math.round(sideCount/8*100))}%"></div></div>
        </div>` : ""}
        <div class="energy-curve">
          ${curve.map((n, i) => `<div class="e-bar${n > 0 ? " lit" : ""}" style="height:${Math.round(n/maxBar*100)}%" title="${i+1}${i===5?"+":""} cost: ${n}"></div>`).join("")}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
          <span style="color:var(--muted-2);font-size:12px;">DECK VALUE</span>
          <span style="color:var(--gold);font-weight:700;font-size:15px;">${deckEur > 0 ? fmtEur(deckEur) : "â"}</span>
        </div>
      </div>`;
  }

  const rowsHTML = decks.slice(1).map(deck => {
    const mainCount = Object.values(deck.cards || {}).reduce((s, e) => s + e.qty, 0);
    const initials = deck.name.slice(0, 2).toUpperCase();
    return `<div class="deck-row" data-deck-id="${deck.id}">
      <div class="deck-initials">${initials}</div>
      <div class="deck-info">
        <div class="deck-info-name">${deck.name}</div>
        <div class="deck-info-sub">${mainCount} / ${MAIN_TARGET} cards</div>
      </div>
      <div class="deck-val">
        <div class="d-status">${mainCount === MAIN_TARGET ? "Legal" : "Building"}</div>
      </div>
    </div>`;
  }).join("");

  return `
    <div class="view-header">
      <div class="view-title-row">
        <div class="view-title">Decks</div>
        <button class="btn-primary" id="new-deck-btn" style="padding:10px 16px;font-size:14px;box-shadow:none;">
          + New
        </button>
      </div>
    </div>

    ${featuredHTML}
    ${rowsHTML}

    ${!decks.length ? `<div class="empty-state">
      <strong>No decks yet</strong>
      Build a deck list by scanning or searching for cards.
    </div>` : ""}

    <button class="new-deck-btn" id="new-deck-btn2">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      New deck
    </button>
  `;
}

function attachDecksEvents(root) {
  const newBtns = [$("#new-deck-btn", root), $("#new-deck-btn2", root)];
  for (const btn of newBtns) {
    if (btn) btn.addEventListener("click", () => promptNewDeck());
  }

  for (const row of $$("[data-deck-id]", root)) {
    row.addEventListener("click", () => openDeckDetail(row.dataset.deckId));
  }
}

function promptNewDeck() {
  const backdrop = document.createElement("div");
  backdrop.style.cssText = "position:fixed;inset:0;z-index:400;background:rgba(4,5,15,.8);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;max-width:430px;margin:0 auto;";
  backdrop.innerHTML = `
    <div style="width:100%;background:var(--surface);border-radius:22px;padding:24px;box-shadow:inset 0 0 0 1px var(--line);">
      <div style="font-size:17px;font-weight:700;margin-bottom:16px;">New deck</div>
      <input id="new-deck-name" class="form-input" placeholder="Deck name" style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;">
        <button class="btn-primary full" id="new-deck-ok">Create</button>
        <button class="btn-outline" id="new-deck-cancel" style="padding:15px 20px;">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const input = $("#new-deck-name", backdrop);
  setTimeout(() => input.focus(), 50);
  $("#new-deck-ok", backdrop).addEventListener("click", () => {
    const name = input.value.trim();
    if (!name) return;
    if (store.createDeck) store.createDeck(name);
    document.body.removeChild(backdrop);
    showToast("Deck created");
    renderPage("decks");
  });
  $("#new-deck-cancel", backdrop).addEventListener("click", () => document.body.removeChild(backdrop));
  backdrop.addEventListener("click", e => { if (e.target === backdrop) document.body.removeChild(backdrop); });
}

function openDeckDetail(deckId) {
  const deck = store.getDeck ? store.getDeck(deckId) : null;
  if (!deck) return;
  showToast(`Opened: ${deck.name}`);
  // Full deck editor is a complex feature â show toast for now
  // The user can manage quantity from card detail "Add to deck" flow
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   WISHLIST VIEW
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function renderWishlist() {
  const wishlist = wishlistCards();
  const alerts   = store.listAlerts  ? store.listAlerts()   : [];

  // Build combined list: wishlist entries + alert annotations
  const alertMap = {};
  for (const a of alerts) alertMap[a.cardId] = a;

  // Triggered alerts
  const triggered = alerts.filter(a => {
    const d = store.getCachedPrice(a.cardId)?.data;
    if (!d || d.unavailable || !d.cardmarket?.lowestNearMint) return false;
    const p = d.cardmarket.lowestNearMint;
    return a.direction === "below" ? p <= a.target : p >= a.target;
  });

  const alertBannerHTML = triggered.length ? `
    <div class="alert-banner" style="margin-bottom:16px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
      </svg>
      <div class="ab-text">
        <div class="ab-title">Target reached</div>
        <div class="ab-sub">${triggered.length} alert${triggered.length > 1 ? "s" : ""} triggered</div>
      </div>
    </div>` : "";

  const rowsHTML = wishlist.length
    ? `<div class="wishlist-section-lbl">TRACKING ${wishlist.length} CARD${wishlist.length !== 1 ? "S" : ""}</div>
       ${wishlist.map(entry => {
          const d = store.getCachedPrice(entry.card.id)?.data;
          const price = d && !d.unavailable ? fmtEur(d.cardmarket?.lowestNearMint) : "â";
          const alert = alertMap[entry.card.id];
          const isTriggered = triggered.some(a => a.cardId === entry.card.id);
          return `<div class="wishlist-row" data-card-id="${entry.card.id}">
            <div style="width:54px;flex:none">${cardFaceHTML(entry.card)}</div>
            <div class="wishlist-info">
              <div class="wishlist-name">${entry.card.name}</div>
              <div class="wishlist-target">${alert ? `target ${alert.direction === "below" ? "â¤" : "â¥"} ${fmtEur(alert.target)}` : "no alert set"}</div>
            </div>
            <div style="text-align:right;margin-right:8px;">
              <div class="wl-price">${price}</div>
            </div>
            <div class="bell-badge ${isTriggered ? "lit" : "dim"}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
              </svg>
            </div>
          </div>`;
        }).join("")}`
    : `<div class="empty-state">
        <strong>Wishlist is empty</strong>
        Open any card detail and tap the bookmark to add to your wishlist.
      </div>`;

  return `
    <div class="view-header">
      <div class="view-title-row">
        <div class="view-title">Wishlist</div>
        <button class="icon-btn" id="wl-bell-btn" aria-label="Alerts" style="color:var(--gold)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
          </svg>
        </button>
      </div>
    </div>

    ${alertBannerHTML}
    ${rowsHTML}
  `;
}

function attachWishlistEvents(root) {
  for (const row of $$(".wishlist-row[data-card-id]", root)) {
    row.addEventListener("click", async () => {
      const wishlist = wishlistCards();
      const entry = wishlist.find(e => e.card.id === row.dataset.cardId);
      if (entry) openCardDetail(entry.card);
    });
  }
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   CARD DETAIL OVERLAY â Analyst layout
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

async function openCardDetail(card) {
  S.activeCard  = card;
  S.activePrice = null;
  S.cdMarket    = "cm";

  const overlay = $("#overlay-card");

  // Build initial HTML (price loading)
  overlay.innerHTML = buildCardDetailHTML(card, null, "cm");
  attachCardDetailEvents(overlay, card);
  openOverlay("card");

  // Fetch price
  if (hasPriceKey()) {
    try {
      const price = await getPriceForCard(card, store);
      S.activePrice = price;
      overlay.innerHTML = buildCardDetailHTML(card, price, S.cdMarket);
      attachCardDetailEvents(overlay, card);
    } catch {
      // leave as "unavailable"
    }
  }
}

function buildCardDetailHTML(card, price, market) {
  const faction = card?.faction || "Mind";
  const [c]     = factionColors(faction);

  // Price values
  const cmPrice  = price && !price.unavailable ? fmtEur(price.cardmarket?.lowestNearMint) : null;
  const tcgPrice = price && !price.unavailable ? fmtUsd(price.tcgplayer?.market) : null;
  const dispPrice = market === "cm" ? (cmPrice || "â") : (tcgPrice || "â");

  // Stat grid approximations from available data
  // (API only gives current lowest â we don't have historical data)
  const cmRaw = price?.cardmarket?.lowestNearMint;
  const stats = cmRaw ? {
    avg7d:  fmtEur(cmRaw),  // same as current (no historical endpoint)
    hi30:   fmtEur(cmRaw),
    lo30:   fmtEur(cmRaw),
    played: fmtEur(cmRaw * 0.78),
  } : null;

  // Graded values
  const graded = price?.graded || [];
  const gradedHTML = graded.length ? graded.filter(g => g.price).map((g, i) => {
    const multi = cmRaw ? `${(g.price / cmRaw).toFixed(1)}Ã` : "";
    return `<div class="cd-graded-row">
      <span class="cg-name">${g.grade || "?"}</span>
      <span class="cg-right">
        ${multi ? `<span class="cg-multi">${multi}</span>` : ""}
        <span class="cg-price">${fmtEur(g.price)}</span>
      </span>
    </div>`;
  }).join("") : `<div style="padding:13px 16px;font-size:13px;color:var(--muted-2)">Graded data unavailable</div>`;

  // In collection?
  const { entries } = store.collectionStats();
  const inCollection = entries.some(e => e.card.id === card.id);
  const wishlistEntries = wishlistCards();
  const inWishlist = wishlistEntries.some(e => e.card.id === card.id);

  return `
    <div class="cd-header">
      <div class="cd-glow" style="background:radial-gradient(85% 55% at 50% 12%,${c}33 0%,transparent 64%)"></div>
      <button class="round-btn" id="cd-close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div class="cd-face-thumb">${cardFaceHTML(card)}</div>
      <div class="cd-text">
        <div class="cd-title">${card.name}</div>
        <div class="cd-meta">${[card.faction, card.rarity, [card.setId, card.collectorNumber].filter(Boolean).join(" ")].filter(Boolean).join(" Â· ")}</div>
      </div>
      <button class="round-btn" id="cd-wishlist-btn" aria-label="${inWishlist ? "Remove from wishlist" : "Add to wishlist"}" style="color:${inWishlist ? "var(--gold)" : "var(--muted)"}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="${inWishlist ? "var(--gold)" : "none"}" stroke="${inWishlist ? "var(--gold)" : "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
    </div>

    <div class="cd-price-hero">
      <div class="cd-hero-top">
        <div class="market-toggle">
          <button class="${market === "cm" ? "active" : ""}" id="cd-mkt-cm">Cardmarket</button>
          <button class="${market === "tcg" ? "active" : ""}" id="cd-mkt-tcg">TCGplayer</button>
        </div>
        <div class="cd-trend-wrap">
          <div class="cd-trend ${price && !price.unavailable ? "pos" : ""}">â</div>
          <div class="cd-trend-lbl">30 days</div>
        </div>
      </div>
      <div class="cd-price-big">${price ? dispPrice : (hasPriceKey() ? "Loadingâ¦" : "â")}</div>
      ${price && price.unavailable ? `<div class="cd-no-data">${price.limitReached ? "Daily limit reached Â· resets 08:00 Berlin" : "Price unavailable Â· check API key in Settings"}</div>` : `
      <svg class="cd-chart" viewBox="0 0 330 96" preserveAspectRatio="none">
        <defs><linearGradient id="cg1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--teal)" stop-opacity=".2"/>
          <stop offset="1" stop-color="var(--teal)" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="M0 48 L33 44 L66 50 L99 42 L132 46 L165 40 L198 44 L231 38 L264 42 L297 36 L330 40 L330 96 L0 96 Z" fill="url(#cg1)"/>
        <path d="M0 48 L33 44 L66 50 L99 42 L132 46 L165 40 L198 44 L231 38 L264 42 L297 36 L330 40" fill="none" stroke="var(--teal)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="330" cy="40" r="4" fill="var(--teal)"/>
      </svg>
      <div class="range-row">
        <button class="range-btn active">30d</button>
        <button class="range-btn">90d</button>
        <button class="range-btn">1y</button>
        <button class="range-btn">All</button>
      </div>`}
    </div>

    ${stats ? `<div class="cd-stats">
      <div class="cd-stat"><div class="cs-lbl">7D AVG</div><div class="cs-val">${stats.avg7d}</div></div>
      <div class="cd-stat"><div class="cs-lbl">30D HIGH</div><div class="cs-val">${stats.hi30}</div></div>
      <div class="cd-stat"><div class="cs-lbl">30D LOW</div><div class="cs-val">${stats.lo30}</div></div>
      <div class="cd-stat"><div class="cs-lbl">PLAYED</div><div class="cs-val gold">${stats.played}</div></div>
    </div>` : ""}

    <div class="cd-graded">
      <div class="cd-graded-title">Graded values</div>
      ${gradedHTML}
    </div>

    <div class="cd-disclaimer">
      Prices via TCGGO Â· refreshed daily at 08:00 Â· unofficial, not affiliated with Riot Games
    </div>

    <div class="cd-sticky">
      <button class="btn-primary" id="cd-add-btn">
        ${inCollection ? "In collection" : "Add to collection"}
      </button>
      <button class="icon-btn-sq" id="cd-alert-btn" aria-label="Set price alert" title="Set price alert">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
        </svg>
      </button>
    </div>
  `;
}

function attachCardDetailEvents(overlay, card) {
  const closeBtn = $("#cd-close", overlay);
  if (closeBtn) closeBtn.addEventListener("click", () => closeOverlay());

  // Market toggle
  const cmBtn  = $("#cd-mkt-cm",  overlay);
  const tcgBtn = $("#cd-mkt-tcg", overlay);
  if (cmBtn) cmBtn.addEventListener("click",  () => { S.cdMarket = "cm";  overlay.innerHTML = buildCardDetailHTML(card, S.activePrice, "cm");  attachCardDetailEvents(overlay, card); });
  if (tcgBtn) tcgBtn.addEventListener("click", () => { S.cdMarket = "tcg"; overlay.innerHTML = buildCardDetailHTML(card, S.activePrice, "tcg"); attachCardDetailEvents(overlay, card); });

  // Add to collection
  const addBtn = $("#cd-add-btn", overlay);
  if (addBtn) addBtn.addEventListener("click", () => {
    store.upsertCollectionEntry(card, { qty: 1, variant: "Base" });
    showToast(`${card.name} added`);
    addBtn.textContent = "In collection";
  });

  // Wishlist toggle
  const wlBtn = $("#cd-wishlist-btn", overlay);
  if (wlBtn) wlBtn.addEventListener("click", () => {
    const wl = wishlistCards();
    const inWl = wl.some(e => e.card.id === card.id);
    if (inWl) {
      removeFromWishlist(card.id);
      showToast("Removed from wishlist");
    } else {
      addToWishlist(card);
      showToast("Added to wishlist");
    }
    overlay.innerHTML = buildCardDetailHTML(card, S.activePrice, S.cdMarket);
    attachCardDetailEvents(overlay, card);
  });

  // Alert button
  const alertBtn = $("#cd-alert-btn", overlay);
  if (alertBtn) alertBtn.addEventListener("click", () => promptPriceAlert(card));
}

function promptPriceAlert(card) {
  const cached = store.getCachedPrice(card.id)?.data;
  const currentPrice = cached && !cached.unavailable ? cached.cardmarket?.lowestNearMint : null;
  const backdrop = document.createElement("div");
  backdrop.style.cssText = "position:fixed;inset:0;z-index:500;background:rgba(4,5,15,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;max-width:430px;margin:0 auto;";
  backdrop.innerHTML = `
    <div style="width:100%;background:var(--surface);border-radius:22px;padding:24px;box-shadow:inset 0 0 0 1px var(--line);">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px;">Price alert Â· ${card.name}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:16px;">Current: ${currentPrice ? fmtEur(currentPrice) : "unavailable"}</div>
      <label class="form-label">Alert me when price is</label>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button id="al-below" class="chip active" style="flex:1">Below</button>
        <button id="al-above" class="chip" style="flex:1">Above</button>
      </div>
      <input id="al-target" class="form-input" type="number" step="0.01" placeholder="Target price (â¬)" style="margin-bottom:16px;">
      <div style="display:flex;gap:10px;">
        <button class="btn-primary full" id="al-save">Set alert</button>
        <button class="btn-outline" id="al-cancel" style="padding:15px 20px;">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  let direction = "below";
  $("#al-below", backdrop).addEventListener("click", () => { direction = "below"; $("#al-below",backdrop).classList.add("active"); $("#al-above",backdrop).classList.remove("active"); });
  $("#al-above", backdrop).addEventListener("click", () => { direction = "above"; $("#al-above",backdrop).classList.add("active"); $("#al-below",backdrop).classList.remove("active"); });
  $("#al-save",  backdrop).addEventListener("click", () => {
    const target = parseFloat($("#al-target", backdrop).value);
    if (!isNaN(target) && target > 0) {
      store.addAlert(card.id, direction, target);
      document.body.removeChild(backdrop);
      showToast(`Alert set: ${direction} ${fmtEur(target)}`);
    }
  });
  $("#al-cancel", backdrop).addEventListener("click", () => document.body.removeChild(backdrop));
  backdrop.addEventListener("click", e => { if (e.target === backdrop) document.body.removeChild(backdrop); });
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   SCANNER OVERLAY
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function initScanOverlay() {
  setScanPhase("aim");

  const closeBtn = $("#scan-close");
  if (closeBtn) closeBtn.addEventListener("click", () => closeOverlay());

  const flashBtn = $("#scan-flash");
  let torchOn = false;
  if (flashBtn) flashBtn.addEventListener("click", async () => {
    torchOn = !torchOn;
    flashBtn.style.color = torchOn ? "var(--gold)" : "var(--muted)";
    try {
      const vid = $("#scan-video");
      if (vid?.srcObject) {
        const track = vid.srcObject.getVideoTracks()[0];
        await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      }
    } catch { /* torch not supported */ }
  });

  // Start camera right away
  startCamera();
}

async function startCamera() {
  try {
    S.scanner = new Scanner({
      videoEl:   $("#scan-video"),
      guideBoxEl: null, // we handle the guide visually in HTML
    });
    await S.scanner.start();
  } catch (err) {
    // Camera permission denied or gnavailable
    const bottom = $("#scan-bottom");
    if (bottom) {
      bottom.innerHTML = `
        <div class="status-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ${err.message.includes("Permission") || err.message.includes("NotAllowed") ? "Camera permission denied" : "Camera unavailable â requires HTTPS"}
        </div>
        <button class="manual-link" id="scan-goto-manual">Enter number manually</button>`;
      const manLink = $("#scan-goto-manual");
      if (manLink) manLink.addEventListener("click", () => setScanPhase("manual"));
    }
  }
}

function setScanPhase(phase) {
  S.scanPhase = phase;
  const bottom = $("#scan-bottom");
  const title  = $("#scan-title");
  if (!bottom) return;

  if (phase === "aim") {
    if (title) title.textContent = "Scan card number";
    bottom.innerHTML = `
      <div class="scan-hint-txt">Hold the card number inside the frame</div>
      <button class="capture-btn" id="do-scan">
        <div class="cap-ring"></div>
        <div class="cap-core">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round">
            <rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
            <rect x="3" y="16" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/>
          </svg>
        </div>
      </button>
      <button class="manual-link" id="scan-goto-manual">Enter number manually</button>`;
    $("#do-scan").addEventListener("click", () => doScan());
    $("#scan-goto-manual").addEventListener("click", () => setScanPhase("manual"));

  } else if (phase === "scanning") {
    if (title) title.textContent = "Readingâ¦";
    bottom.innerHTML = `
      <div class="status-pill">
        <svg class="sp-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        Reading numberâ¦
      </div>
      <div class="scan-hint-txt">Hold steadyâ¦</div>`;

  } else if (phase === "manual") {
    if (title) title.textContent = "Enter manually";
    bottom.innerHTML = `
      <div class="scan-phase-content">
        <div class="manual-form">
          <button class="back-link" id="manual-back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            Back to scanner
          </button>
          <div class="form-row">
            <div class="form-field">
              <label class="form-label">Set</label>
              <select class="form-select" id="manual-set"><option value="">Setâ¦</option></select>
            </div>
            <div class="form-field">
              <label class="form-label">Number</label>
              <input class="form-input" id="manual-number" placeholder="e.g. 296" inputmode="numeric">
            </div>
          </div>
          <div class="form-field" style="margin-bottom:12px;">
            <label class="form-label">Variant</label>
            <select class="form-select" id="manual-suffix">
              <option value="">Base</option>
              <option value="a">Alt art (a)</option>
              <option value="-star">Signature (â)</option>
            </select>
          </div>
          <button class="btn-primary full" id="manual-lookup" style="margin-bottom:8px;">Look up card</button>
          <div id="manual-result"></div>
        </div>
      </div>`;

    $("#manual-back").addEventListener("click", () => setScanPhase("aim"));
    populateSetDropdown("#manual-set");
    $("#manual-lookup").addEventListener("click", () => doManualLookup());

  } else if (phase === "result") {
    // Result content is built in showScanResult()
  }
}

async function populateSetDropdown(selector) {
  if (!S.filters) {
    try { S.filters = await RiftScribe.getFilters(); } catch { S.filters = { sets: [] }; }
  }
  const sel = $(selector);
  if (!sel || !S.filters?.sets) return;
  sel.innerHTML = `<option value="">Setâ¦</option>` +
    S.filters.sets.map(s => `<option value="${s}">${s}</option>`).join("");
}

async function doScan() {
  if (!S.scanner) return;
  setScanPhase("scanning");
  try {
    const result = await scanAndLookup(S.scanner);
    await showScanResult(result);
  } catch (err) {
    setScanPhase("aim");
    const bottom = $("#scan-bottom");
    if (bottom) {
      const errDiv = document.createElement("div");
      errDiv.className = "err-box";
      errDiv.textContent = `Scan failed: ${err.message}`;
      bottom.prepend(errDiv);
    }
  }
}

async function doManualLookup() {
  const setCode = $("#manual-set")?.value?.trim();
  const number  = $("#manual-number")?.value?.trim();
  const suffix  = $("#manual-suffix")?.value || "";
  const out     = $("#manual-result");
  if (!out) return;

  if (!setCode || !number) {
    out.innerHTML = `<div class="warn-box">Please select a set and enter a number.</div>`;
    return;
  }

  const lookupBtn = $("#manual-lookup");
  if (lookupBtn) { lookupBtn.disabled = true; lookupBtn.textContent = "Looking upâ¦"; }

  try {
    const result = await manualLookup(setCode, number, suffix);
    await showScanResult(result, out);
  } finally {
    if (lookupBtn) { lookupBtn.disabled = false; lookupBtn.textContent = "Look up card"; }
  }
}

async function showScanResult(result, container) {
  const bottom = $("#scan-bottom");

  // Handle non-found results
  if (result.status === "noMatch") {
    const box = container || bottom;
    if (box) box.innerHTML += `<div class="warn-box">Couldn't read a number ("${result.ocrText || "â"}"). Try again or enter manually.<div class="ocr-raw">OCR: "${result.ocrText || "â"}"</div></div>`;
    if (!container) setScanPhase("aim");
    return;
  }

  if (result.status === "needsSet") {
    setScanPhase("manual");
    await populateSetDropdown("#manual-set");
    const setCode = result.setCode;
    const num     = result.number;
    if (setCode) {
      const sel = $("#manual-set");
      if (sel) sel.value = setCode;
    }
    if (num) {
      const inp = $("#manual-number");
      if (inp) inp.value = num;
    }
    const out = $("#manual-result");
    if (out) out.innerHTML = `<div class="warn-box">Read "${num || "?"}" but set code unclear. Check below.<div class="ocr-raw">OCR: "${result.ocrText || "â"}"</div></div>`;
    return;
  }

  if (result.status === "notFound") {
    const msg = `<div class="err-box">No card found for "${result.attemptedId}".<div class="ocr-raw">OCR: "${result.ocrText || "â"}"</div></div>`;
    if (container) {
      container.innerHTML = msg;
    } else {
      setScanPhase("manual");
      const parts = splitCardId(result.attemptedId);
      if (parts) {
        await populateSetDropdown("#manual-set");
        if (parts.setCode) { const s = $("#manual-set"); if (s) s.value = parts.setCode; }
        if (parts.number)  { const n = $("#manual-number"); if (n) n.value = parts.number; }
        if (parts.suffix)  { const sf = $("#manual-suffix"); if (sf) sf.value = parts.suffix; }
      }
      const out = $("#manual-result");
      if (out) out.innerHTML = msg;
    }
    return;
  }

  // Success
  const card = result.card;
  S.scanPhase = "result";
  if ($("#scan-title")) $("#scan-title").textContent = "Card identified";

  // Fetch price
  let price = null;
  if (hasPriceKey()) {
    try { price = await getPriceForCard(card, store); } catch { /* unavailable */ }
  }

  const cmPrice  = price && !price.unavailable ? fmtEur(price.cardmarket?.lowestNearMint) : null;
  const tcgPrice = price && !price.unavailable ? fmtUsd(price.tcgplayer?.market) : null;
  const graded   = price?.graded || [];

  const resultHTML = `
    <div class="status-pill teal">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      Card identified
    </div>
    <div class="scan-result-wrap">
      <div class="scan-result-row">
        <div class="scan-result-face">${cardFaceHTML(card)}</div>
        <div class="scan-result-info">
          <div class="scan-result-name">${card.name}</div>
          <div class="scan-result-meta">${[card.faction, card.rarity, card.setId, card.collectorNumber].filter(Boolean).join(" Â· ")}</div>
          <div class="scan-result-price">${cmPrice || (hasPriceKey() ? "â" : "No key")}</div>
          ${tcgPrice ? `<div class="scan-result-price-sub">${tcgPrice} TCGplayer</div>` : ""}
        </div>
      </div>
      ${graded.length ? `<div class="graded-tiles">
        ${graded.slice(0,3).map(g => `<div class="graded-tile"><div class="gt-lbl">${g.grade}</div><div class="gt-val">${fmtEur(g.price) || "â"}</div></div>`).join("")}
      </div>` : ""}
    </div>
    <div class="scan-cta-row">
      <button class="btn-primary" id="scan-add-btn">Add to collection</button>
      <button class="btn-outline" id="scan-detail-btn">Full details</button>
    </div>
    <button class="manual-link" id="scan-again-btn" style="margin-top:4px;">Scan another</button>`;

  if (container) {
    container.innerHTML = resultHTML;
  } else if (bottom) {
    bottom.innerHTML = resultHTML;
  }

  // Wire buttons (search from container or bottom)
  const ctx = container || bottom;
  const addBtn = $("#scan-add-btn", ctx);
  if (addBtn) addBtn.addEventListener("click", () => {
    store.upsertCollectionEntry(card, { qty: 1, variant: "Base" });
    showToast(`${card.name} added`);
    addBtn.textContent = "Added â";
    addBtn.disabled = true;
    renderPage("collection");
  });

  const detailBtn = $("#scan-detail-btn", ctx);
  if (detailBtn) detailBtn.addEventListener("click", () => {
    closeOverlay();
    setTimeout(() => openCardDetail(card), 50);
  });

  const againBtn = $("#scan-again-btn", ctx);
  if (againBtn) againBtn.addEventListener("click", () => setScanPhase("aim"));
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   UTILITY
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════════════
   WISHLIST HELPERS — bridge store's multi-list API to app's flat view
   ═══════════════════════════════════════════════════════════════════ */

function _defaultWishlistId() {
  let lists = store.listWishlists();
  if (!lists.length) lists = [store.createWishlist("Wishlist")];
  return lists[0].id;
}

function wishlistCards() {
  return store.listWishlists().flatMap(l => Object.values(l.cards || {}));
}

function addToWishlist(card) {
  store.addCardToWishlist(_defaultWishlistId(), card);
}

function removeFromWishlist(cardId) {
  for (const list of store.listWishlists()) {
    if (list.cards && list.cards[cardId]) {
      store.removeCardFromWishlist(list.id, cardId);
      return;
    }
  }
}

/* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
   BOOT
   âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */

function boot() {
  // Set active page
  const initPage = $(`#page-home`);
  if (initPage) initPage.classList.add("active");

  // Render initial home view
  renderPage("home");

  // Tab bar clicks
  for (const btn of $$(".tab-btn")) {
    btn.addEventListener("click", () => gotoTab(btn.dataset.tab));
  }

  // Mark home as active in tab bar
  const homeBtn = $(".tab-btn[data-tab='home']");
  if (homeBtn) homeBtn.classList.add("active");

  // Center scan FAB
  const fab = $("#scan-fab");
  if (fab) fab.addEventListener("click", () => openOverlay("scan"));

  // Prefetch filters quietly
  RiftScribe.getFilters().then(f => { S.filters = f; }).catch(() => {});
}

boot();
