// ===========================================================
// Story map
//
// Data model (Dexie table `nodes`):
//   Every node except the root IS the end of one line. The line's color
//   is stored on the node it leads to (`lineColor`), so a line can never
//   exist without a circle or square at its end.
//
//   { id, bookId, type: "root" | "decision" | "ending",
//     parentId, lineColor, label, endingId, createdAt }
//
//   root     the permanent start of the book (one per book, never deleted)
//   decision a circle: a choice point that branches into more lines
//   ending   a square: linked to a record in `endings` via endingId, so
//            it shares its entry with the list view
// ===========================================================

const PALETTE = [
  ["Red", "#D7263D"], ["Orange", "#E8833A"], ["Yellow", "#E8C21A"], ["Lime", "#8FB339"],
  ["Green", "#1F9D57"], ["Teal", "#0F7B6C"], ["Cyan", "#17A9C0"], ["Blue", "#1479B8"],
  ["Indigo", "#5B5FC7"], ["Purple", "#8E5BA8"], ["Pink", "#D6578F"], ["Slate", "#5F7373"],
];

const mapCfg = {
  xStep: 150,   // horizontal distance between levels
  yStep: 64,    // vertical distance between rows
  padL: 130, padT: 56, padR: 190, padB: 48,
  rootR: 17, decR: 11, endHalf: 10,
  stub: 96,     // length of the start line leading into the root
};

const ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5];
let mapZoomIdx = 2;
let mapRenderToken = 0;
const mapSheet = { nodeId: null };
const lineDraft = { parentId: null, type: "decision", color: PALETTE[0][1] };

// ---------- small helpers ----------

function safeColor(c, fallback = "#5F7373") {
  return /^#[0-9a-fA-F]{6}$/.test(c || "") ? c : fallback;
}

// black or white, whichever reads better on top of `hex`
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#241C15" : "#FFFFFF";
}

function trunc(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}

function radiusOf(node) {
  if (node.type === "root") return mapCfg.rootR;
  if (node.type === "decision") return mapCfg.decR;
  return mapCfg.endHalf;
}

// ---------- data ----------

async function ensureRoot(bookId) {
  await db.transaction("rw", db.nodes, async () => {
    const existing = await db.nodes.where("bookId").equals(bookId).filter((n) => n.type === "root").first();
    if (!existing) {
      await db.nodes.add({
        bookId, type: "root", parentId: null, lineColor: PALETTE[10][1],
        label: "", endingId: null, createdAt: Date.now(),
      });
    }
  });
}

async function nextLineColor(bookId) {
  const nodes = await db.nodes.where("bookId").equals(bookId).toArray();
  const used = new Set(nodes.map((n) => (n.lineColor || "").toLowerCase()));
  const free = PALETTE.find(([, hex]) => !used.has(hex.toLowerCase()));
  return free ? free[1] : PALETTE[nodes.length % PALETTE.length][1];
}

// ids of a node and everything beneath it
async function subtreeIds(rootId) {
  const all = await db.nodes.where("bookId").equals(state.currentBookId).toArray();
  const kids = new Map();
  for (const n of all) {
    if (n.parentId == null) continue;
    if (!kids.has(n.parentId)) kids.set(n.parentId, []);
    kids.get(n.parentId).push(n.id);
  }
  const out = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    (kids.get(id) || []).forEach((k) => stack.push(k));
  }
  return out;
}

// ---------- rendering ----------

function lineSvg(d, color) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function chevronsSvg(x0, x1, y, color) {
  const span = x1 - x0;
  const n = Math.min(8, Math.floor(span / 26));
  if (n <= 0) return "";
  const step = span / n;
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * step;
    out += `<path class="m-chev" d="M${x - 4} ${y - 5}L${x + 5} ${y}L${x - 4} ${y + 5}Z" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  return out;
}

async function renderMap() {
  const bookId = state.currentBookId;
  if (bookId == null) return;
  const token = ++mapRenderToken;

  await ensureRoot(bookId);
  const [nodes, endings] = await Promise.all([
    db.nodes.where("bookId").equals(bookId).toArray(),
    db.endings.where("bookId").equals(bookId).toArray(),
  ]);
  // a newer render started, or the person left this book / tab: drop this one
  if (token !== mapRenderToken || bookId !== state.currentBookId || state.bookTab !== "map") return;

  nodes.sort((a, b) => a.id - b.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const endingById = new Map(endings.map((e) => [e.id, e]));
  const kids = new Map();
  for (const n of nodes) {
    if (n.parentId == null) continue;
    if (!kids.has(n.parentId)) kids.set(n.parentId, []);
    kids.get(n.parentId).push(n);
  }
  const root = nodes.find((n) => n.type === "root");
  if (!root) return;

  // ----- layout: leaves take consecutive rows, parents sit between their children -----
  let row = 0;
  let maxDepth = 0;
  const seen = new Set();
  const place = (n, depth) => {
    if (seen.has(n.id)) return; // guards against a corrupt cycle
    seen.add(n.id);
    n._d = depth;
    maxDepth = Math.max(maxDepth, depth);
    const ch = (kids.get(n.id) || []).filter((c) => !seen.has(c.id));
    if (!ch.length) { n._r = row++; return; }
    ch.forEach((c) => place(c, depth + 1));
    const m = ch.length;
    n._r = m % 2 ? ch[(m - 1) / 2]._r : (ch[m / 2 - 1]._r + ch[m / 2]._r) / 2;
  };
  place(root, 0);

  const X = (n) => mapCfg.padL + n._d * mapCfg.xStep;
  const Y = (n) => mapCfg.padT + n._r * mapCfg.yStep;
  const width = mapCfg.padL + maxDepth * mapCfg.xStep + mapCfg.padR;
  const height = Math.max(190, mapCfg.padT + Math.max(0, row - 1) * mapCfg.yStep + mapCfg.padB);
  const placed = nodes.filter((n) => n._d !== undefined);

  // ----- lines (drawn first, farthest first, so nearer lines sit on top) -----
  const out = [];
  const rx = X(root), ry = Y(root);
  const rootColor = safeColor(root.lineColor);
  out.push(lineSvg(`M${rx - mapCfg.stub} ${ry}H${rx}`, rootColor));
  out.push(chevronsSvg(rx - mapCfg.stub + 14, rx - mapCfg.rootR - 8, ry, rootColor));

  const edges = placed
    .filter((n) => n.type !== "root" && byId.get(n.parentId) && byId.get(n.parentId)._d !== undefined)
    .sort((a, b) => Math.abs(Y(b) - Y(byId.get(b.parentId))) - Math.abs(Y(a) - Y(byId.get(a.parentId))));

  for (const c of edges) {
    const p = byId.get(c.parentId);
    const px = X(p), py = Y(p), cx = X(c), cy = Y(c);
    const dy = cy - py;
    const color = safeColor(c.lineColor);
    let d, hx0;
    if (Math.abs(dy) < 0.5) {
      d = `M${px} ${py}H${cx}`;
      hx0 = px + radiusOf(p) + 10;
    } else {
      const dir = dy > 0 ? 1 : -1;
      const r = Math.min(14, Math.abs(dy), (cx - px) / 2);
      d = `M${px} ${py}V${cy - dir * r}Q${px} ${cy} ${px + r} ${cy}H${cx}`;
      hx0 = px + r + 12;
    }
    out.push(lineSvg(d, color));
    out.push(chevronsSvg(hx0, cx - radiusOf(c) - 8, cy, color));
  }

  // ----- nodes -----
  for (const n of placed) {
    const x = X(n), y = Y(n);
    const kidCount = (kids.get(n.id) || []).length;

    if (n.type === "root") {
      const lines = kidCount === 1 ? "1 line" : `${kidCount} lines`;
      out.push(
        `<g class="mnode" data-node-id="${n.id}" tabindex="0" role="button" aria-label="Start of the story, ${lines}">` +
        `<circle class="hit" cx="${x}" cy="${y}" r="26"/>` +
        `<circle class="m-ring" cx="${x}" cy="${y}" r="${mapCfg.rootR}" stroke-width="5"/>` +
        `</g>`
      );
      out.push(`<text class="mlabel" x="${x - mapCfg.stub}" y="${y - 22}">${escapeHtml(trunc(n.label || "Start", 22))}</text>`);
    } else if (n.type === "decision") {
      const dash = kidCount < 2 ? ' stroke-dasharray="5 3.5"' : "";
      const lines = kidCount === 1 ? "1 line" : `${kidCount} lines`;
      const name = n.label ? `Decision: ${n.label}` : "Decision";
      out.push(
        `<g class="mnode" data-node-id="${n.id}" tabindex="0" role="button" aria-label="${escapeHtml(name)}, ${lines}">` +
        `<circle class="hit" cx="${x}" cy="${y}" r="22"/>` +
        `<circle class="m-ring" cx="${x}" cy="${y}" r="${mapCfg.decR}" stroke-width="4"${dash}/>` +
        `</g>`
      );
      if (n.label) out.push(`<text class="mlabel" text-anchor="end" x="${x - 14}" y="${y - 14}">${escapeHtml(trunc(n.label, 18))}</text>`);
    } else {
      const e = endingById.get(n.endingId);
      const color = safeColor(n.lineColor);
      const reached = !!e && e.status === "reached";
      const h = mapCfg.endHalf;
      const name = e ? e.label : "Missing ending";
      const fill = reached ? color : "var(--card)";
      const check = reached
        ? `<polyline points="${x - 5},${y} ${x - 1.5},${y + 4} ${x + 5},${y - 4}" fill="none" stroke="${inkOn(color)}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
        : "";
      out.push(
        `<g class="mnode${reached ? " mnode--reached" : ""}" data-node-id="${n.id}" tabindex="0" role="button" aria-label="Ending: ${escapeHtml(name)}, ${reached ? "reached" : "not reached"}">` +
        `<circle class="hit" cx="${x}" cy="${y}" r="22"/>` +
        `<rect x="${x - h}" y="${y - h}" width="${h * 2}" height="${h * 2}" rx="3" style="fill:${fill}" stroke="${color}" stroke-width="4"/>` +
        check +
        `</g>`
      );
      out.push(`<text class="mlabel" x="${x + 19}" y="${y + 4}">${escapeHtml(trunc(name, 22))}</text>`);
    }
  }

  const svg = $("#map-svg");
  const z = ZOOM_STEPS[mapZoomIdx];
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", Math.round(width * z));
  svg.setAttribute("height", Math.round(height * z));
  svg.innerHTML = out.join("");

  // hint + "not on the map yet" note
  $("#map-hint").textContent = nodes.length === 1
    ? "Tap the Start circle to draw your first line."
    : "Tap a circle to add a line. Tap a square to open its ending.";
  const placedEndings = new Set(nodes.filter((n) => n.endingId != null).map((n) => n.endingId));
  const unplaced = endings.filter((e) => !placedEndings.has(e.id)).length;
  const note = $("#map-note");
  note.hidden = unplaced === 0;
  if (unplaced) {
    note.textContent = `${unplaced} ending${unplaced === 1 ? "" : "s"} in your list ${unplaced === 1 ? "isn't" : "aren't"} on the map yet. When you add an ending line, choose \u201cLink an existing ending\u201d to place ${unplaced === 1 ? "it" : "them"}.`;
  }
}

// open a node by tapping it (or pressing Enter / Space when focused)
$("#map-svg").addEventListener("click", (ev) => {
  const g = ev.target.closest(".mnode");
  if (g) openNodeSheet(Number(g.dataset.nodeId));
});
$("#map-svg").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const g = ev.target.closest(".mnode");
  if (g) { ev.preventDefault(); openNodeSheet(Number(g.dataset.nodeId)); }
});

$("#zoom-in").addEventListener("click", () => { mapZoomIdx = Math.min(ZOOM_STEPS.length - 1, mapZoomIdx + 1); renderMap(); });
$("#zoom-out").addEventListener("click", () => { mapZoomIdx = Math.max(0, mapZoomIdx - 1); renderMap(); });

// ---------- color picker (shared by the node sheet and the add-line dialog) ----------

// onPick(hex, final): `final` is false while a custom color is still being dragged
function mountSwatches(container, color, onPick) {
  const current = color.toLowerCase();
  container.setAttribute("role", "radiogroup");
  container.innerHTML =
    PALETTE.map(([name, hex]) =>
      `<button type="button" class="swatch" role="radio" aria-checked="${hex.toLowerCase() === current}" aria-label="${name}" data-color="${hex}" style="--sw:${hex}"></button>`
    ).join("") +
    `<label class="swatch swatch--custom" aria-label="Custom color"><input type="color" value="${color}"></label>`;

  const mark = (hex) => {
    container.querySelectorAll(".swatch[data-color]").forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.color.toLowerCase() === hex.toLowerCase())));
  };
  container.querySelectorAll(".swatch[data-color]").forEach((b) =>
    b.addEventListener("click", () => {
      container.querySelector('input[type="color"]').value = b.dataset.color;
      mark(b.dataset.color);
      onPick(b.dataset.color, true);
    }));
  const custom = container.querySelector('input[type="color"]');
  custom.addEventListener("input", () => { mark(custom.value); onPick(custom.value, false); });
  custom.addEventListener("change", () => { mark(custom.value); onPick(custom.value, true); });
}

// ---------- node sheet: tap a circle or square ----------

async function openNodeSheet(nodeId) {
  const node = await db.nodes.get(nodeId);
  if (!node) return;
  mapSheet.nodeId = nodeId;
  const ending = node.endingId != null ? await db.endings.get(node.endingId) : null;
  const kidCount = await db.nodes.where("parentId").equals(nodeId).count();

  const title = node.type === "root" ? "Start"
    : node.type === "decision" ? (node.label || "Decision")
    : (ending ? ending.label : "Missing ending");
  $("#node-dlg-title").textContent = title;

  let html = "";
  if (node.type !== "ending") {
    const isRoot = node.type === "root";
    html += `<div class="field">
      <label for="f-node-label">${isRoot ? "Name for the starting point" : "What's the choice?"} <span class="hint">optional</span></label>
      <input type="text" id="f-node-label" value="${escapeHtml(node.label || "")}" autocomplete="off" placeholder="${isRoot ? "Start" : "e.g. Open the door or run?"}">
    </div>`;
    if (node.type === "decision" && kidCount < 2) {
      html += `<p class="hint-box">This choice has ${kidCount === 0 ? "no lines" : "only one line"} so far. A decision needs at least two lines to branch. Until then its circle is drawn dashed.</p>`;
    }
  } else if (ending) {
    const meta = [ending.pageRef, ending.rating ? "\u2605".repeat(ending.rating) : ""].filter(Boolean).join(" \u00b7 ");
    html += `<div class="node-summary">${meta ? `<p>${escapeHtml(meta)}</p>` : ""}</div>
      <div class="field toggle-row">
        <span>Reached</span>
        <label class="switch">
          <input type="checkbox" id="node-reached" ${ending.status === "reached" ? "checked" : ""}>
          <span class="track"></span><span class="thumb"></span>
        </label>
      </div>`;
  } else {
    html += `<p class="hint-box">The ending this square pointed to no longer exists. You can remove the square from the map.</p>`;
  }
  html += `<div class="field"><label>${node.type === "root" ? "Start line color" : "Line color"}</label><div class="swatches" id="node-swatches"></div></div>`;
  $("#node-dlg-body").innerHTML = html;

  mountSwatches($("#node-swatches"), safeColor(node.lineColor), async (hex, final) => {
    if (!final) return;
    await db.nodes.update(nodeId, { lineColor: hex });
    renderMap();
  });

  const foot = $("#node-dlg-foot");
  if (node.type === "root") {
    foot.innerHTML = `<button type="button" class="btn btn--primary" id="node-add">Add a line</button>`;
  } else if (node.type === "decision") {
    foot.innerHTML = `<button type="button" class="btn btn--ghost btn--danger" id="node-delete">Delete</button>
      <button type="button" class="btn btn--primary" id="node-add">Add a line</button>`;
  } else {
    foot.innerHTML = `<button type="button" class="btn btn--ghost btn--danger" id="node-remove">Remove from map</button>` +
      (ending ? `<button type="button" class="btn btn--primary" id="node-open">Open entry</button>` : "");
  }

  $("#node-add")?.addEventListener("click", () => { closeDialog("dlg-node"); openLineDialog(nodeId); });

  $("#node-delete")?.addEventListener("click", async () => {
    const ids = await subtreeIds(nodeId);
    const beyond = ids.length - 1;
    const msg = beyond === 0
      ? "Delete this decision?"
      : `Delete this decision and the ${beyond} point${beyond === 1 ? "" : "s"} beyond it? Endings you've logged stay in your list.`;
    if (!confirm(msg)) return;
    mapSheet.nodeId = null; // nothing left to save a label for
    await db.nodes.bulkDelete(ids);
    closeDialog("dlg-node");
    renderBook();
    toast("Decision deleted");
  });

  $("#node-remove")?.addEventListener("click", async () => {
    mapSheet.nodeId = null;
    await db.nodes.delete(nodeId);
    closeDialog("dlg-node");
    renderBook();
    toast("Removed from the map. The entry is still in your list.");
  });

  $("#node-open")?.addEventListener("click", () => {
    closeDialog("dlg-node");
    openEndingDialogById(ending.id);
  });

  $("#node-reached")?.addEventListener("change", () => toggleReached(ending.id));

  openDialog("dlg-node");
}

// save a decision's / start's label when the sheet closes, however it closes
$("#dlg-node").addEventListener("close", async () => {
  const id = mapSheet.nodeId;
  const input = $("#f-node-label");
  mapSheet.nodeId = null;
  if (id == null || !input) return;
  const node = await db.nodes.get(id);
  const value = input.value.trim();
  if (node && node.type !== "ending" && (node.label || "") !== value) {
    await db.nodes.update(id, { label: value });
    renderMap();
  }
});

// ---------- add-line dialog ----------

function setLineType(type) {
  lineDraft.type = type;
  const isEnd = type === "ending";
  $$("#line-type button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.type === type)));
  $("#line-type-hint").textContent = isEnd
    ? "A square is where the story stops. It also gets an entry in your Endings list."
    : "A circle is a choice point. It branches into two or more lines.";
  $("#line-label-text").textContent = isEnd ? "Ending title" : "What's the choice?";
  $("#line-label-opt").hidden = isEnd;
  $("#f-line-label").placeholder = isEnd ? "e.g. Frozen Forever" : "e.g. Open the door or run?";
  const canLink = $("#f-line-link").options.length > 1;
  $("#line-link-field").hidden = !(isEnd && canLink);
  syncLineLabel();
}

function syncLineLabel() {
  const linking = lineDraft.type === "ending" && !!$("#f-line-link").value;
  $("#f-line-label").disabled = linking;
  $("#f-line-label").required = lineDraft.type === "ending" && !linking;
}

async function openLineDialog(parentId) {
  const bookId = state.currentBookId;
  const [nodes, endings] = await Promise.all([
    db.nodes.where("bookId").equals(bookId).toArray(),
    db.endings.where("bookId").equals(bookId).toArray(),
  ]);
  const placed = new Set(nodes.filter((n) => n.endingId != null).map((n) => n.endingId));
  const unplaced = endings.filter((e) => !placed.has(e.id));

  lineDraft.parentId = parentId;
  lineDraft.color = await nextLineColor(bookId);
  $("#f-line-label").value = "";
  $("#f-line-link").innerHTML = `<option value="">Create a new ending</option>` +
    unplaced.map((e) => `<option value="${e.id}">${escapeHtml(e.label)}</option>`).join("");
  mountSwatches($("#line-swatches"), lineDraft.color, (hex) => { lineDraft.color = hex; });
  setLineType("decision");
  openDialog("dlg-line");
}

$$("#line-type button").forEach((b) => b.addEventListener("click", () => setLineType(b.dataset.type)));
$("#f-line-link").addEventListener("change", syncLineLabel);

$("#form-line").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const bookId = state.currentBookId;
  const parentId = lineDraft.parentId;
  const lineColor = safeColor(lineDraft.color);
  const label = $("#f-line-label").value.trim();

  if (lineDraft.type === "decision") {
    await db.nodes.add({ bookId, type: "decision", parentId, lineColor, label, endingId: null, createdAt: Date.now() });
    toast("Decision added");
  } else {
    const linkId = Number($("#f-line-link").value) || null;
    if (!linkId && !label) return;
    await db.transaction("rw", db.endings, db.nodes, async () => {
      const endingId = linkId || await db.endings.add({
        bookId, label, pageRef: "", path: "", notes: "", rating: null, isSpoiler: false,
        status: "unreached", reachedAt: null, createdAt: Date.now(),
      });
      await db.nodes.add({ bookId, type: "ending", parentId, lineColor, label: "", endingId, createdAt: Date.now() });
    });
    toast(linkId ? "Ending placed on the map" : "Ending added");
  }
  closeDialog("dlg-line");
  renderBook(); // refreshes the list counts and, on the map tab, the map
});