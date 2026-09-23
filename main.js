function firstString(values) {
  if (!Array.isArray(values)) return "";
  for (var index = 0; index < values.length && index < 8; index++) {
    var value = values[index];
    var url = safeURL(typeof value === "string" ? value : value && value.src);
    if (url) return url;
  }
  return "";
}

function mediaUrl(value, depth) {
  depth = depth || 0;
  if (!value || depth > 4) return "";
  if (typeof value === "string") return safeURL(value);
  if (Array.isArray(value)) return firstString(value);
  return safeURL(value.src) || firstString(value.url_list) || firstString(value.urlList) || mediaUrl(value.play_addr, depth + 1) || mediaUrl(value.playAddr, depth + 1);
}

function safeURL(value) {
  if (typeof value !== "string" || value.length > 16384 || /[\s\\\x00-\x1f\x7f]/.test(value)) return "";
  // Feed metadata can contain an unfinished web-prime address. The player
  // supplies its session parameters on the actual media request. Do not emit
  // the known-incomplete URL as a ready preview/download, including API/SSR
  // fallbacks that have not yet received a page-script update.
  if (/^https?:\/\/[a-z0-9-]+-web-prime\.douyinvod\.com(?::(?:80|443))?\//i.test(value) &&
      /[?&]tk=webid(?:&|$)/.test(value) && !/[?&]webid=[^&#]+/.test(value)) return "";
  return /^https?:\/\/(?:[a-z0-9-]+\.)+(?:douyin\.com|iesdouyin\.com|douyinvod\.com|douyinpic\.com|douyinstatic\.com)(?::(?:80|443))?\/[^#]*$/i.test(value) ? value : "";
}

function workId(item) {
  var id = item && (item.aweme_id || item.awemeId);
  // Numeric IDs above JS's safe integer range must never be rounded.
  if (typeof id === "number" && (!isFinite(id) || Math.abs(id) > 9007199254740991)) return "";
  id = typeof id === "string" || typeof id === "number" ? String(id) : "";
  return /^\d{1,24}$/.test(id) ? id : "";
}

function number(value) {
  return typeof value === "number" && isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function imageUrl(image) {
  if (!image || typeof image !== "object") return "";
  return mediaUrl(image) ||
    mediaUrl(image.origin_image) || mediaUrl(image.originImage) ||
    mediaUrl(image.display_image) || mediaUrl(image.displayImage) ||
    mediaUrl(image.download_url) || mediaUrl(image.downloadUrl);
}

function extensionFromUrl(rawUrl, fallback) {
  var clean = String(rawUrl || "").split("?")[0].toLowerCase();
  var match = /\.(jpe?g|png|webp|gif|mp3|m4a|aac|mp4)$/.exec(clean);
  if (!match) return fallback;
  var extension = match[1] === "jpeg" ? "jpg" : match[1];
  return "." + extension;
}

function mimeForExtension(extension, fallback) {
  var types = {
    ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".mp4": "video/mp4"
  };
  return types[extension] || fallback;
}

function audioExtensionFromUrl(rawUrl) {
  var extension = extensionFromUrl(rawUrl, ".m4a");
  if (extension === ".mp3" || extension === ".m4a" || extension === ".aac") return extension;
  // An MP4 container used as a music track should be presented as M4A so the
  // saved extension and MIME both describe audio rather than video.
  return ".m4a";
}

function audioMimeForExtension(extension) {
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".aac") return "audio/aac";
  return "audio/mp4";
}

function collectAwemes(payload) {
  var result = [];
  var seen = {};
  var visited = 0;
  function visit(value, depth) {
    if (!value || typeof value !== "object" || depth > 7 || visited++ > 12000 || result.length >= 200) return;
    if (!Array.isArray(value) && workId(value) && (value.video || value.images || value.image_post_info || value.imagePostInfo)) {
      var id = workId(value);
      if (!seen[id]) {
        seen[id] = true;
        result.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (var arrayIndex = 0; arrayIndex < value.length && arrayIndex < 250; arrayIndex++) visit(value[arrayIndex], depth + 1);
      return;
    }
    var preferred = ["aweme_list", "aweme_detail", "data", "app", "videoDetail"];
    for (var preferredIndex = 0; preferredIndex < preferred.length; preferredIndex++) {
      if (Object.prototype.hasOwnProperty.call(value, preferred[preferredIndex])) visit(value[preferred[preferredIndex]], depth + 1);
    }
  }
  visit(payload, 0);
  return result;
}

function postImages(item) {
  if (Array.isArray(item.images)) return item.images;
  var info = item.image_post_info || item.imagePostInfo || {};
  return Array.isArray(info.images) ? info.images : [];
}

function authorName(item) {
  var author = item.author || item.authorInfo || {};
  return typeof author.nickname === "string" ? author.nickname.slice(0, 200) : "";
}

function baseTitle(item) {
  var value = item.desc || item.item_title || item.itemTitle || item.preview_title;
  var description = typeof value === "string" ? value.trim().slice(0, 2000) : "";
  return description || "抖音作品 " + workId(item);
}

function source(awemeId) {
  return {pageUrl: "https://www.douyin.com/video/" + awemeId, domain: "douyin.com"};
}

function requestHeaders() {
  return {Referer: "https://www.douyin.com/"};
}

function imagePostResources(item, settings) {
  var images = postImages(item);
  var awemeId = workId(item);
  if (!awemeId || !images.length) return [];

  var title = baseTitle(item);
  var author = authorName(item);
  var parentGroupKey = "douyin:" + awemeId;
  var candidates = [];
  var preparedImages = [];
  for (var imageIndex = 0; imageIndex < images.length && imageIndex < 100; imageIndex++) {
    var rawUrl = imageUrl(images[imageIndex]);
    if (rawUrl) preparedImages.push({item: images[imageIndex], url: rawUrl, sourceIndex: imageIndex});
  }
  if (!preparedImages.length) return [];

  var music = item.music || {};
  var audioUrl = mediaUrl(music.play_url || music.playUrl);
  var includeAudio = settings.includeImagePostAudio !== false && !!audioUrl;
  candidates.push({
    groupKey: parentGroupKey,
    kind: "media.collection",
    title: title,
    coverUrl: preparedImages[0].url,
    capabilities: ["download"],
    metadata: {
      platform: "douyin",
      awemeId: awemeId,
      author: author,
      imageCount: preparedImages.length,
      childCount: preparedImages.length + (includeAudio ? 1 : 0)
    },
    source: source(awemeId)
  });

  for (var preparedIndex = 0; preparedIndex < preparedImages.length; preparedIndex++) {
    var prepared = preparedImages[preparedIndex];
    var extension = extensionFromUrl(prepared.url, ".jpg");
    var trackId = "image-" + (preparedIndex + 1);
    candidates.push({
      groupKey: parentGroupKey + ":image:" + (prepared.sourceIndex + 1),
      parentGroupKey: parentGroupKey,
      kind: "media.image",
      title: title + " - " + String(preparedIndex + 1).padStart(2, "0"),
      coverUrl: prepared.url,
      tracks: [{
        id: trackId,
        role: "image",
        executor: "http-file",
        url: prepared.url,
        mime: mimeForExtension(extension, "image/jpeg"),
        extension: extension,
        width: Number(prepared.item.width) || 0,
        height: Number(prepared.item.height) || 0,
        size: Number(prepared.item.data_size || prepared.item.dataSize) || 0,
        headers: requestHeaders()
      }],
      requiredTracks: ["image"],
      capabilities: ["download", "preview", "open", "copy"],
      preview: {renderer: "image", mode: "range-proxy", mime: mimeForExtension(extension, "image/jpeg"), trackId: trackId},
      metadata: {platform: "douyin", awemeId: awemeId, author: author, collectionIndex: preparedIndex + 1, collectionRole: "image"},
      source: source(awemeId)
    });
  }

  if (includeAudio) {
    // Douyin's object URLs commonly omit a suffix; the verified web response
    // is audio/mp4 in that case.
    var audioExtension = audioExtensionFromUrl(audioUrl);
    var audioMime = audioMimeForExtension(audioExtension);
    candidates.push({
      groupKey: parentGroupKey + ":audio",
      parentGroupKey: parentGroupKey,
      kind: "media.audio",
      title: title + " - 背景音乐",
      coverUrl: mediaUrl(music.cover_hd || music.cover_large || music.cover_medium) || preparedImages[0].url,
      tracks: [{
        id: "audio",
        role: "audio",
        executor: "http-file",
        url: audioUrl,
        mime: audioMime,
        extension: audioExtension,
        size: Number((music.play_url || music.playUrl || {}).data_size) || 0,
        headers: requestHeaders()
      }],
      requiredTracks: ["audio"],
      capabilities: ["download", "preview", "open", "copy"],
      preview: {renderer: "audio", mode: "range-proxy", mime: audioMime, trackId: "audio"},
      metadata: {platform: "douyin", awemeId: awemeId, author: author, collectionIndex: preparedImages.length + 1, collectionRole: "audio"},
      source: source(awemeId)
    });
  }
  return candidates;
}

function object(value) {
  if (typeof value === "string" && value.length < 262144) {
    try { value = JSON.parse(value); } catch (_) { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function videoVariants(video) {
  var list = video.bit_rate || video.bitRateList || [];
  var variants = [];
  for (var i = 0; Array.isArray(list) && i < list.length && i < 64; i++) {
    var rate = object(list[i]), play = rate.play_addr || rate.playAddr;
    var url = mediaUrl(play);
    if (!url) continue;
    var extra = object(rate.video_extra);
    var format = String(rate.format || rate.videoFormat || extra.format || "").toLowerCase();
    variants.push({url: url, width: number(rate.width || (play || {}).width || video.width),
      height: number(rate.height || (play || {}).height || video.height),
      size: number(rate.dataSize || (play || {}).data_size),
      bitrate: number(rate.bit_rate || rate.bitRate),
      split: format === "dash",
      h265: !!(rate.is_h265 || rate.isH265 || rate.is_bytevc1)});
  }
  // The top-level play address is not necessarily DASH even when video.meta
  // says "dash". Match it to the variant list before interpreting its format.
  var fallback = video.play_addr_h264 || video.playAddrH264 || video.play_addr || video.playAddr;
  var fallbackURL = mediaUrl(fallback);
  if (fallbackURL && !variants.some(function (v) { return v.url === fallbackURL; })) {
    variants.push({url: fallbackURL, width: number((fallback || {}).width || video.width), height: number((fallback || {}).height || video.height),
      size: number((fallback || {}).data_size || video.playAddrSize || video.dataSize),
      bitrate: 0, split: String(video.format).toLowerCase() === "dash", h265: false});
  }
  // Prefer a complete MP4 when available. Within a format choose resolution,
  // then H.264 compatibility and bitrate. Never emit every quality separately.
  variants.sort(function (a, b) {
    return Number(a.split) - Number(b.split) ||
      b.width * b.height - a.width * a.height || Number(a.h265) - Number(b.h265) || b.bitrate - a.bitrate;
  });
  return variants;
}

function audioVariant(video) {
  var list = video.bit_rate_audio || video.bitRateAudioList || [], best = null;
  for (var i = 0; Array.isArray(list) && i < list.length && i < 16; i++) {
    var audio = object(list[i]);
    var meta = object(audio.audio_meta || audio);
    var url = mediaUrl(meta);
    if (!url || (meta.media_type && meta.media_type !== "audio") || (meta.mediaType && meta.mediaType !== "audio")) continue;
    var bitrate = number(meta.bitrate || meta.bit_rate);
    if (!best || bitrate > best.bitrate) best = {url: url, bitrate: bitrate, size: number(meta.size || meta.data_size)};
  }
  return best;
}

function videoResource(item) {
  var awemeId = workId(item), video = object(item.video);
  var selected = videoVariants(video)[0];
  if (!awemeId || !selected) return [];
  var audio = selected.split ? audioVariant(video) : null;
  var tracks = [{id: "video", role: "video", executor: "http-file", url: selected.url,
    mime: "video/mp4", extension: ".mp4", width: selected.width, height: selected.height,
    size: selected.size, headers: requestHeaders()}];
  if (audio) tracks.push({id: "audio", role: "audio", executor: "http-file", url: audio.url,
    mime: "audio/mp4", extension: ".m4a", size: audio.size, headers: requestHeaders()});
  var resource = {
    groupKey: "douyin:" + awemeId + ":video", kind: "media.video",
    title: baseTitle(item), coverUrl: mediaUrl(video.cover || video.origin_cover || video.originCover),
    tracks: tracks, requiredTracks: selected.split ? ["video", "audio"] : ["video"],
    capabilities: selected.split ? ["download", "open", "copy"] : ["download", "preview", "open", "copy"],
    metadata: {platform: "douyin", awemeId: awemeId, author: authorName(item), "douyin.separateAV": selected.split},
    source: source(awemeId)
  };
  // The host's ordinary video preview plays one track; do not advertise a
  // misleading silent preview for a two-input download.
  if (!selected.split) resource.preview = {renderer: "video", mode: "range-proxy", mime: "video/mp4", trackId: "video"};
  return [resource];
}

function itemResources(item, settings) {
  if (!workId(item) || item.is_ads === true || item.is_ads === 1 || item.isAds === true || item.aweme_type === 101 || item.awemeType === 101) return [];
  return postImages(item).length ? imagePostResources(item, settings) : videoResource(item);
}

function header(request, name) {
  var headers = request.headers || {}, keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === name) return Array.isArray(headers[keys[i]]) ? headers[keys[i]][0] || "" : "";
  }
  return "";
}

function webPage(url) {
  return typeof url === "string" && /^https:\/\/(?:www|www-hj)\.douyin\.com(?::443)?\/(?:[?#]|$|jingxuan(?:[/?#]|$)|video\/\d+(?:[/?#]|$)|note\/\d+(?:[/?#]|$))/.test(url);
}

function pageWorkId(url) {
  if (!webPage(url)) return "";
  var path = /^https:\/\/[^/]+\/(?:video|note)\/(\d{1,24})(?:[/?#]|$)/.exec(url);
  return path ? path[1] : queryId(url, "modal_id");
}

function queryId(url, name) {
  var match = new RegExp("[?&]" + name + "=(\\d{1,24})(?:&|#|$)").exec(String(url || ""));
  return match ? match[1] : "";
}

function metadataAPI(url) {
  return typeof url === "string" && /^https:\/\/(?:www|www-hj)\.douyin\.com(?::443)?\/aweme\/v[12]\/web\/(?:aweme\/(?:detail|related|post|favorite)|tab\/feed|module\/feed|mix\/aweme)\/(?:[?#]|$)/.test(url);
}

function webBusinessAPI(url) {
  return typeof url === "string" && /^https:\/\/(?:www|www-hj)\.douyin\.com(?::443)?\/aweme\/v[12]\/web\//.test(url);
}

function claimedMedia(observation, api) {
  var request = observation.request || {}, response = observation.response || {};
  if ((response.statusCode !== 200 && response.statusCode !== 206) || !safeURL(request.url)) return false;
  var type = String(response.contentType || "").split(";")[0].trim().toLowerCase();
  if (!/^(?:video\/|audio\/|image\/)/.test(type) && type !== "application/octet-stream") return false;
  if (api && api.correlate && (api.correlate.find(request.url) || []).length) return true;
  // Claim web-player preloads/ranges even if they arrive before metadata, but
  // only in this site's page context with a live plugin bridge. Other sites
  // sharing the CDN, failed injection, unknown MIME and errors retain fallback.
  var referrer = header(request, "referer");
  if (!webPage(referrer) || !api || !api.page) return false;
  var sessions = api.page.sessions() || [];
  if (!sessions.some(function (s) {
    return s.scriptId === "current-work" && webPage(s.pageUrl) && (api.correlate.find(pageMarker(s.pageSessionId)) || []).length > 0;
  })) return false;
  var mediaHost = /^https?:\/\/[^/]+\.douyinvod\.com(?::(?:80|443))?\//i.test(request.url);
  var pictureHost = /^https?:\/\/[^/]+\.douyinpic\.com(?::(?:80|443))?\//i.test(request.url);
  var musicHost = /^https?:\/\/[^/]+\.douyinstatic\.com(?::(?:80|443))?\//i.test(request.url);
  var playAPI = /^https:\/\/(?:www|www-hj)\.douyin\.com(?::443)?\/aweme\/v1\/play\//i.test(request.url);
  return ((mediaHost || playAPI) && /^(?:video\/|audio\/|application\/octet-stream$)/.test(type)) ||
    (pictureHost && /^(?:image\/|video\/)/.test(type)) || (musicHost && /^audio\//.test(type));
}

function registerResources(resources, api) {
  if (!api || !api.correlate) return;
  resources.forEach(function (resource) {
    (resource.tracks || []).forEach(function (track) {
      api.correlate.register({groupKey: resource.groupKey, trackId: track.id, role: track.role, aliases: [track.url]});
    });
  });
}

function pageMarker(sessionId) {
  return "https://www.douyin.com/?resd_page=" + encodeURIComponent(sessionId);
}

function onObservation(observation, api) {
  var result = {decision: "continue", handled: false}, request = observation.request || {}, response = observation.response || {};
  if (observation.stage !== "response") return result;
  if (claimedMedia(observation, api)) { result.handled = true; return result; }
  var isAPI = metadataAPI(request.url), isHTML = webPage(request.url) && /^text\/html(?:;|$)/i.test(response.contentType || "");
  // The /web/ namespace carries site APIs (history, comments, tracking, etc.),
  // not CDN media. Observe headers only outside the extraction allowlist.
  // Preserve actual media/playlist/attachment responses if a new endpoint is
  // introduced, rather than claiming the entire domain or binary CDN traffic.
  if (!isAPI && webBusinessAPI(request.url)) {
    var mime = String(response.contentType || "").split(";")[0].trim().toLowerCase();
    var disposition = header({headers: response.headers}, "content-disposition");
    var payloadType = /^(?:application\/(?:json|octet-stream|binary)|binary\/octet-stream|text\/(?:plain|html))$/.test(mime) || !mime;
    result.handled = payloadType && !/\battachment\b/i.test(disposition);
    return result;
  }
  if (!isAPI && !isHTML) return result;
  // A known metadata endpoint is never a downloadable binary file, including
  // opaque/encrypted envelopes and error responses. Do not pretend to decode it.
  if (isAPI) result.handled = true;
  var settings = observation.settings || {};
  if (response.statusCode !== 200 || typeof response.body !== "string" || !response.body || response.truncated || response.body.length > 16777216) return result;
  var payload;
  try {
    if (isHTML) {
      var script = /<script\b[^>]*\bid\s*=\s*(["'])RENDER_DATA\1[^>]*>([\s\S]*?)<\/script\s*>/i.exec(response.body);
      if (!script) return result;
      payload = JSON.parse(decodeURIComponent(script[2]));
    } else payload = JSON.parse(response.body.replace(/^\uFEFF/, ""));
  } catch (_) { return result; }
  // SPA navigation can send the PREVIOUS page as Referer. It must not override
  // a detail request's explicit ID, nor identify an active work in a feed.
  var target = isHTML ? pageWorkId(request.url) : "";
  if (isAPI && /\/aweme\/detail\/(?:[?#]|$)/.test(request.url || "")) target = queryId(request.url, "aweme_id");
  var resources = [];
  collectAwemes(payload).forEach(function (item) {
    if (settings.captureScope === "all" || (target && workId(item) === target)) resources = resources.concat(itemResources(item, settings));
  });
  registerResources(resources, api);
  result.resources = resources;
  result.handled = isAPI || resources.length > 0;
  return result;
}

function onPageMessage(message, context, api) {
  if (!message || context.scriptId !== "current-work" || !/^https:\/\/(?:www|www-hj)\.douyin\.com(?::443)?$/.test(context.origin || "") ||
      !webPage(context.pageUrl)) return {ok: false, error: "Invalid page context"};
  if (message.type === "page-ready") {
    api.correlate.register({groupKey: "douyin:page:" + context.pageSessionId, trackId: "page", role: "page",
      aliases: [pageMarker(context.pageSessionId)]});
    return {ok: true};
  }
  if (message.type !== "current-work" || !webPage(message.pageUrl) ||
      !workId(message.item) || workId(message.item) !== message.activeId) return {ok: false, error: "Invalid current work"};
  // The page message is untrusted. The bounded extractors only retain media,
  // a public work ID and display metadata, never account/session objects.
  var resources = itemResources(message.item, context.settings || {});
  registerResources(resources, api);
  return {ok: true, resources: resources, data: {accepted: resources.length > 0}};
}

function createDownloadPlan(input) {
  var resource = input.resource || {}, tracks = resource.tracks || [];
  var video = null, audio = null;
  tracks.forEach(function (track) {
    if (track.id === "video" && track.role === "video") video = track;
    if (track.id === "audio" && track.role === "audio") audio = track;
  });
  if (!video) return null; // Image posts use the host's ordinary file plans.
  var split = (resource.metadata || {})["douyin.separateAV"] === true;
  if (!safeURL(video.url) || (split && (!audio || !safeURL(audio.url)))) throw new Error("音视频轨道不完整，请重新打开作品抓取。");
  var inputs = [{id: "video", executor: "http-file", url: video.url, headers: requestHeaders(), extension: ".mp4"}];
  if (!split) return {inputs: inputs, output: {input: "video", extension: ".mp4"}};
  inputs.push({id: "audio", executor: "http-file", url: audio.url, headers: requestHeaders(), extension: ".m4a"});
  return {inputs: inputs, pipeline: [{id: "muxed", executor: "builtin.media.mux", inputs: ["video", "audio"], options: {extension: ".mp4"}}],
    output: {input: "muxed", extension: ".mp4"}};
}

function refreshResource(input) {
  return {status: "recaptureRequired", resource: input.resource, message: "播放地址可能已过期，请重新打开对应抖音作品抓取。"};
}
