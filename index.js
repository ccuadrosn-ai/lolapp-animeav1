/**
 * AnimeAV1 - CC — addon general tipo "source" (LolPlusTV SDK API v1).
 * Flujo general para cualquier anime (series):
 *   TMDB id -> titulos (TMDB web es/en, sin API key)
 *   -> candidatos (buscador animeav1) -> confirmacion (aka/titulo de /media/{slug})
 *   -> slug + episodio absoluto -> embeds DUB/SUB.
 *   getStreams devuelve embeds (listado rapido); extract() resuelve a video
 *   directo fresco al dar play, con verificacion y un reintento, porque los
 *   tokens caducan por peticion y los hosts a veces fallan.
 *
 * Limitaciones conocidas:
 * - Peliculas (type "movie"): no resueltas, retorna [].
 * - Temporadas > 1: se busca slug de temporada; si no existe, offset TMDB;
 *   si no calculable, se intenta con el numero de episodio directo.
 */

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
var ANIMEAV1 = "https://animeav1.com";
var TMDB = "https://www.themoviedb.org";
var FETCH_TIMEOUT = 10000;
var mediaCache = {};
var titleCache = {};
var searchCache = {};

function sleepMs(ms) {
  return new Promise(function (res) { setTimeout(res, ms); });
}

/** GET con reintentos ante rate-limit (TMDB responde 403/429 si hay muchas peticiones). */
async function httpGet(url, headers) {
  var lastErr = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    var ctrl = null;
    var timer = null;
    try {
      if (typeof AbortController !== "undefined") {
        ctrl = new AbortController();
        timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, FETCH_TIMEOUT);
      }
      var opts = { headers: headers || {} };
      if (!opts.headers["User-Agent"]) opts.headers["User-Agent"] = UA;
      if (ctrl) opts.signal = ctrl.signal;
      var r = await fetch(url, opts);
      if (timer) clearTimeout(timer);
      if (r.status === 403 || r.status === 429) {
        lastErr = new Error("HTTP " + r.status + " en " + url);
        await sleepMs(2000 * (attempt + 1));
        continue;
      }
      if (!r.ok) throw new Error("HTTP " + r.status + " en " + url);
      return await r.text();
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastErr = err;
      if (attempt < 2) await sleepMs(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, function (m, n) {
      try { return String.fromCharCode(parseInt(n, 10)); } catch (e) { return m; }
    });
}

function cleanTitle(s) {
  return decodeEntities(s).replace(/\s*\(\d{4}.*?\)\s*$/, "").trim();
}

function normWords(s) {
  return cleanTitle(s).toLowerCase()
    .replace(/[^a-z0-9ñáéíóúü ]/gi, " ")
    .split(/\s+/).filter(function (w) { return w.length > 1; });
}

function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  var hits = a.filter(function (w) { return b.indexOf(w) !== -1; }).length;
  return hits / a.length;
}

/** Titulos TMDB es + en (en paralelo, con cache). */
async function tmdbTitles(id) {
  if (titleCache[id]) return titleCache[id];
  function titleOf(html) {
    var m = html.match(/<meta property="og:title" content="([^"]+)"/);
    return m ? cleanTitle(m[1]) : "";
  }
  var results = await Promise.all([
    httpGet(TMDB + "/tv/" + id + "?language=es").catch(function () { return ""; }),
    httpGet(TMDB + "/tv/" + id + "?language=en-US").catch(function () { return ""; })
  ]);
  var out = [];
  results.forEach(function (html) {
    var t = titleOf(html);
    if (t && out.indexOf(t) === -1) out.push(t);
  });
  titleCache[id] = out.filter(function (t) { return !!t; });
  return titleCache[id];
}

/** Slugs candidatos del buscador animeav1 (ordenados, unicos, con cache). */
async function searchSlugs(query) {
  if (searchCache[query]) return searchCache[query];
  var html = await httpGet(ANIMEAV1 + "/catalogo?search=" + encodeURIComponent(query));
  var seen = {};
  var slugs = [];
  var re = /href="(\/media\/[a-z0-9\-]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (!seen[m[1]] && m[1].split("/").length === 3) { seen[m[1]] = 1; slugs.push(m[1].split("/")[2]); }
  }
  searchCache[query] = slugs;
  return slugs;
}

/** Info de /media/{slug}: titulo, akas, episodios. Con cache en memoria. */
async function mediaInfo(slug) {
  if (mediaCache[slug]) return mediaCache[slug];
  var html = await httpGet(ANIMEAV1 + "/media/" + slug);
  var t = html.match(/title:"((?:[^"\\]|\\.)*)"/);
  var akas = [];
  var am = html.match(/aka:\{([^}]*)\}/);
  if (am) {
    var ar = /"[^"]*":"((?:[^"\\]|\\.)*)"/g;
    var x;
    while ((x = ar.exec(am[1])) !== null) akas.push(decodeEntities(x[1]));
  }
  var ec = html.match(/episodesCount:(\d+)/);
  var info = {
    title: t ? decodeEntities(t[1]) : slug,
    akas: akas,
    episodesCount: ec ? parseInt(ec[1], 10) : 0
  };
  mediaCache[slug] = info;
  return info;
}

/** Puntaje slug+titulo+akas contra variantes de titulo. */
function confirmScore(slug, info, variants) {
  var fields = [slug.replace(/-/g, " "), info.title].concat(info.akas).map(normWords);
  var best = 0;
  variants.forEach(function (v) {
    var qw = normWords(v);
    fields.forEach(function (f) {
      var s = overlap(qw, f);
      if (s > best) best = s;
    });
  });
  return best;
}

function slugSeason(slug) {
  var m = slug.match(/-season-(\d+)/) || slug.match(/-(\d+)(?:nd|rd|th)-season/)
    || slug.match(/-part-(\d+)$/) || slug.match(/-temporada-(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

/** Temporada segun el TITULO ("Temporada 2", "Season 2", "2nd Season", "Part 2", "第2期"). */
function titleSeason(t) {
  var s = String(t || "");
  var m = s.match(/temporada\s*(\d+)/i) || s.match(/season\s*(\d+)/i)
    || s.match(/(\d+)(?:nd|rd|th)\s*season/i) || s.match(/\bpart\s*(\d+)/i)
    || s.match(/第(\d+)期/);
  return m ? parseInt(m[1], 10) : 1;
}

/** Elige slug: confirma candidatos en paralelo y prefiere base (S1) o slug de temporada. */
async function pickSlug(variants, season) {
  var lists = await Promise.all(variants.map(function (v) {
    return searchSlugs(v).catch(function () { return []; });
  }));
  var cands = [];
  lists.forEach(function (slugs) {
    slugs.slice(0, 10).forEach(function (s) {
      if (cands.indexOf(s) === -1) cands.push(s);
    });
  });
  cands = cands.slice(0, 10);
  var checked = await Promise.all(cands.map(function (c) {
    return mediaInfo(c).then(function (info) {
      return { slug: c, info: info, score: confirmScore(c, info, variants) };
    }).catch(function () { return null; });
  }));
  var scored = checked.filter(function (c) { return c && c.score >= 0.5; });
  if (!scored.length) return null;
  if (season <= 1) {
    scored.sort(function (a, b) {
      var sa = slugSeason(a.slug) === 1 ? 0 : 1;
      var sb = slugSeason(b.slug) === 1 ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (a.slug.length !== b.slug.length) return a.slug.length - b.slug.length;
      return b.score - a.score;
    });
    return scored[0];
  }
  var dated = scored.filter(function (c) {
    return slugSeason(c.slug) === season || titleSeason(c.info.title) === season;
  });
  if (dated.length) {
    dated.sort(function (a, b) { return b.score - a.score; });
    return dated[0];
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored[0];
}

/** Offset de temporada TMDB (suma de episodios previos). -1 si no calculable. */
async function seasonOffset(tmdbId, season) {
  if (!season || season <= 1) return 0;
  var html = await httpGet(TMDB + "/tv/" + tmdbId + "/seasons?language=es");
  var bySeason = {};
  var re = /\/tv\/\d+\/season\/(\d+)[\s\S]{0,1200}?(\d+)\s*episodios/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var sn = parseInt(m[1], 10);
    if (!(sn in bySeason)) bySeason[sn] = parseInt(m[2], 10);
  }
  var offset = 0;
  for (var s = 1; s < season; s++) {
    if (!(s in bySeason)) return -1;
    offset += bySeason[s];
  }
  return offset;
}

/** Parse del bloque embeds:{SUB:[...],DUB:[...]}. */
function parseEmbeds(html) {
  var out = { SUB: [], DUB: [] };
  var start = html.indexOf("embeds:{");
  if (start === -1) return out;
  var block = html.slice(start, start + 20000);
  ["SUB", "DUB"].forEach(function (k) {
    var si = block.indexOf(k + ":[");
    if (si === -1) return;
    var end = block.indexOf("]", si);
    var list = block.slice(si, end);
    var re = /\{server:"([^"]+)",url:"([^"]+)"\}/g;
    var m;
    while ((m = re.exec(list)) !== null) out[k].push({ server: m[1], url: m[2] });
  });
  return out;
}

async function resolveMp4Upload(embedUrl) {
  var html = await httpGet(embedUrl, { Referer: ANIMEAV1 + "/" });
  var m = html.match(/player\.src\(\{\s*type:\s*"video\/mp4",\s*src:\s*"([^"]+)"/)
    || html.match(/src:\s*"([^"]+\.mp4[^"]*)"/);
  if (!m) throw new Error("MP4Upload sin src");
  return m[1];
}

async function resolveYourUpload(embedUrl) {
  var html = await httpGet(embedUrl, { Referer: ANIMEAV1 + "/" });
  var m = html.match(/file:\s*'([^']+\/video\.mp4[^']*)'/)
    || html.match(/<meta property="og:video" content="([^"]+)"/);
  if (!m) throw new Error("YourUpload sin file");
  return m[1];
}

/** extract(): embed -> video directo fresco al momento de reproducir.
 * Los tokens de MP4Upload/YourUpload rotan por peticion y caducan rapido:
 * resolver en getStreams (listado) deja URLs muertas al dar play. Por eso
 * getStreams devuelve embeds y la resolucion final ocurre aqui, con
 * verificacion Range y un reintento ante hosts lentos/caidos.
 * StreamTape/Voe/UPNShare se devuelven tal cual (sin resolucion util). */
async function extract(embedUrl) {
  var u = String(embedUrl && embedUrl.url ? embedUrl.url : embedUrl);
  var resolvable = u.indexOf("mp4upload.com") !== -1 || u.indexOf("yourupload.com") !== -1;
  if (!resolvable) return { url: u, quality: "HD" };
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var direct = u.indexOf("mp4upload.com") !== -1
        ? await resolveMp4Upload(u)
        : await resolveYourUpload(u);
      if (await verifyVideo(direct, u)) {
        return { url: direct, quality: "HD", headers: { Referer: u, "User-Agent": UA } };
      }
    } catch (err) { /* reintentar una vez con token fresco */ }
  }
  try {
    var last = u.indexOf("mp4upload.com") !== -1
      ? await resolveMp4Upload(u)
      : await resolveYourUpload(u);
    return { url: last, quality: "HD", headers: { Referer: u, "User-Agent": UA } };
  } catch (err) {
    return { url: u, quality: "HD" };
  }
}

/** Verificacion barata: el directo responde video en el primer byte. */
async function verifyVideo(url, referer) {
  var ctrl = null;
  var timer = null;
  try {
    if (typeof AbortController !== "undefined") {
      ctrl = new AbortController();
      timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 8000);
    }
    var opts = { headers: { "User-Agent": UA, Range: "bytes=0-0", Referer: referer } };
    if (ctrl) opts.signal = ctrl.signal;
    var r = await fetch(url, opts);
    if (timer) clearTimeout(timer);
    if (r.status !== 206 && r.status !== 200) return false;
    var ct = (r.headers.get("content-type") || "").toLowerCase();
    try { if (r.body && r.body.cancel) await r.body.cancel(); } catch (e) {}
    return ct.indexOf("video") !== -1 || ct.indexOf("octet-stream") !== -1;
  } catch (err) {
    if (timer) clearTimeout(timer);
    return false;
  }
}

function epLabel(s, e) {
  return "S" + (s < 10 ? "0" + s : s) + "E" + (e < 10 ? "0" + e : e);
}

function toStreamItem(embed, show, s, e, lang) {
  return {
    url: embed.url,
    title: show + " " + epLabel(s, e) + " [" + lang + "] " + embed.server,
    quality: "HD",
    provider: "AnimeAV1",
    headers: { Referer: ANIMEAV1 + "/", "User-Agent": UA }
  };
}

async function streamsForSlug(slug, title, s, e, absolute) {
  var html = await httpGet(ANIMEAV1 + "/media/" + slug + "/" + absolute);
  var embeds = parseEmbeds(html);
  var serverRank = function (url) { return url.indexOf("mp4upload.com") !== -1 ? 0 : 1; };
  // getStreams devuelve EMBEDS (listado rapido). La resolucion a video
  // directo ocurre en extract() al dar play, con URL fresca: los tokens
  // caducan en minutos y resolver aqui dejaba enlaces muertos.
  var out = [];
  ["DUB", "SUB"].forEach(function (lang) {
    var sorted = embeds[lang].slice().sort(function (a, b) { return serverRank(a.url) - serverRank(b.url); });
    sorted.forEach(function (x) { out.push(toStreamItem(x, title, s, e, lang)); });
  });
  // MP4Upload primero (pares DUB+SUB), luego el resto.
  out.sort(function (a, b) {
    var ra = a.url.indexOf("mp4upload.com") !== -1 ? 0 : 1;
    var rb = b.url.indexOf("mp4upload.com") !== -1 ? 0 : 1;
    if (ra !== rb) return ra - rb;
    var la = a.title.indexOf("[DUB]") !== -1 ? 0 : 1;
    var lb = b.title.indexOf("[DUB]") !== -1 ? 0 : 1;
    return la - lb;
  });
  return out;
}

/** getStreams(): pipeline general TMDB -> animeav1 -> embeds. */
async function getStreams(tmdbId, type, season, episode) {
  try {
    if (tmdbId !== null && typeof tmdbId === "object") {
      var a = tmdbId;
      type = a.type; season = a.season; episode = a.episode;
      tmdbId = a.tmdbId || a.id;
    }
    if (type === "movie") return [];
    var s = season === undefined || season === null || season === "" ? 1 : Number(season);
    var e = episode === undefined || episode === null || episode === "" ? 1 : Number(episode);
    if (!(s >= 1) || !(e >= 1)) return [];

    var digits = String(tmdbId || "").match(/\d+/);
    if (!digits) return [];

    var variants = await tmdbTitles(digits[0]).catch(function () { return []; });
    if (!variants.length) {
      if (/naruto/i.test(String(tmdbId))) variants = ["Naruto"];
      else return [];
    }
    var picked = await pickSlug(variants, s).catch(function () { return null; });
    if (!picked) return [];

    var absolute = e;
    var slug = picked.slug;
    // Solo se suma offset si el slug elegido es la serie base (temporada 1
    // segun slug Y titulo). Si ya es slug de temporada, el episodio es directo.
    if (s > 1 && slugSeason(slug) === 1 && titleSeason(picked.info.title) === 1) {
      try {
        var off = await seasonOffset(digits[0], s);
        absolute = off >= 0 ? off + e : e;
      } catch (err) { absolute = e; }
    }
    if (picked.info.episodesCount && absolute > picked.info.episodesCount) return [];
    var label = picked.info.title || variants[0];
    return await streamsForSlug(slug, label, s, e, absolute).catch(function () { return []; });
  } catch (err) {
    return [];
  }
}

// Registro CJS (documentacion) + globales (runtimes sandbox).
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
  globalThis.extract = extract;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, extract };
}
