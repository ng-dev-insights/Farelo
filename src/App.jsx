import { useState, useEffect, useRef } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (d) => {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const today = () => fmt(new Date());
const nights = (a, b) => {
  if (!a || !b) return 0;
  return Math.max(
    0,
    Math.round(
      (new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000,
    ),
  );
};
const uid = () => Math.random().toString(36).slice(2, 8);
const INR = (n) => `₹${Number(Math.round(n) || 0).toLocaleString("en-IN")}`;
const fmtD = (d) => {
  try {
    return d
      ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
        })
      : "";
  } catch (e) {
    console.warn('Date formatting failed:', e);
    return "";
  }
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const month = (d) => {
  try {
    return new Date(d + "T00:00:00").getMonth();
  } catch (e) {
    console.warn('Month extraction failed:', e);
    return 0;
  }
};

// ─── Persistent storage ───────────────────────────────────────────────────────
const STORE = "tripcost_v2";
const persist = async (trips) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(trips));
  } catch (e) {
    console.warn('Failed to persist trips:', e);
  }
};
const hydrate = async () => {
  try {
    const r = localStorage.getItem(STORE);
    return r ? JSON.parse(r) : [];
  } catch {
    return [];
  }
};

// ─── City normalization ───────────────────────────────────────────────────────
function normalizeCity(str) {
  return str
    .toLowerCase()
    .split(",")[0]
    .replace(
      /\b(airport|city|district|region|marina|north|south|east|west|new|old|greater|metro|international)\b/g,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Session cache ────────────────────────────────────────────────────────────
const MAX_CACHE = 200;
const CACHE = new Map();

// FIX 1: MODEL_VERSION included in cache key — ensures stale entries are
// automatically invalidated whenever the pricing model changes, preventing
// users from seeing old blended data after a deploy.
const MODEL_VERSION = "v1.3.1";

const cacheKey = (from, to, nts, adults, style, m) =>
  `${normalizeCity(from)}-${normalizeCity(to)}-${nts}n-${adults}p-${style}-m${m}-${MODEL_VERSION}`;

function cacheSet(k, data) {
  if (CACHE.has(k)) CACHE.delete(k);
  CACHE.set(k, { data, ts: Date.now() });
  if (CACHE.size > MAX_CACHE) {
    const oldest = CACHE.keys().next().value;
    CACHE.delete(oldest);
  }
}
function cacheGet(k) {
  const entry = CACHE.get(k);
  if (!entry) return null;
  if (Date.now() - entry.ts > 86400000) {
    CACHE.delete(k);
    return null;
  }
  CACHE.delete(k);
  CACHE.set(k, entry);
  return entry.data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BASELINE PRICING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

const TRANSPORT = {
  "mumbai-goa": { lo: 4500, hi: 9000 },
  "delhi-goa": { lo: 5000, hi: 10000 },
  "bangalore-goa": { lo: 3500, hi: 7500 },
  "mumbai-manali": { lo: 5000, hi: 9500 },
  "delhi-manali": { lo: 800, hi: 2500 },
  "delhi-shimla": { lo: 600, hi: 1800 },
  "delhi-jaipur": { lo: 300, hi: 1200 },
  "mumbai-udaipur": { lo: 4000, hi: 8000 },
  "delhi-leh": { lo: 6000, hi: 14000 },
  "mumbai-kochi": { lo: 4500, hi: 9000 },
  "bangalore-munnar": { lo: 500, hi: 2000 },
  "bangalore-ooty": { lo: 400, hi: 1500 },
  "mumbai-varanasi": { lo: 4500, hi: 9000 },
  "delhi-agra": { lo: 400, hi: 1500 },
  "mumbai-kolkata": { lo: 5000, hi: 10000 },
  "india-bali": { lo: 20000, hi: 38000 },
  "india-bangkok": { lo: 15000, hi: 28000 },
  "india-phuket": { lo: 18000, hi: 32000 },
  "india-singapore": { lo: 16000, hi: 30000 },
  "india-kuala lumpur": { lo: 14000, hi: 26000 },
  "india-dubai": { lo: 14000, hi: 28000 },
  "india-abu dhabi": { lo: 14000, hi: 28000 },
  "india-maldives": { lo: 22000, hi: 45000 },
  "india-kathmandu": { lo: 9000, hi: 18000 },
  "india-colombo": { lo: 10000, hi: 20000 },
  "india-istanbul": { lo: 30000, hi: 55000 },
  "india-london": { lo: 45000, hi: 85000 },
  "india-paris": { lo: 45000, hi: 85000 },
  "india-rome": { lo: 42000, hi: 80000 },
  "india-tokyo": { lo: 38000, hi: 70000 },
  "india-seoul": { lo: 32000, hi: 60000 },
  "india-sydney": { lo: 55000, hi: 95000 },
  "india-new york": { lo: 55000, hi: 100000 },
};

const HOTEL = {
  goa: { budget: 1200, mid: 2800, comfortable: 5000, luxury: 12000 },
  manali: { budget: 800, mid: 2000, comfortable: 4000, luxury: 9000 },
  shimla: { budget: 700, mid: 1800, comfortable: 3500, luxury: 8000 },
  jaipur: { budget: 900, mid: 2200, comfortable: 4500, luxury: 11000 },
  udaipur: { budget: 1000, mid: 2800, comfortable: 5500, luxury: 14000 },
  leh: { budget: 800, mid: 2000, comfortable: 4000, luxury: 10000 },
  kochi: { budget: 900, mid: 2200, comfortable: 4500, luxury: 10000 },
  munnar: { budget: 700, mid: 1800, comfortable: 3500, luxury: 8000 },
  ooty: { budget: 600, mid: 1500, comfortable: 3000, luxury: 7000 },
  varanasi: { budget: 700, mid: 1800, comfortable: 3500, luxury: 8000 },
  agra: { budget: 800, mid: 2000, comfortable: 4000, luxury: 10000 },
  darjeeling: { budget: 600, mid: 1500, comfortable: 3000, luxury: 7000 },
  rishikesh: { budget: 600, mid: 1500, comfortable: 3000, luxury: 7000 },
  mumbai: { budget: 1500, mid: 3500, comfortable: 7000, luxury: 18000 },
  delhi: { budget: 1200, mid: 3000, comfortable: 6000, luxury: 16000 },
  bangalore: { budget: 1200, mid: 3000, comfortable: 6000, luxury: 15000 },
  kolkata: { budget: 900, mid: 2200, comfortable: 4500, luxury: 11000 },
  andaman: { budget: 1200, mid: 3000, comfortable: 6000, luxury: 14000 },
  coorg: { budget: 1000, mid: 2500, comfortable: 5000, luxury: 12000 },
  hampi: { budget: 500, mid: 1200, comfortable: 2500, luxury: 6000 },
  kasol: { budget: 500, mid: 1200, comfortable: 2500, luxury: 5000 },
  bali: { budget: 2000, mid: 4500, comfortable: 9000, luxury: 22000 },
  bangkok: { budget: 1800, mid: 4000, comfortable: 8000, luxury: 20000 },
  phuket: { budget: 2200, mid: 5000, comfortable: 10000, luxury: 25000 },
  singapore: { budget: 5000, mid: 9000, comfortable: 16000, luxury: 35000 },
  "kuala lumpur": {
    budget: 2500,
    mid: 5500,
    comfortable: 11000,
    luxury: 25000,
  },
  dubai: { budget: 5500, mid: 11000, comfortable: 20000, luxury: 45000 },
  "abu dhabi": { budget: 5000, mid: 10000, comfortable: 18000, luxury: 40000 },
  maldives: { budget: 8000, mid: 18000, comfortable: 35000, luxury: 80000 },
  kathmandu: { budget: 1200, mid: 2800, comfortable: 6000, luxury: 14000 },
  colombo: { budget: 1500, mid: 3500, comfortable: 7000, luxury: 16000 },
  istanbul: { budget: 3500, mid: 7500, comfortable: 15000, luxury: 35000 },
  london: { budget: 10000, mid: 18000, comfortable: 30000, luxury: 65000 },
  paris: { budget: 10000, mid: 18000, comfortable: 30000, luxury: 70000 },
  rome: { budget: 8000, mid: 15000, comfortable: 26000, luxury: 55000 },
  tokyo: { budget: 7000, mid: 13000, comfortable: 22000, luxury: 50000 },
  seoul: { budget: 5000, mid: 10000, comfortable: 18000, luxury: 40000 },
  sydney: { budget: 9000, mid: 16000, comfortable: 28000, luxury: 60000 },
  "new york": { budget: 12000, mid: 22000, comfortable: 38000, luxury: 80000 },
};

const FOOD = {
  goa: 250,
  manali: 200,
  jaipur: 200,
  udaipur: 250,
  leh: 200,
  kochi: 220,
  munnar: 180,
  ooty: 160,
  varanasi: 180,
  agra: 200,
  shimla: 180,
  rishikesh: 180,
  darjeeling: 160,
  mumbai: 350,
  delhi: 300,
  bangalore: 300,
  kolkata: 220,
  andaman: 280,
  coorg: 220,
  kasol: 180,
  bali: 600,
  bangkok: 500,
  phuket: 650,
  singapore: 1200,
  "kuala lumpur": 700,
  dubai: 1500,
  "abu dhabi": 1400,
  maldives: 2500,
  kathmandu: 350,
  colombo: 400,
  istanbul: 900,
  london: 2500,
  paris: 2800,
  rome: 2500,
  tokyo: 1800,
  seoul: 1400,
  sydney: 2200,
  "new york": 2800,
};

const ACTIVITY = {
  budget: 1200,
  "mid-range": 2500,
  comfortable: 4500,
  luxury: 8000,
};

const SEASON = {
  goa:       [1.3, 1.2, 1.0, 0.7, 0.6, 0.6, 0.7, 0.7, 0.8, 1.1, 1.3, 1.4],
  manali:    [0.5, 0.5, 0.6, 0.8, 1.1, 1.3, 1.4, 1.3, 1.1, 0.9, 0.5, 0.5],
  leh:       [0.3, 0.3, 0.3, 0.5, 0.9, 1.3, 1.4, 1.3, 1.1, 0.7, 0.3, 0.3],
  bali:      [0.9, 0.9, 0.9, 0.9, 1.0, 1.0, 1.3, 1.4, 1.3, 1.1, 0.9, 0.9],
  dubai:     [1.3, 1.3, 1.2, 1.0, 0.7, 0.6, 0.6, 0.6, 0.8, 1.0, 1.2, 1.3],
  jaipur:    [1.1, 1.1, 1.0, 0.8, 0.6, 0.5, 0.5, 0.5, 0.7, 1.0, 1.2, 1.2],
  shimla:    [0.7, 0.7, 0.8, 1.0, 1.2, 1.3, 1.4, 1.3, 1.0, 0.9, 0.6, 0.7],
  singapore: [1.0, 1.0, 1.0, 1.0, 1.1, 1.1, 1.0, 1.0, 1.0, 1.1, 1.2, 1.2],
  bangkok:   [1.1, 1.1, 1.0, 0.9, 0.9, 0.9, 1.0, 1.0, 0.9, 0.9, 1.1, 1.2],
  maldives:  [1.2, 1.2, 1.1, 1.0, 0.8, 0.7, 0.7, 0.8, 0.9, 1.0, 1.1, 1.3],
  udaipur:   [1.1, 1.0, 0.9, 0.8, 0.6, 0.5, 0.5, 0.6, 0.8, 1.0, 1.1, 1.2],
  kochi:     [1.0, 1.0, 0.9, 0.8, 0.7, 0.6, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2],
  andaman:   [1.0, 1.0, 0.9, 0.8, 0.7, 0.5, 0.5, 0.5, 0.7, 0.9, 1.1, 1.2],
  rishikesh: [0.8, 0.8, 1.0, 1.1, 1.2, 0.6, 0.6, 0.6, 1.0, 1.2, 1.0, 0.8],
  default:   [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
};

const INDIA_CITIES = [
  "goa",
  "manali",
  "jaipur",
  "udaipur",
  "mumbai",
  "delhi",
  "bangalore",
  "chennai",
  "hyderabad",
  "kolkata",
  "pune",
  "ahmedabad",
  "lucknow",
  "kochi",
  "shimla",
  "rishikesh",
  "darjeeling",
  "munnar",
  "jodhpur",
  "jaisalmer",
  "leh",
  "srinagar",
  "varanasi",
  "agra",
  "mysore",
  "amritsar",
  "pondicherry",
  "ooty",
  "nainital",
  "gangtok",
  "coorg",
  "hampi",
  "andaman",
  "kasol",
];

function isIntl(str) {
  const n = normalizeCity(str);
  if (INDIA_CITIES.some((c) => n.includes(c))) return false;
  if (
    typeof CITIES !== "undefined" &&
    CITIES.some((c) => normalizeCity(c.city) === n && c.country === "India")
  )
    return false;
  return true;
}

function getTransportKey(from, to) {
  const f = normalizeCity(from);
  const t = normalizeCity(to);
  const intl = isIntl(to);
  if (intl) {
    const direct = `india-${t}`;
    if (TRANSPORT[direct]) return direct;
    return (
      Object.keys(TRANSPORT).find(
        (k) =>
          k.startsWith("india-") &&
          (t.includes(k.replace("india-", "")) ||
            k.replace("india-", "").includes(t)),
      ) || null
    );
  }
  const k1 = `${f}-${t}`,
    k2 = `${t}-${f}`;
  if (TRANSPORT[k1]) return k1;
  if (TRANSPORT[k2]) return k2;
  return null;
}

function getHotelKey(to) {
  const t = normalizeCity(to);
  if (HOTEL[t]) return t;
  return Object.keys(HOTEL).find((k) => t.startsWith(k)) || null;
}

function getFoodPerDay(to) {
  const t = normalizeCity(to);
  if (FOOD[t]) return FOOD[t];
  const key = Object.keys(FOOD).find((k) => t.startsWith(k));
  return key ? FOOD[key] : 400;
}

function getSeason(to, m) {
  const t = normalizeCity(to);
  const key = Object.keys(SEASON).find((k) => t.startsWith(k));
  return (key ? SEASON[key] : SEASON["default"])[m] || 1.0;
}

const STYLE_KEY = {
  Budget: "budget",
  "Mid-range": "mid-range",
  Comfortable: "comfortable",
  Luxury: "luxury",
};

const OUTBOUND_SHARE = 0.65;
const RETURN_SHARE = 0.35;

const RETURN_LEG_FACTOR = {
  flight: 1.0,
  train: 0.25,
  bus: 0.15,
  undecided: 0.6,
};

function getTransportFactor(returnMode) {
  const rlf = RETURN_LEG_FACTOR[returnMode] ?? 1.0;
  return OUTBOUND_SHARE * 1.0 + RETURN_SHARE * rlf;
}

function getBestTimeLabel(to, m) {
  const t = normalizeCity(to);
  const key = Object.keys(SEASON).find((k) => t.startsWith(k)) || "default";
  const arr = SEASON[key];
  const val = arr[m];
  if (val >= 1.2)
    return {
      label: "Peak Season",
      color: "var(--red)",
      icon: "🔴",
      tip: "Prices are at their highest now",
      scarcity: null, // removed fake urgency
    };
  if (val >= 0.9)
    return {
      label: "Good Season",
      color: "var(--gold)",
      icon: "🟡",
      tip: "Solid time to visit",
      scarcity: null,
    };
  return {
    label: "Off Season",
    color: "var(--green)",
    icon: "🟢",
    tip: `${Math.round((1 - val) * 100)}% cheaper than peak`,
    scarcity: null, // removed fake urgency
  };
}

function getBudgetLabel(total) {
  if (total < 25000)
    return { label: "💸 Affordable Weekend Trip", color: "var(--teal)" };
  if (total < 75000)
    return { label: "✨ Moderate Holiday Budget", color: "var(--gold)" };
  if (total < 150000)
    return { label: "🌟 Comfortable Getaway", color: "var(--blue)" };
  return { label: "💎 Premium Getaway", color: "#C084FC" };
}

const AVG_TRIPS = {
  "mumbai-goa": [18000, 32000],
  "delhi-goa": [22000, 38000],
  "bangalore-goa": [16000, 28000],
  "delhi-manali": [12000, 22000],
  "mumbai-manali": [20000, 35000],
  "delhi-jaipur": [6000, 14000],
  "mumbai-udaipur": [18000, 32000],
  "delhi-leh": [28000, 50000],
  "mumbai-kochi": [20000, 35000],
  "bangalore-coorg": [8000, 16000],
  "india-bali": [55000, 90000],
  "india-bangkok": [45000, 75000],
  "india-dubai": [50000, 85000],
  "india-singapore": [55000, 90000],
  "india-maldives": [90000, 160000],
};

function getWhenToBook(checkIn) {
  const now = new Date();
  const travelDt = new Date(checkIn + "T00:00:00");
  const daysOut = Math.round((travelDt - now) / 86400000);

  if (daysOut < 0) return null;
  if (daysOut < 7)
    return {
      icon: "⚡",
      color: "var(--red)",
      head: "Book immediately",
      body: "Prices spike sharply within 7 days of departure. Book right now.",
    };
  if (daysOut < 21)
    return {
      icon: "🔥",
      color: "var(--red)",
      head: "Prices rising fast",
      body: "Within 3 weeks of travel, fares increase daily. Check and lock in today.",
    };
  if (daysOut < 45)
    return {
      icon: "✅",
      color: "var(--green)",
      head: "Good time to book",
      body: "30–45 days out is the sweet spot — prices are fair and seats are available.",
    };
  if (daysOut < 90)
    return {
      icon: "💡",
      color: "var(--gold)",
      head: "Keep an eye on prices",
      body: "Fares are usually stable here. Set a price alert and book within 4–6 weeks.",
    };
  return {
    icon: "🗓️",
    color: "var(--blue)",
    head: "Too early to book flights",
    body: `${daysOut} days out — wait until 6–8 weeks before departure for best fares.`,
  };
}

function getAvgTrip(from, to) {
  const f = normalizeCity(from);
  const t = normalizeCity(to);
  const intl = isIntl(to);
  if (intl) {
    const k = Object.keys(AVG_TRIPS).find(
      (k) => k.startsWith("india-") && k.includes(t),
    );
    return k ? AVG_TRIPS[k] : null;
  }
  const k1 = `${f}-${t}`,
    k2 = `${t}-${f}`;
  return AVG_TRIPS[k1] || AVG_TRIPS[k2] || null;
}

// ─── Analytics ────────────────────────────────────────────────────────────────
const ANALYTICS = { searches: [], clicks: [] };

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const _flushCounter = debounce((key) => {
  try {
    const prevRaw = localStorage.getItem(key);
    const prev = prevRaw ? JSON.parse(prevRaw) : { count: 0 };
    localStorage.setItem(
      key,
      JSON.stringify({
        count: (prev.count || 0) + 1,
        lastSeen: Date.now(),
      })
    );
  } catch (error) {
    console.warn('Debounce error:', error);
  }
}, 2000);

function trackSearch(from, to, nts, adults, style) {
  try {
    ANALYTICS.searches.push({
      route: `${normalizeCity(from)}-${normalizeCity(to)}`,
      nights: nts,
      adults,
      style,
      intl: isIntl(to),
      ts: Date.now(),
    });
    if (ANALYTICS.searches.length > 500) ANALYTICS.searches.shift();
    _flushCounter(`analytics_search_${normalizeCity(to)}`);
    _flushCounter(
      `analytics_route_${normalizeCity(from)}_${normalizeCity(to)}`,
    );
  } catch (e) {
    console.warn('Track search failed:', e);
  }
}
function trackClick(type, destination) {
  try {
    ANALYTICS.clicks.push({
      type,
      destination: normalizeCity(destination),
      ts: Date.now(),
    });
    if (ANALYTICS.clicks.length > 500) ANALYTICS.clicks.shift();
    _flushCounter(`analytics_click_${type}`);
    _flushCounter(`analytics_click_${type}_${normalizeCity(destination)}`);
    // GA4 affiliate click event
    try {
      if (window._gtagReady && typeof window.gtag === "function") {
        window.gtag("event", "affiliate_click", {
          link_type: type,
          destination: normalizeCity(destination),
        });
      }
    } catch (error) {
      // Silently ignore GA errors — analytics failure should not break the app
      if (typeof console !== "undefined" && console.debug) {
        console.debug("GA affiliate click event failed:", error);
      }
    }
  } catch (e) {
    console.warn('Track click failed:', e);
  }
}
if (typeof window !== "undefined") window.__fareloAnalytics = ANALYTICS;

function getConfidence(from, to) {
  const transportKey = getTransportKey(from, to);
  const hotelKey = getHotelKey(to);
  if (transportKey && hotelKey) return "high";
  if (hotelKey || transportKey) return "medium";
  return "low";
}

function computeBaseline(
  from,
  to,
  nts,
  adults,
  style,
  checkIn,
  returnMode = "flight",
) {
  const pax = parseInt(adults) || 1;
  const sk = STYLE_KEY[style] || "mid-range";
  const m = month(checkIn);
  const seasonM = getSeason(to, m);
  const intl = isIntl(to);

  const seasonDamped = 1 + (seasonM - 1) * 0.5;

  const tKey = getTransportKey(from, to);
  let tBase = tKey
    ? TRANSPORT[tKey]
    : intl
      ? { lo: 18000, hi: 40000 }
      : { lo: 2000, hi: 7000 };

  const styleMul =
    sk === "luxury"
      ? 1.4
      : sk === "comfortable"
        ? 1.15
        : sk === "budget"
          ? 0.85
          : 1;

  // FIX 2: International trips must always use round-trip flight pricing.
  // Train/bus return modes only make sense for domestic routes — applying
  // the discount factor to a Mumbai→London estimate would be incorrect.
  const effectiveReturnMode = intl ? "flight" : returnMode;
  const rf = getTransportFactor(effectiveReturnMode);

  const transport_lo = Math.round(tBase.lo * pax * styleMul * rf);
  const transport_hi = Math.round(
    tBase.hi *
      pax *
      (sk === "luxury"
        ? 1.5
        : sk === "comfortable"
          ? 1.2
          : sk === "budget"
            ? 0.9
            : 1) *
      rf,
  );

  const rooms = Math.max(1, Math.ceil(pax / 2)); // guard against 0 rooms
  const hKey = getHotelKey(to);
  const hRates = hKey
    ? HOTEL[hKey]
    : intl
      ? { budget: 3000, mid: 7000, comfortable: 14000, luxury: 30000 }
      : { budget: 800, mid: 2000, comfortable: 4000, luxury: 10000 };
  const hRate = hRates[sk] || hRates["mid-range"] || 2000;
  const stay_lo = Math.round(hRate * 0.8 * rooms * nts * seasonDamped);
  const stay_hi = Math.round(hRate * 1.2 * rooms * nts * seasonDamped);

  const fpd = getFoodPerDay(to);
  const food_lo = Math.round(
    fpd *
      0.75 *
      pax *
      nts *
      (sk === "budget" ? 0.7 : sk === "luxury" ? 1.5 : 1),
  );
  const food_hi = Math.round(
    fpd * 1.4 * pax * nts * (sk === "budget" ? 0.8 : sk === "luxury" ? 2.0 : 1),
  );

  const actBase = ACTIVITY[sk] || 2500;
  const activities_lo = Math.round(actBase * 0.7 * pax);
  const activities_hi = Math.round(actBase * 1.4 * pax);

  const total_lo = transport_lo + stay_lo + food_lo + activities_lo;
  const total_hi = transport_hi + stay_hi + food_hi + activities_hi;

  return {
    transport_lo,
    transport_hi,
    stay_lo,
    stay_hi,
    food_lo,
    food_hi,
    activities_lo,
    activities_hi,
    total_lo,
    total_hi,
    per_person_lo: Math.round(total_lo / pax),
    per_person_hi: Math.round(total_hi / pax),
    tips: [],
    source: "baseline",
    confidence: getConfidence(from, to),
    season_multiplier: seasonM,
    return_factor: rf,
    // Expose the effective mode so the UI can reflect what was actually used
    return_mode: effectiveReturnMode,
    generated_at: Date.now(),
  };
}

function sanityBlend(ai, baseline) {
  const fields = [
    "transport_lo",
    "transport_hi",
    "stay_lo",
    "stay_hi",
    "food_lo",
    "food_hi",
    "activities_lo",
    "activities_hi",
  ];
  const blended = {};
  for (const f of fields) {
    const b = baseline[f];
    const a = ai[f] || b;
    const clamped = clamp(a, b * 0.4, b * 2.5);
    blended[f] = Math.round(b * 0.3 + clamped * 0.7);
  }
  blended.total_lo =
    blended.transport_lo +
    blended.stay_lo +
    blended.food_lo +
    blended.activities_lo;
  blended.total_hi =
    blended.transport_hi +
    blended.stay_hi +
    blended.food_hi +
    blended.activities_hi;
  const pax = ai.pax || 1;
  blended.per_person_lo = Math.round(blended.total_lo / pax);
  blended.per_person_hi = Math.round(blended.total_hi / pax);
  blended.tips = Array.isArray(ai.tips) ? ai.tips.slice(0, 3) : [];
  blended.source = "ai_blended";
  blended.confidence = baseline.confidence;
  blended.season_multiplier = baseline.season_multiplier;
  blended.return_factor = baseline.return_factor;
  blended.return_mode = baseline.return_mode;
  blended.generated_at = Date.now();

  const baseTotalHi = baseline.total_hi || 1;
  const delta = Math.round(
    ((blended.total_hi - baseTotalHi) / baseTotalHi) * 100,
  );
  blended.ai_delta_pct = Math.abs(delta) >= 3 ? delta : 0;

  return blended;
}

async function callAI(prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000); // 6s — fail fast on slow networks, baseline already visible
  try {
    // Use OpenAI ChatGPT via local proxy
    const res = await fetch("/api/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini", // fast, cheap, significantly smarter than gpt-3.5-turbo
        max_tokens: 350,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timer);
    const j = await res.json();
    if (!res.ok || j.error)
      throw new Error(j.error?.message || `HTTP ${res.status}`);
    return j.choices?.[0]?.message?.content || "";
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function refineWithAI(from, to, nts, adults, style, checkIn, baseline) {
  const pax = parseInt(adults) || 1;
  const mo = new Date(checkIn + "T00:00:00").toLocaleString("en", {
    month: "long",
  });
  const intl = isIntl(to);
  const fromCity = from.split(",")[0];
  const toCity = to.split(",")[0];

  const prompt = `You are a travel cost expert for Indian travellers.
Trip: ${fromCity} → ${toCity}, ${nts} nights, ${pax} adult(s), ${style}, ${mo}. International: ${intl}.
Baseline estimates (INR): transport ₹${baseline.transport_lo}–${baseline.transport_hi}, stay ₹${baseline.stay_lo}–${baseline.stay_hi}, food ₹${baseline.food_lo}–${baseline.food_hi}, activities ₹${baseline.activities_lo}–${baseline.activities_hi}.

Adjust ONLY if you have a strong reason (peak season, major events, inflation). Return ONLY this JSON (no other text):
{"transport_lo":0,"transport_hi":0,"stay_lo":0,"stay_hi":0,"food_lo":0,"food_hi":0,"activities_lo":0,"activities_hi":0,"pax":${pax},"tips":["tip1","tip2","tip3"]}

STRICT RULES: All values must be positive integers in INR. No decimals. No nulls. No strings. No negative numbers.`;

  const raw = await callAI(prompt);
  const text = raw.replace(/```json|```/gi, "").trim();
  const s = text.indexOf("{"),
    e = text.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("AI: no JSON braces found");
  let parsed;
  try {
    parsed = JSON.parse(text.slice(s, e + 1));
  } catch (jsonErr) {
    throw new Error(`AI: JSON parse failed — ${jsonErr.message}`);
  }

  const numFields = [
    "transport_lo",
    "transport_hi",
    "stay_lo",
    "stay_hi",
    "food_lo",
    "food_hi",
    "activities_lo",
    "activities_hi",
  ];
  let validFields = 0;
  for (const f of numFields) {
    const v = parsed[f];
    if (typeof v !== "number" || !isFinite(v) || v < 0) {
      parsed[f] = baseline[f];
    } else {
      parsed[f] = Math.round(v);
      validFields++;
    }
  }
  if (validFields < 4)
    throw new Error(`AI: only ${validFields}/8 fields valid, rejecting`);
  if (!Array.isArray(parsed.tips)) parsed.tips = [];
  parsed.tips = parsed.tips
    .filter((t) => typeof t === "string" && t.trim().length > 5)
    .slice(0, 3);
  return parsed;
}

async function estimateBudget(
  from,
  to,
  nts,
  adults,
  style,
  checkIn,
  onInstant,
  returnMode = "flight",
) {
  const m = month(checkIn);
  const ck = cacheKey(from, to, nts, adults, style, m) + `-${returnMode}`;

  const cached = cacheGet(ck);
  if (cached) {
    onInstant(cached, true);
    return cached;
  }

  const baseline = computeBaseline(
    from,
    to,
    nts,
    adults,
    style,
    checkIn,
    returnMode,
  );
  onInstant(baseline, false);

  try {
    const ai = await refineWithAI(
      from,
      to,
      nts,
      adults,
      style,
      checkIn,
      baseline,
    );
    const blended = sanityBlend(ai, baseline);
    cacheSet(ck, blended);
    return blended;
  } catch {
    const fallback = {
      ...baseline,
      source: "baseline",
      tips: [
        "Book trains 60 days ahead on IRCTC for best prices",
        "Weekday travel is 15–20% cheaper than weekends",
        "Local restaurants cost 40–60% less than tourist spots",
      ],
    };
    cacheSet(ck, fallback);
    return fallback;
  }
}

// ─── City list ────────────────────────────────────────────────────────────────
const CITIES = [
  { city: "Mumbai", st: "MH", country: "India" },
  { city: "Delhi", st: "DL", country: "India" },
  { city: "Bangalore", st: "KA", country: "India" },
  { city: "Chennai", st: "TN", country: "India" },
  { city: "Hyderabad", st: "TS", country: "India" },
  { city: "Kolkata", st: "WB", country: "India" },
  { city: "Pune", st: "MH", country: "India" },
  { city: "Ahmedabad", st: "GJ", country: "India" },
  { city: "Jaipur", st: "RJ", country: "India" },
  { city: "Lucknow", st: "UP", country: "India" },
  { city: "Kochi", st: "KL", country: "India" },
  { city: "Goa", st: "GA", country: "India" },
  { city: "Manali", st: "HP", country: "India" },
  { city: "Shimla", st: "HP", country: "India" },
  { city: "Rishikesh", st: "UK", country: "India" },
  { city: "Darjeeling", st: "WB", country: "India" },
  { city: "Munnar", st: "KL", country: "India" },
  { city: "Udaipur", st: "RJ", country: "India" },
  { city: "Jodhpur", st: "RJ", country: "India" },
  { city: "Jaisalmer", st: "RJ", country: "India" },
  { city: "Leh", st: "LA", country: "India" },
  { city: "Srinagar", st: "JK", country: "India" },
  { city: "Varanasi", st: "UP", country: "India" },
  { city: "Agra", st: "UP", country: "India" },
  { city: "Mysore", st: "KA", country: "India" },
  { city: "Amritsar", st: "PB", country: "India" },
  { city: "Pondicherry", st: "PY", country: "India" },
  { city: "Ooty", st: "TN", country: "India" },
  { city: "Nainital", st: "UK", country: "India" },
  { city: "Gangtok", st: "SK", country: "India" },
  { city: "Coorg", st: "KA", country: "India" },
  { city: "Hampi", st: "KA", country: "India" },
  { city: "Andaman", st: "AN", country: "India" },
  { city: "Kasol", st: "HP", country: "India" },
  { city: "Bali", st: "", country: "Indonesia" },
  { city: "Bangkok", st: "", country: "Thailand" },
  { city: "Phuket", st: "", country: "Thailand" },
  { city: "Singapore", st: "", country: "Singapore" },
  { city: "Kuala Lumpur", st: "", country: "Malaysia" },
  { city: "Dubai", st: "", country: "UAE" },
  { city: "Abu Dhabi", st: "", country: "UAE" },
  { city: "Maldives", st: "", country: "Maldives" },
  { city: "Kathmandu", st: "", country: "Nepal" },
  { city: "Colombo", st: "", country: "Sri Lanka" },
  { city: "Istanbul", st: "", country: "Turkey" },
  { city: "London", st: "", country: "UK" },
  { city: "Paris", st: "", country: "France" },
  { city: "Rome", st: "", country: "Italy" },
  { city: "Tokyo", st: "", country: "Japan" },
  { city: "Seoul", st: "", country: "South Korea" },
  { city: "Sydney", st: "", country: "Australia" },
  { city: "New York", st: "", country: "USA" },
];
const FLAGS = {
  India: "🇮🇳",
  UAE: "🇦🇪",
  UK: "🇬🇧",
  USA: "🇺🇸",
  Japan: "🇯🇵",
  France: "🇫🇷",
  Thailand: "🇹🇭",
  Indonesia: "🇮🇩",
  Singapore: "🇸🇬",
  Australia: "🇦🇺",
  Malaysia: "🇲🇾",
  Nepal: "🇳🇵",
  "Sri Lanka": "🇱🇰",
  Turkey: "🇹🇷",
  Maldives: "🇲🇻",
  "South Korea": "🇰🇷",
  Italy: "🇮🇹",
};

const searchCities = (q) => {
  if (!q || q.trim().length < 1) return [];
  const lq = q.toLowerCase().trim();
  return CITIES.map((c) => {
    const n = c.city.toLowerCase(),
      co = c.country.toLowerCase();
    let s =
      n === lq
        ? 100
        : n.startsWith(lq)
          ? 80
          : n.includes(lq)
            ? 55
            : co.startsWith(lq)
              ? 25
              : co.includes(lq)
                ? 12
                : 0;
    return { ...c, score: s };
  })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);
};

const CITY_DATA = {
  mumbai: { iata: "BOM", mmtSlug: "mumbai", booking: "Mumbai" },
  delhi: { iata: "DEL", mmtSlug: "new-delhi", booking: "New+Delhi" },
  bangalore: { iata: "BLR", mmtSlug: "bengaluru", booking: "Bangalore" },
  chennai: { iata: "MAA", mmtSlug: "chennai", booking: "Chennai" },
  hyderabad: { iata: "HYD", mmtSlug: "hyderabad", booking: "Hyderabad" },
  kolkata: { iata: "CCU", mmtSlug: "kolkata", booking: "Kolkata" },
  pune: { iata: "PNQ", mmtSlug: "pune", booking: "Pune" },
  ahmedabad: { iata: "AMD", mmtSlug: "ahmedabad", booking: "Ahmedabad" },
  jaipur: { iata: "JAI", mmtSlug: "jaipur", booking: "Jaipur" },
  lucknow: { iata: "LKO", mmtSlug: "lucknow", booking: "Lucknow" },
  kochi: { iata: "COK", mmtSlug: "kochi", booking: "Kochi" },
  goa: { iata: "GOI", mmtSlug: "goa", booking: "Goa" },
  manali: { iata: "KUU", mmtSlug: "manali", booking: "Manali" },
  shimla: { iata: "SLV", mmtSlug: "shimla", booking: "Shimla" },
  rishikesh: { iata: "DED", mmtSlug: "rishikesh", booking: "Rishikesh" },
  darjeeling: { iata: "IXB", mmtSlug: "darjeeling", booking: "Darjeeling" },
  munnar: { iata: "COK", mmtSlug: "munnar", booking: "Munnar" },
  udaipur: { iata: "UDR", mmtSlug: "udaipur", booking: "Udaipur" },
  jodhpur: { iata: "JDH", mmtSlug: "jodhpur", booking: "Jodhpur" },
  jaisalmer: { iata: "JSA", mmtSlug: "jaisalmer", booking: "Jaisalmer" },
  leh: { iata: "IXL", mmtSlug: "leh", booking: "Leh" },
  srinagar: { iata: "SXR", mmtSlug: "srinagar", booking: "Srinagar" },
  varanasi: { iata: "VNS", mmtSlug: "varanasi", booking: "Varanasi" },
  agra: { iata: "AGR", mmtSlug: "agra", booking: "Agra" },
  mysore: { iata: "MYQ", mmtSlug: "mysuru", booking: "Mysore" },
  amritsar: { iata: "ATQ", mmtSlug: "amritsar", booking: "Amritsar" },
  pondicherry: { iata: "PNY", mmtSlug: "pondicherry", booking: "Pondicherry" },
  ooty: { iata: "CJB", mmtSlug: "ooty", booking: "Ooty" },
  nainital: { iata: "PGH", mmtSlug: "nainital", booking: "Nainital" },
  gangtok: { iata: "BDO", mmtSlug: "gangtok", booking: "Gangtok" },
  coorg: { iata: "MYQ", mmtSlug: "coorg", booking: "Coorg" },
  hampi: { iata: "HBX", mmtSlug: "hampi", booking: "Hampi" },
  andaman: { iata: "IXZ", mmtSlug: "port-blair", booking: "Port+Blair" },
  kasol: { iata: "KUU", mmtSlug: "kasol", booking: "Kasol" },
  // International — mmtCityCode & mmtCountry power the hotel-listing URL format
  // Format: /hotels/hotel-listing/?checkin=DDMMYYYY&city=CTXXXX&country=XXX&...
  bali: {
    iata: "DPS",
    mmtSlug: "bali",
    booking: "Bali",
    mmtCityCode: "CTBALIN",
    mmtCountry: "IDN",
    mmtSearch: "Bali",
  },
  bangkok: {
    iata: "BKK",
    mmtSlug: "bangkok",
    booking: "Bangkok",
    mmtCityCode: "CTBANGK",
    mmtCountry: "THA",
    mmtSearch: "Bangkok",
  },
  phuket: {
    iata: "HKT",
    mmtSlug: "phuket",
    booking: "Phuket",
    mmtCityCode: "CTPHUKE",
    mmtCountry: "THA",
    mmtSearch: "Phuket",
  },
  singapore: {
    iata: "SIN",
    mmtSlug: "singapore",
    booking: "Singapore",
    mmtCityCode: "CTSINAP",
    mmtCountry: "SGP",
    mmtSearch: "Singapore",
  },
  "kuala lumpur": {
    iata: "KUL",
    mmtSlug: "kuala-lumpur",
    booking: "Kuala+Lumpur",
    mmtCityCode: "CTKUALA",
    mmtCountry: "MYS",
    mmtSearch: "Kuala+Lumpur",
  },
  dubai: {
    iata: "DXB",
    mmtSlug: "dubai",
    booking: "Dubai",
    mmtCityCode: "CTDUBAI",
    mmtCountry: "ARE",
    mmtSearch: "Dubai",
  },
  "abu dhabi": {
    iata: "AUH",
    mmtSlug: "abu-dhabi",
    booking: "Abu+Dhabi",
    mmtCityCode: "CTABUDH",
    mmtCountry: "ARE",
    mmtSearch: "Abu+Dhabi",
  },
  maldives: {
    iata: "MLE",
    mmtSlug: "maldives",
    booking: "Maldives",
    mmtCityCode: "CTMALE0",
    mmtCountry: "MDV",
    mmtSearch: "Maldives",
  },
  kathmandu: {
    iata: "KTM",
    mmtSlug: "kathmandu",
    booking: "Kathmandu",
    mmtCityCode: "CTKATMD",
    mmtCountry: "NPL",
    mmtSearch: "Kathmandu",
  },
  colombo: {
    iata: "CMB",
    mmtSlug: "colombo",
    booking: "Colombo",
    mmtCityCode: "CTCOLOM",
    mmtCountry: "LKA",
    mmtSearch: "Colombo",
  },
  istanbul: {
    iata: "IST",
    mmtSlug: "istanbul",
    booking: "Istanbul",
    mmtCityCode: "CTISTAN",
    mmtCountry: "TUR",
    mmtSearch: "Istanbul",
  },
  london: {
    iata: "LON",
    mmtSlug: "london",
    booking: "London",
    mmtCityCode: "CTLONDO",
    mmtCountry: "GBR",
    mmtSearch: "London",
  },
  paris: {
    iata: "PAR",
    mmtSlug: "paris",
    booking: "Paris",
    mmtCityCode: "CTPARIS",
    mmtCountry: "FRA",
    mmtSearch: "Paris",
  },
  rome: {
    iata: "ROM",
    mmtSlug: "rome",
    booking: "Rome",
    mmtCityCode: "CTROME0",
    mmtCountry: "ITA",
    mmtSearch: "Rome",
  },
  tokyo: {
    iata: "TYO",
    mmtSlug: "tokyo",
    booking: "Tokyo",
    mmtCityCode: "CTTOKYO",
    mmtCountry: "JPN",
    mmtSearch: "Tokyo",
  },
  seoul: {
    iata: "SEL",
    mmtSlug: "seoul",
    booking: "Seoul",
    mmtCityCode: "CTSEOUL",
    mmtCountry: "KOR",
    mmtSearch: "Seoul",
  },
  sydney: {
    iata: "SYD",
    mmtSlug: "sydney",
    booking: "Sydney",
    mmtCityCode: "CTSYNEY",
    mmtCountry: "AUS",
    mmtSearch: "Sydney",
  },
  "new york": {
    iata: "NYC",
    mmtSlug: "new-york",
    booking: "New+York",
    mmtCityCode: "CTNEWYO",
    mmtCountry: "USA",
    mmtSearch: "New+York",
  },
};

function getCityData(nameRaw) {
  const name = normalizeCity(nameRaw);
  if (CITY_DATA[name]) return CITY_DATA[name];
  const key = Object.keys(CITY_DATA).find((k) => name.startsWith(k));
  return key ? CITY_DATA[key] : null;
}

function buildAffiliates(
  from,
  to,
  checkIn,
  checkOut,
  adults,
  returnMode = "flight",
) {
  const pax = Math.min(9, parseInt(adults) || 1); // booking platforms cap at 9 adults
  const fromD = getCityData(from);
  const toD = getCityData(to);
  const intlTrip = isIntl(to);

  const isValidDate = (d) => {
    if (!d || typeof d !== "string") return false;
    const dt = new Date(d + "T00:00:00");
    return !isNaN(dt.getTime());
  };

  const mmtDate = (d) => {
    if (!isValidDate(d)) return "";
    const [y, mo, day] = d.split("-");
    return `${day}/${mo}/${y}`;
  };

  const bkDate = (d) => (isValidDate(d) ? d : "");

  const goiDateFmt = (d) => {
    if (!isValidDate(d)) return "";
    const [y, mo, day] = d.split("-");
    return `${day}/${mo}/${y}`;
  };

  const skyDate = (d) => {
    if (!isValidDate(d)) return "";
    const dt = new Date(d + "T00:00:00");
    const yy = String(dt.getFullYear()).slice(2);
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}${mm}${dd}`;
  };

  const fromIATA = fromD?.iata || "DEL";
  const toIATA = toD?.iata || "GOI";

  const ciMMT = mmtDate(checkIn);
  const coMMT = mmtDate(checkOut);
  const ciGOI = goiDateFmt(checkIn);
  const coGOI = goiDateFmt(checkOut);
  const ciSKY = skyDate(checkIn);
  const coSKY = skyDate(checkOut);

  // FIX 2 (UI side): International trips always use round-trip flight links
  // regardless of what the user selected in the return mode picker.
  const effectiveReturnMode = intlTrip ? "flight" : returnMode;
  const wantsRoundTripFlight =
    effectiveReturnMode === "flight" && ciMMT && coMMT;

  const mmtFlight = wantsRoundTripFlight
    ? `https://www.makemytrip.com/flight/search?tripType=R&itinerary=${fromIATA}-${toIATA}-${ciMMT}_${toIATA}-${fromIATA}-${coMMT}&paxType=A-${pax}_C-0_I-0&cabinClass=E&intl=${intlTrip ? "true" : "false"}&forwardFlowRequired=true`
    : ciMMT
      ? `https://www.makemytrip.com/flight/search?tripType=O&itinerary=${fromIATA}-${toIATA}-${ciMMT}&paxType=A-${pax}_C-0_I-0&cabinClass=E&intl=${intlTrip ? "true" : "false"}&forwardFlowRequired=true`
      : `https://www.makemytrip.com/flights/`;

  const goibibo = wantsRoundTripFlight
    ? `https://www.goibibo.com/flight/search?itinerary=${fromIATA}-${toIATA}-${ciGOI}_${toIATA}-${fromIATA}-${coGOI}&tripType=R&paxType=A-${pax}_C-0_I-0&intl=${intlTrip ? "true" : "false"}&cabinClass=E&lang=eng`
    : ciGOI
      ? `https://www.goibibo.com/flight/search?itinerary=${fromIATA}-${toIATA}-${ciGOI}&tripType=O&paxType=A-${pax}_C-0_I-0&intl=${intlTrip ? "true" : "false"}&cabinClass=E&lang=eng`
      : `https://www.goibibo.com/`;

  const sky = wantsRoundTripFlight
    ? `https://www.skyscanner.co.in/transport/flights/${fromIATA.toLowerCase()}/${toIATA.toLowerCase()}/${ciSKY}/${coSKY}/?adultsv2=${pax}&cabinclass=economy&childrenv2=&ref=home&rtn=1&outboundaltsenabled=false&inboundaltsenabled=false&preferdirects=false`
    : ciSKY
      ? `https://www.skyscanner.co.in/transport/flights/${fromIATA.toLowerCase()}/${toIATA.toLowerCase()}/${ciSKY}/?adultsv2=${pax}&cabinclass=economy&childrenv2=&ref=home&rtn=0&outboundaltsenabled=false&inboundaltsenabled=false&preferdirects=false`
      : `https://www.skyscanner.co.in/`;

  const bookingFlight = wantsRoundTripFlight
    ? `https://flights.booking.com/flights/${fromIATA}.CITY-${toIATA}.AIRPORT/?type=ROUNDTRIP&adults=${pax}&cabinClass=ECONOMY&from=${fromIATA}.CITY&to=${toIATA}.AIRPORT&depart=${bkDate(checkIn)}&return=${bkDate(checkOut)}&sort=BEST&travelPurpose=leisure`
    : bkDate(checkIn)
      ? `https://flights.booking.com/flights/${fromIATA}.CITY-${toIATA}.AIRPORT/?type=ONEWAY&adults=${pax}&cabinClass=ECONOMY&from=${fromIATA}.CITY&to=${toIATA}.AIRPORT&depart=${bkDate(checkIn)}&sort=BEST&travelPurpose=leisure`
      : `https://flights.booking.com/`;

  const irctc = `https://www.irctc.co.in/nget/train-search`;

  // MMT hotel date format: DDMMYYYY (no separators)
  const mmtHotelDate = (d) => {
    if (!isValidDate(d)) return "";
    const [y, mo, day] = d.split("-");
    return `${day}${mo}${y}`;
  };
  const _rooms = Math.max(1, Math.ceil(pax / 2));
  // roomStayQualifier: {adults_per_room}e0e  |  rsc: 1e{total_adults}e0e
  const rStayQ = `${pax}e0e`;
  const rsc = `1e${pax}e0e`;

  let mmtHotel;
  if (intlTrip && toD?.mmtCityCode) {
    // International hotel-listing deep-link (matches MMT's own URL structure)
    const ci = mmtHotelDate(checkIn);
    const co = mmtHotelDate(checkOut);
    mmtHotel = `https://www.makemytrip.com/hotels/hotel-listing/?checkin=${ci}&city=${toD.mmtCityCode}&checkout=${co}&roomStayQualifier=${rStayQ}&locusId=${toD.mmtCityCode}&country=${toD.mmtCountry}&locusType=city&searchText=${toD.mmtSearch}&regionNearByExp=3&rsc=${rsc}`;
  } else {
    // Domestic slug-based URL
    const mmtHotelSlug =
      toD?.mmtSlug || to.split(",")[0].toLowerCase().replace(/\s+/g, "-");
    mmtHotel = `https://www.makemytrip.com/hotels/${mmtHotelSlug}-hotels.html`;
  }
  const toBooking = toD?.booking || encodeURIComponent(to.split(",")[0]);
  const booking = `https://www.booking.com/search.html?ss=${toBooking}&checkin=${bkDate(checkIn)}&checkout=${bkDate(checkOut)}&group_adults=${pax}&no_rooms=1&group_children=0`;

  return {
    mmtFlight,
    mmtHotel,
    goibibo,
    booking,
    bookingFlight,
    sky,
    irctc,
    returnMode: effectiveReturnMode,
  };
}

function buildShareText(from, to, nts, adults, style, budget) {
  const f = from.split(",")[0];
  const t = to.split(",")[0];
  const pax = parseInt(adults) || 1;
  return `✈️ *${f} → ${t} Trip Cost*

📅 ${nts} nights · ${pax} adult${pax > 1 ? "s" : ""} · ${style}
💰 Total: *${INR(budget.total_lo)} – ${INR(budget.total_hi)}*
👤 Per person: ${INR(budget.per_person_lo)} – ${INR(budget.per_person_hi)}

Breakdown:
✈️ Transport: ${INR(budget.transport_lo)}–${INR(budget.transport_hi)}
🏨 Stay: ${INR(budget.stay_lo)}–${INR(budget.stay_hi)}
🍽️ Food: ${INR(budget.food_lo)}–${INR(budget.food_hi)}
🎯 Activities: ${INR(budget.activities_lo)}–${INR(budget.activities_hi)}

Plan your trip 👉 https://farelo.in
_Know your trip cost before you book_`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Syne:wght@700&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

/* ── Dark theme (default) ── */
:root,[data-theme="dark"]{
  --bg:#09090F;--bg1:#0E0E17;--bg2:#141420;--bg3:#1A1A28;
  --border:rgba(255,255,255,0.055);--border2:rgba(255,255,255,0.1);
  --text:#EEEEF8;--muted:#56567A;--muted2:#37374F;
  --shadow:rgba(0,0,0,.6);
  --gold:#F5A623;--gold-dim:rgba(245,166,35,0.1);--gold-border:rgba(245,166,35,0.24);
  --teal:#00D4AA;--teal-dim:rgba(0,212,170,0.09);
  --blue:#5B8FF9;--blue-dim:rgba(91,143,249,0.09);
  --red:#FF6B6B;--green:#34D399;
}

/* ── Light theme ── */
[data-theme="light"]{
  --bg:#F5F5FA;--bg1:#FFFFFF;--bg2:#EEEEF6;--bg3:#E2E2EE;
  --border:rgba(0,0,0,0.08);--border2:rgba(0,0,0,0.14);
  --text:#111128;--muted:#6B6B90;--muted2:#9898B8;
  --shadow:rgba(0,0,0,.12);
  --gold:#D4850A;--gold-dim:rgba(212,133,10,0.1);--gold-border:rgba(212,133,10,0.28);
  --teal:#008F73;--teal-dim:rgba(0,143,115,0.09);
  --blue:#3D6FD4;--blue-dim:rgba(61,111,212,0.09);
  --red:#D93535;--green:#1A9E6E;
}

body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased;transition:background .25s,color .25s}
::selection{background:rgba(245,166,35,0.2);color:var(--gold)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--bg3);border-radius:4px}
[data-theme="light"] input[type=date]::-webkit-calendar-picker-indicator{filter:none;cursor:pointer}
[data-theme="dark"]  input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.3);cursor:pointer}
select option{background:var(--bg2)}
input,select{color:var(--text)!important;caret-color:var(--gold)}
input::placeholder{color:var(--muted)!important}

@keyframes fadeUp  {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn  {from{opacity:0}to{opacity:1}}
@keyframes scaleIn {from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes spin    {to{transform:rotate(360deg)}}
@keyframes pulse   {0%,100%{opacity:.06;transform:scale(.9)}50%{opacity:.16;transform:scale(1.04)}}
@keyframes float   {0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes glow    {0%,100%{box-shadow:0 0 8px rgba(245,166,35,.18)}50%{box-shadow:0 0 22px rgba(245,166,35,.48)}}
@keyframes confetti{0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(-150px) rotate(720deg);opacity:0}}
@keyframes shimmer {0%,100%{opacity:.5}50%{opacity:1}}
@keyframes barFill {from{width:0}to{width:var(--w)}}
@keyframes popIn   {from{transform:scale(.8);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes drawLine{from{stroke-dashoffset:320}to{stroke-dashoffset:0}}
@keyframes planeFly{from{offset-distance:0%}to{offset-distance:100%}}
@keyframes stepIn  {from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
@keyframes progressFill{from{width:0%}to{width:100%}}

.fu{animation:fadeUp .38s cubic-bezier(.22,1,.36,1) both}
.fi{animation:fadeIn .28s ease both}
.si{animation:scaleIn .28s cubic-bezier(.22,1,.36,1) both}
.pi{animation:popIn .32s cubic-bezier(.22,1,.36,1) both}

button:not(:disabled):active{transform:scale(0.96)!important}

.stagger>*:nth-child(1){animation-delay:.04s}
.stagger>*:nth-child(2){animation-delay:.08s}
.stagger>*:nth-child(3){animation-delay:.12s}
.stagger>*:nth-child(4){animation-delay:.16s}
.stagger>*:nth-child(5){animation-delay:.20s}

.serif{font-family:'Instrument Serif',serif}
.mono{font-family:'JetBrains Mono',monospace}

.card{background:var(--bg1);border:1px solid var(--border);border-radius:14px;transition:border-color .18s,background .25s}
.card:hover{border-color:var(--border2)}

.input-base{background:var(--bg2);border:1px solid var(--border);border-radius:11px;padding:12px 14px;font-family:'DM Sans',sans-serif;font-size:14px;width:100%;outline:none;transition:border-color .18s,box-shadow .18s,background .25s}
.input-base:focus{border-color:rgba(245,166,35,.45);box-shadow:0 0 0 3px rgba(245,166,35,.06)}

.pill{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:100px;border:1px solid var(--border2);background:var(--bg2);color:var(--muted);font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .16s;white-space:nowrap}
.pill:hover{border-color:var(--gold-border);color:var(--gold);background:var(--gold-dim)}

.conf-high  {background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.25);color:var(--green)}
.conf-medium{background:rgba(245,166,35,.1);border:1px solid rgba(245,166,35,.25);color:var(--gold)}
.conf-low   {background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);color:var(--red)}

.return-mode-disabled{opacity:0.35;cursor:not-allowed!important;pointer-events:none}

/* Theme toggle button */
.theme-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:100px;border:1px solid var(--border2);background:var(--bg2);color:var(--muted);font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;cursor:pointer;transition:all .16s}
.theme-btn:hover{border-color:var(--gold-border);color:var(--gold);background:var(--gold-dim)}

@media(max-width:660px){
  .grid-2{grid-template-columns:1fr!important}
  .hide-sm{display:none!important}
  .hero-num{font-size:clamp(40px,11vw,70px)!important}
  .aff-grid{grid-template-columns:1fr 1fr!important}
  .cta-stack{flex-direction:column!important}
}
`;

// ─── Components ───────────────────────────────────────────────────────────────
const Spinner = ({ size = 16, color = "var(--gold)" }) => (
  <div
    style={{
      width: size,
      height: size,
      border: `2px solid rgba(255,255,255,.07)`,
      borderTopColor: color,
      borderRadius: "50%",
      animation: "spin .65s linear infinite",
      flexShrink: 0,
    }}
  />
);

function CityInput({ label, value, onChange, placeholder, icon }) {
  const [suggs, setSuggs] = useState([]);
  const [open, setOpen] = useState(false);
  const [ok, setOk] = useState(false);
  const ref = useRef();
  const deb = useRef();
  const handle = (e) => {
    const v = e.target.value;
    onChange(v);
    setOk(false);
    clearTimeout(deb.current);
    deb.current = setTimeout(() => {
      const r = searchCities(v);
      setSuggs(r);
      setOpen(r.length > 0 && v.trim().length > 0);
    }, 55);
  };
  const pick = (c) => {
    onChange(
      `${c.city}${c.st ? `, ${c.st}` : ""}${c.country !== "India" ? `, ${c.country}` : ""}`,
    );
    setOk(true);
    setSuggs([]);
    setOpen(false);
  };
  useEffect(() => {
    const fn = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);
  useEffect(() => () => clearTimeout(deb.current), []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <label
        style={{
          display: "block",
          fontSize: 10,
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: 1.8,
          marginBottom: 7,
        }}
      >
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={handle}
          className="input-base"
          style={{ paddingRight: 42 }}
          onFocus={(e) => {
            e.target.style.borderColor = "rgba(245,166,35,.45)";
            e.target.style.boxShadow = "0 0 0 3px rgba(245,166,35,.06)";
            if (!ok && value.trim().length > 0) {
              const r = searchCities(value);
              setSuggs(r);
              setOpen(r.length > 0);
            }
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "";
            e.target.style.boxShadow = "";
            setTimeout(() => setOpen(false), 170);
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 14,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 15,
            color: ok ? "var(--teal)" : "var(--muted)",
            pointerEvents: "none",
            transition: "color .2s",
          }}
        >
          {ok ? "✓" : icon}
        </div>
      </div>
      {open && suggs.length > 0 && (
        <div
          className="si"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 200,
            background: "#111119",
            border: "1px solid var(--border2)",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 24px 56px rgba(0,0,0,.75)",
          }}
        >
          {suggs.map((c, i) => (
            <div
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                borderBottom:
                  i < suggs.length - 1 ? "1px solid var(--border)" : "none",
                transition: "background .1s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(245,166,35,.07)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <span style={{ fontSize: 15, minWidth: 20, textAlign: "center" }}>
                {FLAGS[c.country] || "🌍"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text)",
                  }}
                >
                  {c.city}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}
                >
                  {[c.st, c.country].filter(Boolean).join(", ")}
                </div>
              </div>
              <span
                style={{
                  fontSize: 9,
                  color: "var(--muted2)",
                  background: "var(--bg3)",
                  padding: "2px 7px",
                  borderRadius: 100,
                  border: "1px solid var(--border)",
                }}
              >
                {c.country === "India" ? "Domestic" : "Intl"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CountUp({ target, duration = 1000, prefix = "₹" }) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    const start = Date.now();
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(from + e * (target - from)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return (
    <span>
      {prefix}
      {val.toLocaleString("en-IN")}
    </span>
  );
}

function CatBar({ icon, label, lo, hi, totalHi, delay = 0 }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  const pct = Math.round((hi / (totalHi || 1)) * 100);
  return (
    <div style={{ marginBottom: 13 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 5,
        }}
      >
        <span
          style={{
            fontSize: 13,
            color: "var(--text)",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span>{icon}</span>
          {label}
        </span>
        <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
          {INR(lo)} – {INR(hi)}
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--bg3)",
          borderRadius: 100,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: on ? `${pct}%` : "0%",
            background: "linear-gradient(90deg,var(--gold),#F7C34A)",
            borderRadius: 100,
            transition: "width .85s cubic-bezier(.22,1,.36,1)",
          }}
        />
      </div>
    </div>
  );
}

function ConfidencePill({ level }) {
  const [tip, setTip] = useState(false);
  const map = {
    high: {
      cls: "conf-high",
      icon: "🟢",
      txt: "High confidence",
      tooltip:
        "Strong historical data for this route. Range is tight and reliable.",
    },
    medium: {
      cls: "conf-medium",
      icon: "🟡",
      txt: "Estimated",
      tooltip:
        "Partial route data. Directionally accurate — verify on booking platforms.",
    },
    low: {
      cls: "conf-low",
      icon: "🔴",
      txt: "Wide variation",
      tooltip:
        "Limited data for this route. Use as a rough starting point — prices may vary significantly.",
    },
  };
  const c = map[level] || map.medium;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <span
        className={c.cls}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          borderRadius: 100,
          padding: "3px 10px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "help",
        }}
        onMouseEnter={() => setTip(true)}
        onMouseLeave={() => setTip(false)}
      >
        {c.icon} {c.txt} <span style={{ fontSize: 9, opacity: 0.7 }}>ⓘ</span>
      </span>
      {tip && (
        <div
          className="si"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 300,
            background: "var(--bg1)",
            border: "1px solid var(--border2)",
            borderRadius: 10,
            padding: "10px 13px",
            width: 220,
            boxShadow: "0 16px 40px var(--shadow)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--text)",
              lineHeight: 1.6,
              marginBottom: 4,
            }}
          >
            <strong>{c.txt}</strong>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
            {c.tooltip}
          </div>
        </div>
      )}
    </span>
  );
}

function TrustModal({ onClose }) {
  return (
    <div
      className="fi"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 450,
        background: "rgba(0,0,0,.82)",
        backdropFilter: "blur(22px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        className="si"
        style={{
          background: "var(--bg1)",
          border: "1px solid var(--border2)",
          borderRadius: 18,
          padding: 24,
          width: "100%",
          maxWidth: 400,
          boxShadow: "0 32px 80px rgba(0,0,0,.8)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <h3
            style={{
              fontFamily: "'Instrument Serif',serif",
              fontSize: 20,
              color: "var(--text)",
            }}
          >
            How we calculate this
          </h3>
          <button
            onClick={onClose}
            style={{
              width: 31,
              height: 31,
              borderRadius: 8,
              border: "1px solid var(--border2)",
              background: "var(--bg2)",
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
          >
            ✕
          </button>
        </div>
        {[
          [
            "✓",
            "Based on 50,000+ Indian travel price patterns",
            "var(--green)",
          ],
          ["✓", "Adjusted for season and peak/off-peak timing", "var(--green)"],
          ["✓", "Calibrated per city pair and route type", "var(--green)"],
          ["✓", "Compared against current market price ranges", "var(--green)"],
          ["✓", "AI-validated against real travel trends", "var(--green)"],
          [
            "✓",
            `Model version ${MODEL_VERSION} — updated regularly`,
            "var(--teal)",
          ],
        ].map(([icon, text, color], i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 11,
              alignItems: "flex-start",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 5,
                background: `${color}18`,
                border: `1px solid ${color}33`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 11,
                color,
                fontWeight: 800,
                marginTop: 1,
              }}
            >
              {icon}
            </div>
            <div
              style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}
            >
              {text}
            </div>
          </div>
        ))}
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            fontSize: 11,
            color: "var(--muted2)",
            lineHeight: 1.7,
          }}
        >
          ⚠️ These are estimates, not guaranteed prices. Always verify with
          booking platforms before purchasing. Prices vary by airline, hotel,
          dates, and demand.
        </div>
      </div>
    </div>
  );
}

function SavingsSection({ trip, onUpdate, totalHi }) {
  const target = totalHi || trip.budget?.total_hi || 50000;
  const saved = trip.saved || 0;
  const entries = trip.entries || [];
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [boom, setBoom] = useState(false);
  const pctDone = Math.min(100, Math.round((saved / target) * 100));
  const at60 = pctDone >= 60 && pctDone < 80;
  const at80 = pctDone >= 80 && pctDone < 100;
  const at100 = pctDone >= 100;

  const monthsToGoal = (() => {
    if (at100 || entries.length < 1) return null;
    const recent = entries.slice(-3);
    const avgSave = recent.reduce((s, e) => s + e.amount, 0) / recent.length;
    if (avgSave <= 0) return null;
    const remaining = Math.max(0, target - saved);
    const months = Math.ceil(remaining / avgSave);
    return months <= 24 ? months : null;
  })();

  const add = () => {
    const n = parseFloat(amt);
    if (!n || n <= 0) return;
    const np = Math.min(100, Math.round(((saved + n) / target) * 100));
    if (pctDone < 100 && np >= 100) {
      setBoom(true);
      setTimeout(() => setBoom(false), 3800);
    }
    onUpdate({
      ...trip,
      saved: saved + n,
      entries: [
        ...entries,
        { id: uid(), amount: n, note: note || "Saved", date: today() },
      ],
    });
    setAmt("");
    setNote("");
  };

  const remove = (id) => {
    const f = entries.filter((e) => e.id !== id);
    onUpdate({
      ...trip,
      saved: f.reduce((s, e) => s + e.amount, 0),
      entries: f,
    });
  };

  return (
    <div style={{ position: "relative" }}>
      {boom && (
        <div
          className="fi"
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 500,
            overflow: "hidden",
          }}
        >
          {[...Array(22)].map((_, i) => {
            const confettiPiece = (() => {
              const left = 10 + Math.random() * 80;
              const top = 30 + Math.random() * 40;
              const duration = 0.7 + Math.random() * 0.8;
              const delay = Math.random() * 0.5;
              const isRound = Math.random() > 0.5;
              return { left, top, duration, delay, isRound };
            })();
            return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${confettiPiece.left}%`,
                top: `${confettiPiece.top}%`,
                width: 8,
                height: 8,
                borderRadius: confettiPiece.isRound ? "50%" : "3px",
                background: [
                  "#F5A623",
                  "#00D4AA",
                  "#5B8FF9",
                  "#FF6B6B",
                  "#fff",
                ][i % 5],
                animation: `confetti ${confettiPiece.duration}s ease-out ${confettiPiece.delay}s both`,
              }}
            />
          );
          })}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 52, marginBottom: 8 }}>🎉</div>
            <div
              style={{
                fontFamily: "'Instrument Serif',serif",
                fontSize: 28,
                color: "var(--gold)",
                textShadow: "0 0 40px rgba(245,166,35,.6)",
              }}
            >
              Goal Reached!
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              Time to book your trip
            </div>
          </div>
        </div>
      )}

      {at60 && (
        <div
          className="pi"
          style={{
            marginBottom: 12,
            padding: "12px 16px",
            background: "rgba(91,143,249,.07)",
            border: "1px solid rgba(91,143,249,.22)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--blue)",
                marginBottom: 2,
              }}
            >
              📈 Great progress — you're 60% there!
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Early deal alerts can save 10–20% — check now
            </div>
          </div>
          <a
            href={trip.affiliates?.mmtFlight || "https://www.makemytrip.com"}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "8px 14px",
              borderRadius: 9,
              background: "rgba(91,143,249,.15)",
              border: "1px solid rgba(91,143,249,.3)",
              color: "var(--blue)",
              fontWeight: 700,
              fontSize: 12,
              whiteSpace: "nowrap",
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            See Early Deals →
          </a>
        </div>
      )}

      {at80 && (
        <div
          className="pi"
          style={{
            marginBottom: 12,
            padding: "12px 16px",
            background:
              "linear-gradient(135deg,rgba(245,166,35,.12),rgba(232,76,30,.08))",
            border: "1px solid rgba(245,166,35,.3)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            animation: "glow 2s ease-in-out infinite",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--gold)",
                marginBottom: 2,
              }}
            >
              🔥 You can almost afford this trip!
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              You're at {pctDone}% — compare flights now before prices change
            </div>
          </div>
          <a
            href={trip.affiliates?.mmtFlight || "https://www.makemytrip.com"}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "8px 16px",
              borderRadius: 9,
              background: "var(--gold)",
              color: "#09090F",
              fontWeight: 700,
              fontSize: 12,
              whiteSpace: "nowrap",
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            Compare Flights →
          </a>
        </div>
      )}

      {at100 && (
        <div
          className="pi"
          style={{
            marginBottom: 12,
            padding: "12px 16px",
            background: "var(--teal-dim)",
            border: "1px solid rgba(0,212,170,.28)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--teal)" }}>
            🎊 Goal reached! Ready to book?
          </div>
          <a
            href={trip.affiliates?.mmtFlight || "https://www.makemytrip.com"}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "8px 16px",
              borderRadius: 9,
              background: "var(--teal)",
              color: "#09090F",
              fontWeight: 700,
              fontSize: 12,
              whiteSpace: "nowrap",
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            Book Now →
          </a>
        </div>
      )}

      <div
        className="card"
        style={{
          padding: 20,
          marginBottom: 10,
          background: "linear-gradient(135deg,rgba(0,212,170,.03),transparent)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              position: "relative",
              flexShrink: 0,
              width: 68,
              height: 68,
            }}
          >
            <svg width="68" height="68" viewBox="0 0 68 68">
              <circle
                cx="34"
                cy="34"
                r="29"
                fill="none"
                stroke="var(--bg3)"
                strokeWidth="5"
              />
              <circle
                cx="34"
                cy="34"
                r="29"
                fill="none"
                stroke="var(--teal)"
                strokeWidth="5"
                strokeDasharray={`${Math.PI * 58} ${Math.PI * 58}`}
                strokeDashoffset={Math.PI * 58 * (1 - pctDone / 100)}
                strokeLinecap="round"
                transform="rotate(-90 34 34)"
                style={{
                  transition: "stroke-dashoffset .8s cubic-bezier(.22,1,.36,1)",
                }}
              />
            </svg>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--teal)",
              }}
            >
              {pctDone}%
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--teal)",
                letterSpacing: 2,
                textTransform: "uppercase",
                marginBottom: 5,
              }}
            >
              Savings Goal
            </div>
            <div
              style={{
                fontFamily: "'Instrument Serif',serif",
                fontSize: 20,
                color: "var(--text)",
                marginBottom: 2,
              }}
            >
              {INR(saved)}{" "}
              <span
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  fontFamily: "'DM Sans',sans-serif",
                }}
              >
                of {INR(target)}
              </span>
            </div>
            {!at100 &&
              (() => {
                const remaining = Math.max(0, target - saved);
                if (remaining === 0) return null;
                const show = [3, 6, 12].map((m) => ({
                  months: m,
                  perMonth: Math.ceil(remaining / m),
                }));
                return (
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        marginBottom: 4,
                      }}
                    >
                      {INR(remaining)} remaining — save it as:
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {show.map(({ months, perMonth }) => (
                        <span
                          key={months}
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "var(--teal)",
                            background: "var(--teal-dim)",
                            border: "1px solid rgba(0,212,170,.18)",
                            borderRadius: 100,
                            padding: "2px 9px",
                          }}
                        >
                          {INR(perMonth)}/mo × {months}mo
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            {monthsToGoal && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--gold)",
                  marginTop: 5,
                  fontWeight: 600,
                }}
              >
                📅 At this pace, ~{monthsToGoal} month
                {monthsToGoal > 1 ? "s" : ""} to go
              </div>
            )}
          </div>
        </div>
        <div
          style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 9 }}
        >
          {[1000, 2500, 5000, 10000].map((q) => (
            <button
              key={q}
              onClick={() => setAmt(String(q))}
              style={{
                padding: "4px 10px",
                borderRadius: 100,
                border: `1px solid ${amt === String(q) ? "rgba(0,212,170,.38)" : "var(--border)"}`,
                background:
                  amt === String(q) ? "var(--teal-dim)" : "var(--bg3)",
                color: amt === String(q) ? "var(--teal)" : "var(--muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "'DM Sans',sans-serif",
                transition: "all .13s",
              }}
            >
              +{INR(q)}
            </button>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "100px 1fr auto",
            gap: 7,
            alignItems: "center",
          }}
        >
          <input
            type="number"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            placeholder="₹ Amount"
            className="input-base"
            style={{ padding: "9px 12px", fontSize: 13 }}
            onFocus={(e) => (e.target.style.borderColor = "rgba(0,212,170,.4)")}
            onBlur={(e) => (e.target.style.borderColor = "")}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (salary, bonus…)"
            className="input-base"
            style={{ padding: "9px 12px", fontSize: 13 }}
            onFocus={(e) => (e.target.style.borderColor = "rgba(0,212,170,.4)")}
            onBlur={(e) => (e.target.style.borderColor = "")}
          />
          <button
            onClick={add}
            style={{
              padding: "9px 15px",
              borderRadius: 9,
              border: "1px solid rgba(0,212,170,.28)",
              background: "var(--teal-dim)",
              color: "var(--teal)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'DM Sans',sans-serif",
              whiteSpace: "nowrap",
              transition: "all .15s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(0,212,170,.16)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "var(--teal-dim)")
            }
          >
            + Add
          </button>
        </div>
      </div>

      {entries.length > 0 && (
        <div className="card" style={{ padding: "13px 15px" }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--muted)",
              letterSpacing: 1.8,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            History
          </div>
          {[...entries].reverse().map((e) => (
            <div
              key={e.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "7px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: "var(--teal-dim)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    color: "var(--teal)",
                    fontWeight: 700,
                  }}
                >
                  +
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--text)",
                    }}
                  >
                    {INR(e.amount)}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>
                    {e.note} · {e.date}
                  </div>
                </div>
              </div>
              <button
                onClick={() => remove(e.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted2)",
                  cursor: "pointer",
                  fontSize: 16,
                  padding: "2px 6px",
                  transition: "color .13s",
                }}
                onMouseEnter={(e) => (e.target.style.color = "var(--red)")}
                onMouseLeave={(e) => (e.target.style.color = "var(--muted2)")}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SavedPanel({ trips, onOpen, onDelete, onClose }) {
  return (
    <div
      className="fi"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(0,0,0,.78)",
        backdropFilter: "blur(22px)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        className="si"
        style={{
          width: "100%",
          maxWidth: 390,
          background: "var(--bg1)",
          borderLeft: "1px solid var(--border2)",
          overflowY: "auto",
          padding: "22px 18px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--gold)",
                letterSpacing: 2,
                textTransform: "uppercase",
                marginBottom: 5,
              }}
            >
              ✦ Saved
            </div>
            <h2
              style={{
                fontFamily: "'Instrument Serif',serif",
                fontSize: 22,
                color: "var(--text)",
              }}
            >
              My Trips
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--border2)",
              background: "var(--bg2)",
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "color .15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 10, color: "var(--muted2)", marginBottom: 14 }}>
          💡 Trips persist across sessions — even after closing the browser
        </div>
        {trips.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "50px 0",
              color: "var(--muted)",
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 10 }}>🗺️</div>
            <div style={{ fontSize: 13 }}>No saved trips yet</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {trips.map((tr) => {
              const pct = Math.min(
                100,
                Math.round(
                  ((tr.saved || 0) / (tr.budget?.total_hi || 1)) * 100,
                ),
              );
              return (
                <div
                  key={tr.id}
                  className="card"
                  style={{
                    padding: 14,
                    cursor: "pointer",
                    transition: "border-color .16s",
                  }}
                  onClick={() => onOpen(tr)}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = "var(--gold-border)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 7,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "'Instrument Serif',serif",
                          fontSize: 15,
                          color: "var(--text)",
                          marginBottom: 2,
                        }}
                      >
                        {tr.from.split(",")[0]} → {tr.to.split(",")[0]}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {tr.nights}n · {tr.adults} adult · {tr.style}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(tr.id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--muted2)",
                        cursor: "pointer",
                        fontSize: 14,
                        padding: "2px 4px",
                        transition: "color .13s",
                      }}
                      onMouseEnter={(e) =>
                        (e.target.style.color = "var(--red)")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.color = "var(--muted2)")
                      }
                    >
                      🗑
                    </button>
                  </div>
                  {tr.budget && (
                    <>
                      <div
                        className="mono"
                        style={{
                          fontSize: 12,
                          color: "var(--gold)",
                          marginBottom: 5,
                        }}
                      >
                        {INR(tr.budget.total_lo)} – {INR(tr.budget.total_hi)}
                      </div>
                      <div
                        style={{
                          height: 3,
                          background: "var(--bg3)",
                          borderRadius: 100,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: "var(--teal)",
                            borderRadius: 100,
                            transition: "width .6s",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--muted)",
                          marginTop: 3,
                        }}
                      >
                        {INR(tr.saved || 0)} saved · {pct}%
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ShareModal({ trip, budget, onClose }) {
  const [copied, setCopied] = useState(false);
  const nts = trip.nights || 1;
  const text = buildShareText(
    trip.from,
    trip.to,
    nts,
    trip.adults,
    trip.style,
    budget,
  );
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.warn('Clipboard copy failed:', e);
    }
  };
  return (
    <div
      className="fi"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(0,0,0,.82)",
        backdropFilter: "blur(22px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        className="si"
        style={{
          background: "var(--bg1)",
          border: "1px solid var(--border2)",
          borderRadius: 18,
          padding: 22,
          width: "100%",
          maxWidth: 420,
          boxShadow: "0 32px 80px rgba(0,0,0,.8)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3
            style={{
              fontFamily: "'Instrument Serif',serif",
              fontSize: 20,
              color: "var(--text)",
            }}
          >
            Share Estimate
          </h3>
          <button
            onClick={onClose}
            style={{
              width: 31,
              height: 31,
              borderRadius: 8,
              border: "1px solid var(--border2)",
              background: "var(--bg2)",
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "color .13s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "13px 15px",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 11,
            color: "var(--muted)",
            lineHeight: 1.9,
            marginBottom: 14,
            whiteSpace: "pre-wrap",
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {text}
        </div>
        <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "12px",
              borderRadius: 10,
              background: "rgba(37,211,102,.12)",
              border: "1px solid rgba(37,211,102,.28)",
              color: "#25D366",
              fontWeight: 700,
              fontSize: 14,
              textDecoration: "none",
              transition: "all .16s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(37,211,102,.2)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "rgba(37,211,102,.12)")
            }
          >
            <span style={{ fontSize: 18 }}>💬</span> Send on WhatsApp
          </a>
          <button
            onClick={copy}
            style={{
              padding: "11px",
              borderRadius: 10,
              border: `1px solid ${copied ? "rgba(0,212,170,.35)" : "var(--border2)"}`,
              background: copied ? "var(--teal-dim)" : "var(--bg2)",
              color: copied ? "var(--teal)" : "var(--text)",
              cursor: "pointer",
              fontFamily: "'DM Sans',sans-serif",
              fontSize: 13,
              fontWeight: 600,
              transition: "all .16s",
            }}
          >
            {copied ? "✓ Copied!" : "📋 Copy Text"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Budget Sliders ───────────────────────────────────────────────────────────
const SliderRow = ({ label, value, setValue, options, icon }) => (
  <div style={{ marginBottom: 16 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>{icon}</span>
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--gold)",
          background: "var(--gold-dim)",
          border: "1px solid var(--gold-border)",
          borderRadius: 100,
          padding: "2px 10px",
        }}
      >
        {options[value]}
      </span>
    </div>
    <div style={{ display: "flex", gap: 5 }}>
      {options.map((opt, i) => (
        <button
          key={i}
          onClick={() => setValue(i)}
          style={{
            flex: 1,
            padding: "7px 4px",
            borderRadius: 8,
            border: `1px solid ${i === value ? "var(--gold-border)" : "var(--border)"}`,
            background: i === value ? "var(--gold-dim)" : "var(--bg2)",
            color: i === value ? "var(--gold)" : "var(--muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: i === value ? 700 : 400,
            fontFamily: "'DM Sans',sans-serif",
            transition: "all .15s",
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  </div>
);

// ─── Budget slider constants ──────────────────────────────────────────────────
const HOTEL_MUL = [0.65, 0.9, 1.0, 1.4];
const FOOD_MUL = [0.6, 1.0, 1.55];
const ACTIVITY_MUL = [0.55, 1.0, 1.55];

function BudgetSliders({ budget, onAdjust }) {
  const [hotel, setHotel] = useState(2); // 0=budget 1=mid 2=comfortable 3=luxury
  const [food, setFood] = useState(1); // 0=street 1=mix 2=restaurants
  const [activity, setActivity] = useState(1); // 0=light 1=moderate 2=full

  const hotelLabels = ["Budget", "Mid-range", "Comfortable", "Luxury"];
  const foodLabels = ["Street food", "Mix", "Restaurants"];
  const activityLabels = ["Light", "Moderate", "Full"];

  useEffect(() => {
    const hm = HOTEL_MUL[hotel];
    const fm = FOOD_MUL[food];
    const am = ACTIVITY_MUL[activity];
    const adj = {
      stay_lo: Math.round(budget.stay_lo * hm),
      stay_hi: Math.round(budget.stay_hi * hm),
      food_lo: Math.round(budget.food_lo * fm),
      food_hi: Math.round(budget.food_hi * fm),
      activities_lo: Math.round(budget.activities_lo * am),
      activities_hi: Math.round(budget.activities_hi * am),
    };
    adj.total_lo =
      budget.transport_lo + adj.stay_lo + adj.food_lo + adj.activities_lo;
    adj.total_hi =
      budget.transport_hi + adj.stay_hi + adj.food_hi + adj.activities_hi;
    onAdjust(adj);
  }, [hotel, food, activity, budget, onAdjust]);

  return (
    <div
      className="card fu"
      style={{
        padding: 20,
        marginBottom: 12,
        background: "linear-gradient(135deg,rgba(91,143,249,.03),var(--bg1))",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--blue)",
          letterSpacing: 2,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        🎚️ Adjust Your Budget
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>
        Tweak preferences to see how costs change
      </div>
      <SliderRow
        label="Hotel style"
        value={hotel}
        setValue={setHotel}
        options={hotelLabels}
        icon="🏨"
      />
      <SliderRow
        label="Food preference"
        value={food}
        setValue={setFood}
        options={foodLabels}
        icon="🍽️"
      />
      <SliderRow
        label="Activities"
        value={activity}
        setValue={setActivity}
        options={activityLabels}
        icon="🎯"
      />
      <div style={{ fontSize: 10, color: "var(--muted2)", marginTop: 4 }}>
        Transport cost stays fixed — only stay, food & activities adjust
      </div>
    </div>
  );
}

const ROUTES = [
  { from: "Mumbai", to: "Goa", nights: 3, emoji: "🏖️" },
  { from: "Delhi", to: "Manali", nights: 5, emoji: "🏔️" },
  { from: "Bangalore", to: "Coorg", nights: 2, emoji: "🌿" },
  { from: "Mumbai", to: "Bali", nights: 5, emoji: "🌺" },
  { from: "Delhi", to: "Jaipur", nights: 2, emoji: "🏯" },
  { from: "Chennai", to: "Maldives", nights: 4, emoji: "🏝️" },
  { from: "Delhi", to: "Leh", nights: 7, emoji: "🗻" },
  { from: "Mumbai", to: "Dubai", nights: 4, emoji: "🌆" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function Farelo() {
  const defaultCI = fmt(addDays(new Date(), 14));
  const defaultCO = fmt(addDays(new Date(), 17));

  const [form, setForm] = useState({
    from: "",
    to: "",
    checkIn: defaultCI,
    checkOut: defaultCO,
    adults: 2,
    style: "Mid-range",
    returnMode: "flight",
  });
  const [phase, setPhase] = useState("idle");
  const [budget, setBudget] = useState(null);
  const [error, setError] = useState("");
  const [tipMsg, setTipMsg] = useState(""); // soft tip — different styling from error
  const [trips, setTrips] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [activeTrip, setActive] = useState(null);
  const [showSaved, setShowSaved] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showTrust, setShowTrust] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [view, setView] = useState("form");
  const [adjBudget, setAdjBudget] = useState(null); // slider-adjusted overlay
  const [calcError, setCalcError] = useState(false); // true if both baseline + AI failed

  // ── Theme: "dark" | "light" | "system" ──────────────────────────────────────
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("farelo_theme") || "system";
    } catch {
      return "system";
    }
  });

  // Resolve "system" → actual dark/light based on OS preference
  const resolvedTheme = (() => {
    if (theme === "system") {
      try {
        return window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
      } catch (e) {
        console.warn('Failed to check theme preference:', e);
        return "dark";
      }
    }
    return theme;
  })();

  useEffect(() => {
    try {
      localStorage.setItem("farelo_theme", theme);
    } catch (e) {
      console.warn('Failed to save theme:', e);
    }
  }, [theme]);

  // Re-check system preference on change
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => setTheme("system"); // triggers re-render
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  // ── Google Analytics 4 ──────────────────────────────────────────────────────
  // ⚠️  PRODUCTION REMINDER: Replace G-XXXXXXXXXX with your real GA4 Measurement ID.
  //    Get it from: analytics.google.com → Admin → Data Streams → Web → Measurement ID
  //    GA is silently disabled until this is set — no tracking, no errors.
  const GA_ID = "G-XXXXXXXXXX";

  useEffect(() => {
    if (!GA_ID || GA_ID === "G-XXXXXXXXXX") return; // skip until real ID is set
    // Inject gtag script tag
    const script1 = document.createElement("script");
    script1.async = true;
    script1.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(script1);
    // Init dataLayer
    const script2 = document.createElement("script");
    script2.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_ID}', { page_path: '/' });
    `;
    document.head.appendChild(script2);
    window._gtagReady = true;
  }, []);

  // Helper: fire GA event safely
  const gaEvent = (name, params = {}) => {
    try {
      if (window._gtagReady && typeof window.gtag === "function") {
        window.gtag("event", name, params);
      }
    } catch (error) {
      // Silently ignore GA errors — analytics failure should not break the app
      if (typeof console !== "undefined" && console.debug) {
        console.debug("GA event failed:", error);
      }
    }
  };

  const cycleTheme = () => {
    const order = ["dark", "light", "system"];
    setTheme((t) => order[(order.indexOf(t) + 1) % order.length]);
  };
  const themeIcon = theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "💻";
  const themeLabel =
    theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";

  const nts = nights(form.checkIn, form.checkOut);
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Derived: is the currently selected destination international?
  const destIsIntl = form.to.trim() ? isIntl(form.to) : false;

  useEffect(() => {
    if (view !== "result") {
      setShowSticky(false);
      return;
    }
    const onScroll = () => setShowSticky(window.scrollY > 420);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [view]);

  useEffect(() => {
    hydrate()
      .then((ts) => {
        if (Array.isArray(ts) && ts.length) setTrips(ts);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (loaded) persist(trips);
  }, [trips, loaded]);

  const updateTrip = (u) => {
    setTrips((p) => p.map((t) => (t.id === u.id ? u : t)));
    if (activeTrip?.id === u.id) setActive(u);
  };
  const deleteTrip = (id) => {
    setTrips((p) => p.filter((t) => t.id !== id));
    if (activeTrip?.id === id) setActive(null);
  };

  const openSaved = (tr) => {
    setForm({
      from: tr.from,
      to: tr.to,
      checkIn: tr.checkIn || defaultCI,
      checkOut: tr.checkOut || defaultCO,
      adults: tr.adults,
      style: tr.style,
      returnMode: tr.returnMode || "flight",
    });
    setBudget(tr.budget);
    setActive(tr);
    setView("result");
    setPhase("done");
    setShowSaved(false);
  };

  const estimate = async () => {
    if (!form.from.trim() || !form.to.trim()) {
      setError("Enter departure and destination.");
      return;
    }
    if (normalizeCity(form.from) === normalizeCity(form.to)) {
      setError("Departure and destination can't be the same city.");
      return;
    }
    if (nts < 1) {
      setError("Check-out must be after check-in.");
      return;
    }
    if (nts > 30) {
      setError("Maximum trip duration is 30 nights.");
      return;
    }

    const minNights = isIntl(form.to) ? 4 : 2;
    if (nts < minNights && nts >= 1) {
      setTipMsg(`Most travellers spend at least ${minNights} nights in ${form.to.split(",")[0]} to make the trip worthwhile.`);
      setTimeout(() => setTipMsg(""), 6000);
    } else {
      setTipMsg("");
    }

    setBudget(null);
    setAdjBudget(null);
    setCalcError(false);
    setPhase("preview");
    trackSearch(form.from, form.to, nts, form.adults, form.style);
    gaEvent("estimate_requested", {
      route: `${normalizeCity(form.from)}-${normalizeCity(form.to)}`,
      nights: nts,
      adults: form.adults,
      style: form.style,
      intl: isIntl(form.to),
    });

    const affs = buildAffiliates(
      form.from,
      form.to,
      form.checkIn,
      form.checkOut,
      form.adults,
      form.returnMode,
    );

    const tripBase = {
      id: uid(),
      from: form.from,
      to: form.to,
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      adults: form.adults,
      style: form.style,
      nights: nts,
      returnMode: form.returnMode,
      affiliates: affs,
      saved: 0,
      entries: [],
    };

    try {
      const final = await estimateBudget(
        form.from,
        form.to,
        nts,
        form.adults,
        form.style,
        form.checkIn,
        (instant, fromCache) => {
          setBudget(instant);
          setView("result");
          if (!fromCache) setPhase("refining");
        },
        form.returnMode,
      );

      setBudget(final);
      setPhase("done");
      gaEvent("estimate_shown", {
        route: `${normalizeCity(form.from)}-${normalizeCity(form.to)}`,
        source: final.source,
        total_hi: final.total_hi,
      });

      const fullTrip = { ...tripBase, budget: final };
      setTrips((p) => {
        const ex = p.find(
          (t) =>
            t.from === form.from &&
            t.to === form.to &&
            t.checkIn === form.checkIn &&
            t.checkOut === form.checkOut &&
            t.style === form.style &&
            t.adults === form.adults &&
            t.nights === nts,
        );
        if (ex) {
          const u = {
            ...ex,
            budget: final,
            affiliates: affs,
            nights: nts,
            checkOut: form.checkOut,
          };
          setTimeout(() => setActive(u), 0);
          return p.map((t) => (t.id === ex.id ? u : t));
        }
        const nt = { ...fullTrip };
        setTimeout(() => setActive(nt), 0);
        return [...p, nt];
      });
    } catch (e) {
      setPhase("done");
      setCalcError(true);
      console.error(e);
    }
  };

  const affs =
    activeTrip?.affiliates ||
    buildAffiliates(
      form.from,
      form.to,
      form.checkIn,
      form.checkOut,
      form.adults,
      form.returnMode,
    );

  // Display budget — merges slider adjustments over base budget
  const disp = budget
    ? adjBudget
      ? { ...budget, ...adjBudget }
      : budget
    : null;

  const LoadingOverlay = () => {
    const [step, setStep] = useState(0);
    const steps = [
      { icon: "✈️", text: "Checking flight prices" },
      { icon: "🏨", text: "Comparing hotel rates" },
      { icon: "🍽️", text: "Estimating food costs" },
      { icon: "🎯", text: "Adding activities" },
      { icon: "🤖", text: "AI refining estimate" },
    ];
    useEffect(() => {
      const t = setInterval(
        () => setStep((s) => Math.min(s + 1, 4)),
        700,
      );
      return () => clearInterval(t);
    }, []);
    const fromName = form.from.split(",")[0];
    const toName = form.to.split(",")[0];
    return (
      <div
        className="fi"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 500,
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        {/* subtle ambient rings */}
        {[500, 340, 200].map((s, k) => (
          <div
            key={s}
            style={{
              position: "absolute",
              width: s,
              height: s,
              borderRadius: "50%",
              border: "1px solid rgba(245,166,35,.04)",
              animation: `pulse 4s ease-in-out ${k * 1.1}s infinite`,
              pointerEvents: "none",
            }}
          />
        ))}

        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 380,
            textAlign: "center",
          }}
        >
          {/* route header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              marginBottom: 28,
            }}
          >
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  marginBottom: 2,
                }}
              >
                From
              </div>
              <div
                style={{
                  fontFamily: "'Instrument Serif',serif",
                  fontSize: 20,
                  color: "var(--text)",
                  lineHeight: 1,
                }}
              >
                {fromName}
              </div>
            </div>

            {/* animated SVG route */}
            <div
              style={{
                flex: 1,
                position: "relative",
                height: 40,
                minWidth: 80,
              }}
            >
              <svg
                width="100%"
                height="40"
                viewBox="0 0 160 40"
                preserveAspectRatio="none"
              >
                <path
                  d="M8,20 Q80,4 152,20"
                  fill="none"
                  stroke="rgba(245,166,35,.18)"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
                <path
                  d="M8,20 Q80,4 152,20"
                  fill="none"
                  stroke="var(--gold)"
                  strokeWidth="2"
                  strokeDasharray="320"
                  strokeDashoffset="320"
                  strokeLinecap="round"
                  style={{
                    animation:
                      "drawLine 1.8s cubic-bezier(.4,0,.2,1) .2s forwards",
                  }}
                />
                {/* dot origin */}
                <circle
                  cx="8"
                  cy="20"
                  r="3.5"
                  fill="var(--gold)"
                  opacity=".6"
                />
                {/* dot dest — pulses */}
                <circle
                  cx="152"
                  cy="20"
                  r="4"
                  fill="var(--gold)"
                  style={{ animation: "shimmer 1s ease-in-out 1.8s infinite" }}
                />
              </svg>
              {/* plane emoji riding the path */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  width: "100%",
                  transform: "translateY(-50%)",
                  animation:
                    "planeFly 1.8s cubic-bezier(.4,0,.2,1) .2s forwards",
                  offsetPath: "path('M8,20 Q80,4 152,20')",
                  offsetRotate: "auto",
                  fontSize: 16,
                  lineHeight: 1,
                  pointerEvents: "none",
                }}
              >
                ✈️
              </div>
            </div>

            <div style={{ textAlign: "left" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted)",
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  marginBottom: 2,
                }}
              >
                To
              </div>
              <div
                style={{
                  fontFamily: "'Instrument Serif',serif",
                  fontSize: 20,
                  color: "var(--text)",
                  lineHeight: 1,
                }}
              >
                {toName}
              </div>
            </div>
          </div>

          {/* progress bar */}
          <div
            style={{
              height: 2,
              background: "var(--bg3)",
              borderRadius: 100,
              marginBottom: 24,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                background: "linear-gradient(90deg,var(--gold),#F7C34A)",
                borderRadius: 100,
                animation: "progressFill 3.5s cubic-bezier(.4,0,.2,1) forwards",
              }}
            />
          </div>

          {/* step list */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginBottom: 28,
            }}
          >
            {steps.map((s, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 14px",
                  borderRadius: 10,
                  border: `1px solid ${i <= step ? "var(--gold-border)" : "var(--border)"}`,
                  background: i <= step ? "var(--gold-dim)" : "transparent",
                  opacity: i <= step ? 1 : 0.3,
                  animation:
                    i === 0 ? "none" : `stepIn .3s ease ${i * 0.12}s both`,
                  transition: "all .3s ease",
                }}
              >
                <span
                  style={{ fontSize: 15, minWidth: 20, textAlign: "center" }}
                >
                  {s.icon}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: i <= step ? 600 : 400,
                    color: i <= step ? "var(--gold)" : "var(--muted)",
                    flex: 1,
                    textAlign: "left",
                  }}
                >
                  {s.text}
                </span>
                {i < step && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--green)",
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                )}
                {i === step && (
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      border: "2px solid rgba(245,166,35,.3)",
                      borderTopColor: "var(--gold)",
                      animation: "spin .7s linear infinite",
                      flexShrink: 0,
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, color: "var(--muted2)" }}>
            AI-powered estimate · Usually takes 2–4 seconds
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{CSS}</style>
      <div
        data-theme={resolvedTheme}
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          transition: "background .25s",
        }}
      >
        {phase === "preview" && !budget && <LoadingOverlay />}
        {showSaved && (
          <SavedPanel
            trips={trips}
            onOpen={openSaved}
            onDelete={deleteTrip}
            onClose={() => setShowSaved(false)}
          />
        )}
        {showShare && activeTrip && budget && (
          <ShareModal
            trip={activeTrip}
            budget={budget}
            onClose={() => setShowShare(false)}
          />
        )}
        {showTrust && <TrustModal onClose={() => setShowTrust(false)} />}

        {/* NAV */}
        <nav
          style={{
            position: "sticky",
            top: 0,
            zIndex: 100,
            background: "rgba(9,9,15,.93)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid var(--border)",
            height: 54,
            display: "flex",
            alignItems: "center",
            padding: "0 18px",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
            onClick={() => {
              setView("form");
              setBudget(null);
              setActive(null);
              setPhase("idle");
              setShowCompare(false);
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 148 32"
              width="148"
              height="32"
            >
              <defs>
                <linearGradient
                  id="logo-grad"
                  x1="0%"
                  y1="0%"
                  x2="130%"
                  y2="130%"
                >
                  <stop offset="0%" stopColor="#F5A623" />
                  <stop offset="100%" stopColor="#E84C1E" />
                </linearGradient>
                <linearGradient
                  id="logo-shine"
                  x1="0%"
                  y1="0%"
                  x2="0%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </linearGradient>
              </defs>
              <rect
                x="0"
                y="0"
                width="32"
                height="32"
                rx="8"
                fill="url(#logo-grad)"
              />
              <rect
                x="0"
                y="0"
                width="32"
                height="32"
                rx="8"
                fill="url(#logo-shine)"
              />
              <circle
                cx="9"
                cy="24"
                r="2.8"
                fill="none"
                stroke="rgba(9,9,15,0.88)"
                strokeWidth="1.8"
              />
              <line
                x1="11.8"
                y1="21.2"
                x2="22"
                y2="10"
                stroke="rgba(9,9,15,0.88)"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <circle cx="23" cy="9" r="3.8" fill="rgba(9,9,15,0.88)" />
              <circle cx="23" cy="9" r="1.6" fill="#F5A623" />
              <text
                x="42"
                y="22"
                fontFamily="'Syne',sans-serif"
                fontSize="17"
                fontWeight="700"
                fill="#EEEEF8"
                letterSpacing="-0.5"
              >
                farelo
              </text>
            </svg>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {view === "result" && (
              <button
                onClick={() => {
                  setView("form");
                  setShowCompare(false);
                }}
                className="pill"
              >
                ← Edit
              </button>
            )}
            <button
              onClick={cycleTheme}
              className="theme-btn"
              title={`Theme: ${themeLabel}`}
            >
              {themeIcon} <span className="hide-sm">{themeLabel}</span>
            </button>
            <button onClick={() => setShowSaved(true)} className="pill">
              🗺️ Saved
              {trips.length > 0 && (
                <span
                  style={{
                    background: "var(--gold)",
                    color: "#09090F",
                    borderRadius: "50%",
                    width: 16,
                    height: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontWeight: 800,
                  }}
                >
                  {trips.length}
                </span>
              )}
            </button>
          </div>
        </nav>

        {/* FORM */}
        {view === "form" && (
          <div
            style={{
              maxWidth: 640,
              margin: "0 auto",
              padding: "38px 16px 80px",
            }}
          >
            <div
              className="fu"
              style={{ textAlign: "center", marginBottom: 36 }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  background: "var(--gold-dim)",
                  border: "1px solid var(--gold-border)",
                  borderRadius: 100,
                  padding: "5px 14px",
                  marginBottom: 18,
                  animation: "glow 3s ease-in-out infinite",
                }}
              >
                <div
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--gold)",
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--gold)",
                    letterSpacing: 2,
                    textTransform: "uppercase",
                  }}
                >
                  Free · Instant · No login
                </span>
              </div>
              <h1
                style={{
                  fontFamily: "'Instrument Serif',serif",
                  fontSize: "clamp(32px,6vw,56px)",
                  color: "var(--text)",
                  lineHeight: 1.08,
                  letterSpacing: -0.4,
                  marginBottom: 13,
                }}
              >
                Know your trip cost
                <br />
                <span style={{ color: "var(--gold)", fontStyle: "italic" }}>
                  before you book.
                </span>
              </h1>
              <p
                style={{
                  fontSize: 14,
                  color: "var(--muted)",
                  lineHeight: 1.75,
                  maxWidth: 360,
                  margin: "0 auto",
                }}
              >
                Enter your trip. Get a real budget breakdown in seconds.
              </p>
              <div
                style={{
                  marginTop: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 11,
                  color: "var(--muted2)",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "var(--teal-dim)",
                    border: "1px solid rgba(0,212,170,.18)",
                    borderRadius: 100,
                    padding: "3px 10px",
                    color: "var(--teal)",
                    fontWeight: 600,
                  }}
                >
                  ✓ Free
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "var(--gold-dim)",
                    border: "1px solid var(--gold-border)",
                    borderRadius: 100,
                    padding: "3px 10px",
                    color: "var(--gold)",
                    fontWeight: 600,
                  }}
                >
                  ⚡ Instant
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "var(--blue-dim)",
                    border: "1px solid rgba(91,143,249,.2)",
                    borderRadius: 100,
                    padding: "3px 10px",
                    color: "var(--blue)",
                    fontWeight: 600,
                  }}
                >
                  🔒 No login
                </span>
              </div>
            </div>

            <div
              className="card fu"
              style={{ padding: 22, marginBottom: 18, animationDelay: ".05s" }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 13,
                  marginBottom: 14,
                }}
                className="grid-2"
              >
                <CityInput
                  label="From"
                  value={form.from}
                  onChange={(v) => upd("from", v)}
                  placeholder="Mumbai, Delhi…"
                  icon="🛫"
                />
                <CityInput
                  label="To"
                  value={form.to}
                  onChange={(v) => upd("to", v)}
                  placeholder="Goa, Bali, Dubai…"
                  icon="🛬"
                />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 13,
                  marginBottom: 14,
                }}
                className="grid-2"
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: 1.8,
                      marginBottom: 7,
                    }}
                  >
                    Check-in
                  </label>
                  <input
                    type="date"
                    value={form.checkIn}
                    min={today()}
                    onChange={(e) => {
                      upd("checkIn", e.target.value);
                      if (form.checkOut <= e.target.value)
                        upd(
                          "checkOut",
                          fmt(
                            addDays(new Date(e.target.value + "T00:00:00"), 1),
                          ),
                        );
                    }}
                    className="input-base"
                    style={{
                      height: 46,
                      colorScheme: "dark",
                      cursor: "pointer",
                    }}
                    onFocus={(e) =>
                      (e.target.style.borderColor = "rgba(245,166,35,.45)")
                    }
                    onBlur={(e) => (e.target.style.borderColor = "")}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: 1.8,
                      marginBottom: 7,
                    }}
                  >
                    Check-out
                  </label>
                  <input
                    type="date"
                    value={form.checkOut}
                    min={
                      form.checkIn
                        ? fmt(addDays(new Date(form.checkIn + "T00:00:00"), 1))
                        : today()
                    }
                    onChange={(e) => upd("checkOut", e.target.value)}
                    className="input-base"
                    style={{
                      height: 46,
                      colorScheme: "dark",
                      cursor: "pointer",
                    }}
                    onFocus={(e) =>
                      (e.target.style.borderColor = "rgba(245,166,35,.45)")
                    }
                    onBlur={(e) => (e.target.style.borderColor = "")}
                  />
                </div>
              </div>
              {nts > 0 && (
                <div style={{ textAlign: "center", marginBottom: 14 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: "var(--gold-dim)",
                      border: "1px solid var(--gold-border)",
                      borderRadius: 100,
                      padding: "4px 13px",
                      fontSize: 12,
                      color: "var(--gold)",
                      fontWeight: 700,
                    }}
                  >
                    🌙 {nts} night{nts !== 1 ? "s" : ""} · {fmtD(form.checkIn)}{" "}
                    – {fmtD(form.checkOut)}
                  </span>
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 13,
                  marginBottom: 18,
                }}
                className="grid-2"
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: 1.8,
                      marginBottom: 7,
                    }}
                  >
                    Adults
                  </label>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      background: "var(--bg2)",
                      border: "1px solid var(--border)",
                      borderRadius: 11,
                      height: 46,
                      overflow: "hidden",
                    }}
                  >
                    {[
                      [-1, "−"],
                      [1, "+"],
                    ].map(([dir, lbl], bi) => {
                      const dis =
                        dir < 0 ? form.adults <= 1 : form.adults >= 12;
                      return (
                        <button
                          key={bi}
                          onClick={() =>
                            !dis && upd("adults", form.adults + dir)
                          }
                          style={{
                            width: 42,
                            height: "100%",
                            background: "transparent",
                            color: dis ? "var(--muted2)" : "var(--gold)",
                            border: "none",
                            cursor: dis ? "not-allowed" : "pointer",
                            fontSize: 20,
                            fontWeight: 300,
                            order: bi === 0 ? 0 : 2,
                            transition: "background .13s",
                          }}
                          onMouseEnter={(e) => {
                            if (!dis)
                              e.target.style.background = "var(--gold-dim)";
                          }}
                          onMouseLeave={(e) =>
                            (e.target.style.background = "transparent")
                          }
                        >
                          {lbl}
                        </button>
                      );
                    })}
                    <div
                      style={{
                        flex: 1,
                        textAlign: "center",
                        fontSize: 18,
                        fontWeight: 700,
                        color: "var(--text)",
                        order: 1,
                      }}
                    >
                      {form.adults}
                    </div>
                  </div>
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: 1.8,
                      marginBottom: 7,
                    }}
                  >
                    Budget style
                  </label>
                  <select
                    value={form.style}
                    onChange={(e) => upd("style", e.target.value)}
                    className="input-base"
                    style={{
                      height: 46,
                      appearance: "none",
                      cursor: "pointer",
                    }}
                    onFocus={(e) =>
                      (e.target.style.borderColor = "rgba(245,166,35,.45)")
                    }
                    onBlur={(e) => (e.target.style.borderColor = "")}
                  >
                    <option>Budget</option>
                    <option>Mid-range</option>
                    <option>Comfortable</option>
                    <option>Luxury</option>
                  </select>
                </div>
              </div>

              {/* Return travel mode */}
              <div style={{ marginBottom: 18 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: 1.8,
                    marginBottom: 9,
                  }}
                >
                  Return travel
                </label>

                {/* FIX 2 (UI): Show contextual notice for international destinations
                    so user understands why train/bus are disabled — not a silent override */}
                {destIsIntl && (
                  <div
                    style={{
                      marginBottom: 9,
                      padding: "8px 12px",
                      background: "rgba(91,143,249,.07)",
                      border: "1px solid rgba(91,143,249,.18)",
                      borderRadius: 9,
                      fontSize: 11,
                      color: "var(--blue)",
                    }}
                  >
                    ✈️ International trip — return flight pricing applies.
                    Train/bus options are domestic only.
                  </div>
                )}

                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {[
                    { val: "flight", icon: "✈️", label: "Flight back" },
                    { val: "train", icon: "🚂", label: "Train / Bus back" },
                    { val: "undecided", icon: "🤔", label: "Not decided" },
                  ].map((opt) => {
                    // FIX 2: Disable train/bus options for international destinations
                    const disabled = destIsIntl && opt.val !== "flight";
                    const active = !disabled && form.returnMode === opt.val;
                    return (
                      <button
                        key={opt.val}
                        onClick={() => {
                          if (!disabled) upd("returnMode", opt.val);
                        }}
                        className={disabled ? "return-mode-disabled" : ""}
                        title={
                          disabled
                            ? "Only available for domestic trips"
                            : undefined
                        }
                        style={{
                          flex: 1,
                          minWidth: 100,
                          padding: "10px 8px",
                          borderRadius: 10,
                          border: `1px solid ${active ? "rgba(245,166,35,.45)" : "var(--border)"}`,
                          background: active
                            ? "var(--gold-dim)"
                            : disabled
                              ? "var(--bg3)"
                              : "var(--bg2)",
                          color: active
                            ? "var(--gold)"
                            : disabled
                              ? "var(--muted2)"
                              : "var(--muted)",
                          cursor: disabled ? "not-allowed" : "pointer",
                          fontFamily: "'DM Sans',sans-serif",
                          fontSize: 12,
                          fontWeight: active ? 700 : 500,
                          transition: "all .15s",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span style={{ fontSize: 18 }}>{opt.icon}</span>
                        <span>{opt.label}</span>
                        {disabled && (
                          <span style={{ fontSize: 9, color: "var(--muted2)" }}>
                            domestic only
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {form.returnMode === "train" && !destIsIntl && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "var(--teal)",
                      background: "var(--teal-dim)",
                      border: "1px solid rgba(0,212,170,.18)",
                      borderRadius: 8,
                      padding: "7px 11px",
                    }}
                  >
                    💡 We'll show you a one-way flight out + IRCTC link for your
                    return train
                  </div>
                )}
                {form.returnMode === "undecided" && !destIsIntl && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "var(--muted)",
                      background: "var(--bg2)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "7px 11px",
                    }}
                  >
                    We'll show all transport options so you can decide later
                  </div>
                )}
              </div>

              {tipMsg && (
                <div style={{
                  fontSize: 12,
                  marginBottom: 10,
                  background: "var(--blue-dim)",
                  border: "1px solid rgba(91,143,249,.2)",
                  borderRadius: 8,
                  padding: "9px 13px",
                  textAlign: "center",
                  color: "var(--blue)",
                }}>
                  💡 {tipMsg}
                </div>
              )}
              {error && (
                <div
                  style={{
                    color: "var(--red)",
                    fontSize: 13,
                    marginBottom: 13,
                    background: "rgba(255,107,107,.07)",
                    border: "1px solid rgba(255,107,107,.17)",
                    borderRadius: 8,
                    padding: "9px 13px",
                    textAlign: "center",
                  }}
                >
                  ⚠️ {error}
                </div>
              )}
              <button
                onClick={estimate}
                disabled={phase === "preview" || phase === "refining"}
                style={{
                  width: "100%",
                  padding: "14px",
                  borderRadius: 11,
                  border: "none",
                  background: "linear-gradient(130deg,#F5A623,#E84C1E)",
                  color: "#09090F",
                  fontFamily: "'DM Sans',sans-serif",
                  fontSize: 15,
                  fontWeight: 800,
                  cursor:
                    phase === "preview" || phase === "refining"
                      ? "not-allowed"
                      : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "all .24s",
                  opacity:
                    phase === "preview" || phase === "refining" ? 0.5 : 1,
                  boxShadow: "0 4px 18px rgba(245,166,35,.2)",
                }}
                onMouseEnter={(e) => {
                  if (phase === "idle" || phase === "done") {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow =
                      "0 10px 30px rgba(245,166,35,.3)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.boxShadow =
                    "0 4px 18px rgba(245,166,35,.2)";
                }}
              >
                <span style={{ fontSize: 17 }}>₹</span>
                Estimate My Budget
              </button>
              <p
                style={{
                  textAlign: "center",
                  marginTop: 9,
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                ⚡ Instant estimate · AI-refined · Auto-saved
              </p>
            </div>

            <div className="fu" style={{ animationDelay: ".1s" }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--muted)",
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  marginBottom: 12,
                  textAlign: "center",
                }}
              >
                ✦ Popular Routes
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))",
                  gap: 8,
                }}
              >
                {ROUTES.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const ci = fmt(addDays(new Date(), 14));
                      const co = fmt(addDays(new Date(), 14 + r.nights));
                      setForm((f) => ({
                        ...f,
                        from: r.from,
                        to: r.to,
                        checkIn: ci,
                        checkOut: co,
                      }));
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    style={{
                      padding: "11px 13px",
                      borderRadius: 11,
                      border: "1px solid var(--border)",
                      background: "var(--bg1)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all .17s",
                      fontFamily: "'DM Sans',sans-serif",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--gold-border)";
                      e.currentTarget.style.background = "var(--gold-dim)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.background = "var(--bg1)";
                    }}
                  >
                    <div style={{ fontSize: 17, marginBottom: 4 }}>
                      {r.emoji}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--text)",
                        marginBottom: 1,
                      }}
                    >
                      {r.from} → {r.to}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>
                      {r.nights} nights
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Error fallback UI — shown if both baseline + AI failed ── */}
        {view === "result" && !budget && phase === "done" && calcError && (
          <div style={{ maxWidth: 640, margin: "0 auto", padding: "60px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ fontFamily: "'Instrument Serif',serif", fontSize: 24, color: "var(--text)", marginBottom: 10 }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, marginBottom: 8, maxWidth: 380, margin: "0 auto 12px" }}>
              We couldn't calculate your estimate right now. This is usually a temporary network issue.
            </p>
            <div style={{ display: "inline-block", padding: "10px 18px", background: "rgba(245,166,35,.08)", border: "1px solid var(--gold-border)", borderRadius: 10, fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>
              Showing average market prices. Live prices may vary.
            </div>
            <br />
            <button onClick={() => { setView("form"); setCalcError(false); setPhase("idle"); }} className="pill" style={{ fontSize: 13, padding: "9px 20px" }}>
              ← Try Again
            </button>
          </div>
        )}

        {/* RESULT */}
        {view === "result" && budget && (
          <div
            style={{
              maxWidth: 640,
              margin: "0 auto",
              padding: "28px 16px 80px",
            }}
          >
            {phase === "refining" && (
              <div
                className="fi"
                style={{
                  marginBottom: 16,
                  padding: "11px 16px",
                  background: "var(--blue-dim)",
                  border: "1px solid rgba(91,143,249,.2)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Spinner size={14} color="var(--blue)" />
                <span style={{ fontSize: 12, color: "var(--blue)" }}>
                  Refining estimate with AI…
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    marginLeft: "auto",
                  }}
                >
                  Showing baseline prices
                </span>
              </div>
            )}

            {/* Hero number */}
            <div
              className="fu"
              style={{
                textAlign: "center",
                marginBottom: 16,
                padding: "32px 16px",
                background:
                  "radial-gradient(ellipse at 50% 0%,rgba(245,166,35,.07),transparent 70%)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--gold)",
                  letterSpacing: 2.5,
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                {form.from.split(",")[0]} → {form.to.split(",")[0]} · {nts}{" "}
                night{nts !== 1 ? "s" : ""} · {form.adults} adult
                {form.adults > 1 ? "s" : ""}
              </div>
              {/* Flight type indicator */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.07)",
                  borderRadius: 100,
                  padding: "3px 11px",
                  marginBottom: 10,
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                {budget.return_mode === "flight"
                  ? form.checkIn && form.checkOut
                    ? "✈️ Round trip flight search"
                    : "✈️ One-way flight search"
                  : budget.return_mode === "train"
                    ? "✈️ One-way flight out  +  🚂 Train return"
                    : "✈️ One-way out  ·  Return undecided"}
              </div>
              <div
                style={{ fontSize: 13, color: "var(--muted)", marginBottom: 5 }}
              >
                Estimated total trip cost
              </div>
              <div
                className="hero-num"
                style={{
                  fontFamily: "'Instrument Serif',serif",
                  fontSize: "clamp(48px,9vw,84px)",
                  color: "var(--gold)",
                  lineHeight: 1,
                  letterSpacing: -2,
                  marginBottom: 6,
                }}
              >
                <CountUp target={disp.total_lo} duration={850} /> –{" "}
                <CountUp target={disp.total_hi} duration={1050} />
              </div>
              <div
                style={{ fontSize: 14, color: "var(--muted)", marginBottom: 8 }}
              >
                <span style={{ color: "var(--text)", fontWeight: 600 }}>
                  Per person:
                </span>{" "}
                <span className="mono">
                  {INR(
                    Math.round(
                      disp.total_lo / Math.max(1, parseInt(form.adults) || 1),
                    ),
                  )}{" "}
                  –{" "}
                  {INR(
                    Math.round(
                      disp.total_hi / Math.max(1, parseInt(form.adults) || 1),
                    ),
                  )}
                </span>
              </div>

              {/* ── Pricing Disclaimer — legal protection, shown prominently ── */}
              <div style={{
                display: "inline-flex",
                alignItems: "flex-start",
                gap: 6,
                background: "rgba(255,255,255,.04)",
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 8,
                padding: "8px 13px",
                marginBottom: 14,
                maxWidth: 480,
              }}>
                <span style={{ fontSize: 10, color: "var(--muted2)", lineHeight: 1.7, textAlign: "left" }}>
                  ⚠️ <strong style={{ color: "var(--muted)" }}>Estimate only.</strong>{" "}
                  Based on historical averages and seasonal patterns. Final prices depend on availability, airline, and booking time. Always verify on booking platforms before purchasing.
                </span>
              </div>

              <div style={{ marginBottom: 14 }}>
                <a
                  href={affs.mmtFlight}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => trackClick("validation_nudge", form.to)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 16px",
                    borderRadius: 100,
                    background:
                      "linear-gradient(130deg,rgba(245,166,35,.12),rgba(232,76,30,.07))",
                    border: "1px solid rgba(245,166,35,.28)",
                    textDecoration: "none",
                    transition: "all .16s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "linear-gradient(130deg,rgba(245,166,35,.2),rgba(232,76,30,.12))")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      "linear-gradient(130deg,rgba(245,166,35,.12),rgba(232,76,30,.07))")
                  }
                >
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    Live prices may vary —
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--gold)",
                    }}
                  >
                    confirm on MakeMyTrip →
                  </span>
                </a>
              </div>

              <div style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: "var(--muted2)" }}>
                  Based on real Indian travel patterns ·{" "}
                </span>
                <button
                  onClick={() => setShowTrust(true)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: 11,
                    color: "var(--muted)",
                    textDecoration: "underline",
                    textDecorationStyle: "dotted",
                    textUnderlineOffset: 3,
                    fontFamily: "'DM Sans',sans-serif",
                  }}
                  onMouseEnter={(e) => (e.target.style.color = "var(--gold)")}
                  onMouseLeave={(e) => (e.target.style.color = "var(--muted)")}
                >
                  Learn how →
                </button>
              </div>

              {(() => {
                const bl = getBudgetLabel(budget.total_hi);
                return (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: "rgba(255,255,255,.04)",
                      border: "1px solid rgba(255,255,255,.08)",
                      borderRadius: 100,
                      padding: "4px 14px",
                      marginBottom: 10,
                      fontSize: 12,
                      color: bl.color,
                      fontWeight: 700,
                    }}
                  >
                    {bl.label}
                  </div>
                );
              })()}

              {(() => {
                const avg = getAvgTrip(form.from, form.to);
                if (!avg) return null;
                const userMid = (budget.total_lo + budget.total_hi) / 2;
                const avgMid = (avg[0] + avg[1]) / 2;
                const diff = userMid - avgMid;
                const pct = Math.abs(Math.round((diff / avgMid) * 100));
                const isAbove = diff > avgMid * 0.1;
                const isBelow = diff < -avgMid * 0.1;
                const label = isAbove
                  ? `↑ ${pct}% above typical ${form.to.split(",")[0]} trip`
                  : isBelow
                    ? `↓ ${pct}% below typical — great value!`
                    : "~ On par with typical trips";
                const color = isAbove
                  ? "var(--red)"
                  : isBelow
                    ? "var(--green)"
                    : "var(--muted)";
                return (
                  <div style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        marginBottom: 3,
                      }}
                    >
                      Avg {form.to.split(",")[0]} trip from{" "}
                      {form.from.split(",")[0]}:{" "}
                      <span className="mono" style={{ color: "var(--text)" }}>
                        {INR(avg[0])} – {INR(avg[1])}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color }}>
                      {label}
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const m = month(form.checkIn);
                const btv = getBestTimeLabel(form.to, m);
                return (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 6,
                      marginBottom: 14,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: `${btv.color}18`,
                        border: `1px solid ${btv.color}33`,
                        borderRadius: 100,
                        padding: "3px 10px",
                        fontSize: 11,
                        fontWeight: 700,
                        color: btv.color,
                      }}
                    >
                      {btv.icon} {btv.label} — {btv.tip}
                    </span>
                  </div>
                );
              })()}

              <button
                onClick={() => setShowShare(true)}
                style={{
                  marginBottom: 14,
                  padding: "7px 18px",
                  borderRadius: 100,
                  border: "1px solid var(--border2)",
                  background: "var(--bg2)",
                  color: "var(--muted)",
                  fontFamily: "'DM Sans',sans-serif",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all .15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--gold-border)";
                  e.currentTarget.style.color = "var(--gold)";
                  e.currentTarget.style.background = "var(--gold-dim)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border2)";
                  e.currentTarget.style.color = "var(--muted)";
                  e.currentTarget.style.background = "var(--bg2)";
                }}
              >
                🔗 Share this estimate
              </button>

              {(() => {
                const tPct = Math.round(
                  (budget.transport_hi / budget.total_hi) * 100,
                );
                return tPct > 30 ? (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: "rgba(91,143,249,.09)",
                      border: "1px solid rgba(91,143,249,.2)",
                      borderRadius: 100,
                      padding: "4px 13px",
                      marginBottom: 14,
                      fontSize: 12,
                      color: "var(--blue)",
                      fontWeight: 600,
                    }}
                  >
                    ✈️ Flights = {tPct}% of trip cost — compare before prices
                    change
                  </div>
                ) : null;
              })()}

              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  marginBottom: 12,
                }}
              >
                💡 Flights booked 30–45 days ahead are typically 12–18% cheaper
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 10,
                }}
              >
                <ConfidencePill level={budget.confidence} />
                {budget.season_multiplier > 1.2 && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      background: "rgba(255,107,107,.09)",
                      border: "1px solid rgba(255,107,107,.22)",
                      borderRadius: 100,
                      padding: "3px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--red)",
                    }}
                  >
                    🔴 Peak season (+
                    {Math.round((budget.season_multiplier - 1) * 100)}%)
                  </span>
                )}
                {budget.season_multiplier > 0 &&
                  budget.season_multiplier <= 0.8 && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: "rgba(52,211,153,.09)",
                        border: "1px solid rgba(52,211,153,.22)",
                        borderRadius: 100,
                        padding: "3px 10px",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--green)",
                      }}
                    >
                      🟢 Off-season (
                      {Math.round((1 - budget.season_multiplier) * 100)}%
                      cheaper)
                    </span>
                  )}
                {budget.source === "baseline" && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      background: "rgba(91,143,249,.09)",
                      border: "1px solid rgba(91,143,249,.22)",
                      borderRadius: 100,
                      padding: "3px 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--blue)",
                    }}
                  >
                    📊 Average price estimate
                  </span>
                )}
                {budget.ai_delta_pct && budget.ai_delta_pct !== 0 && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      background: "rgba(91,143,249,.09)",
                      border: "1px solid rgba(91,143,249,.22)",
                      borderRadius: 100,
                      padding: "3px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--blue)",
                    }}
                  >
                    🤖 AI adjusted {budget.ai_delta_pct > 0 ? "+" : ""}
                    {budget.ai_delta_pct}% from baseline
                  </span>
                )}
              </div>

              {/* Transport adjustment badge — only shown for domestic train/bus trips */}
              {budget.return_mode &&
                budget.return_mode !== "flight" &&
                budget.return_factor && (
                  <div
                    className="pi"
                    style={{
                      marginBottom: 10,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      background: "var(--teal-dim)",
                      border: "1px solid rgba(0,212,170,.25)",
                      borderRadius: 100,
                      padding: "5px 14px",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--teal)",
                    }}
                  >
                    {budget.return_mode === "train" ||
                    budget.return_mode === "bus"
                      ? `🚂 ${budget.return_mode === "train" ? "Train" : "Bus"} return — transport ~${Math.round((1 - budget.return_factor) * 100)}% cheaper than flying both ways`
                      : `🤔 Return undecided — using blended transport estimate`}
                  </div>
                )}

              {(() => {
                const btv = getBestTimeLabel(form.to, month(form.checkIn));
                return btv.scarcity ? (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: btv.color,
                      marginBottom: 10,
                      opacity: 0.85,
                    }}
                  >
                    {btv.icon} {btv.scarcity}
                  </div>
                ) : null;
              })()}

              {budget.generated_at && (
                <div style={{ fontSize: 10, color: "var(--muted2)" }}>
                  Estimated using average prices · Updated{" "}
                  {new Date(budget.generated_at).toLocaleDateString("en-IN", {
                    month: "long",
                    year: "numeric",
                  })}
                </div>
              )}
            </div>

            {/* When to Book */}
            {(() => {
              const wtb =
                budget && form.checkIn
                  ? getWhenToBook(form.checkIn, budget.season_multiplier)
                  : null;
              return wtb ? (
                <div
                  className="card fu"
                  style={{
                    padding: 16,
                    marginBottom: 12,
                    animationDelay: ".02s",
                    borderLeft: `3px solid ${wtb.color}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 22, lineHeight: 1 }}>
                      {wtb.icon}
                    </span>
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: wtb.color,
                          marginBottom: 4,
                        }}
                      >
                        {wtb.head}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          lineHeight: 1.6,
                        }}
                      >
                        {wtb.body}
                      </div>
                      {form.checkIn && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--muted2)",
                            marginTop: 6,
                          }}
                        >
                          📅 Best window: book{" "}
                          <strong style={{ color: "var(--text)" }}>
                            6–8 weeks before
                          </strong>{" "}
                          departure · Avoid last-minute surges
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Primary MMT CTA */}
            <div
              className="fu"
              style={{ marginBottom: 12, animationDelay: ".03s" }}
            >
              {budget.season_multiplier > 1.2 && (
                <div
                  className="pi"
                  style={{
                    marginBottom: 9,
                    padding: "10px 14px",
                    background: "rgba(255,107,107,.07)",
                    border: "1px solid rgba(255,107,107,.2)",
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--red)",
                      fontWeight: 600,
                    }}
                  >
                    🔥 Peak season pricing — book early to lock in lower rates
                  </span>
                </div>
              )}
              <div
                style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                className="cta-stack"
              >
                <a
                  href={affs.mmtFlight}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => trackClick("flight_mmt_primary", form.to)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "13px 18px",
                    borderRadius: 11,
                    background: "linear-gradient(130deg,#F5A623,#E84C1E)",
                    color: "#09090F",
                    fontWeight: 800,
                    fontSize: 14,
                    textDecoration: "none",
                    transition: "all .18s",
                    boxShadow: "0 4px 18px rgba(245,166,35,.28)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow =
                      "0 10px 28px rgba(245,166,35,.4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow =
                      "0 4px 18px rgba(245,166,35,.28)";
                  }}
                >
                  <span style={{ fontSize: 16 }}>🏅</span> Compare Flights on
                  MakeMyTrip
                </a>
              </div>
            </div>

            {/* Breakdown */}
            <div
              className="card fu"
              style={{ padding: 20, marginBottom: 12, animationDelay: ".04s" }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "var(--muted)",
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  marginBottom: 16,
                }}
              >
                Cost Breakdown
              </div>
              <CatBar
                icon="✈️"
                label="Transport"
                lo={disp.transport_lo}
                hi={disp.transport_hi}
                totalHi={disp.total_hi}
                delay={80}
              />
              <CatBar
                icon="🏨"
                label="Stay"
                lo={disp.stay_lo}
                hi={disp.stay_hi}
                totalHi={disp.total_hi}
                delay={160}
              />
              <CatBar
                icon="🍽️"
                label="Food"
                lo={disp.food_lo}
                hi={disp.food_hi}
                totalHi={disp.total_hi}
                delay={240}
              />
              <CatBar
                icon="🎯"
                label="Activities"
                lo={disp.activities_lo}
                hi={disp.activities_hi}
                totalHi={disp.total_hi}
                delay={320}
              />
            </div>

            {/* Budget Sliders */}
            <BudgetSliders budget={budget} onAdjust={setAdjBudget} />

            {/* Tips */}
            {budget.tips?.length > 0 && (
              <div
                className="card fu"
                style={{
                  padding: 18,
                  marginBottom: 12,
                  animationDelay: ".08s",
                  background:
                    "linear-gradient(135deg,rgba(245,166,35,.025),var(--bg1))",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--gold)",
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    marginBottom: 12,
                  }}
                >
                  💡 Save Money
                </div>
                {budget.tips.map((tip, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 9,
                      marginBottom: i < budget.tips.length - 1 ? 9 : 0,
                    }}
                  >
                    <div
                      style={{
                        width: 19,
                        height: 19,
                        borderRadius: 5,
                        background: "var(--gold-dim)",
                        border: "1px solid var(--gold-border)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        color: "var(--gold)",
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {i + 1}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        lineHeight: 1.65,
                      }}
                    >
                      {tip}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Affiliate CTAs */}
            {/* ── Affiliate disclosure — visible above CTAs, legally required ── */}
            <div style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 7,
              padding: "8px 12px",
              marginBottom: 10,
              background: "rgba(255,255,255,.03)",
              border: "1px solid rgba(255,255,255,.07)",
              borderRadius: 8,
            }}>
              <span style={{ fontSize: 10, color: "var(--muted2)", lineHeight: 1.6 }}>
                🔗 <strong style={{ color: "var(--muted)" }}>Affiliate links below.</strong>{" "}
                We may earn a small commission if you book — at no extra cost to you. This helps keep Farelo free.
              </span>
            </div>
            <div
              className="fu"
              style={{ marginBottom: 12, animationDelay: ".12s" }}
            >
              {/* ── PRIMARY: Flights ── */}
              <a
                href={affs.mmtFlight}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackClick("flight_mmt_book", form.to)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "16px 18px",
                  borderRadius: 12,
                  background: "linear-gradient(130deg,#F5A623,#E84C1E)",
                  color: "#09090F",
                  fontWeight: 800,
                  fontSize: 15,
                  textDecoration: "none",
                  marginBottom: 8,
                  boxShadow: "0 4px 20px rgba(245,166,35,.32)",
                  transition: "all .18s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow =
                    "0 10px 30px rgba(245,166,35,.45)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.boxShadow =
                    "0 4px 20px rgba(245,166,35,.32)";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🏅</span>
                  <div>
                    <div>Check Flights on MakeMyTrip</div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        opacity: 0.75,
                        marginTop: 1,
                      }}
                    >
                      Best prices · Instant confirmation
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: 18, opacity: 0.8 }}>→</span>
              </a>

              {/* ── PRIMARY: Hotels ── */}
              <a
                href={affs.mmtHotel}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackClick("hotel_mmt_book", form.to)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "14px 18px",
                  borderRadius: 12,
                  background: "var(--bg1)",
                  border: "1px solid var(--border2)",
                  color: "var(--text)",
                  fontWeight: 700,
                  fontSize: 14,
                  textDecoration: "none",
                  marginBottom: 8,
                  transition: "all .18s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--gold-border)";
                  e.currentTarget.style.background = "var(--gold-dim)";
                  e.currentTarget.style.color = "var(--gold)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border2)";
                  e.currentTarget.style.background = "var(--bg1)";
                  e.currentTarget.style.color = "var(--text)";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🏨</span>
                  <div>
                    <div>Find Hotels on MakeMyTrip</div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: "var(--muted)",
                        marginTop: 1,
                      }}
                    >
                      Best rates · Free cancellation options
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: 16, color: "var(--muted)" }}>→</span>
              </a>

              {/* ── IRCTC: domestic train return only ── */}
              {!isIntl(form.to) && (
                <a
                  href={affs.irctc}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: affs.returnMode === "train" ? "flex" : "none",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "14px 18px",
                    borderRadius: 12,
                    background:
                      "linear-gradient(135deg,rgba(0,212,170,.06),var(--bg1))",
                    border: "1px solid rgba(0,212,170,.35)",
                    color: "var(--teal)",
                    fontWeight: 700,
                    fontSize: 14,
                    textDecoration: "none",
                    marginBottom: 8,
                    transition: "all .18s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(0,212,170,.12)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      "linear-gradient(135deg,rgba(0,212,170,.06),var(--bg1))")
                  }
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span style={{ fontSize: 18 }}>🚂</span>
                    <div>
                      <div>Book Return Train on IRCTC</div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 400,
                          color: "var(--muted)",
                          marginTop: 1,
                        }}
                      >
                        {form.to.split(",")[0]} → {form.from.split(",")[0]} ·{" "}
                        {fmtD(form.checkOut)}
                      </div>
                    </div>
                  </div>
                  <span style={{ fontSize: 16, opacity: 0.6 }}>→</span>
                </a>
              )}

              {/* ── SECONDARY: collapsed compare panel ── */}
              <button
                onClick={() => setShowCompare((c) => !c)}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--muted)",
                  fontFamily: "'DM Sans',sans-serif",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  transition: "all .16s",
                  marginTop: 4,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--border2)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.color = "var(--muted)";
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    transition: "transform .2s",
                    display: "inline-block",
                    transform: showCompare ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                >
                  ⌃
                </span>
                {showCompare
                  ? "Hide other platforms"
                  : "Compare other platforms"}
              </button>

              {showCompare && (
                <div
                  className="fi"
                  style={{
                    marginTop: 8,
                    padding: 14,
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--bg1)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      letterSpacing: 1.8,
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    ✈️ More flight options
                  </div>
                  {[
                    {
                      href: affs.goibibo,
                      label: "Goibibo",
                      sub: "Cashback offers",
                      color: "var(--blue)",
                    },
                    {
                      href: affs.sky,
                      label: "Skyscanner",
                      sub: "Compare across airlines",
                      color: "var(--muted)",
                    },
                    {
                      href: affs.bookingFlight,
                      label: "Booking.com",
                      sub: "Flights + hotel bundles",
                      color: "#0078ff",
                    },
                  ].map(({ href, label, sub, color }) => (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 13px",
                        borderRadius: 9,
                        border: "1px solid var(--border)",
                        background: "var(--bg2)",
                        color: "var(--text)",
                        textDecoration: "none",
                        transition: "all .15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = color;
                        e.currentTarget.style.color = color;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.color = "var(--text)";
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {label}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            marginTop: 1,
                          }}
                        >
                          {sub}
                        </div>
                      </div>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>
                        →
                      </span>
                    </a>
                  ))}
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--muted)",
                      letterSpacing: 1.8,
                      textTransform: "uppercase",
                      marginTop: 6,
                      marginBottom: 4,
                    }}
                  >
                    🏨 More hotel options
                  </div>
                  <a
                    href={affs.booking}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 13px",
                      borderRadius: 9,
                      border: "1px solid var(--border)",
                      background: "var(--bg2)",
                      color: "var(--text)",
                      textDecoration: "none",
                      transition: "all .15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "#0078ff";
                      e.currentTarget.style.color = "#0078ff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        Booking.com
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--muted)",
                          marginTop: 1,
                        }}
                      >
                        International inventory · Reviews
                      </div>
                    </div>
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>
                      →
                    </span>
                  </a>

                  {/* IRCTC in compare panel for non-train domestic trips */}
                  {!isIntl(form.to) && affs.returnMode !== "train" && (
                    <>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "var(--muted)",
                          letterSpacing: 1.8,
                          textTransform: "uppercase",
                          marginTop: 6,
                          marginBottom: 4,
                        }}
                      >
                        🚂 Trains
                      </div>
                      <a
                        href={affs.irctc}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 13px",
                          borderRadius: 9,
                          border: "1px solid var(--border)",
                          background: "var(--bg2)",
                          color: "var(--text)",
                          textDecoration: "none",
                          transition: "all .15s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--teal)";
                          e.currentTarget.style.color = "var(--teal)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border)";
                          e.currentTarget.style.color = "var(--text)";
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            IRCTC
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--muted)",
                              marginTop: 1,
                            }}
                          >
                            Train tickets · 60 days in advance
                          </div>
                        </div>
                        <span style={{ fontSize: 13, color: "var(--muted)" }}>
                          →
                        </span>
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Affiliate disclosure */}
            <div
              style={{
                textAlign: "center",
                marginBottom: 12,
                padding: "6px 0",
              }}
            >
              <span style={{ fontSize: 10, color: "var(--muted2)" }}>
                We may earn a commission when you book through our links — at no
                extra cost to you.
              </span>
            </div>

            {/* Savings */}
            <div
              className="fu"
              style={{ marginBottom: 12, animationDelay: ".16s" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--teal)",
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      marginBottom: 3,
                    }}
                  >
                    💚 Start Saving
                  </div>
                  <div
                    style={{
                      fontFamily: "'Instrument Serif',serif",
                      fontSize: 17,
                      color: "var(--text)",
                    }}
                  >
                    Track your savings goal
                  </div>
                </div>
              </div>
              {activeTrip && (
                <SavingsSection
                  trip={activeTrip}
                  onUpdate={updateTrip}
                  totalHi={budget.total_hi}
                />
              )}
            </div>

            <div
              style={{
                textAlign: "center",
                marginTop: 30,
                paddingTop: 20,
                borderTop: "1px solid var(--border)",
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  color: "var(--muted2)",
                  marginBottom: 10,
                }}
              >
                AI + baseline pricing · Estimates only · Verify before booking
              </p>
              <button
                onClick={() => {
                  setView("form");
                  setShowCompare(false);
                }}
                className="pill"
              >
                ← Change Trip
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "16px 18px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              alignItems: "center",
            }}
          >
            <p style={{ fontSize: 11, color: "var(--muted2)" }}>
              Farelo · Free AI trip budget estimator for Indian travellers
            </p>
            <p
              style={{
                fontSize: 10,
                color: "var(--muted2)",
                maxWidth: 480,
                lineHeight: 1.6,
                textAlign: "center",
              }}
            >
              Estimates are based on historical travel costs, seasonal patterns,
              and typical price ranges. Actual prices vary depending on
              availability, demand, and booking time.
            </p>
            {/* affiliate disclosure already shown above booking CTAs — removed duplicate here */}
            <p style={{ fontSize: 10, color: "var(--muted2)" }}>
              Questions?{" "}
              <a href="mailto:ngdevinsights@gmail.com" style={{ color: "var(--muted)", textDecoration: "underline", textDecorationStyle: "dotted", fontFamily: "inherit" }}>
                ngdevinsights@gmail.com
              </a>
            </p>
          </div>
        </div>

        {/* Sticky scroll CTA */}
        {view === "result" && budget && showSticky && (
          <div
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 200,
              padding: "12px 16px",
              background: "rgba(9,9,15,.97)",
              borderTop: "1px solid rgba(245,166,35,.22)",
              backdropFilter: "blur(20px)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--gold)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {form.from.split(",")[0]} → {form.to.split(",")[0]}
              </div>
              <div
                className="mono"
                style={{ fontSize: 12, color: "var(--muted)" }}
              >
                {INR(budget.total_lo)} – {INR(budget.total_hi)}
              </div>
            </div>
            <a
              href={affs.mmtFlight}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackClick("flight_mmt_sticky", form.to)}
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 18px",
                borderRadius: 10,
                background: "linear-gradient(130deg,#F5A623,#E84C1E)",
                color: "#09090F",
                fontWeight: 800,
                fontSize: 13,
                textDecoration: "none",
                boxShadow: "0 2px 14px rgba(245,166,35,.35)",
                transition: "all .16s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.boxShadow =
                  "0 4px 22px rgba(245,166,35,.55)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.boxShadow =
                  "0 2px 14px rgba(245,166,35,.35)")
              }
            >
              🏅 Book on MakeMyTrip
            </a>
            <button
              onClick={() => setShowSticky(false)}
              style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: 7,
                border: "1px solid var(--border2)",
                background: "var(--bg2)",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "color .13s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "var(--text)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "var(--muted)")
              }
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </>
  );
}