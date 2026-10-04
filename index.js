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

// Registro CJS (documentación) + globales (runtimes sandbox).
if (typeof globalThis !== "undefined") {
  globalThis.getStreams = getStreams;
  globalThis.extract = extract;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, extract };
}
