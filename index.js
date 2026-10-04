/**
 * AnimeAV1 — addon general tipo "source" (LolPlusTV SDK API v1).
 *
 * Flujo general para cualquier anime (series):
 *   TMDB id -> titulos (TMDB web es/en, sin API key)
 *   -> candidatos (buscador animeav1) -> confirmacion (aka/titulo de /media/{slug})
 *   -> slug + episodio absoluto -> embeds DUB/SUB -> video directo.
 *
 * Limitaciones conocidas:
 * - Peliculas (type "movie"): no resueltas, retorna [].
 * - Temporadas > 1: se busca slug de temporada; si no existe, offset TMDB;
 *   si no calculable, se intenta con el numero de episodio directo.
 */

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
var ANIMEAV1 = "https://animeav1.com";
var TMDB = "https://www.themoviedb.org";
var FETCH_TIMEOUT = 15000;
var mediaCache = {};

function httpGet(url, headers) {
  var ctrl = null;
  var timer = null;
  try {
    if (typeof AbortController !== "undefined") {
      ctrl = new AbortController();
      timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, FETCH_TIMEOUT);
    }
  } catch (e) { ctrl = null; }
  var opts = { headers: headers || {} };
  if (!opts.headers["User-Agent"]) opts.headers["User-Agent"] = UA;
  if (ctrl) opts.signal = ctrl.signal;
  return fetch(url, opts).then(function (r) {
    if (timer) clearTimeout(timer);
    if (!r.ok) throw new Error("HTTP " + r.status + " en " + url);
    return r.text();
  }, function (err) {
    if (timer) clearTimeout(timer);
    throw err;
  });
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

/** Titulos TMDB es + en. */
async function tmdbTitles(id) {
  var out = [];
  var es = await httpGet(TMDB + "/tv/" + id + "?language=es").catch(function () { return ""; });
  var m = es.match(/<meta property="og:title" content="([^"]+)"/);
  if (m) out.push(cleanTitle(m[1]));
  var en = await httpGet(TMDB + "/tv/" + id + "?language=en-US").catch(function () { return ""; });
  var m2 = en.match(/<meta property="og:title" content="([^"]+)"/);
  if (m2) {
    var t = cleanTitle(m2[1]);
    if (out.indexOf(t) === -1) out.push(t);
  }
  return out.filter(function (t) { return !!t; });
}

/** Slugs candidatos del buscador animeav1 (ordenados, unicos). */
async function searchSlugs(query) {
  var html = await httpGet(ANIMEAV1 + "/catalogo?search=" + encodeURIComponent(query));
  var seen = {};
  var slugs = [];
  var re = /href="(\/media\/[a-z0-9\-]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (!seen[m[1]] && m[1].split("/").length === 3) { seen[m[1]] = 1; slugs.push(m[1].split("/")[2]); }
  }
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
  var m = slug.match(/-season-(\d+)/) || slug.match(/-(\d+)(?:nd|rd|th)-season/) || slug.match(/-part-(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

/** Elige slug: confirma candidatos y prefiere base (S1) o slug de temporada. */
async function pickSlug(variants, season) {
  var cands = [];
  for (var i = 0; i < variants.length; i++) {
    var slugs = await searchSlugs(variants[i]).catch(function () { return []; });
    slugs.slice(0, 10).forEach(function (s) {
      if (cands.indexOf(s) === -1) cands.push(s);
    });
    if (cands.length >= 10) break;
  }
  var scored = [];
  for (var j = 0; j < Math.min(cands.length, 8); j++) {
    try {
      var info = await mediaInfo(cands[j]);
      var score = confirmScore(cands[j], info, variants);
      if (score >= 0.5) scored.push({ slug: cands[j], info: info, score: score });
    } catch (e) { /* candidato inaccesible */ }
  }
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
  var dated = scored.filter(function (c) { return slugSeason(c.slug) === season; });
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

async function resolveStreamTape(embedUrl) {
  var view = embedUrl.replace(/\/e\//, "/v/");
  var html = await httpGet(view, { Referer: ANIMEAV1 + "/" });
  var m = html.match(/id="robotlink"[^>]*>([^<]+)</);
  if (!m) throw new Error("StreamTape sin robotlink");
  var gate = "https://streamtape.com" + m[1].replace(/^\/streamtape\.com/, "");
  var r = await fetch(gate, {
    headers: { "User-Agent": UA, Referer: view },
    redirect: "manual"
  });
  var loc = r.headers.get("location") || "";
  if (r.status >= 300 && r.status < 400 && loc) {
    if (loc.indexOf("http") !== 0) loc = "https:" + loc;
    return loc;
  }
  throw new Error("StreamTape gate " + r.status);
}

/** extract(): embed -> video directo (falla -> embed original). */
async function extract(embedUrl) {
  try {
    var u = String(embedUrl && embedUrl.url ? embedUrl.url : embedUrl);
    var direct = null;
    if (u.indexOf("mp4upload.com") !== -1) direct = await resolveMp4Upload(u);
    else if (u.indexOf("yourupload.com") !== -1) direct = await resolveYourUpload(u);
    else if (u.indexOf("streamtape.") !== -1) direct = await resolveStreamTape(u);
    if (direct) {
      return { url: direct, quality: "HD", headers: { Referer: u, "User-Agent": UA } };
    }
    return { url: u, quality: "HD" };
  } catch (err) {
    return { url: String(embedUrl && embedUrl.url ? embedUrl.url : embedUrl), quality: "HD" };
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
  var ordered = [];
  embeds.DUB.forEach(function (x) { ordered.push({ embed: x, lang: "DUB" }); });
  embeds.SUB.forEach(function (x) { ordered.push({ embed: x, lang: "SUB" }); });
  if (!ordered.length) return [];
  var items = [];
  var jobs = ordered.map(function (o) {
    var host = o.embed.url;
    var resolvable = host.indexOf("mp4upload.com") !== -1
      || host.indexOf("yourupload.com") !== -1
      || host.indexOf("streamtape.") !== -1;
    if (!resolvable) {
      items.push({ item: toStreamItem(o.embed, title, s, e, o.lang), priority: 2 });
      return Promise.resolve();
    }
    return extract(o.embed.url).then(function (r) {
      if (r.url !== o.embed.url) {
        items.push({
          item: {
            url: r.url,
            title: title + " " + epLabel(s, e) + " [" + o.lang + "] " + o.embed.server,
            quality: "HD",
            provider: "AnimeAV1",
            headers: r.headers || { Referer: o.embed.url, "User-Agent": UA }
          },
          priority: 1
        });
      } else {
        items.push({ item: toStreamItem(o.embed, title, s, e, o.lang), priority: 2 });
      }
    }).catch(function () {
      items.push({ item: toStreamItem(o.embed, title, s, e, o.lang), priority: 2 });
    });
  });
  await Promise.all(jobs);
  items.sort(function (x, y) { return x.priority - y.priority; });
  return items.map(function (x) { return x.item; });
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
    if (s > 1 && slugSeason(slug) === 1) {
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
