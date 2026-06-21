// js/store.js — persistence: collection / decks / wishlist / alerts / price
// cache. Wraps localStorage with an in-memory fallback (private browsing /
// sandboxed iframes throw on localStorage access in some browsers).
//
// Namespaced keys ("rbc:"), per CLAUDE.md §10:
//   rbc:collection -> { [cardId]: { card, qty, variant, meta? } }
//   rbc:decks      -> [{ id, name, cards: { [cardId]: { card, qty } } }]
//   rbc:wishlist   -> [{ id, name, cards: { [cardId]: { card, addedAt } } }]
//   rbc:alerts     -> [{ id, cardId, direction, target }]
//   rbc:prices     -> { [cardId]: { day, data } }
//   rbc:settings   -> { rapidApiKey? } — local-only, NEVER part of any
//                      export/import or git-tracked file. See getApiKey().

const NS = "rbc:";
const KEYS = {
  collection: NS + "collection",
  decks: NS + "decks",
  wishlist: NS + "wishlist",
  alerts: NS + "alerts",
  prices: NS + "prices",
  settings: NS + "settings",
};

function detectLocalStorage() {
  try {
    const testKey = NS + "__probe__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

const hasLocalStorage = typeof window !== "undefined" && detectLocalStorage();
const memoryFallback = new Map();

const backend = {
  get(key) {
    if (hasLocalStorage) return window.localStorage.getItem(key);
    return memoryFallback.has(key) ? memoryFallback.get(key) : null;
  },
  set(key, value) {
    if (hasLocalStorage) {
      window.localStorage.setItem(key, value);
    } else {
      memoryFallback.set(key, value);
    }
  },
};

export function isUsingInMemoryFallback() {
  return !hasLocalStorage;
}

function readJSON(key, fallback) {
  const raw = backend.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  backend.set(key, JSON.stringify(value));
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ----------------------------- Collection ----------------------------- */

const VARIANTS = ["Base", "Foil", "Promo"];
export { VARIANTS };

function collectionEntryKey(cardId, variant) {
  return `${cardId}::${variant || "Base"}`;
}

export function getCollection() {
  return readJSON(KEYS.collection, {});
}

export function upsertCollectionEntry(card, { qty = 1, variant = "Base", meta = {} } = {}) {
  const coll = getCollection();
  const key = collectionEntryKey(card.id, variant);
  const existing = coll[key];
  coll[key] = {
    card,
    qty: (existing ? existing.qty : 0) + qty,
    variant,
    meta: { ...(existing ? existing.meta : {}), ...meta },
  };
  writeJSON(KEYS.collection, coll);
  return coll[key];
}

export function setCollectionQty(cardId, variant, qty) {
  const coll = getCollection();
  const key = collectionEntryKey(cardId, variant);
  if (!coll[key]) return null;
  if (qty <= 0) {
    delete coll[key];
  } else {
    coll[key].qty = qty;
  }
  writeJSON(KEYS.collection, coll);
  return coll[key] || null;
}

export function removeFromCollection(cardId, variant) {
  const coll = getCollection();
  delete coll[collectionEntryKey(cardId, variant)];
  writeJSON(KEYS.collection, coll);
}

export function collectionStats() {
  const coll = getCollection();
  const entries = Object.values(coll);
  const totalCount = entries.reduce((sum, e) => sum + e.qty, 0);
  const uniqueCount = new Set(entries.map((e) => e.card.id)).size;
  return { totalCount, uniqueCount, entries };
}

export function exportCollectionJSON() {
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), collection: getCollection() },
    null,
    2
  );
}

export function exportCollectionCSV() {
  const rows = [["cardId", "name", "setId", "variant", "qty", "purchaseDate", "purchasePrice", "condition", "note"]];
  for (const entry of Object.values(getCollection())) {
    const m = entry.meta || {};
    rows.push([
      entry.card.id,
      entry.card.name,
      entry.card.setId || "",
      entry.variant,
      entry.qty,
      m.purchaseDate || "",
      m.purchasePrice ?? "",
      m.condition || "",
      (m.note || "").replace(/[\r\n,]+/g, " "),
    ]);
  }
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function importCollectionJSON(jsonText) {
  const parsed = JSON.parse(jsonText);
  const coll = parsed.collection || parsed; // tolerate a bare collection object too
  writeJSON(KEYS.collection, coll);
  return getCollection();
}

/* ----------------------------- Decks ----------------------------- */

export function listDecks() {
  return readJSON(KEYS.decks, []);
}

export function createDeck(name) {
  const decks = listDecks();
  const deck = { id: uid(), name: name || "New Deck", cards: {}, battlefields: [], createdAt: new Date().toISOString() };
  decks.push(deck);
  writeJSON(KEYS.decks, decks);
  return deck;
}

export function getDeck(deckId) {
  return listDecks().find((d) => d.id === deckId) || null;
}

export function renameDeck(deckId, name) {
  const decks = listDecks();
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) return null;
  deck.name = name;
  writeJSON(KEYS.decks, decks);
  return deck;
}

export function deleteDeck(deckId) {
  writeJSON(KEYS.decks, listDecks().filter((d) => d.id !== deckId));
}

export function setDeckCardQty(deckId, card, qty, { sideboard = false } = {}) {
  const decks = listDecks();
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) return null;
  const bucket = sideboard ? "sideboard" : "cards";
  deck[bucket] = deck[bucket] || {};
  if (qty <= 0) {
    delete deck[bucket][card.id];
  } else {
    deck[bucket][card.id] = { card, qty };
  }
  writeJSON(KEYS.decks, decks);
  return deck;
}

export function setDeckBattlefields(deckId, battlefieldCardIds) {
  const decks = listDecks();
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) return null;
  deck.battlefields = battlefieldCardIds.slice(0, 3);
  writeJSON(KEYS.decks, decks);
  return deck;
}

export function exportDeckJSON(deckId) {
  const deck = getDeck(deckId);
  return deck ? JSON.stringify(deck, null, 2) : null;
}

export function exportDeckText(deckId) {
  const deck = getDeck(deckId);
  if (!deck) return null;
  const lines = [`# ${deck.name}`, ""];
  lines.push("## Main Deck");
  for (const { card, qty } of Object.values(deck.cards || {})) {
    lines.push(`${qty}x ${card.name} (${card.id})`);
  }
  if (deck.sideboard && Object.keys(deck.sideboard).length) {
    lines.push("", "## Sideboard");
    for (const { card, qty } of Object.values(deck.sideboard)) {
      lines.push(`${qty}x ${card.name} (${card.id})`);
    }
  }
  if (deck.battlefields && deck.battlefields.length) {
    lines.push("", "## Battlefields");
    for (const id of deck.battlefields) lines.push(id);
  }
  return lines.join("\n");
}

export function importDeckJSON(jsonText) {
  const deck = JSON.parse(jsonText);
  deck.id = uid(); // never collide with an existing local deck id
  const decks = listDecks();
  decks.push(deck);
  writeJSON(KEYS.decks, decks);
  return deck;
}

/* ----------------------------- Wishlist ----------------------------- */

export function listWishlists() {
  return readJSON(KEYS.wishlist, []);
}

export function createWishlist(name) {
  const lists = listWishlists();
  const list = { id: uid(), name: name || "Wishlist", cards: {} };
  lists.push(list);
  writeJSON(KEYS.wishlist, lists);
  return list;
}

export function addCardToWishlist(listId, card) {
  const lists = listWishlists();
  const list = lists.find((l) => l.id === listId);
  if (!list) return null;
  list.cards[card.id] = { card, addedAt: new Date().toISOString() };
  writeJSON(KEYS.wishlist, lists);
  return list;
}

export function removeCardFromWishlist(listId, cardId) {
  const lists = listWishlists();
  const list = lists.find((l) => l.id === listId);
  if (!list) return null;
  delete list.cards[cardId];
  writeJSON(KEYS.wishlist, lists);
  return list;
}

export function deleteWishlist(listId) {
  writeJSON(KEYS.wishlist, listWishlists().filter((l) => l.id !== listId));
}

/* ----------------------------- Price alerts ----------------------------- */

export function listAlerts() {
  return readJSON(KEYS.alerts, []);
}

export function addAlert(cardId, direction, target) {
  const alerts = listAlerts();
  const alert = { id: uid(), cardId, direction, target: Number(target) };
  alerts.push(alert);
  writeJSON(KEYS.alerts, alerts);
  return alert;
}

export function removeAlert(alertId) {
  writeJSON(KEYS.alerts, listAlerts().filter((a) => a.id !== alertId));
}

/**
 * Compares each alert's target against a current-price lookup function
 * `getPrice(cardId) -> number|null` and returns the ones that should fire.
 * Pure/testable: pass in whatever price source you like (live or mocked).
 */
export function checkAlerts(getPrice) {
  const triggered = [];
  for (const alert of listAlerts()) {
    const price = getPrice(alert.cardId);
    if (price == null) continue;
    if (alert.direction === "below" && price <= alert.target) triggered.push({ ...alert, price });
    if (alert.direction === "above" && price >= alert.target) triggered.push({ ...alert, price });
  }
  return triggered;
}

/* ----------------------------- Price cache ----------------------------- */

export function getCachedPrice(cardId) {
  const prices = readJSON(KEYS.prices, {});
  return prices[cardId] || null;
}

export function setCachedPrice(cardId, day, data) {
  const prices = readJSON(KEYS.prices, {});
  prices[cardId] = { day, data };
  writeJSON(KEYS.prices, prices);
}

/* ----------------------------- Local-only settings (API key) ----------------------------- */
//
// The RapidAPI key, if you choose to enable prices, lives ONLY here —
// browser localStorage on your device. It is never read from or written to
// any file in this repo, and is deliberately excluded from
// exportAllJSON()/importAllJSON() so it can never end up in a collection
// backup you might share with someone else.

export function getApiKey() {
  return readJSON(KEYS.settings, {}).rapidApiKey || "";
}

export function setApiKey(key) {
  const settings = readJSON(KEYS.settings, {});
  settings.rapidApiKey = (key || "").trim();
  writeJSON(KEYS.settings, settings);
}

export function clearApiKey() {
  writeJSON(KEYS.settings, {});
}

/* ----------------------------- Bulk import/export (full state) ----------------------------- */

export function exportAllJSON() {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      collection: getCollection(),
      decks: listDecks(),
      wishlist: listWishlists(),
      alerts: listAlerts(),
    },
    null,
    2
  );
}

export function importAllJSON(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (parsed.collection) writeJSON(KEYS.collection, parsed.collection);
  if (parsed.decks) writeJSON(KEYS.decks, parsed.decks);
  if (parsed.wishlist) writeJSON(KEYS.wishlist, parsed.wishlist);
  if (parsed.alerts) writeJSON(KEYS.alerts, parsed.alerts);
}

/** Wipes collection/decks/wishlist/alerts/prices. Deliberately leaves
 * rbc:settings (your local API key) untouched — wiping your collection
 * shouldn't force you to re-paste your key. */
export function wipeAll() {
  const wipeable = [KEYS.collection, KEYS.decks, KEYS.wishlist, KEYS.alerts, KEYS.prices];
  for (const key of wipeable) backend.set(key, JSON.stringify(key === KEYS.collection || key === KEYS.prices ? {} : []));
}
