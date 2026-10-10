// ===========================================================
// Database
// ===========================================================
const db = new Dexie("cyoa_tracker");
db.version(1).stores({
  books: "++id, title, createdAt",
  endings: "++id, bookId, status, createdAt",
});
// v2 adds the story-map table. Existing books and endings are kept.
db.version(2).stores({
  books: "++id, title, createdAt",
  endings: "++id, bookId, status, createdAt",
  nodes: "++id, bookId, parentId, endingId",
}); 
// ===========================================================
// State
// ===========================================================
const state = {
  currentBookId: null,
  editingBookId: null,
  editingEndingId: null,
  expandedEndingId: null,
  bookTab: "list", // "list" | "map"
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ===========================================================
// Toast
// ===========================================================
let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ===========================================================
// View switching
// ===========================================================
function showLibrary() {
  state.currentBookId = null;
  $("#view-book").hidden = true;
  $("#view-library").hidden = false;
  renderLibrary();
}

async function showBook(bookId) {
  state.currentBookId = bookId;
  state.expandedEndingId = null;
  state.bookTab = "list";
  applyBookTab();
  $("#view-library").hidden = true;
  $("#view-book").hidden = false;
  await renderBook();
}

function applyBookTab() {
  const isMap = state.bookTab === "map";
  $("#tab-list").setAttribute("aria-selected", String(!isMap));
  $("#tab-map").setAttribute("aria-selected", String(isMap));
  $("#panel-list").hidden = isMap;
  $("#panel-map").hidden = !isMap;
  $("#btn-add-ending").hidden = isMap;
}

function setBookTab(tab) {
  state.bookTab = tab;
  applyBookTab();
  if (tab === "map") renderMap(); // defined in map.js
}

$("#tab-list").addEventListener("click", () => setBookTab("list"));
$("#tab-map").addEventListener("click", () => setBookTab("map"));

// ===========================================================
// Rendering: Library
// ===========================================================
async function renderLibrary() {
  const books = await db.books.orderBy("createdAt").reverse().toArray();
  const shelf = $("#shelf");
  const empty = $("#library-empty");
  const subtitle = $("#library-subtitle");

  if (books.length === 0) {
    shelf.innerHTML = "";
    empty.hidden = false;
    subtitle.textContent = "";
    return;
  }
  empty.hidden = true;
  subtitle.textContent = `${books.length} book${books.length === 1 ? "" : "s"}`;

  const rows = await Promise.all(
    books.map(async (b) => {
      const endings = await db.endings.where("bookId").equals(b.id).toArray();
      const reached = endings.filter((e) => e.status === "reached").length;
      const known = b.totalEndings && b.totalEndings > endings.length ? b.totalEndings : endings.length;
      const pct = known > 0 ? Math.round((reached / known) * 100) : 0;
      const stateClass = reached === 0 ? "" : (known > 0 && reached >= known ? "spine--complete" : "spine--started");
      return `
        <button class="spine ${stateClass}" data-book-id="${b.id}">
          <span class="spine__bar"></span>
          <span class="spine__body">
            <p class="spine__title">${escapeHtml(b.title)}</p>
            <p class="spine__author">${escapeHtml(b.author || "Unknown author")}</p>
            <span class="progress-row">
              <span class="progress-track"><span class="progress-fill" style="width:${pct}%"></span></span>
              <span class="progress-label">${reached}/${known || 0}</span>
            </span>
          </span>
        </button>`;
    })
  );
  shelf.innerHTML = rows.join("");

  $$("#shelf .spine").forEach((el) => {
    el.addEventListener("click", () => showBook(Number(el.dataset.bookId)));
  });
}

// ===========================================================
// Rendering: Book detail
// ===========================================================
async function renderBook() {
  const book = await db.books.get(state.currentBookId);
  if (!book) { showLibrary(); return; }

  $("#book-title").textContent = book.title;
  $("#book-author").textContent = book.author || "Unknown author";
  if (state.bookTab == "map") renderMap();

  const endings = await db.endings
    .where("bookId").equals(book.id)
    .reverse().sortBy("createdAt");

  const reached = endings.filter((e) => e.status === "reached").length;
  const known = book.totalEndings && book.totalEndings > endings.length ? book.totalEndings : endings.length;
  $("#book-progress-count").textContent = `${reached}/${known || 0}`;
  $("#book-progress-text").textContent = known > 0 && reached >= known
    ? "every known ending reached"
    : "endings reached";

  const list = $("#endings");
  const empty = $("#book-empty");

  if (endings.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = endings.map((e) => {
    const expanded = state.expandedEndingId === e.id;
    const hideBody = e.isSpoiler && !expanded;
    return `
      <div class="ending ${e.status === "reached" ? "ending--reached" : ""}" data-ending-id="${e.id}">
        <button class="ending__row" data-action="toggle-expand" data-id="${e.id}">
          <span class="check" data-action="toggle-reached" data-id="${e.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
          <span class="ending__main">
            <p class="ending__label">${escapeHtml(e.label)}</p>
            <p class="ending__meta">${[e.pageRef, ratingStars(e.rating)].filter(Boolean).join(" &middot; ") || "&nbsp;"}</p>
          </span>
          <span class="ending__chev">${expanded ? "&#x2303;" : "&#x2304;"}</span>
        </button>
        ${expanded ? `
        <div class="ending__detail">
          ${e.isSpoiler && hideBody ? "" : renderEndingDetail(e)}
          <div class="actions">
            <button data-action="edit-ending" data-id="${e.id}">Edit</button>
            <button class="danger" data-action="delete-ending" data-id="${e.id}">Delete</button>
          </div>
        </div>` : ""}
      </div>`;
  }).join("");

  $$('#endings [data-action="toggle-reached"]').forEach((el) =>
    el.addEventListener("click", (ev) => { ev.stopPropagation(); toggleReached(Number(el.dataset.id)); }));
  $$('#endings [data-action="toggle-expand"]').forEach((el) =>
    el.addEventListener("click", () => {
      const id = Number(el.dataset.id);
      state.expandedEndingId = state.expandedEndingId === id ? null : id;
      renderBook();
    }));
  $$('#endings [data-action="edit-ending"]').forEach((el) =>
    el.addEventListener("click", (ev) => { ev.stopPropagation(); openEndingDialogById(Number(el.dataset.id)); }));
  $$('#endings [data-action="delete-ending"]').forEach((el) =>
    el.addEventListener("click", (ev) => { ev.stopPropagation(); deleteEnding(Number(el.dataset.id)); }));
}

function renderEndingDetail(e) {
  let html = "";
  if (e.path) html += `<p><span class="label">Path: </span>${escapeHtml(e.path)}</p>`;
  if (e.notes) html += `<p>${escapeHtml(e.notes)}</p>`;
  if (!e.path && !e.notes) html += `<p>No notes yet.</p>`;
  return html;
}

function ratingStars(n) {
  if (!n) return "";
  return "&#9733;".repeat(n);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ===========================================================
// Mutations
// ===========================================================
async function toggleReached(id) {
  const e = await db.endings.get(id);
  const nowReached = e.status !== "reached";
  await db.endings.update(id, {
    status: nowReached ? "reached" : "unreached",
    reachedAt: nowReached ? Date.now() : null,
  });
  renderBook();
}

async function deleteEnding(id) {
  if (!confirm("Delete this ending? This can't be undone.")) return;
  await db.transaction("rw", db.endings, db.nodes, async () => {
    await db.nodes.where("endingId").equals(id).delete();
    await db.endings.delete(id);
  });
  state.expandedEndingId = null;
  renderBook();
  toast("Ending deleted");
}

async function deleteBook(id) {
  if (!confirm("Delete this book and all its endings? This can't be undone.")) return;
  await db.transaction("rw", db.books, db.endings, db.nodes, async () => {
    await db.endings.where("bookId").equals(id).delete();
    await db.nodes.where("bookId").equals(id).delete();
    await db.books.delete(id);
  });
  closeDialog("dlg-book");
  showLibrary();
  toast("Book deleted");
}

// ===========================================================
// Dialogs: generic open/close
// ===========================================================
function openDialog(id) { $("#" + id).showModal(); }
function closeDialog(id) { $("#" + id).close(); }

$$("[data-close]").forEach((btn) =>
  btn.addEventListener("click", () => closeDialog(btn.dataset.close)));

// close when clicking the backdrop
$$("dialog").forEach((dlg) => {
  dlg.addEventListener("click", (ev) => {
    const r = dlg.getBoundingClientRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    if (!inside) dlg.close();
  });
});

// ===========================================================
// Book dialog
// ===========================================================
function openBookDialog(book) {
  state.editingBookId = book ? book.id : null;
  $("#book-dlg-title").textContent = book ? "Edit book" : "Add a book";
  $("#f-book-title").value = book?.title || "";
  $("#f-book-author").value = book?.author || "";
  $("#f-book-series").value = book?.series || "";
  $("#f-book-total").value = book?.totalEndings ?? "";
  $("#f-book-notes").value = book?.notes || "";

  let deleteBtn = $("#btn-delete-book");
  if (book) {
    if (!deleteBtn) {
      deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.id = "btn-delete-book";
      deleteBtn.className = "btn btn--ghost";
      deleteBtn.textContent = "Delete";
      deleteBtn.style.color = "var(--rust)";
      deleteBtn.addEventListener("click", () => deleteBook(state.editingBookId));
      $("#form-book .sheet__foot").prepend(deleteBtn);
    }
  } else if (deleteBtn) {
    deleteBtn.remove();
  }

  openDialog("dlg-book");
  setTimeout(() => $("#f-book-title").focus(), 50);
}

$("#btn-add-book").addEventListener("click", () => openBookDialog(null));
$("#btn-edit-book").addEventListener("click", async () => {
  const book = await db.books.get(state.currentBookId);
  openBookDialog(book);
});

$("#form-book").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const title = $("#f-book-title").value.trim();
  if (!title) return;
  const data = {
    title,
    author: $("#f-book-author").value.trim(),
    series: $("#f-book-series").value.trim(),
    totalEndings: $("#f-book-total").value ? Number($("#f-book-total").value) : null,
    notes: $("#f-book-notes").value.trim(),
  };
  if (state.editingBookId) {
    await db.books.update(state.editingBookId, data);
    toast("Book updated");
  } else {
    data.createdAt = Date.now();
    const id = await db.books.add(data);
    toast("Book added");
    closeDialog("dlg-book");
    showBook(id);
    return;
  }
  closeDialog("dlg-book");
  if (!$("#view-book").hidden) renderBook(); else renderLibrary();
});

// ===========================================================
// Ending dialog
// ===========================================================
function setRating(n) {
  $("#f-ending-rating").dataset.value = n;
  $$("#f-ending-rating button").forEach((b) => {
    b.classList.toggle("on", Number(b.dataset.star) <= n);
  });
}

$$("#f-ending-rating button").forEach((b) => {
  b.addEventListener("click", () => {
    const current = Number($("#f-ending-rating").dataset.value);
    const val = Number(b.dataset.star);
    setRating(val === current ? 0 : val);
  });
});

function openEndingDialog(endingId, ending) {
  state.editingEndingId = endingId || null;
  $("#ending-dlg-title").textContent = endingId ? "Edit ending" : "Add an ending";
  $("#f-ending-label").value = ending?.label || "";
  $("#f-ending-page").value = ending?.pageRef || "";
  $("#f-ending-path").value = ending?.path || "";
  $("#f-ending-notes").value = ending?.notes || "";
  $("#f-ending-reached").checked = ending?.status === "reached";
  $("#f-ending-spoiler").checked = !!ending?.isSpoiler;
  setRating(ending?.rating || 0);
  openDialog("dlg-ending");
  setTimeout(() => $("#f-ending-label").focus(), 50);
}

$("#btn-add-ending").addEventListener("click", () => openEndingDialog(null, null));

async function openEndingDialogById(id) {
  const e = await db.endings.get(id);
  openEndingDialog(id, e);
}


$("#form-ending").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const label = $("#f-ending-label").value.trim();
  if (!label) return;
  const reached = $("#f-ending-reached").checked;
  const data = {
    bookId: state.currentBookId,
    label,
    pageRef: $("#f-ending-page").value.trim(),
    path: $("#f-ending-path").value.trim(),
    notes: $("#f-ending-notes").value.trim(),
    rating: Number($("#f-ending-rating").dataset.value) || null,
    isSpoiler: $("#f-ending-spoiler").checked,
    status: reached ? "reached" : "unreached",
  };
  if (state.editingEndingId) {
    const existing = await db.endings.get(state.editingEndingId);
    data.reachedAt = reached ? (existing.reachedAt || Date.now()) : null;
    await db.endings.update(state.editingEndingId, data);
    toast("Ending updated");
  } else {
    data.reachedAt = reached ? Date.now() : null;
    data.createdAt = Date.now();
    await db.endings.add(data);
    toast("Ending added");
  }
  closeDialog("dlg-ending");
  renderBook();
});

// ===========================================================
// Back / navigation
// ===========================================================
$("#btn-back").addEventListener("click", showLibrary);

// ===========================================================
// Settings: export / import
// ===========================================================
$("#btn-settings").addEventListener("click", () => openDialog("dlg-settings"));

async function buildExportPayload() {
  const [books, endings, nodes] = await Promise.all([
    db.books.toArray(), db.endings.toArray(), db.nodes.toArray(),
  ]);
  return {
    app: "cyoa-endings-tracker",
    version: 2,
    exportedAt: new Date().toISOString(),
    books, endings, nodes,
  };
}

// Merges a library file into what's already on this device.
//  - books with the same title are merged, not duplicated
//  - endings already in a book (same title, ignoring case) are skipped; if the
//    file says it was reached, the existing one is marked reached too
//  - a story map is only imported into a book whose map is still empty, so an
//    existing map is never overwritten
async function importPayload(payload) {
  if (!payload || !Array.isArray(payload.books) || !Array.isArray(payload.endings)) {
    throw new Error("That file doesn't look like a library export.");
  }
  const importedNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const summary = { books: 0, endings: 0, skippedEndings: 0, maps: 0, skippedMaps: 0 };

  await db.transaction("rw", db.books, db.endings, db.nodes, async () => {
    const known = await db.books.toArray();
    const bookMap = new Map(); // id in the file -> id on this device
    for (const b of payload.books) {
      const { id: oldId, ...rest } = b;
      const title = String(rest.title || "").trim();
      if (!title) continue;
      const match = known.find((x) => x.title.trim().toLowerCase() === title.toLowerCase());
      if (match) {
        bookMap.set(oldId, match.id);
      } else {
        const rec = { ...rest, title, createdAt: rest.createdAt || Date.now() };
        const newId = await db.books.add(rec);
        known.push({ ...rec, id: newId });
        bookMap.set(oldId, newId);
        summary.books++;
      }
    }

    const endingMap = new Map();
    for (const e of payload.endings) {
      const { id: oldId, ...rest } = e;
      const newBookId = bookMap.get(e.bookId);
      const label = String(rest.label || "").trim();
      if (newBookId == null || !label) continue;
      const dupe = await db.endings.where("bookId").equals(newBookId)
        .filter((x) => x.label.trim().toLowerCase() === label.toLowerCase()).first();
      if (dupe) {
        endingMap.set(oldId, dupe.id);
        summary.skippedEndings++;
        if (rest.status === "reached" && dupe.status !== "reached") {
          await db.endings.update(dupe.id, { status: "reached", reachedAt: rest.reachedAt || Date.now() });
        }
      } else {
        const newId = await db.endings.add({ ...rest, label, bookId: newBookId, createdAt: rest.createdAt || Date.now() });
        endingMap.set(oldId, newId);
        summary.endings++;
      }
    }

    const byBook = new Map();
    for (const n of importedNodes) {
      if (!byBook.has(n.bookId)) byBook.set(n.bookId, []);
      byBook.get(n.bookId).push(n);
    }
    for (const [oldBookId, list] of byBook) {
      const newBookId = bookMap.get(oldBookId);
      if (newBookId == null || !list.some((n) => n.type === "root")) continue;
      const current = await db.nodes.where("bookId").equals(newBookId).toArray();
      if (current.some((n) => n.type !== "root")) { summary.skippedMaps++; continue; }
      await db.nodes.where("bookId").equals(newBookId).delete(); // drop the empty auto-made root
      const idMap = new Map();
      for (const n of [...list].sort((a, b) => a.id - b.id)) { // parents always have lower ids
        const { id: oldId, ...rest } = n;
        const parentId = rest.parentId == null ? null : idMap.get(rest.parentId);
        if (rest.parentId != null && parentId == null) continue;
        let endingId = null;
        if (rest.endingId != null) {
          endingId = endingMap.get(rest.endingId) ?? null;
          if (endingId == null) continue;
        }
        const newId = await db.nodes.add({
          ...rest, bookId: newBookId, parentId, endingId,
          lineColor: safeColor(rest.lineColor), createdAt: rest.createdAt || Date.now(),
        });
        idMap.set(oldId, newId);
      }
      summary.maps++;
    }
  });
  return summary;
}

$("#btn-export").addEventListener("click", async () => {
  const payload = await buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `adventure-library-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Exported");
});

$("#btn-import").addEventListener("click", () => $("#file-import").click());

$("#file-import").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.books) || !Array.isArray(payload.endings)) {
      throw new Error("That file doesn't look like a library export.");
    }
    const points = Array.isArray(payload.nodes) ? payload.nodes.length : 0;
    if (!confirm(`Import ${payload.books.length} book(s), ${payload.endings.length} ending(s) and ${points} map point(s)? Books with the same title are merged, and endings you already have are skipped.`)) return;
    const s = await importPayload(payload);
    toast(`Imported ${s.endings} new ending${s.endings === 1 ? "" : "s"}`);
    closeDialog("dlg-settings");
    showLibrary();
  } catch (err) {
    alert("Import failed: " + err.message);
  }
});

// ===========================================================
// Service worker
// ===========================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      /* offline support just won't be available; app still works */
    });
  });
}

// ===========================================================
// Boot
// ===========================================================
showLibrary();
