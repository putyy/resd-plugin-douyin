const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const script = fs.readFileSync(path.join(__dirname, '../page/current-work.js'), 'utf8');
const hostScript = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const work = id => ({awemeId: id, desc: '示例作品', authorInfo: {nickname: '示例作者', privateField: 'must-not-leave-page'},
  video: {width: 1920, height: 1080, playAddr: [{src: `https://v11-weba.douyinvod.com/fixture-${id}.mp4`}],
    bitRateList: [{format: 'mp4', width: 1920, height: 1080, playAddr: [{src: `https://v11-weba.douyinvod.com/fixture-${id}.mp4`}], playerAccessKey: 'must-not-leave-page'}]}});
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness({url = 'https://www.douyin.com/jingxuan?modal_id=7390030', render, item, activeId = null, hidden = false, send, fetch: fetchImpl} = {}) {
  const messages = [], intervals = [], elements = {}, timers = [], listeners = {};
  let mutation, cards;
  function player(item, id, {visible = true, playing = true} = {}) {
    const video = {paused: !playing, readyState: 0, currentSrc: '', error: null};
    return {__reactFiber$fixture: {memoizedProps: {item}, return: null}, getAttribute() { return id; },
      getBoundingClientRect() { return {width: 1080, height: 800, top: visible ? 0 : -800, bottom: visible ? 800 : 0}; },
      querySelector() { return video; }};
  }
  if (item) elements.player = player(item, activeId);
  const document = {hidden, documentElement: {}, addEventListener(name, fn) { listeners[name] = fn; },
    getElementById() { return render ? {textContent: encodeURIComponent(JSON.stringify(render))} : null; },
    querySelectorAll() { return cards || (activeId && elements.player ? [elements.player] : []); },
    querySelector(selector) { return selector.includes('feed-active-video') ? (activeId && elements.player) || null : elements.player || null; }};
  class XHR {
    constructor() { this.handlers = []; }
    open() { return 'original-open-result'; }
    addEventListener(name, callback) { if (name === 'load') this.handlers.push(callback); }
    respond(value) { this.status = 200; this.responseType = 'json'; this.response = value; this.handlers.forEach(fn => fn.call(this)); }
  }
  const sandbox = {URL, Map, TextEncoder, TextDecoder, Date, document, XMLHttpRequest: XHR, location: new URL(url),
    innerHeight: 800, addEventListener(name, fn) { listeners[name] = fn; },
    MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    setInterval(fn, ms) { intervals.push({fn, ms}); },
    pageApi: {send(message) { messages.push(JSON.parse(JSON.stringify(message))); return send ? send(message) : Promise.resolve({ok: true, data: {accepted: true}}); }}};
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  sandbox.fetch = fetchImpl || (() => Promise.resolve({status: 200, url: 'https://example.com/not-media'}));
  vm.runInNewContext(script, sandbox);
  return {messages, sandbox, poll: () => intervals.find(x => x.ms === 1000).fn(),
    setPlayer(values) { Object.assign(elements.player.querySelector(), values); },
    flushEvents() { timers.splice(0).forEach(fn => fn()); },
    mutate() { mutation(); },
    event(name) { listeners[name](); },
    setCards(values) { cards = values.map(v => player(v.item, v.item.awemeId, v)); },
    alternate(previous, next) { elements.player.__reactFiber$fixture = {memoizedProps: {item: previous}, alternate: {memoizedProps: {item: next}}}; },
    switchTo(next) { activeId = next.awemeId; elements.player = player(next, activeId); }};
}

test('jingxuan SSR current work is captured once without forwarding account objects', async () => {
  const h = harness({render: {app: {videoDetail: work('7390030'), user: {private: 'must-not-leave-page'}}}});
  await settle();
  h.poll(); await settle();
  const messages = h.messages.filter(m => m.type === 'current-work');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].activeId, '7390030');
  assert.ok(!JSON.stringify(messages).includes('must-not-leave-page'));
  const host = vm.createContext({}); vm.runInContext(hostScript, host);
  const result = host.onPageMessage(messages[0], {scriptId: 'current-work', origin: 'https://www.douyin.com', pageUrl: h.sandbox.location.href}, {});
  assert.equal(result.resources[0].tracks[0].url, 'https://v11-weba.douyinvod.com/fixture-7390030.mp4');
});

test('recommend scroll emits the active item, not originAwemeInfo or preloads', async () => {
  const h = harness({url: 'https://www.douyin.com/?recommend=1', item: work('7390031'), activeId: '7390031'});
  await settle();
  const xhr = new h.sandbox.XMLHttpRequest();
  assert.equal(xhr.open('GET', '/aweme/v1/web/tab/feed/'), 'original-open-result');
  xhr.respond({aweme_list: [work('7390032'), work('7390033')]});
  h.poll(); await settle();
  assert.equal(h.messages.filter(m => m.type === 'current-work').length, 1);
  h.switchTo(work('7390032')); h.poll(); await settle();
  assert.deepEqual(h.messages.filter(m => m.type === 'current-work').map(m => m.activeId), ['7390031', '7390032']);
});

test('direct video can resolve the matching API response without active feed DOM', async () => {
  const h = harness({url: 'https://www.douyin.com/video/7390034'});
  const xhr = new h.sandbox.XMLHttpRequest(); xhr.open('GET', '/aweme/v1/web/aweme/detail/');
  xhr.respond({aweme_detail: work('7390034')});
  h.poll(); await settle();
  assert.equal(h.messages.filter(m => m.type === 'current-work')[0].activeId, '7390034');
});

test('background pages, no active work and unrelated API responses do not emit works', async () => {
  const h = harness({url: 'https://www.douyin.com/?recommend=1', hidden: true, activeId: '7390035', item: work('7390035')});
  await settle();
  assert.equal(h.messages.filter(m => m.type === 'current-work').length, 0);
  const fresh = harness({url: 'https://www.douyin.com/?recommend=1'});
  const xhr = new fresh.sandbox.XMLHttpRequest(); xhr.open('GET', '/private/account/'); xhr.respond({aweme_detail: work('7390035')});
  fresh.poll(); await settle();
  assert.equal(fresh.messages.filter(m => m.type === 'current-work').length, 0);
});

test('page compaction preserves DASH format and audio URL for host muxing', async () => {
  const item = work('7390036');
  item.video.playAddr = [];
  item.video.bitRateList[0].format = 'dash';
  item.video.bitRateAudioList = [{mediaType: 'audio', bitrate: 128000, size: 500, urlList: [{src: 'https://v26-web.douyinvod.com/example-audio.m4a'}]}];
  const h = harness({url: 'https://www.douyin.com/?recommend=1', activeId: item.awemeId, item});
  await settle();
  const host = vm.createContext({}); vm.runInContext(hostScript, host);
  const result = host.onPageMessage(h.messages.find(m => m.type === 'current-work'), {scriptId: 'current-work', origin: 'https://www.douyin.com', pageUrl: h.sandbox.location.href}, {});
  assert.deepEqual(JSON.parse(JSON.stringify(result.resources[0].requiredTracks)), ['video', 'audio']);
  assert.equal(host.createDownloadPlan({resource: result.resources[0]}).inputs.length, 2);
});

test('many quality alternatives fit the bridge and retain the best complete MP4', async () => {
  const item = work('7390037');
  item.video.playAddr = [];
  item.video.bitRateList = Array.from({length: 64}, (_, i) => ({format: i % 2 ? 'dash' : 'mp4',
    width: 640 + i * 10, height: 360 + i * 10,
    playAddr: [{src: `https://v11-weba.douyinvod.com/variant-${i}.mp4?fixture=${'a'.repeat(1000)}`}]}));
  const h = harness({url: 'https://www.douyin.com/?recommend=1', activeId: item.awemeId, item});
  await settle();
  const message = h.messages.find(m => m.type === 'current-work');
  assert.ok(message);
  assert.ok(Buffer.byteLength(JSON.stringify(message)) < 60000);
  assert.match(message.item.video.bit_rate[0].play_addr.url_list[0], /variant-62\.mp4/);
});

test('image post compaction retains gallery and optional music', async () => {
  const item = {awemeId: '7390038', desc: '示例图文', images: [
    {url_list: ['https://p3.douyinpic.com/example-a.jpg'], width: 1080, height: 1440},
    {url_list: ['https://p3.douyinpic.com/example-b.jpg'], width: 1080, height: 1440}],
    music: {play_url: {url_list: ['https://sf5.douyinstatic.com/example-song.mp3']}}};
  const h = harness({url: 'https://www.douyin.com/note/7390038', item});
  await settle();
  const host = vm.createContext({}); vm.runInContext(hostScript, host);
  const message = h.messages.find(m => m.type === 'current-work');
  const ctx = {scriptId: 'current-work', origin: 'https://www.douyin.com', pageUrl: h.sandbox.location.href};
  assert.equal(host.onPageMessage(message, ctx, {}).resources.length, 4);
  assert.equal(host.onPageMessage(message, {...ctx, settings: {includeImagePostAudio: false}}, {}).resources.length, 3);
});

test('www-hj cross-origin detail is cached and retains its description', async () => {
  const h = harness({url: 'https://www.douyin.com/video/7390042'});
  const item = work('7390042'); item.desc = '跨域详情中的作品描述';
  const xhr = new h.sandbox.XMLHttpRequest();
  xhr.open('GET', 'https://www-hj.douyin.com:443/aweme/v1/web/aweme/detail/?aweme_id=7390042');
  xhr.respond({aweme_detail: item}); h.poll(); await settle();
  assert.equal(h.messages.find(m => m.type === 'current-work').item.desc, item.desc);
});

test('XHR ArrayBuffer containing JSON is parsed and long descriptions are truncated, not dropped', async () => {
  const h = harness({url: 'https://www.douyin.com/video/7390043'});
  const item = work('7390043'); item.desc = '示例描述'.repeat(1000);
  const xhr = new h.sandbox.XMLHttpRequest();
  xhr.open('GET', 'https://www-hj.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7390043');
  xhr.status = 200; xhr.responseType = 'arraybuffer';
  xhr.response = new TextEncoder().encode(JSON.stringify({aweme_detail: item})).buffer;
  xhr.handlers.forEach(fn => fn.call(xhr)); h.poll(); await settle();
  const message = h.messages.find(m => m.type === 'current-work');
  assert.equal(message.item.desc, item.desc.slice(0, 2000));
});

test('a DOM transition publishes the new card without another scroll or interval tick', async () => {
  const h = harness({url: 'https://www.douyin.com/jingxuan?modal_id=7390050', item: work('7390050'), activeId: '7390050'});
  await settle();
  h.switchTo(work('7390051'));
  h.mutate(); h.flushEvents(); await settle();
  assert.deepEqual(h.messages.filter(m => m.type === 'current-work').map(m => m.activeId), ['7390050', '7390051']);
});

test('old mounted active card and stale route cannot override the visible playing card', async () => {
  const h = harness({url: 'https://www.douyin.com/jingxuan?modal_id=7390050'});
  h.setCards([{item: work('7390050'), visible: false, playing: false}, {item: work('7390051'), visible: true, playing: true}]);
  h.event('playing'); h.flushEvents(); await settle();
  assert.equal(h.messages.find(m => m.type === 'current-work').activeId, '7390051');
});

test('matching data in the alternate React branch is available on the first transition', async () => {
  const h = harness({url: 'https://www.douyin.com/?recommend=1', item: work('7390050'), activeId: '7390050'});
  await settle();
  h.switchTo(work('7390051')); h.alternate(work('7390050'), work('7390051'));
  h.mutate(); h.flushEvents(); await settle();
  assert.equal(h.messages.filter(m => m.type === 'current-work').at(-1).activeId, '7390051');
});

test('a switch during an in-flight message sends the newest work as soon as it settles', async () => {
  let release;
  const h = harness({url: 'https://www.douyin.com/?recommend=1', item: work('7390050'), activeId: '7390050',
    send(message) {
      if (message.activeId === '7390050') return new Promise(resolve => { release = resolve; });
      return Promise.resolve({ok: true, data: {accepted: true}});
    }});
  h.switchTo(work('7390051')); h.mutate(); h.flushEvents();
  assert.equal(h.messages.filter(m => m.type === 'current-work').length, 1);
  release({ok: true, data: {accepted: true}}); await settle();
  h.flushEvents(); await settle();
  assert.deepEqual(h.messages.filter(m => m.type === 'current-work').map(m => m.activeId), ['7390050', '7390051']);
});

const primaryCDN = 'https://v11-weba.douyinvod.com/fixture-track.mp4';
const backupCDN = 'https://v26-web.douyinvod.com/fixture-track.mp4';
function cdnWork() {
  const item = work('7390060');
  item.video.playAddr = [{src: primaryCDN}, {src: backupCDN}];
  item.video.bitRateList[0].playAddr = item.video.playAddr;
  return item;
}
function latestResource(h) {
  const host = vm.createContext({}); vm.runInContext(hostScript, host);
  const message = h.messages.filter(m => m.type === 'current-work').at(-1);
  const ctx = {scriptId: 'current-work', origin: 'https://www.douyin.com', pageUrl: h.sandbox.location.href};
  const resource = host.onPageMessage(message, ctx, {}).resources[0];
  return {resource, plan: host.createDownloadPlan({resource})};
}

test('loaded currentSrc replaces a rejected first CDN in both preview and download input', async () => {
  const item = cdnWork();
  const h = harness({item, activeId: item.awemeId});
  await settle();
  assert.equal(latestResource(h).resource.tracks[0].url, primaryCDN);
  h.setPlayer({currentSrc: backupCDN, readyState: 2});
  h.event('loadeddata'); h.flushEvents(); await settle();
  const {resource, plan} = latestResource(h);
  assert.equal(resource.tracks[0].url, backupCDN);
  assert.equal(resource.preview.trackId, resource.tracks[0].id);
  assert.equal(plan.inputs[0].url, backupCDN);
  assert.equal(resource.groupKey, 'douyin:7390060:video');
  assert.equal(resource.tracks[0].width, 1920);
  assert.equal(item.video.playAddr[0].src, primaryCDN, 'must not mutate player metadata');
  h.poll(); await settle();
  assert.equal(latestResource(h).resource.tracks[0].url, backupCDN);
});

test('unloaded, failed, blob and other-work currentSrc never replace this track', async () => {
  for (const player of [
    {currentSrc: backupCDN, readyState: 0},
    {currentSrc: backupCDN, readyState: 2, error: {}},
    {currentSrc: 'blob:https://www.douyin.com/fixture', readyState: 2},
    {currentSrc: 'https://v26-web.douyinvod.com/other-work.mp4', readyState: 2}
  ]) {
    const item = cdnWork(); const h = harness({item, activeId: item.awemeId});
    await settle(); h.setPlayer(player); h.poll(); await settle();
    assert.equal(latestResource(h).resource.tracks[0].url, primaryCDN);
  }
});

test('MSE XHR switches to a successful alternate, ignores failed requests and unrelated tracks', async () => {
  const item = cdnWork(); const h = harness({item, activeId: item.awemeId});
  await settle();
  h.setPlayer({currentSrc: 'blob:https://www.douyin.com/fixture', readyState: 2});
  function response(url, status) {
    const xhr = new h.sandbox.XMLHttpRequest(); xhr.open('GET', url);
    xhr.status = status; xhr.responseURL = url;
    Object.defineProperty(xhr, 'response', {get() { throw new Error('must not read media body'); }});
    xhr.handlers.forEach(fn => fn.call(xhr)); h.flushEvents();
  }
  response(backupCDN, 403); await settle();
  response('https://v26-web.douyinvod.com/other-work.mp4', 206); await settle();
  assert.equal(latestResource(h).resource.tracks[0].url, primaryCDN);
  response(backupCDN, 206); await settle();
  assert.equal(latestResource(h).plan.inputs[0].url, backupCDN);
});

test('MSE fetch success selects video and audio alternates independently without reading their bodies', async () => {
  const item = cdnWork(); item.video.playAddr = [];
  item.video.bitRateList[0].format = 'dash';
  const audioPrimary = 'https://v11-weba.douyinvod.com/fixture-audio.m4a';
  const audioBackup = 'https://v26-web.douyinvod.com/fixture-audio.m4a';
  item.video.bitRateAudioList = [{mediaType: 'audio', urlList: [{src: audioPrimary}, {src: audioBackup}]}];
  const h = harness({item, activeId: item.awemeId, fetch: url => Promise.resolve({url, status: 206,
    clone() { throw new Error('must not clone media body'); }})});
  await settle();
  await h.sandbox.fetch(backupCDN); await h.sandbox.fetch(audioBackup);
  h.flushEvents(); await settle();
  const {resource, plan} = latestResource(h);
  assert.deepEqual(JSON.parse(JSON.stringify(resource.requiredTracks)), ['video', 'audio']);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.inputs.map(t => t.url))), [backupCDN, audioBackup]);
  assert.equal(plan.pipeline[0].executor, 'builtin.media.mux');
});

test('API-only cache can switch to a successful backup after metadata arrives', async () => {
  const h = harness({url: 'https://www.douyin.com/video/7390060'});
  const xhr = new h.sandbox.XMLHttpRequest(); xhr.open('GET', '/aweme/v1/web/aweme/detail/');
  xhr.respond({aweme_detail: cdnWork()}); h.flushEvents(); await settle();
  const media = new h.sandbox.XMLHttpRequest(); media.open('GET', backupCDN);
  media.status = 200; media.responseURL = backupCDN;
  media.handlers.forEach(fn => fn.call(media)); h.flushEvents(); await settle();
  assert.equal(latestResource(h).resource.tracks[0].url, backupCDN);
});

const primeBase = 'https://v26-web-prime.douyinvod.com/video/fixture-low/?signature=fixture-signature&tk=webid&policy=4';
const primeActual = primeBase + '&__vid=7390061&webid=fixture-session&fid=fixture-file';
function primeWork() {
  const item = work('7390061');
  item.video.playAddr = [{src: primeBase.replace('fixture-low', 'fixture-high')}];
  item.video.bitRateList = [
    {format: 'mp4', width: 3840, height: 2160, playAddr: item.video.playAddr},
    {format: 'mp4', width: 1280, height: 720, playAddr: [{src: primeBase}]}
  ];
  return item;
}
function observeXHR(h, url, status = 206) {
  const x = new h.sandbox.XMLHttpRequest(); x.open('GET', url);
  x.status = status; x.responseURL = url; x.handlers.forEach(fn => fn.call(x));
  h.flushEvents();
}
function hostResources(h) {
  const host = vm.createContext({}); vm.runInContext(hostScript, host);
  const m = h.messages.filter(m => m.type === 'current-work').at(-1);
  return host.onPageMessage(m, {scriptId: 'current-work', origin: 'https://www.douyin.com', pageUrl: h.sandbox.location.href}, {}).resources;
}

test('feed waits for complete player URL and chooses loaded 720p over unfinished 4K', async () => {
  const item = primeWork(); const h = harness({item, activeId: item.awemeId,
    send: m => Promise.resolve({ok: true, data: {accepted: !!m.item?.video?.bit_rate?.length}})});
  await settle();
  assert.equal(hostResources(h).length, 0);
  observeXHR(h, primeActual); await settle();
  const {resource, plan} = latestResource(h);
  assert.equal(resource.tracks[0].url, primeActual);
  assert.equal(plan.inputs[0].url, primeActual);
  assert.equal(resource.tracks[0].width, 1280);
  assert.equal(resource.tracks[0].height, 720);
  assert.equal(resource.metadata['douyin.separateAV'], false);
});

test('loaded direct-video source retains player-added query fields', async () => {
  const item = primeWork(); const h = harness({item, activeId: item.awemeId});
  await settle();
  h.setPlayer({currentSrc: primeActual, readyState: 4}); h.event('playing'); h.flushEvents(); await settle();
  assert.equal(latestResource(h).resource.tracks[0].url, primeActual);
});

test('successful media before API metadata resolves a lower-quality cached candidate', async () => {
  const h = harness({url: 'https://www.douyin.com/video/7390061'});
  observeXHR(h, primeActual); await settle();
  const x = new h.sandbox.XMLHttpRequest(); x.open('GET', '/aweme/v1/web/aweme/detail/');
  x.respond({aweme_detail: primeWork()}); h.flushEvents(); await settle();
  assert.equal(latestResource(h).plan.inputs[0].url, primeActual);
});

test('player URL matching preserves signature, domain, original parameters and work boundaries', async () => {
  for (const invalid of [
    primeActual.replace('fixture-signature', 'changed-signature'),
    primeActual.replace('fixture-low', 'another-file'),
    primeActual.replace('v26-web-prime', 'v11-web-prime'),
    primeActual + '&unobserved_extra=1',
    primeActual.replace('policy=4', 'policy=3')
  ]) {
    const item = primeWork(); const h = harness({item, activeId: item.awemeId});
    await settle(); observeXHR(h, invalid); await settle();
    assert.equal(hostResources(h).length, 0);
  }
  const item = primeWork(); item.video.playAddr = [];
  item.video.bitRateList = [{format: 'mp4', playAddr: [{src: primeBase + '&webid=original-session'}]}];
  const h = harness({item, activeId: item.awemeId});
  await settle(); observeXHR(h, primeActual); await settle();
  assert.equal(latestResource(h).resource.tracks[0].url, primeBase + '&webid=original-session');
});

test('query reordering is allowed, but failed requests never complete prime URLs', async () => {
  const item = primeWork(); const h = harness({item, activeId: item.awemeId});
  await settle(); observeXHR(h, primeActual, 403); await settle();
  assert.equal(hostResources(h).length, 0);
  const reordered = primeActual.split('?')[0] + '?' + primeActual.split('?')[1].split('&').reverse().join('&');
  observeXHR(h, reordered); await settle();
  assert.equal(latestResource(h).resource.tracks[0].url, reordered);
});

test('observed DASH retains both complete URLs and cannot flip published mux mode', async () => {
  const item = primeWork(); item.video.bitRateList[1].format = 'dash';
  const audioBase = primeBase.replace('fixture-low', 'fixture-audio');
  const audioActual = audioBase + '&webid=fixture-session&fid=fixture-audio';
  item.video.bitRateAudioList = [{mediaType: 'audio', urlList: [{src: audioBase}]}];
  const h = harness({item, activeId: item.awemeId, send: m => Promise.resolve({ok: true, data: {accepted: !!m.item?.video?.bit_rate?.length}})});
  await settle(); observeXHR(h, primeActual); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(hostResources(h)[0].requiredTracks)), ['video', 'audio']);
  observeXHR(h, audioActual); await settle();
  const plan = latestResource(h).plan;
  assert.deepEqual(JSON.parse(JSON.stringify(plan.inputs.map(t => t.url))), [primeActual, audioActual]);
  assert.equal(plan.pipeline[0].executor, 'builtin.media.mux');
  observeXHR(h, primeActual.replace('fixture-low', 'fixture-high')); await settle();
  assert.equal(latestResource(h).resource.metadata['douyin.separateAV'], true);
  assert.equal(latestResource(h).resource.capabilities.includes('preview'), false);
});
