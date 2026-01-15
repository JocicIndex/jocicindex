const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vREa_HW3XWf2Z_3WQ0YAT2P3whceAVheUiZyscHb9hsoqFzHpOIhIyEH0jsE7r6EpfW3DTcBrAlkVTH/pub?gid=133794820&single=true&output=csv";

/* =========================
   HELPER: DATUM & ZAHLEN
========================= */

function parseDate(dateStr) {
  const s = (dateStr || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return { y, m, d };
  }

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    const [d, m, y] = s.split(".").map(Number);
    return { y, m, d };
  }

  return null;
}

function toUnixSeconds(dateStr, timeStr) {
  const dt = parseDate(dateStr);
  if (!dt) return null;

  const t = (timeStr || "").trim();
  const match = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hh = Number(match[1]);
  const mm = Number(match[2]);

  const jsDate = new Date(dt.y, dt.m - 1, dt.d, hh, mm, 0);
  return Math.floor(jsDate.getTime() / 1000);
}

function formatNumberDE(n) {
  return n.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatTimestampDE(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

/* =========================
   HELPER: CSV PARSING
========================= */

function parseCsvLine(line, delimiter) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map(s => s.trim());
}

function detectDelimiter(lines) {
  const sample = lines.find(l => l.trim().length > 0) || "";
  if (sample.includes(";")) return ";";
  return ",";
}

async function loadCSV() {
  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("CSV konnte nicht geladen werden");

  let text = await res.text();
  text = text.replace(/^\uFEFF/, "");

  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const delimiter = detectDelimiter(lines);

  const data = [];

  for (const line of lines) {
    const parts = parseCsvLine(line, delimiter);
    if (parts.length < 3) continue;

    if (parts[0] === "" && parts[1] === "" && parts[2] === "") continue;
    if (/datum|date/i.test(parts[0])) continue;

    const dateStr = parts[0];
    const timeStr = parts[1];
    const pointsRaw = parts.slice(2).join(delimiter).trim();

    const value = Number(pointsRaw.replace(",", "."));
    const ts = toUnixSeconds(dateStr, timeStr);

    if (!Number.isFinite(value) || !ts) continue;

    data.push({ time: ts, value });
  }

  data.sort((a, b) => a.time - b.time);
  return data;
}

/* =========================
   HELPER: RANGE & HEADLINE
========================= */

function filterRange(allData, range) {
  if (range === "ALL") return allData;

  const lastT = allData[allData.length - 1].time;
  const lastDate = new Date(lastT * 1000);
  const dayMs = 24 * 60 * 60 * 1000;

  let cutoff;
  if (range === "1D") cutoff = new Date(lastDate - dayMs);
  else if (range === "1W") cutoff = new Date(lastDate - 7 * dayMs);
  else if (range === "1M") cutoff = new Date(lastDate - 30 * dayMs);
  else if (range === "3M") cutoff = new Date(lastDate - 90 * dayMs);
  else if (range === "1Y") cutoff = new Date(lastDate - 365 * dayMs);
  else if (range === "YTD") cutoff = new Date(lastDate.getFullYear(), 0, 1);
  else cutoff = new Date(0);

  const cutoffT = Math.floor(cutoff.getTime() / 1000);
  return allData.filter(p => p.time >= cutoffT);
}

function setActiveButton(range) {
  document.querySelectorAll(".btn").forEach(b => b.classList.remove("active"));
  const el = document.querySelector(`.btn[data-range="${range}"]`);
  if (el) el.classList.add("active");
}

function setHeadlineFromData(data) {
  const elLastValue = document.getElementById("lastValue");
  const elChangeAbs = document.getElementById("changeAbs");
  const elChangePct = document.getElementById("changePct");
  const elLastTimestamp = document.getElementById("lastTimestamp");

  if (!data || data.length === 0) return;

  const last = data[data.length - 1];
  const base = data[0]; // erster Punkt im aktuell gewählten Zeitraum

  elLastValue.textContent = `${formatNumberDE(last.value)} Punkte`;
  elLastTimestamp.textContent = `Stand: ${formatTimestampDE(last.time)}`;

  // Wenn nur 1 Punkt im Zeitraum existiert
  if (!base || base.time === last.time) {
    elChangeAbs.textContent = "+0,00";
    elChangePct.textContent = "(+0.00%)";
    elChangeAbs.classList.remove("pos", "neg");
    elChangePct.classList.remove("pos", "neg");
    elChangeAbs.classList.add("pos");
    elChangePct.classList.add("pos");
    return;
  }

  const diff = last.value - base.value;
  const pct = (diff / base.value) * 100;
  const sign = diff >= 0 ? "+" : "";

  elChangeAbs.textContent = `${sign}${formatNumberDE(diff)}`;
  elChangePct.textContent = `(${sign}${pct.toFixed(2)}%)`;

  elChangeAbs.classList.remove("pos", "neg");
  elChangePct.classList.remove("pos", "neg");

  if (diff >= 0) {
    elChangeAbs.classList.add("pos");
    elChangePct.classList.add("pos");
  } else {
    elChangeAbs.classList.add("neg");
    elChangePct.classList.add("neg");
  }
}


/* =========================
   START
========================= */

async function init() {
  const container = document.getElementById("chart");

  const chart = LightweightCharts.createChart(container, {
    layout: { background: { color: "#0b0f14" }, textColor: "#e9eef5" },
    timeScale: { timeVisible: true },
    rightPriceScale: { borderVisible: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    height: 420
  });

  const allData = await loadCSV();
  if (allData.length === 0) return;

  const series = chart.addSeries(LightweightCharts.LineSeries, {
    color: "#e9eef5",
    lineWidth: 2
  });

  function applyRange(range) {
    const filtered = filterRange(allData, range);
    series.setData(filtered);
    chart.timeScale().fitContent();
    setActiveButton(range);
    setHeadlineFromData(filtered);
  }

  applyRange("ALL");

  document.querySelectorAll(".btn").forEach(btn => {
    btn.addEventListener("click", () =>
      applyRange(btn.dataset.range)
    );
  });
}

init();
