// ========== Config ==========
const API = "https://api.mangadex.org";
const UPLOADS = "https://uploads.mangadex.org";
const PAGE_SIZE = 24;
const CH_PAGE_SIZE = 50;
const USE_DATA_SAVER = true;

const el = (s) => document.querySelector(s);
const els = (s) => Array.from(document.querySelectorAll(s));
const fmt = new Intl.DateTimeFormat("es", { dateStyle: "medium" });

// Estado global
const state = {
  search: { q: "", lang: "en", page: 1, total: 0 },
  currentManga: null,
  chapters: { order: "desc", page: 1, total: 0, list: [] },
  reader: { mangaTitle: "", chapterId: null, pages: [], index: 0, chapterList: [], chapterPos: -1 }
};

// ========== Helpers ==========
function setStatus(msg, kind = "ok") {
  const bar = el("#statusBar");
  if (!msg) { bar.hidden = true; bar.textContent = ""; bar.className = "status"; return; }
  bar.hidden = false;
  bar.textContent = msg;
  bar.className = "status " + (kind === "error" ? "error" : "ok");
}

// IMPORTANTE: sin headers en GET (evita preflight CORS desde file://)
async function api(path, params = {}) {
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((val) => url.searchParams.append(k, val));
    else if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), {
    // No headers; no credentials; cache desactivada para pruebas
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} – ${text.slice(0, 200)}`);
  }
  return res.json();
}

function coverUrl(manga) {
  const rel = (manga.relationships || []).find((r) => r.type === "cover_art");
  if (!rel || !rel.attributes?.fileName) return "";
  return `${UPLOADS}/covers/${manga.id}/${rel.attributes.fileName}.256.jpg`;
}
function titleOf(manga) {
  const t = manga.attributes?.title || {};
  return t["en"] || t["es-la"] || t["es"] || Object.values(t)[0] || "Sin título";
}
function authorsOf(manga) {
  const names = (manga.relationships || [])
    .filter((r) => r.type === "author" || r.type === "artist")
    .map((r) => r.attributes?.name)
    .filter(Boolean);
  const uniq = [...new Set(names)];
  return uniq.slice(0, 2).join(", ") || "—";
}
function statusOf(manga) {
  return (manga.attributes?.status || "—").replace(/_/g, " ");
}

// ========== Render ==========
function setResultsLoading(isLoading) {
  const grid = el("#resultsGrid");
  if (isLoading) {
    grid.innerHTML = Array.from({ length: 8 })
      .map(() => `<article class="card"><div class="cover-wrap"></div><div class="card-body"><h3 class="title"> </h3><p class="meta"> </p><button class="primary" disabled>Cargando…</button></div></article>`)
      .join("");
  }
}
function renderResults(resp, page) {
  const grid = el("#resultsGrid");
  grid.innerHTML = "";
  const data = resp?.data || [];
  if (data.length === 0) {
    grid.innerHTML = `<div class="hint">No se encontraron resultados. Prueba con otro título.</div>`;
  }
  data.forEach((m) => {
    const tpl = el("#cardTpl").content.cloneNode(true);
    const img = tpl.querySelector(".cover");
    const t = tpl.querySelector(".title");
    const meta = tpl.querySelector(".meta");
    const btn = tpl.querySelector(".primary");

    const cu = coverUrl(m);
    if (cu) img.src = cu;
    img.alt = `Portada — ${titleOf(m)}`;
    t.textContent = titleOf(m);
    meta.textContent = `${authorsOf(m)} • ${statusOf(m)}`;
    btn.addEventListener("click", () => openDetails(m));
    grid.appendChild(tpl);
  });

  // Paginación
  const total = resp.total || 0;
  const limit = resp.limit || PAGE_SIZE;
  const lastPage = Math.max(1, Math.ceil(total / limit));
  state.search.total = lastPage;

  const pager = el("#searchPager");
  pager.hidden = lastPage <= 1;
  el("#prevSearchPage").disabled = page <= 1;
  el("#nextSearchPage").disabled = page >= lastPage;
  el("#searchPageInfo").textContent = `Página ${page} de ${lastPage}`;
}

function renderMangaDetailsHTML(manga) {
  const t = titleOf(manga);
  const img = coverUrl(manga);
  const altTitles = (manga.attributes?.altTitles || [])
    .map((o) => Object.values(o)[0])
    .filter(Boolean).slice(0, 3).join(" · ");
  const tags = (manga.attributes?.tags || [])
    .map((tg) => tg.attributes?.name?.en || tg.attributes?.name?.es || "")
    .filter(Boolean).slice(0, 6).join(" · ");

  return `
    <article class="card">
      <div class="cover-wrap">${img ? `<img class="cover" src="${img}" alt="Portada — ${t}">` : ""}</div>
      <div class="card-body">
        <h2 class="title">${t}</h2>
        <p class="meta">${authorsOf(manga)} • ${statusOf(manga)}</p>
        <p class="meta">${altTitles || ""}</p>
        <p class="meta">${tags || ""}</p>
      </div>
    </article>
  `;
}

// ========== Acciones ==========
async function searchManga() {
  const { q, page } = state.search;

  // Sin filtro de idioma aquí
  const params = {
    title: q,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    "includes[]": ["cover_art", "author", "artist"]
  };

  setStatus("Buscando…");
  setResultsLoading(true);
  try {
    const resp = await api("/manga", params);
    el("#resultsSection .hint").hidden = true;
    renderResults(resp, page);
    setStatus(`Resultados para "${q}"`, "ok");
  } catch (e) {
    console.error(e);
    el("#resultsGrid").innerHTML = `<div class="hint">Error al buscar: ${e.message}</div>`;
    setStatus("Error en la búsqueda: " + e.message, "error");
  } finally {
    setResultsLoading(false);
  }
}

async function openDetails(manga) {
  state.currentManga = manga;
  state.chapters = { order: el("#orde
