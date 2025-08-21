// ========== Config ==========
console.log("app.js cargado ✅");

// --- rutas para fallback ---
const DIRECT_API = "https://api.mangadex.org";
const CORS_PROXIES = [
  "https://cors.isomorphic-git.org/",
  "https://r.jina.ai/http/"
];
// Usamos la constante API para construir URLs si la necesitas en otros lados:
const API = DIRECT_API;

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
  if (!bar) return;
  if (!msg) { bar.hidden = true; bar.textContent = ""; bar.className = "status"; return; }
  bar.hidden = false;
  bar.textContent = msg;
  bar.className = "status " + (kind === "error" ? "error" : "ok");
}

// API con fallback por proxy si falla la directa
async function api(path, params = {}) {
  const buildUrl = (base) => {
    const url = new URL(base + path);
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach((val) => url.searchParams.append(k, val));
      else if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    return url.toString();
  };

  const directUrl = buildUrl(DIRECT_API);

  // 1) intento directo
  try {
    const res = await fetch(directUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e1) {
    console.warn("Fallo directo, probando proxies…", e1);
    setStatus("Conectando (modo compatible)…", "ok");
  }

  // 2) reintentos por proxies
  for (const proxy of CORS_PROXIES) {
    try {
      const proxiedUrl = proxy.endsWith("/") ? proxy + directUrl : proxy + "/" + directUrl;
      const res = await fetch(proxiedUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`Proxy ${proxy} → HTTP ${res.status}`);
      const data = await res.json();
      console.info("Usando proxy:", proxy);
      return data;
    } catch (e2) {
      console.warn("Proxy falló:", proxy, e2);
    }
  }

  throw new Error("No se pudo conectar (directo ni proxies). Revisa red/DNS/extensiones.");
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
  if (!grid) return;
  if (isLoading) {
    grid.innerHTML = Array.from({ length: 8 })
      .map(() => `<article class="card"><div class="cover-wrap"></div><div class="card-body"><h3 class="title"> </h3><p class="meta"> </p><button class="primary" disabled>Cargando…</button></div></article>`)
      .join("");
  }
}
function renderResults(resp, page) {
  const grid = el("#resultsGrid");
  if (!grid) return;
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
  if (pager) {
    pager.hidden = lastPage <= 1;
    el("#prevSearchPage").disabled = page <= 1;
    el("#nextSearchPage").disabled = page >= lastPage;
    el("#searchPageInfo").textContent = `Página ${page} de ${lastPage}`;
  }
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
    const hint = el("#resultsSection .hint");
    if (hint) hint.hidden = true;
    renderResults(resp, page);
    setStatus(`Resultados para "${q}"`, "ok");
  } catch (e) {
    console.error(e);
    const grid = el("#resultsGrid");
    if (grid) grid.innerHTML = `<div class="hint">Error al buscar: ${e.message}</div>`;
    setStatus("Error en la búsqueda: " + e.message, "error");
  } finally {
    setResultsLoading(false);
  }
}

async function openDetails(manga) {
  state.currentManga = manga;
  state.chapters = { order: el("#orderSelect")?.value || "desc", page: 1, total: 0, list: [] };

  el("#detailsPanel").hidden = false;
  el("#resultsSection").style.display = "none";

  el("#mangaDetails").innerHTML = renderMangaDetailsHTML(manga);
  await loadChapters();
}

async function loadChapters() {
  const manga = state.currentManga;
  const { order, page } = state.chapters;
  const lang = state.search.lang;

  const params = {
    manga: manga.id,
    translatedLanguage: [lang],
    limit: CH_PAGE_SIZE,
    offset: (page - 1) * CH_PAGE_SIZE,
    "order[chapter]": order,
    "includes[]": ["scanlation_group", "user"]
  };

  const listEl = el("#chaptersList");
  if (listEl) listEl.innerHTML = `<li class="hint">Cargando capítulos…</li>`;
  setStatus("Cargando capítulos…");

  try {
    const resp = await api("/chapter", params);
    const total = resp.total || 0;
    const last = Math.max(1, Math.ceil(total / CH_PAGE_SIZE));
    state.chapters.total = last;
    state.chapters.list = resp.data || [];

    if (listEl) listEl.innerHTML = "";
    (resp.data || []).forEach((ch) => {
      const tpl = el("#chapterItemTpl").content.cloneNode(true);
      tpl.querySelector(".ch-no").textContent = `Cap. ${ch.attributes?.chapter || "—"}`;
      tpl.querySelector(".ch-title").textContent = ch.attributes?.title || "";
      tpl.querySelector(".ch-group").textContent = groupName(ch);
      const d = ch.attributes?.publishAt || ch.attributes?.readableAt || ch.attributes?.createdAt;
      tpl.querySelector(".ch-date").textContent = d ? fmt.format(new Date(d)) : "";
      tpl.querySelector(".chapter-btn").addEventListener("click", () => openReader(ch));
      listEl.appendChild(tpl);
    });

    const pager = el("#chaptersPager");
    if (pager) {
      pager.hidden = last <= 1;
      el("#prevChapterPage").disabled = page <= 1;
      el("#nextChapterPage").disabled = page >= last;
      el("#chapterPageInfo").textContent = `Página ${page} de ${last}`;
    }

    setStatus(`Capítulos en ${lang?.toUpperCase?.() || lang} cargados (${resp.data?.length || 0})`, "ok");
  } catch (e) {
    console.error(e);
    if (listEl) listEl.innerHTML = `<li class="hint">Error cargando capítulos: ${e.message}</li>`;
    setStatus("Error al cargar capítulos: " + e.message, "error");
  }
}

function groupName(ch) {
  const rel = (ch.relationships || []).find((r) => r.type === "scanlation_group");
  return rel?.attributes?.name || "—";
}

async function openReader(chapter) {
  try {
    setStatus("Abriendo capítulo…");
    const { baseUrl, chapter: chInfo } = await api(`/at-home/server/${chapter.id}`);
    const hash = chInfo.hash;
    const files = (USE_DATA_SAVER && chInfo.dataSaver?.length) ? chInfo.dataSaver : chInfo.data;
    const base = `${baseUrl}/${(USE_DATA_SAVER && chInfo.dataSaver?.length) ? "data-saver" : "data"}/${hash}`;

    const pages = files.map((file) => `${base}/${file}`);
    state.reader = {
      mangaTitle: titleOf(state.currentManga),
      chapterId: chapter.id,
      pages,
      index: 0,
      chapterList: state.chapters.list.slice(),
      chapterPos: state.chapters.list.findIndex((c) => c.id === chapter.id)
    };

    el("#readerTitle").textContent = `${state.reader.mangaTitle}`;
    el("#readerSub").textContent = `Cap. ${chapter.attributes?.chapter || "—"} • ${groupName(chapter) || ""}`;
    const list = el("#readerPages");
    list.innerHTML = pages.map((src, i) => `<img src="${src}" alt="Página ${i + 1}" data-index="${i}" loading="${i < 2 ? "eager" : "lazy"}">`).join("");
    el("#pageInfo").textContent = `1 / ${pages.length}`;
    el("#readerDialog").showModal();
    el("#readerPages").scrollTo({ top: 0, behavior: "instant" });
    setStatus("");
  } catch (e) {
    console.error(e);
    setStatus("No se pudo abrir el capítulo: " + e.message, "error");
    alert("No se pudo abrir el capítulo: " + e.message);
  }
}

function toPage(delta) {
  const r = state.reader;
  if (!r.pages.length) return;
  r.index = Math.min(Math.max(0, r.index + delta), r.pages.length - 1);
  const target = el(`#readerPages img[data-index="${r.index}"]`);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  el("#pageInfo").textContent = `${r.index + 1} / ${r.pages.length}`;
}

async function toChapter(offset) {
  const pos = state.reader.chapterPos + offset;
  const list = state.reader.chapterList;
  if (pos < 0 || pos >= list.length) return;
  await openReader(list[pos]);
}

// ========== Eventos ==========
window.addEventListener("DOMContentLoaded", () => {
  el("#searchForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    state.search.q = el("#searchInput")?.value.trim() || "";
    state.search.page = 1;
    if (!state.search.q) { setStatus("Escribe un título para buscar.", "error"); return; }
    searchManga();
  });

  el("#langSelect")?.addEventListener("change", () => {
    state.search.lang = el("#langSelect").value;
    if (!el("#detailsPanel")?.hidden && state.currentManga) {
      state.chapters.page = 1;
      loadChapters();
    }
  });
  if (el("#langSelect")) state.search.lang = el("#langSelect").value;

  el("#prevSearchPage")?.addEventListener("click", () => {
    if (state.search.page > 1) { state.search.page--; searchManga(); }
  });
  el("#nextSearchPage")?.addEventListener("click", () => {
    if (state.search.page < state.search.total) { state.search.page++; searchManga(); }
  });

  el("#backToResults")?.addEventListener("click", () => {
    el("#detailsPanel").hidden = true;
    el("#resultsSection").style.display = "";
    setStatus("");
  });

  el("#orderSelect")?.addEventListener("change", () => {
    state.chapters.order = el("#orderSelect").value;
    state.chapters.page = 1;
    loadChapters();
  });
  el("#prevChapterPage")?.addEventListener("click", () => {
    if (state.chapters.page > 1) { state.chapters.page--; loadChapters(); }
  });
  el("#nextChapterPage")?.addEventListener("click", () => {
    if (state.chapters.page < state.chapters.total) { state.chapters.page++; loadChapters(); }
  });

  el("#closeReader")?.addEventListener("click", () => el("#readerDialog").close());
  el("#prevPage")?.addEventListener("click", () => toPage(-1));
  el("#nextPage")?.addEventListener("click", () => toPage(1));
  el("#prevChapter")?.addEventListener("click", () => toChapter(-1));
  el("#nextChapter")?.addEventListener("click", () => toChapter(1));

  el("#readerPages")?.addEventListener("scroll", () => {
    const images = els("#readerPages img");
    const top = el("#readerPages").scrollTop;
    const viewport = el("#readerPages").clientHeight;
    let current = 0;
    images.forEach((img, i) => {
      const y = img.offsetTop;
      if (y <= top + viewport * 0.4) current = i;
    });
    state.reader.index = current;
    el("#pageInfo").textContent = `${current + 1} / ${images.length}`;
  });
});
