function firstString(values) {
  if (!Array.isArray(values)) return "";
  for (var index = 0; index < values.length; index++) {
    if (typeof values[index] === "string" && /^https?:\/\//.test(values[index])) return values[index];
  }
  return "";
}

function mediaUrl(value) {
  if (!value) return "";
  if (typeof value === "string") return /^https?:\/\//.test(value) ? value : "";
  if (Array.isArray(value)) return firstString(value);
  return firstString(value.url_list) || firstString(value.urlList) || mediaUrl(value.play_addr) || mediaUrl(value.playAddr);
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
    if (!Array.isArray(value) && (value.aweme_id || value.awemeId) && (value.video || value.images || value.image_post_info)) {
      var id = String(value.aweme_id || value.awemeId);
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
    var preferred = ["aweme_list", "aweme_detail", "data"];
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
  var author = item.author || {};
  return String(author.nickname || author.unique_id || author.sec_uid || "");
}

function baseTitle(item) {
  var description = typeof item.desc === "string" ? item.desc.trim() : "";
  return description || "抖音作品 " + String(item.aweme_id || item.awemeId || "");
}

function source(requestUrl) {
  return {pageUrl: requestUrl || "", domain: "douyin.com"};
}

function requestHeaders() {
  return {Referer: "https://www.douyin.com/"};
}

function imagePostResources(item, requestUrl, settings) {
  var images = postImages(item);
  var awemeId = String(item.aweme_id || item.awemeId || "");
  if (!awemeId || !images.length) return [];

  var title = baseTitle(item);
  var author = authorName(item);
  var parentGroupKey = "douyin:" + awemeId;
  var candidates = [];
  var preparedImages = [];
  for (var imageIndex = 0; imageIndex < images.length; imageIndex++) {
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
    source: source(requestUrl)
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
      source: source(requestUrl)
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
      source: source(requestUrl)
    });
  }
  return candidates;
}

function videoResource(item, requestUrl) {
  var awemeId = String(item.aweme_id || item.awemeId || "");
  var video = item.video || {};
  var play = video.play_addr_h264 || video.playAddrH264 || video.play_addr || video.playAddr;
  var rawUrl = mediaUrl(play);
  if (!awemeId || !rawUrl) return [];
  var extension = extensionFromUrl(rawUrl, ".mp4");
  return [{
    groupKey: "douyin:" + awemeId + ":video",
    kind: "media.video",
    title: baseTitle(item),
    coverUrl: mediaUrl(video.cover || video.origin_cover || video.dynamic_cover),
    tracks: [{
      id: "video",
      role: "video",
      executor: "http-file",
      url: rawUrl,
      mime: "video/mp4",
      extension: extension,
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      size: Number(play && (play.data_size || play.dataSize)) || 0,
      headers: requestHeaders()
    }],
    requiredTracks: ["video"],
    capabilities: ["download", "preview", "open", "copy"],
    preview: {renderer: "video", mode: "range-proxy", mime: "video/mp4", trackId: "video"},
    metadata: {platform: "douyin", awemeId: awemeId, author: authorName(item)},
    source: source(requestUrl)
  }];
}

function onObservation(observation) {
  var response = observation.response || {};
  if (response.statusCode !== 200 || !response.body || response.truncated) return {decision: "continue"};
  var payload;
  try {
    payload = JSON.parse(response.body);
  } catch (error) {
    return {decision: "continue"};
  }
  var settings = observation.settings || {};
  var items = collectAwemes(payload);
  var resources = [];
  for (var index = 0; index < items.length; index++) {
    var images = postImages(items[index]);
    var emitted = images.length ? imagePostResources(items[index], observation.request.url, settings) : videoResource(items[index], observation.request.url);
    for (var resourceIndex = 0; resourceIndex < emitted.length; resourceIndex++) resources.push(emitted[resourceIndex]);
  }
  return {decision: "continue", resources: resources};
}

function createDownloadPlan(input) {
  var resource = input.resource || {};
  var tracks = resource.tracks || [];
  var video = null;
  var audio = null;
  for (var index = 0; index < tracks.length; index++) {
    if (!video && tracks[index].role === "video") video = tracks[index];
    if (!audio && tracks[index].role === "audio") audio = tracks[index];
  }
  if (!video || !audio) return null;
  return {
    inputs: [
      {id: video.id || "video", executor: video.executor || "http-file", url: video.url, headers: video.headers || {}, extension: video.extension || ".mp4", processors: video.processors || []},
      {id: audio.id || "audio", executor: audio.executor || "http-file", url: audio.url, headers: audio.headers || {}, extension: audio.extension || ".m4a", processors: audio.processors || []}
    ],
    pipeline: [{id: "muxed", executor: "builtin.media.mux", inputs: [video.id || "video", audio.id || "audio"], options: {extension: ".mp4"}}],
    output: {input: "muxed", extension: ".mp4"}
  };
}
