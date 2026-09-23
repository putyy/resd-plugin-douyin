// Only compact public media metadata leaves the page. Do not forward raw
// responses, React objects, cookies, account data or player access keys.
(function () {
  "use strict";
  if (!/^(?:www|www-hj)\.douyin\.com$/.test(location.hostname) || window.top !== window) return;
  var cache = new Map(), last = "", pending = false, retryAt = 0, failed = "", pollTimer = null;
  var loadedMedia = new Map(), publishedFormats = new Map();

  // The player appends these fields to signed feed URLs before requesting them.
  // Match the same file and original query exactly; never transplant parameters
  // between works, signatures, hosts or qualities.
  function mediaIdentity(raw) {
    try {
      if (!mediaURL(raw)) return "";
      var u = new URL(raw);
      ["__vid", "webid", "fid"].forEach(function (key) { u.searchParams.delete(key); });
      u.searchParams.sort();
      return u.href;
    } catch (_) { return ""; }
  }

  function sameMedia(base, actual) {
    if (!mediaIdentity(base) || mediaIdentity(base) !== mediaIdentity(actual)) return false;
    var a = new URL(base), b = new URL(actual);
    return ["__vid", "webid", "fid"].every(function (key) {
      return !a.searchParams.has(key) || JSON.stringify(a.searchParams.getAll(key)) === JSON.stringify(b.searchParams.getAll(key));
    });
  }

  function usableAddress(raw) {
    try {
      var u = new URL(raw);
      return !(/^[a-z0-9-]+-web-prime\.douyinvod\.com$/i.test(u.hostname) &&
        u.searchParams.get("tk") === "webid" && !u.searchParams.get("webid"));
    } catch (_) { return false; }
  }

  function playbackAddress(raw, currentSrc) {
    if (currentSrc && sameMedia(raw, currentSrc) && usableAddress(currentSrc)) return {url: currentSrc, rank: 2};
    var actual = loadedMedia.get(mediaIdentity(raw));
    if (actual && sameMedia(raw, actual) && usableAddress(actual)) return {url: actual, rank: 1};
    return {url: usableAddress(raw) ? raw : "", rank: 0};
  }

  function mediaURL(raw) {
    try {
      var u = new URL(raw);
      return u.protocol === "https:" && !u.username && !u.password && !u.hash &&
        (!u.port || u.port === "443") && /^(?:[a-z0-9-]+\.)+douyinvod\.com$/i.test(u.hostname);
    } catch (_) { return false; }
  }

  function recordMedia(raw, status) {
    if ((status !== 200 && status !== 206) || typeof raw !== "string" || raw.length > 16384 || !mediaURL(raw)) return;
    var key = mediaIdentity(raw);
    loadedMedia.delete(key);
    loadedMedia.set(key, raw);
    if (loadedMedia.size > 128) loadedMedia.delete(loadedMedia.keys().next().value);
    schedulePoll();
  }

  function schedulePoll() {
    if (pollTimer !== null) return;
    pollTimer = setTimeout(function () { pollTimer = null; poll(); }, 50);
  }

  function idOf(item) {
    var value = item && (item.aweme_id || item.awemeId);
    if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
    return /^(?:\d{1,24})$/.test(String(value)) ? String(value) : "";
  }

  function urls(value) {
    if (typeof value === "string") return /^https?:\/\//.test(value) && value.length <= 16384 ? value : "";
    if (!value || typeof value !== "object") return "";
    if (Array.isArray(value)) return value.slice(0, 8).map(function (u) { return urls(typeof u === "string" ? u : u && u.src); }).filter(function (u) { return typeof u === "string" && u; });
    return urls(value.url_list || value.urlList || value.src || value.play_addr || value.playAddr);
  }

  function pick(value, names) {
    var result = {};
    names.forEach(function (key) {
      var v = value && value[key];
      if ((typeof v === "string" && v.length <= 2048) || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) result[key] = v;
    });
    return result;
  }

  function addr(value, currentSrc, keepAlternatives) {
    var result = pick(value, ["width", "height", "data_size", "dataSize"]);
    var list = urls(value);
    list = Array.isArray(list) ? list : list ? [list] : [];
    // Alternate CDN URLs belong to this exact track. A failed first URL must
    // not hide the URL that the player actually loaded. Never rewrite hosts,
    // signatures, or substitute a URL from another quality/work.
    var resolved = list.map(function (url) { return keepAlternatives ? {url: url, rank: 0} : playbackAddress(url, currentSrc); })
      .filter(function (entry) { return entry.url; }).sort(function (a, b) { return b.rank - a.rank; });
    result.url_list = resolved.slice(0, 2).map(function (entry) { return entry.url; });
    result.observed = resolved.length ? resolved[0].rank : 0;
    return result;
  }

  function compact(item, currentSrc, keepAlternatives) {
    var id = idOf(item);
    if (!id) return null;
    var result = pick(item, ["aweme_type", "awemeType", "is_ads", "isAds"]);
    var description = item.desc || item.item_title || item.itemTitle || item.preview_title;
    if (typeof description === "string") result.desc = description.slice(0, 2000);
    result.aweme_id = id;
    result.author = pick(item.author || item.authorInfo, ["nickname"]);
    var images = item.images || (item.image_post_info || item.imagePostInfo || {}).images;
    if (Array.isArray(images) && images.length) {
      result.images = images.slice(0, 100).map(function (image) {
        return addr(image.url_list || image.urlList ? image : image.origin_image || image.originImage || image.display_image || image.displayImage || image.download_url || image.downloadUrl);
      });
      var music = item.music || {};
      result.music = {play_url: addr(music.play_url || music.playUrl), cover_hd: addr(music.cover_hd || music.coverHD)};
      return result;
    }
    var video = item.video;
    if (!video || typeof video !== "object") return null;
    result.video = pick(video, ["width", "height", "duration", "dataSize", "playAddrSize", "format"]);
    result.video.play_addr = addr(video.play_addr_h264 || video.playAddrH264 || video.play_addr || video.playAddr, currentSrc, keepAlternatives);
    result.video.cover = addr(video.cover || video.origin_cover || video.originCover);
    var rates = video.bit_rate || video.bitRateList;
    if (Array.isArray(rates)) result.video.bit_rate = rates.slice(0, 64).map(function (r) {
      var rate = pick(r, ["width", "height", "dataSize", "format", "videoFormat", "is_h265", "isH265", "is_bytevc1", "bit_rate", "bitRate"]);
      rate.play_addr = addr(r.play_addr || r.playAddr, currentSrc, keepAlternatives);
      if (!rate.format && !rate.videoFormat && typeof r.video_extra === "string" && r.video_extra.length < 262144) {
        try { var format = JSON.parse(r.video_extra).format; if (format === "mp4" || format === "dash") rate.format = format; } catch (_) {}
      }
      if (rate.play_addr.url_list.some(function (u) { return result.video.play_addr.url_list.indexOf(u) >= 0; })) {
        result.video.play_addr.width = rate.width || rate.play_addr.width || video.width;
        result.video.play_addr.height = rate.height || rate.play_addr.height || video.height;
        result.video.format = rate.format || rate.videoFormat || result.video.format;
      }
      return rate;
    }).filter(function (r) {
      var locked = !keepAlternatives && publishedFormats.get(id);
      return r.play_addr.url_list.length > 0 && (!locked || locked === ((r.format || r.videoFormat) === "dash" ? "dash" : "mp4"));
    }).sort(function (a, b) {
      var splitA = (a.format || a.videoFormat) === "dash", splitB = (b.format || b.videoFormat) === "dash";
      var areaA = (a.width || a.play_addr.width || video.width || 0) * (a.height || a.play_addr.height || video.height || 0);
      var areaB = (b.width || b.play_addr.width || video.width || 0) * (b.height || b.play_addr.height || video.height || 0);
      return b.play_addr.observed - a.play_addr.observed || Number(splitA) - Number(splitB) || areaB - areaA ||
        Number(!!(a.is_h265 || a.isH265 || a.is_bytevc1)) - Number(!!(b.is_h265 || b.isH265 || b.is_bytevc1)) ||
        (b.bit_rate || b.bitRate || 0) - (a.bit_rate || a.bitRate || 0);
    }).slice(0, keepAlternatives ? 64 : 1);
    // Keep candidates in the page until their request arrives. Send only the
    // selected variant and prevent the host fallback from reselecting an
    // unplayed, higher-resolution top-level address.
    if (!keepAlternatives && result.video.bit_rate && result.video.bit_rate.length) {
      var selected = result.video.bit_rate[0];
      result.video.play_addr = selected.play_addr;
      result.video.format = selected.format || selected.videoFormat || "";
    }
    if (!keepAlternatives && publishedFormats.has(id) &&
        publishedFormats.get(id) !== (result.video.format === "dash" ? "dash" : "mp4")) return null;
    var audios = video.bit_rate_audio || video.bitRateAudioList;
    if (Array.isArray(audios)) result.video.bit_rate_audio = audios.slice(0, 16).map(function (a) {
      var meta = a.audio_meta || a;
      var audio = pick(meta, ["media_type", "mediaType", "size", "data_size", "bitrate", "bit_rate"]);
      var address = addr(meta, currentSrc, keepAlternatives);
      audio.url_list = address.url_list;
      audio.observed = address.observed;
      return {audio_meta: audio};
    }).filter(function (a) { return a.audio_meta.url_list.length > 0; }).sort(function (a, b) {
      return b.audio_meta.observed - a.audio_meta.observed || (b.audio_meta.bitrate || b.audio_meta.bit_rate || 0) - (a.audio_meta.bitrate || a.audio_meta.bit_rate || 0);
    }).slice(0, keepAlternatives ? 16 : 1);
    return result;
  }

  function remember(item) {
    var small = compact(item, "", true);
    if (!small) return;
    cache.delete(small.aweme_id);
    cache.set(small.aweme_id, small);
    if (cache.size > 80) {
      var oldest = cache.keys().next().value;
      cache.delete(oldest);
      publishedFormats.delete(oldest);
    }
  }

  function collect(payload) {
    var visited = 0;
    function walk(value, depth) {
      if (!value || typeof value !== "object" || depth > 7 || visited++ > 12000) return;
      if (idOf(value) && (value.video || value.images || value.image_post_info || value.imagePostInfo)) { remember(value); return; }
      if (Array.isArray(value)) value.slice(0, 100).forEach(function (v) { walk(v, depth + 1); });
      else ["aweme_list", "aweme_detail", "data", "app", "videoDetail"].forEach(function (key) { walk(value[key], depth + 1); });
    }
    walk(payload, 0);
    schedulePoll();
  }

  function apiURL(raw) {
    try {
      var url = new URL(raw, location.href);
      return url.protocol === "https:" && (!url.port || url.port === "443") && !url.username && !url.password &&
        /^(?:www|www-hj)\.douyin\.com$/.test(url.hostname) && /^\/aweme\/v[12]\/web\/(?:aweme\/(?:detail|related|post|favorite)|tab\/feed|module\/feed|mix\/aweme)\/$/.test(url.pathname);
    } catch (_) { return false; }
  }

  // Cache feed metadata, but never emit it merely because it was prefetched.
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (mediaURL(url)) this.addEventListener("load", function () {
      // Metadata only: do not read or clone the media response body.
      recordMedia(this.responseURL || url, this.status);
    }, {once: true});
    if (apiURL(url)) this.addEventListener("load", function () {
      try {
        if (this.status !== 200) return;
        if (this.responseType === "json") collect(this.response);
        else if (this.responseType === "arraybuffer" && this.response && this.response.byteLength <= 16777216) collect(JSON.parse(new TextDecoder().decode(this.response)));
        else if ((!this.responseType || this.responseType === "text") && this.responseText.length <= 16777216) collect(JSON.parse(this.responseText));
      } catch (_) { /* A non-JSON or blocked request does not affect playback. */ }
    }, {once: true});
    return originalOpen.apply(this, arguments);
  };
  var originalFetch = window.fetch;
  window.fetch = function () {
    var promise = originalFetch.apply(this, arguments);
    promise.then(function (response) {
      recordMedia(response.url, response.status);
      if (response.status === 200 && apiURL(response.url)) response.clone().text().then(function (body) {
        if (body.length <= 16777216) collect(JSON.parse(body));
      }).catch(function () {});
    }).catch(function () {});
    return promise;
  };

  function fromReact(element, id) {
    if (!element) return null;
    var key = Object.keys(element).find(function (k) { return k.indexOf("__reactFiber$") === 0; });
    var fiber = key && element[key];
    for (var i = 0; fiber && i < 24; fiber = fiber.return, i++) {
      var names = ["item", "slideData", "awemeInfo", "awemeDetail", "videoDetail", "data"];
      var branches = [fiber, fiber.alternate];
      for (var b = 0; b < branches.length; b++) {
        var props = branches[b] && branches[b].memoizedProps || {};
        for (var j = 0; j < names.length; j++) {
          var item = props[names[j]];
          if (idOf(item) === id && (item.video || item.images)) return item;
        }
      }
    }
    return null;
  }

  var loadedRender = false;
  function current() {
    if (!/^\/(?:$|jingxuan\/?$|(?:video|note)\/\d+\/?$)/.test(location.pathname)) return null;
    var active = Array.from(document.querySelectorAll('[data-e2e="feed-active-video"]'));
    // During the transition both old and new cards can remain mounted. Pick
    // the visible playing card; do not trust DOM order or a lagging URL alone.
    function visible(element) {
      var r = element.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    }
    var element = active.find(function (e) { var v = e.querySelector("video"); return visible(e) && v && !v.paused; }) ||
      active.find(visible);
    var id = element && element.getAttribute("data-e2e-vid");
    if (!id) {
      var match = /^\/(?:video|note)\/(\d+)/.exec(location.pathname);
      id = match ? match[1] : new URL(location.href).searchParams.get("modal_id");
      element = document.querySelector('[data-e2e="player-container"]');
    }
    if (!id || !/^\d{1,24}$/.test(id)) return null;
    var render = document.getElementById("RENDER_DATA");
    if (!loadedRender && render) {
      try {
        if (render.textContent.length <= 16777216) {
          collect(JSON.parse(decodeURIComponent(render.textContent)));
          loadedRender = true;
        }
      } catch (_) {}
    }
    var player = element && element.querySelector("video");
    var currentSrc = player && player.readyState >= 2 && !player.error ? player.currentSrc : "";
    var item = fromReact(element, id) || cache.get(id);
    if (item) remember(item);
    return cache.has(id) ? compact(cache.get(id), currentSrc) : null;
  }

  function poll() {
    if (pending || document.hidden) return;
    try {
      var item = current();
      if (!item) return;
      var message = {type: "current-work", activeId: item.aweme_id, item: item,
        pageUrl: location.origin + location.pathname};
      var serialized = JSON.stringify(message);
      // Stay beneath the bridge's 64 KiB byte limit; do not truncate arrays and
      // silently change the chosen quality or create an incomplete gallery.
      if (new TextEncoder().encode(serialized).length > 60000 || serialized === last || (serialized === failed && Date.now() < retryAt)) return;
      pending = true;
      pageApi.send(message).then(function (reply) {
        if (reply && reply.ok && reply.data && reply.data.accepted) {
          last = serialized;
          // The host unions requiredTracks/capabilities when merging. Keep a
          // published work in its original mux mode rather than leaving stale
          // required audio or advertising a one-track DASH preview.
          if (item.video) publishedFormats.set(item.aweme_id, item.video.format === "dash" ? "dash" : "mp4");
        }
        else { failed = serialized; retryAt = Date.now() + 3000; }
      }).catch(function () { failed = serialized; retryAt = Date.now() + 3000; }).finally(function () {
        pending = false;
        // If the user scrolled while the previous send was in flight, publish
        // the latest card now rather than waiting for another navigation.
        schedulePoll();
      });
    } catch (_) { /* DOM transitions are retried by the next event/poll. */ }
  }
  setInterval(poll, 1000);
  // A created bridge session alone does not prove injection succeeded. The
  // host suppresses unrelated preloads only after this script announces itself.
  function ready() { pageApi.send({type: "page-ready"}).catch(function () {}); }
  setInterval(ready, 30000);
  ready();
  document.addEventListener("visibilitychange", schedulePoll);
  ["play", "playing", "loadedmetadata", "loadeddata", "canplay"].forEach(function (name) { document.addEventListener(name, schedulePoll, true); });
  if (window.history) ["pushState", "replaceState"].forEach(function (name) {
    var original = window.history[name];
    window.history[name] = function () { var result = original.apply(this, arguments); schedulePoll(); return result; };
  });
  window.addEventListener("popstate", schedulePoll);
  function observe() {
    if (document.documentElement && typeof MutationObserver !== "undefined") {
      new MutationObserver(schedulePoll).observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, attributeFilter: ["data-e2e", "data-e2e-vid"]
      });
    }
    schedulePoll();
  }
  if (document.documentElement) observe();
  else document.addEventListener("DOMContentLoaded", observe, {once: true});
  poll();
})();
