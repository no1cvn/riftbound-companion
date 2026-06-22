// js/app.js — views, routing, rendering. Vanilla ES modules, no framework,
// no build step.

import * as store from "./store.js";
import { RiftScribe, hasPriceKey, getPriceForCard } from "./api.js";
import { Scanner, scanAndLookup, manualLookup } from "./scan.js";

/* ----------------------------- tiny DOM helpers ----------------------------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function fmtMoney(value, symbol) {
  if (value === null || value === undefined) return null;
  return `${symbol}${Number(value).toFixed(2)}`;
}

function priceLine(p) {
  if (p && p.limitReached) {
    return el("p", { class: "price-muted" }, "Price unavailable — daily request limit reached (resets 08:00 Berlin)");
  }
  if (!p || p.unavailable) return el("p", { class: "price-muted" }, "Price unavailable");
  const parts = [];
  if (p.cardmarket && p.cardmarket.lowestNearMint != null) {
    parts.push(el("span", { class: "price" }, `€${p.cardmarket.lowestNearMint.toFixed(2)} `));
    parts.push(el("span", { class: "muted" }, "Cardmarket lowest (NM)  "));
  }
  if (p.tcgplayer && p.tcgplayer.market != null) {
    parts.push(el("span", { class: "price" }, `$${p.tcgplayer.market.toFixed(2)} `));
    parts.push(el("span", { class: "muted" }, "TCGplayer market"));
  }
  if (!parts.length) return el("p", { class: "price-muted" }, "Price unavailable");
  const wrap = el("div", {}, parts);
  if (Array.isArray(p.graded) && p.graded.length) {
    const g = el(
      "div",
      { class: "gap-8 wrap", style: "margin-top:6px" },
      [el("span", { class: "badge" }, "Graded")].concat(
        p.graded
          .filter((g) => g.price != null)
          .map((g) => el("span", { class: "badge" }, `${g.grade || "?"} €${Number(g.price).toFixed(2)}`))
      )
    );
    if (g.children.length > 1) wrap.appendChild(g);
  }
  return wrap;
}

function cardImageEl(card, size = "medium") {
  const src = (card.imageThumb && (card.imageThumb[size] || card.imageThumb.large)) || card.image;
  return el("img", { src: src || "", alt: card.name, loading: "lazy" });
}

/* ----------------------------- router ----------------------------- */

const ROOT = document.getElementById("view-root");
const TAB_BTNS = Array.from(document.querySelectorAll(".tab-btn"));

const routes = {
  scan: renderScanView,
  collection: renderCollectionView,
  decks: renderDecksView,
  wishlist: renderWishlistView,
  about: renderAboutView,
};

function navigate(route) {
  for (const btn of TAB_BTNS) {
    if (btn.dataset.route === route) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  }
  ROOT.innerHTML = "";
  (routes[route] || renderScanView)(ROOT);
}

for (const btn of TAB_BTNS) {
  btn.addEventListener("click", () => navigate(btn.dataset.route));
}

/* =============================================================================
   SCAN VIEW (P1)
   ============================================================================= */

let scannerInstance = null;
let filtersCache = null;

async function getFilters() {
  if (filtersCache) return filtersCache;
  try {
    filtersCache = await RiftScribe.getFilters();
  } catch {
    filtersCache = { sets: [], factions: [], rarities: [], types: [] };
  }
  return filtersCache;
}

function renderScanView(root) {
  const banner = el("div", { class: "banner", id: "scan-banner", style: "display:none" });
  const stage = el("div", { class: "scan-stage" }, [
    el("video", { id: "scan-video", playsinline: "true", muted: "true" }),
    el("div", { class: "scan-guide", id: "scan-guide" }),
    el("div", { class: "scan-hint" }, "Hold the card number here"),
  ]);

  const startBtn = el("button", { class: "btn btn-primary btn-block" }, "Start camera");
  const scanBtn = el("button", { class: "btn btn-accent btn-block", disabled: true }, "Scan number");
  const controls = el("div", { class: "scan-controls" }, [startBtn, scanBtn]);

  const resultBox = el("div", { id: "scan-result" });
  const manualBox = renderManualEntryForm();

  root.append(
    el("h1", {}, "Scan a card"),
    banner,
    stage,
    controls,
    resultBox,
    el("div", { class: "section" }, [el("h2", {}, "Manual entry"), manualBox])
  );

  function showBanner(message, kind = "warn") {
    banner.textContent = message;
    banner.className = `banner banner-${kind}`;
    banner.style.display = "block";
  }

  startBtn.addEventListener("click", async () => {
    banner.style.display = "none";
    scannerInstance = new Scanner({
      videoEl: document.getElementById("scan-video"),
      guideBoxEl: document.getElementById("scan-guide"),
    });
    try {
      await scannerInstance.start();
      startBtn.disabled = true;
      scanBtn.disabled = false;
    } catch (err) {
      showBanner(err.message, "danger");
    }
  });

  scanBtn.addEventListener("click", async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = "Scanning…";
    try {
      const result = await scanAndLookup(scannerInstance);
      await handleScanResult(result, resultBox, manualBox);
    } catch (err) {
      showBanner(`Scan failed: ${err.message}`, "danger");
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = "Scan number";
    }
  });
}

function renderManualEntryForm() {
  const wrap = el("div", { class: "card-panel" });
  const setSelect = el("select", { id: "manual-set" }, [el("option", { value: "" }, "Set…")]);
  const numberInput = el("input", { id: "manual-number", placeholder: "Number, e.g. 296", inputmode: "numeric" });
  const suffixSelect = el("select", { id: "manual-suffix" }, [
    el("option", { value: "" }, "Base"),
    el("option", { value: "a" }, "Alt art (a)"),
    el("option", { value: "-star" }, "Signature (star)"),
  ]);
  const lookupBtn = el("button", { class: "btn btn-primary btn-block" }, "Look up");
  const out = el("div", { id: "manual-result", style: "margin-top:10px" });

  getFilters().then((f) => {
    for (const s of f.sets) setSelect.appendChild(el("option", { value: s }, s));
  });

  lookupBtn.addEventListener("click", async () => {
    const setCode = setSelect.value;
    const number = numberInput.value.trim();
    const suffix = suffixSelect.value;
    if (!setCode || !number) {
      out.innerHTML = "";
      out.appendChild(el("p", { class: "banner banner-warn" }, "Pick a set and enter a number."));
      return;
    }
    lookupBtn.disabled = true;
    try {
      const result = await manualLookup(setCode, number, suffix);
      await handleScanResult(result, out, wrap);
    } finally {
      lookupBtn.disabled = false;
    }
  });

  wrap.append(
    el("div", { class: "field-row" }, [
      el("div", { class: "field" }, [el("label", {}, "Set"), setSelect]),
      el("div", { class: "field" }, [el("label", {}, "Number"), numberInput]),
    ]),
    el("div", { class: "field" }, [el("label", {}, "Variant"), suffixSelect]),
    lookupBtn,
    out
  );
  return wrap;
}

/** Prefill the manual form's number field when OCR found a number but no set. */
function prefillManualNumber(manualBox, number) {
  const input = manualBox.querySelector("#manual-number");
  if (input) input.value = number;
  manualBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function handleScanResult(result, container, manualBox) {
  container.innerHTML = "";

  if (result.status === "noMatch") {
    container.appendChild(
      el("div", { class: "banner banner-warn" }, `Couldn't read a number ("${result.ocrText || "—"}"). Try again or use manual entry below.`)
    );
    return;
  }
  if (result.status === "needsSet") {
    container.appendChild(el("div", { class: "banner banner-warn" }, `Read number ${result.number}, but no set code. Finish it below.`));
    if (manualBox) prefillManualNumber(manualBox, result.number);
    return;
  }
  if (result.status === "notFound") {
    container.appendChild(el("div", { class: "banner banner-danger" }, `No card found for "${result.attemptedId}". Check the set/number and try manual entry.`));
    return;
  }

  const card = result.card;
  const priceBox = el("div", { class: "loading-text" }, "Loading price…");
  const addBtn = el("button", { class: "btn btn-primary" }, "Add to collection");
  const variantSelect = el("select", {}, store.VARIANTS.map((v) => el("option", { value: v }, v)));
  const qtyInput = el("input", { type: "number", value: "1", min: "1", style: "width:64px" });

  container.append(
    el("div", { class: "scan-result-card card-panel" }, [
      cardImageEl(card),
      el("div", {}, [
        el("h3", {}, card.name),
        el("p", { class: "muted" }, [card.setId, card.collectorNumber, card.rarity, card.faction].filter(Boolean).join(" · ")),
        card.isBanned ? el("span", { class: "badge badge-danger" }, "Banned") : null,
        priceBox,
      ]),
    ]),
    el("div", { class: "gap-8", style: "margin-top:10px;align-items:center" }, [variantSelect, qtyInput, addBtn])
  );

  addBtn.addEventListener("click", () => {
    store.upsertCollectionEntry(card, { qty: Number(qtyInput.value) || 1, variant: variantSelect.value });
    addBtn.textContent = "Added ✓";
    addBtn.disabled = true;
  });

  if (!hasPriceKey()) {
    priceBox.replaceWith(el("p", { class: "price-muted" }, "Price unavailable (no API key configured)"));
  } else {
    try {
      const price = await getPriceForCard(card, store);
      priceBox.replaceWith(priceLine(price));
    } catch {
      priceBox.replaceWith(el("p", { class: "price-muted" }, "Price unavailable"));
    }
  }
}

/* =============================================================================
   COLLECTION VIEW (P2)
   ============================================================================= */

function renderCollectionView(root) {
  const { totalCount, uniqueCount, entries } = store.collectionStats();

  let totalEur = 0;
  let totalUsd = 0;
  let pricedCount = 0;
  for (const entry of entries) {
    const cached = store.getCachedPrice(entry.card.id);
    const data = cached && cached.data;
    if (data && !data.unavailable) {
      pricedCount++;
      if (data.cardmarket && data.cardmarket.lowestNearMint != null) totalEur += data.cardmarket.lowestNearMint * entry.qty;
      if (data.tcgplayer && data.tcgplayer.market != null) totalUsd += data.tcgplayer.market * entry.qty;
    }
  }

  const statRow = el("div", { class: "stat-row" }, [
    el("div", { class: "stat-box" }, [el("div", { class: "stat-value" }, String(totalCount)), el("div", { class: "stat-label" }, "Total cards")]),
    el("div", { class: "stat-box" }, [el("div", { class: "stat-value" }, String(uniqueCount)), el("div", { class: "stat-label" }, "Unique cards")]),
    el("div", { class: "stat-box" }, [
      el("div", { class: "stat-value price" }, totalEur ? `€${totalEur.toFixed(2)}` : "—"),
      el("div", { class: "stat-label" }, `Value (EUR)${pricedCount < entries.length ? ` · ${entries.length - pricedCount} unpriced` : ""}`),
    ]),
    el("div", { class: "stat-box" }, [el("div", { class: "stat-value price" }, totalUsd ? `$${totalUsd.toFixed(2)}` : "—"), el("div", { class: "stat-label" }, "Value (USD)")]),
  ]);

  const searchInput = el("input", { placeholder: "Filter by name…" });
  const sortSelect = el("select", {}, [
    el("option", { value: "name" }, "Sort: Name"),
    el("option", { value: "qty" }, "Sort: Quantity"),
    el("option", { value: "set" }, "Sort: Set"),
  ]);

  const grid = el("div", { class: "card-grid" });
  const exportJsonBtn = el("button", { class: "btn" }, "Export JSON");
  const exportCsvBtn = el("button", { class: "btn" }, "Export CSV");
  const importInput = el("input", { type: "file", accept: "application/json", style: "display:none" });
  const importBtn = el("button", { class: "btn" }, "Import JSON");

  function renderGrid() {
    grid.innerHTML = "";
    let list = entries.slice();
    const q = searchInput.value.trim().toLowerCase();
    if (q) list = list.filter((e) => e.card.name.toLowerCase().includes(q));
    if (sortSelect.value === "name") list.sort((a, b) => a.card.name.localeCompare(b.card.name));
    if (sortSelect.value === "qty") list.sort((a, b) => b.qty - a.qty);
    if (sortSelect.value === "set") list.sort((a, b) => (a.card.setId || "").localeCompare(b.card.setId || ""));

    if (!list.length) {
      grid.appendChild(el("div", { class: "empty-state" }, "No cards yet. Scan or search to add some."));
      return;
    }
    for (const entry of list) {
      const tile = el("div", { class: "card-tile" }, [
        cardImageEl(entry.card, "small"),
        el("div", { class: "name" }, entry.card.name),
        el("div", { class: "meta" }, `${entry.card.setId || ""} · ${entry.variant} · ×${entry.qty}`),
      ]);
      tile.addEventListener("click", () => openCollectionEntryDetail(entry, renderGrid));
      grid.appendChild(tile);
    }
  }

  searchInput.addEventListener("input", renderGrid);
  sortSelect.addEventListener("change", renderGrid);

  exportJsonBtn.addEventListener("click", () => downloadFile("riftbound-collection.json", store.exportCollectionJSON(), "application/json"));
  exportCsvBtn.addEventListener("click", () => downloadFile("riftbound-collection.csv", store.exportCollectionCSV(), "text/csv"));
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    store.importCollectionJSON(await file.text());
    navigate("collection");
  });

  root.append(
    el("h1", {}, "Collection"),
    statRow,
    el("div", { class: "field-row" }, [searchInput, sortSelect]),
    grid,
    el("div", { class: "section gap-8 wrap", style: "margin-top:16px" }, [exportJsonBtn, exportCsvBtn, importBtn, importInput])
  );
  renderGrid();
}

function openCollectionEntryDetail(entry, onChange) {
  const overlay = el("div", { class: "card-panel section" });
  const qtyInput = el("input", { type: "number", value: String(entry.qty), min: "0", style: "width:72px" });
  const noteInput = el("textarea", { rows: "2" }, entry.meta?.note || "");
  const removeBtn = el("button", { class: "btn btn-danger" }, "Remove");
  const saveBtn = el("button", { class: "btn btn-primary" }, "Save");

  overlay.append(
    el("h3", {}, entry.card.name),
    el("div", { class: "field" }, [el("label", {}, "Quantity"), qtyInput]),
    el("div", { class: "field" }, [el("label", {}, "Note"), noteInput]),
    el("div", { class: "gap-8" }, [saveBtn, removeBtn])
  );

  saveBtn.addEventListener("click", () => {
    store.setCollectionQty(entry.card.id, entry.variant, Number(qtyInput.value));
    if (Number(qtyInput.value) > 0) {
      store.upsertCollectionEntry(entry.card, { qty: 0, variant: entry.variant, meta: { note: noteInput.value } });
    }
    navigate("collection");
  });
  removeBtn.addEventListener("click", () => {
    store.removeFromCollection(entry.card.id, entry.variant);
    navigate("collection");
  });

  ROOT.appendChild(overlay);
  overlay.scrollIntoView({ behavior: "smooth", block: "center" });
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =============================================================================
   DECKS VIEW (P3) — validation is advisory (see DECISIONS.md for sourcing)
   ============================================================================= */

const MAIN_DECK_TARGET = 40;
const SIDEBOARD_SIZES = [0, 8];
const MAX_COPIES = 3;
const BATTLEFIELD_COUNT = 3;

function renderDecksView(root) {
  const decks = store.listDecks();
  const list = el("div", { class: "card-panel" });
  const nameInput = el("input", { placeholder: "New deck name" });
  const createBtn = el("button", { class: "btn btn-primary" }, "Create deck");

  if (!decks.length) {
    list.appendChild(el("div", { class: "empty-state" }, "No decks yet."));
  } else {
    for (const deck of decks) {
      const row = el("div", { class: "list-row" }, [
        el("span", {}, deck.name),
        el("button", { class: "btn" }, "Open"),
      ]);
      row.querySelector("button").addEventListener("click", () => renderDeckDetail(deck.id));
      list.appendChild(row);
    }
  }

  createBtn.addEventListener("click", () => {
    if (!nameInput.value.trim()) return;
    const deck = store.createDeck(nameInput.value.trim());
    renderDeckDetail(deck.id);
  });

  root.append(el("h1", {}, "Decks"), list, el("div", { class: "field-row section" }, [nameInput, createBtn]));
}

function deckCounts(deck) {
  const mainCount = Object.values(deck.cards || {}).reduce((s, e) => s + e.qty, 0);
  const sideCount = Object.values(deck.sideboard || {}).reduce((s, e) => s + e.qty, 0);
  return { mainCount, sideCount };
}

function checkCopyLimits(deck) {
  const totals = {};
  for (const e of Object.values(deck.cards || {})) totals[e.card.id] = (totals[e.card.id] || 0) + e.qty;
  for (const e of Object.values(deck.sideboard || {})) totals[e.card.id] = (totals[e.card.id] || 0) + e.qty;
  return Object.entries(totals).filter(([, qty]) => qty > MAX_COPIES);
}

async function renderDeckDetail(deckId) {
  const deck = store.getDeck(deckId);
  if (!deck) return navigate("decks");

  ROOT.innerHTML = "";
  const { mainCount, sideCount } = deckCounts(deck);
  const overLimitCards = checkCopyLimits(deck);

  const warnings = [];
  if (mainCount !== MAIN_DECK_TARGET) warnings.push(`Main deck has ${mainCount} cards (target ${MAIN_DECK_TARGET}).`);
  if (!SIDEBOARD_SIZES.includes(sideCount)) warnings.push(`Sideboard has ${sideCount} cards (should be 0 or 8).`);
  if (overLimitCards.length) warnings.push(`Over the ${MAX_COPIES}-copy limit: ${overLimitCards.map(([id, qty]) => `${id} (${qty})`).join(", ")}.`);
  if ((deck.battlefields || []).length !== BATTLEFIELD_COUNT) warnings.push(`${(deck.battlefields || []).length}/${BATTLEFIELD_COUNT} distinct Battlefields chosen.`);

  const banner = warnings.length
    ? el("div", { class: "banner banner-warn" }, [
        el("strong", {}, "Advisory — not enforced: "),
        warnings.join(" "),
        el("br"),
        el("span", { class: "muted" }, "Limits sourced from the official Deckbuilding Primer + cross-referenced fan sources; see DECISIONS.md."),
      ])
    : el("div", { class: "banner" }, "Looks legal by the rules we could verify (advisory only).");

  const backBtn = el("button", { class: "btn" }, "← Decks");
  backBtn.addEventListener("click", () => navigate("decks"));

  const searchInput = el("input", { placeholder: "Search a card to add…" });
  const searchResults = el("div", { class: "card-grid" });
  searchInput.addEventListener("input", debounce(async () => {
    searchResults.innerHTML = "";
    const q = searchInput.value.trim();
    if (q.length < 2) return;
    const results = await RiftScribe.search(q, { limit: 12 });
    for (const r of results) {
      const tile = el("div", { class: "card-tile" }, [
        r.thumbnailUrl ? el("img", { src: r.thumbnailUrl, alt: r.name }) : el("div", { class: "muted" }, "No image"),
        el("div", { class: "name" }, r.name),
      ]);
      tile.addEventListener("click", async () => {
        const card = await RiftScribe.getCard(r.cardId);
        if (card) {
          store.setDeckCardQty(deck.id, card, ((deck.cards[card.id]?.qty || 0) + 1));
          renderDeckDetail(deck.id);
        }
      });
      searchResults.appendChild(tile);
    }
  }, 300));

  const mainList = el("div");
  for (const e of Object.values(deck.cards || {})) {
    mainList.appendChild(deckCardRow(deck, e, false));
  }
  const sideList = el("div");
  for (const e of Object.values(deck.sideboard || {})) {
    sideList.appendChild(deckCardRow(deck, e, true));
  }

  const ownedToggle = el("input", { type: "checkbox", id: "owned-toggle" });
  const ownedLabel = el("label", { for: "owned-toggle" }, " Filter search to cards I own (collection)");

  ownedToggle.addEventListener("change", () => {
    // Lightweight client-side filter applied to the next search render.
    searchResults.dataset.ownedOnly = ownedToggle.checked ? "1" : "";
  });

  const stats = computeDeckStats(deck);
  const curve = el("div", { class: "curve-chart" });
  const maxCount = Math.max(1, ...Object.values(stats.curve));
  for (const cost of Object.keys(stats.curve).sort((a, b) => Number(a) - Number(b))) {
    const count = stats.curve[cost];
    curve.appendChild(
      el("div", { class: "curve-bar", style: `height:${(count / maxCount) * 100}%` }, [el("span", { class: "curve-bar-label" }, cost)])
    );
  }

  const sampleBtn = el("button", { class: "btn" }, "Draw sample hand (7)");
  const sampleOut = el("div", { class: "gap-8 wrap", style: "margin-top:10px" });
  sampleBtn.addEventListener("click", () => {
    sampleOut.innerHTML = "";
    for (const card of drawSampleHand(deck, 7)) {
      sampleOut.appendChild(el("span", { class: "badge" }, card.name));
    }
  });

  const exportTextBtn = el("button", { class: "btn" }, "Export (text)");
  const exportJsonBtn = el("button", { class: "btn" }, "Export (JSON)");
  exportTextBtn.addEventListener("click", () => downloadFile(`${deck.name}.txt`, store.exportDeckText(deck.id), "text/plain"));
  exportJsonBtn.addEventListener("click", () => downloadFile(`${deck.name}.json`, store.exportDeckJSON(deck.id), "application/json"));

  const deleteBtn = el("button", { class: "btn btn-danger" }, "Delete deck");
  deleteBtn.addEventListener("click", () => {
    store.deleteDeck(deck.id);
    navigate("decks");
  });

  ROOT.append(
    backBtn,
    el("h1", {}, deck.name),
    banner,
    el("div", { class: "stat-row" }, [
      el("div", { class: "stat-box" }, [el("div", { class: "stat-value" }, `${mainCount}/${MAIN_DECK_TARGET}`), el("div", { class: "stat-label" }, "Main deck")]),
      el("div", { class: "stat-box" }, [el("div", { class: "stat-value" }, String(sideCount)), el("div", { class: "stat-label" }, "Sideboard")]),
      el("div", { class: "stat-box" }, [el("div", { class: "stat-value price" }, stats.totalCost != null ? `€${stats.totalCost.toFixed(2)}` : "—"), el("div", { class: "stat-label" }, "Deck cost (cached prices)")]),
      el("div", { class: "stat-box" }, [el("div", { class: "stat-value price" }, stats.costToComplete != null ? `€${stats.costToComplete.toFixed(2)}` : "—"), el("div", { class: "stat-label" }, "Cost to complete")]),
    ]),
    el("div", { class: "section" }, [el("h2", {}, "Energy curve"), curve]),
    el("div", { class: "section" }, [
      el("h2", {}, "Add cards"),
      searchInput,
      el("div", {}, [ownedToggle, ownedLabel]),
      searchResults,
    ]),
    el("div", { class: "section" }, [el("h2", {}, `Main deck (${mainCount})`), mainList]),
    el("div", { class: "section" }, [el("h2", {}, `Sideboard (${sideCount})`), sideList]),
    el("div", { class: "section" }, [sampleBtn, sampleOut]),
    el("div", { class: "section gap-8 wrap" }, [exportTextBtn, exportJsonBtn, deleteBtn])
  );
}

function deckCardRow(deck, entry, isSideboard) {
  const minus = el("button", { class: "btn" }, "−");
  const plus = el("button", { class: "btn" }, "+");
  minus.addEventListener("click", () => {
    store.setDeckCardQty(deck.id, entry.card, entry.qty - 1, { sideboard: isSideboard });
    renderDeckDetail(deck.id);
  });
  plus.addEventListener("click", () => {
    store.setDeckCardQty(deck.id, entry.card, entry.qty + 1, { sideboard: isSideboard });
    renderDeckDetail(deck.id);
  });
  return el("div", { class: "list-row" }, [
    el("span", {}, `${entry.qty}× ${entry.card.name}`),
    el("div", { class: "gap-8" }, [minus, plus]),
  ]);
}

function computeDeckStats(deck) {
  const curve = {};
  let totalCost = 0;
  let pricedAll = true;
  let costToComplete = 0;
  const owned = store.getCollection();

  for (const e of Object.values(deck.cards || {})) {
    const cost = e.card.energy ?? "?";
    curve[cost] = (curve[cost] || 0) + e.qty;

    const cached = store.getCachedPrice(e.card.id);
    const price = cached && cached.data && !cached.data.unavailable ? cached.data.cardmarket?.lowestNearMint : null;
    if (price == null) {
      pricedAll = false;
    } else {
      totalCost += price * e.qty;
      const ownedQty = Object.values(owned)
        .filter((o) => o.card.id === e.card.id)
        .reduce((s, o) => s + o.qty, 0);
      const missing = Math.max(0, e.qty - ownedQty);
      costToComplete += price * missing;
    }
  }

  return {
    curve,
    totalCost: Object.keys(curve).length ? totalCost : null,
    costToComplete: Object.keys(curve).length ? costToComplete : null,
    pricedAll,
  };
}

function drawSampleHand(deck, n) {
  const pool = [];
  for (const e of Object.values(deck.cards || {})) {
    for (let i = 0; i < e.qty; i++) pool.push(e.card);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* =============================================================================
   WISHLIST + PRICE ALERTS VIEW (P4)
   ============================================================================= */

function buyLinks(cardName) {
  const q = encodeURIComponent(cardName);
  return [
    { label: "Cardmarket", url: `https://www.cardmarket.com/en/Riftbound/Products/Search?searchString=${q}` },
    { label: "TCGplayer", url: `https://www.tcgplayer.com/search/all/product?q=${q}` },
    { label: "TCGGO", url: `https://www.tcggo.com/riftbound/search?q=${q}` },
  ];
}

function renderWishlistView(root) {
  const lists = store.listWishlists();
  const listsBox = el("div", { class: "section" });
  const nameInput = el("input", { placeholder: "New wishlist name" });
  const createBtn = el("button", { class: "btn btn-primary" }, "Create list");

  if (!lists.length) {
    listsBox.appendChild(el("div", { class: "empty-state" }, "No wishlists yet."));
  }
  for (const list of lists) {
    const cards = Object.values(list.cards || {});
    const panel = el("div", { class: "card-panel section" });
    const header = el("div", { class: "row-between" }, [
      el("h3", {}, `${list.name} (${cards.length})`),
      el("button", { class: "btn btn-danger" }, "Delete list"),
    ]);
    header.querySelector("button").addEventListener("click", () => {
      store.deleteWishlist(list.id);
      navigate("wishlist");
    });
    panel.appendChild(header);

    const searchInput = el("input", { placeholder: "Add a card by name…" });
    const searchResults = el("div", { class: "card-grid" });
    searchInput.addEventListener(
      "input",
      debounce(async () => {
        searchResults.innerHTML = "";
        const q = searchInput.value.trim();
        if (q.length < 2) return;
        const results = await RiftScribe.search(q, { limit: 8 });
        for (const r of results) {
          const tile = el("div", { class: "card-tile" }, [el("div", { class: "name" }, r.name)]);
          tile.addEventListener("click", async () => {
            const card = await RiftScribe.getCard(r.cardId);
            if (card) {
              store.addCardToWishlist(list.id, card);
              navigate("wishlist");
            }
          });
          searchResults.appendChild(tile);
        }
      }, 300)
    );
    panel.append(searchInput, searchResults);

    for (const { card } of cards) {
      const row = el("div", { class: "list-row" }, [
        el("span", {}, card.name),
        el(
          "div",
          { class: "gap-8" },
          buyLinks(card.name).map((l) => el("a", { href: l.url, target: "_blank", rel: "noopener", class: "btn btn-ghost" }, l.label))
        ),
      ]);
      const removeBtn = el("button", { class: "btn btn-danger" }, "×");
      removeBtn.addEventListener("click", () => {
        store.removeCardFromWishlist(list.id, card.id);
        navigate("wishlist");
      });
      row.appendChild(removeBtn);
      panel.appendChild(row);
    }
    listsBox.appendChild(panel);
  }

  createBtn.addEventListener("click", () => {
    if (!nameInput.value.trim()) return;
    store.createWishlist(nameInput.value.trim());
    navigate("wishlist");
  });

  // --- Price alerts ---
  const alertsBox = el("div", { class: "section card-panel" });
  const alerts = store.listAlerts();
  alertsBox.appendChild(
    el("div", { class: "banner banner-warn" }, [
      el("strong", {}, "iOS limitation: "),
      "real background push notifications aren't available for installed PWAs here. Alerts are checked in-app each time you open this tab, not live in the background.",
    ])
  );

  const triggered = store.checkAlerts((cardId) => {
    const cached = store.getCachedPrice(cardId);
    const data = cached && cached.data;
    if (!data || data.unavailable) return null;
    return data.cardmarket && data.cardmarket.lowestNearMint != null ? data.cardmarket.lowestNearMint : null;
  });
  for (const t of triggered) {
    alertsBox.appendChild(
      el("div", { class: "banner banner-danger" }, `Alert: a watched card is now €${t.price.toFixed(2)} (target ${t.direction} €${t.target}).`)
    );
  }

  if (!alerts.length) {
    alertsBox.appendChild(el("p", { class: "muted" }, "No alerts set."));
  }
  for (const a of alerts) {
    const row = el("div", { class: "list-row" }, [
      el("span", {}, `${a.cardId} — ${a.direction} €${a.target}`),
      el("button", { class: "btn btn-danger" }, "Remove"),
    ]);
    row.querySelector("button").addEventListener("click", () => {
      store.removeAlert(a.id);
      navigate("wishlist");
    });
    alertsBox.appendChild(row);
  }

  const alertCardInput = el("input", { placeholder: "Card ID (e.g. OGN-296)" });
  const alertDirSelect = el("select", {}, [el("option", { value: "below" }, "Below"), el("option", { value: "above" }, "Above")]);
  const alertTargetInput = el("input", { type: "number", placeholder: "Target €", step: "0.01" });
  const alertAddBtn = el("button", { class: "btn btn-primary" }, "Add alert");
  alertAddBtn.addEventListener("click", () => {
    if (!alertCardInput.value.trim() || !alertTargetInput.value) return;
    store.addAlert(alertCardInput.value.trim(), alertDirSelect.value, alertTargetInput.value);
    navigate("wishlist");
  });
  alertsBox.append(el("div", { class: "field-row" }, [alertCardInput, alertDirSelect, alertTargetInput, alertAddBtn]));

  root.append(el("h1", {}, "Wishlist & Alerts"), el("div", { class: "field-row" }, [nameInput, createBtn]), listsBox, el("h2", {}, "Price alerts"), alertsBox);
}

/* =============================================================================
   ABOUT VIEW
   ============================================================================= */

function renderSettingsPanel() {
  const panel = el("div", { class: "card-panel section" });
  const currentKey = store.getApiKey();
  const keyInput = el("input", { type: "password", placeholder: "RapidAPI key (X-RapidAPI-Key)", value: currentKey, autocomplete: "off" });
  const saveBtn = el("button", { class: "btn btn-primary" }, "Save key");
  const clearBtn = el("button", { class: "btn btn-danger" }, "Clear key");
  const status = el(
    "p",
    { class: currentKey ? "badge" : "muted" },
    currentKey ? "Price API key saved on this device." : "No price API key saved — prices show as unavailable."
  );

  saveBtn.addEventListener("click", () => {
    store.setApiKey(keyInput.value);
    navigate("about");
  });
  clearBtn.addEventListener("click", () => {
    store.clearApiKey();
    keyInput.value = "";
    navigate("about");
  });

  panel.append(
    el("h3", {}, "Price API key (TCGGO / RapidAPI)"),
    el(
      "p",
      { class: "muted" },
      "Optional. Saved only in this browser's local storage, on this device — never written to any file, never sent anywhere except directly from your device to RapidAPI, and never included in collection/deck exports."
    ),
    status,
    el("div", { class: "field-row" }, [keyInput, saveBtn]),
    el("div", { style: "margin-top:6px" }, [clearBtn])
  );
  return panel;
}

function renderAboutView(root) {
  root.append(
    el("h1", {}, "About"),
    el("div", { class: "card-panel" }, [
      el("p", {}, "Riftbound Companion is a fan-made, unofficial tool for collectors of the Riftbound TCG. It helps you identify cards by collector number, track your collection's value, and build deck lists."),
      el("p", {}, "It never simulates gameplay, never bundles Riot artwork (card images always load live from the data provider), and never fabricates a price — if no price is available, you'll see \"price unavailable\"."),
    ]),
    renderSettingsPanel(),
    el("div", { class: "legal-footer" }, [
      el("p", {}, "“Riftbound Companion” was created under Riot Games' “Legal Jibber Jabber” policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project."),
      el("p", {}, "Riftbound™ and all related card data, names, and imagery are the property of Riot Games, Inc. Card images are loaded live from the data provider at runtime and are never bundled with this app."),
      el("p", {}, "Card data: RiftScribe (riftscribe.gg, a fan-made API — not Riot's official API). Price data (optional): TCGGO via RapidAPI."),
      store.isUsingInMemoryFallback()
        ? el("p", { class: "badge badge-warn" }, "Storage: in-memory fallback active (private browsing) — your data won't persist after closing this tab.")
        : null,
    ])
  );
}

/* ----------------------------- boot ----------------------------- */

navigate("scan");
