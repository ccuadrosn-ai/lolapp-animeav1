/**
 * AnimeAV1 Naruto DUB — addon mínimo tipo "source" (LolPlusTV SDK API v1).
 *
 * La app llama con identificadores TMDB: getStreams(tmdbId, type, season, episode).
 * Naruto (TV 2002) en TMDB es el id 46260 (se aceptan duplicados conocidos).
 * MVP: solo resuelve Temporada 1 Episodio 1 en DUB.
 */

// IDs TMDB conocidos de Naruto (TV 2002). El canónico actual es 46260.
var NARUTO_TMDB_IDS = ["46260", "31910", "330310"];

function normalizeId(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    v = v.tmdbId || v.id || v.tmdb || "";
  }
  return String(v).toLowerCase();
}

function isNaruto(tmdbId) {
  var id = normalizeId(tmdbId);
  if (!id) return false;
  for (var i = 0; i < NARUTO_TMDB_IDS.length; i++) {
    if (id.indexOf(NARUTO_TMDB_IDS[i]) !== -1) return true;
  }
  if (id.indexOf("naruto") !== -1) return true;
  if (id === "20" || id.indexOf("mal:20") !== -1 || id === "mal-20") return true;
  return false;
}

function narutoEp1Streams() {
  var base = {
    quality: "720p",
    provider: "AnimeAV1",
    headers: {
      Referer: "https://animeav1.com/"
    }
  };
  return [
    {
      url: "https://www.mp4upload.com/embed-jdd1k27m57uc.html",
      title: "Naruto S01E01 [DUB] MP4Upload",
      quality: base.quality,
      provider: base.provider,
      headers: base.headers
    },
    {
      url: "https://www.yourupload.com/embed/85WI1V8y18m4",
      title: "Naruto S01E01 [DUB] YourUpload",
      quality: base.quality,
      provider: base.provider,
      headers: base.headers
    },
    {
      url: "https://streamtape.com/e/vgb4w2964qtYLw/",
      title: "Naruto S01E01 [DUB] StreamTape",
      quality: base.quality,
      provider: base.provider,
      headers: base.headers
    }
  ];
}

async function getStreams(tmdbId, type, season, episode) {
  try {
    // Compatibilidad: algunos runtimes pasan un solo objeto { tmdbId, type, season, episode }.
    if (tmdbId !== null && typeof tmdbId === "object") {
      var args = tmdbId;
      type = args.type;
      season = args.season;
      episode = args.episode;
      tmdbId = args.tmdbId || args.id;
    }
    if (!isNaruto(tmdbId)) return [];
    if (type === "movie") return [];
    var s = season === undefined || season === null || season === "" ? 1 : Number(season);
    var e = episode === undefined || episode === null || episode === "" ? 1 : Number(episode);
    if (s === 1 && e === 1) return narutoEp1Streams();
    return [];
  } catch (err) {
    return [];
  }
}

async function extract(embedUrl) {
  return {
    url: embedUrl,
    quality: "720p"
  };
}

// ---------------------------------------------------------------------------
// Catálogo mínimo (mismo repo): solo expone Naruto para que la app lo liste.
// La app registra el addon según el apartado desde donde se instala
// (Fuentes vs Catálogos), así que instala esta misma URI en ambas secciones.
// ---------------------------------------------------------------------------

var NARUTO_ITEM = {
  id: "animeav1:naruto",
  title: "Naruto",
  originalTitle: "ナルト",
  type: "tv",
  poster: "https://cdn.animeav1.com/covers/190.jpg",
  backdrop: "https://cdn.animeav1.com/backdrops/190.jpg",
  overview: "Naruto Uzumaki, un ninja hiperactivo de Konohagakure, lucha por ser reconocido y convertirse en Hokage.",
  year: "2002",
  rating: 8.02,
  genres: ["Acción", "Aventura", "Fantasía", "Shounen", "Artes Marciales"]
};

async function getHome() {
  try {
    return {
      rows: [
        {
          id: "solo_naruto",
          title: "Solo Naruto",
          items: [NARUTO_ITEM]
        }
      ]
    };
  } catch (err) {
    return { rows: [] };
  }
}

async function search(args) {
  try {
    var q = "";
    if (args) q = args.query || args.q || "";
    if (String(q).toLowerCase().indexOf("naruto") !== -1) {
      return [NARUTO_ITEM];
    }
    return [];
  } catch (err) {
    return [];
  }
}

async function discover(args) {
  try {
    return [NARUTO_ITEM];
  } catch (err) {
    return [];
  }
}

async function getMeta(args) {
  try {
    return {
      id: (args && args.id) || NARUTO_ITEM.id,
      title: NARUTO_ITEM.title,
      overview: NARUTO_ITEM.overview,
      poster: NARUTO_ITEM.poster,
      backdrop: NARUTO_ITEM.backdrop,
      year: NARUTO_ITEM.year,
      rating: NARUTO_ITEM.rating,
      genres: NARUTO_ITEM.genres,
      cast: ["Junko Takeuchi", "Chie Nakamura", "Kazuhiko Inoue"]
    };
  } catch (err) {
    return null;
  }
}

// Registro CJS (documentación) + globales (runtimes sandbox).
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
  globalThis.extract = extract;
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.discover = discover;
  globalThis.getMeta = getMeta;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, extract, getHome, search, discover, getMeta };
}
