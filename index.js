async function getStreams(tmdbId, type, season, episode) {
  try {
    return [
      {
        url: "https://www.mp4upload.com/embed-jdd1k27m57uc.html",
        title: "Naruto Ep.1 [DUB] MP4Upload",
        quality: "720p",
        provider: "AnimeAV1",
        headers: {
          Referer: "https://animeav1.com/"
        }
      },
      {
        url: "https://www.yourupload.com/embed/85WI1V8y18m4",
        title: "Naruto Ep.1 [DUB] YourUpload",
        quality: "720p",
        provider: "AnimeAV1",
        headers: {
          Referer: "https://animeav1.com/"
        }
      },
      {
        url: "https://streamtape.com/e/vgb4w2964qtYLw/",
        title: "Naruto Ep.1 [DUB] StreamTape",
        quality: "720p",
        provider: "AnimeAV1",
        headers: {
          Referer: "https://animeav1.com/"
        }
      }
    ];
  } catch (e) {
    return [];
  }
}

async function extract(embedUrl) {
  return {
    url: embedUrl,
    quality: "720p"
  };
}

module.exports = { getStreams, extract };
