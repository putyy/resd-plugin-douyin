const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const context = {scriptId: 'current-work', pageSessionId: 'fixture-session', origin: 'https://www.douyin.com', pageUrl: 'https://www.douyin.com/jingxuan?modal_id=7390003'};
const clone = value => JSON.parse(JSON.stringify(value));
function runtime() {
  const scope = vm.createContext({});
  vm.runInContext(source, scope);
  const refs = new Map();
  const api = {correlate: {
    register(value) { for (const alias of value.aliases) refs.set(alias, [...refs.get(alias) || [], value]); },
    find(url) { return refs.get(url) || null; }
  }, page: {sessions() { return [context]; }}};
  return {scope, api};
}
function fixture(name) { return JSON.parse(fs.readFileSync(path.join(root, 'fixtures', name + '.json'))); }
function message(item) { return {type: 'current-work', activeId: String(item.awemeId || item.aweme_id), pageUrl: 'https://www.douyin.com/jingxuan', item}; }
function resource(scope, api, name) {
  return scope.onObservation(fixture(name).observation, api).resources[0];
}

test('page-normalized {src} URLs preserve title/author and emit one canonical work', () => {
  const {scope, api} = runtime();
  const item = {awemeId: '7390020', desc: '当前作品', authorInfo: {nickname: '示例作者', secUid: 'not-forwarded'},
    video: {width: 1280, height: 720, playAddrSize: 123, playAddr: [{src: 'https://v11-weba.douyinvod.com/example.mp4'}]}};
  const result = scope.onPageMessage(message(item), context, api);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].tracks[0].url, item.video.playAddr[0].src);
  assert.equal(result.resources[0].metadata.author, '示例作者');
  assert.equal(result.resources[0].source.pageUrl, 'https://www.douyin.com/video/7390020');
  assert.ok(!JSON.stringify(result).includes('not-forwarded'));
  assert.equal(scope.onPageMessage(message(item), context, api).resources[0].groupKey, result.resources[0].groupKey);
});

test('default mode does not emit prefetched API items, all mode remains available', () => {
  const {scope, api} = runtime();
  const observation = fixture('viewed-feed').observation;
  assert.equal((scope.onObservation(observation, api).resources || []).length, 0);
  observation.settings.captureScope = 'all';
  assert.equal(scope.onObservation(observation, api).resources.length, 2);
});

test('DASH creates two-input mux, missing audio remains required and cannot download', () => {
  const {scope, api} = runtime();
  const full = resource(scope, api, 'dash-video');
  assert.deepEqual(clone(full.requiredTracks), ['video', 'audio']);
  const plan = scope.createDownloadPlan({resource: full});
  assert.deepEqual(clone(plan.pipeline[0].inputs), ['video', 'audio']);
  assert.equal(plan.pipeline[0].executor, 'builtin.media.mux');
  assert.equal(full.capabilities.includes('preview'), false);
  const partial = resource(scope, api, 'dash-missing-audio');
  assert.equal(partial.tracks.length, 1);
  assert.deepEqual(clone(partial.requiredTracks), ['video', 'audio']);
  assert.throws(() => scope.createDownloadPlan({resource: partial}), /轨道不完整/);
});

test('an MP4 alternative is not mistaken for DASH because audio tracks or meta exist', () => {
  const {scope, api} = runtime();
  const full = resource(scope, api, 'mp4-with-audio-alternative');
  assert.equal(full.metadata['douyin.separateAV'], false);
  assert.equal(full.tracks.length, 1);
  assert.deepEqual(clone(full.requiredTracks), ['video']);
  const plan = scope.createDownloadPlan({resource: full});
  assert.equal(plan.inputs.length, 1);
  assert.equal(plan.pipeline, undefined);
});

test('normalized DASH audio urlList supports page playback data', () => {
  const {scope, api} = runtime();
  const item = {awemeId: '7390021', video: {width: 1920, height: 1080,
    bitRateList: [{format: 'dash', playAddr: [{src: 'https://v11-weba.douyinvod.com/dash.mp4'}]}],
    bitRateAudioList: [{mediaType: 'audio', urlList: [{src: 'https://v26-web.douyinvod.com/dash.m4a'}], bitrate: 128000}]}};
  const full = scope.onPageMessage(message(item), context, api).resources[0];
  assert.equal(full.tracks.length, 2);
  assert.equal(full.metadata['douyin.separateAV'], true);
});

test('preload, Range and separate audio are claimed only with a confirmed page bridge', () => {
  const {scope, api} = runtime();
  for (const audioFirst of [true, false]) {
    for (const audio of [audioFirst, !audioFirst]) {
      const observation = {stage: 'response', request: {url: 'https://v11-weba.douyinvod.com:443/example?range=0-100',
        headers: {Referer: ['https://www.douyin.com:443/'], Range: ['bytes=0-100']}},
        response: {statusCode: 206, contentType: audio ? 'audio/mp4' : 'video/mp4'}};
      const fresh = runtime();
      assert.equal(fresh.scope.onObservation(observation, fresh.api).handled, false);
      scope.onPageMessage({type: 'page-ready'}, context, api);
      const result = scope.onObservation(observation, api);
      assert.equal(result.handled, true);
      assert.equal((result.resources || []).length, 0);
      observation.request.headers.Referer = ['https://other.example/'];
      assert.equal(scope.onObservation(observation, api).handled, false);
      observation.request.headers.Referer = ['https://www.douyin.com/'];
      observation.response.statusCode = 403;
      assert.equal(scope.onObservation(observation, api).handled, false);
    }
  }
});

test('covers and avatars are claimed without touching another site or unknown traffic', () => {
  const {scope, api} = runtime();
  scope.onPageMessage({type: 'page-ready'}, context, api);
  const observation = {stage: 'response', request: {url: 'https://p3-pc-sign.douyinpic.com/aweme/example.jpg',
    headers: {Referer: ['https://www.douyin.com/']}}, response: {statusCode: 200, contentType: 'image/jpeg'}};
  assert.equal(scope.onObservation(observation, api).handled, true);
  observation.request.headers = {};
  assert.equal(scope.onObservation(observation, api).handled, false);
  observation.request.url = 'https://unrelated.example/example.jpg';
  assert.equal(scope.onObservation(observation, api).handled, false);
});

test('untrusted messages cannot inject foreign URLs, invalid IDs or unrelated page data', () => {
  const {scope, api} = runtime();
  const item = {awemeId: '7390022', video: {playAddr: [{src: 'https://localhost/private.mp4'}]}};
  assert.equal(scope.onPageMessage(message(item), context, api).resources.length, 0);
  item.video.playAddr[0].src = 'https://v.douyinvod.com@example.com/private.mp4';
  assert.equal(scope.onPageMessage(message(item), context, api).resources.length, 0);
  assert.equal(scope.onPageMessage({...message(item), activeId: '7390023'}, context, api).ok, false);
  assert.equal(scope.onPageMessage(message(item), {...context, origin: 'https://other.example'}, api).ok, false);
  item.awemeId = 7687228283863880554;
  assert.equal(scope.onPageMessage(message(item), context, api).ok, false);
});

test('invalid metadata never becomes a binary download; unrelated responses retain fallback', () => {
  const {scope, api} = runtime();
  for (const patch of [{truncated: true}, {statusCode: 403}, {contentType: 'text/html', body: '<html>error</html>'}, {body: '{invalid'}]) {
    const observation = fixture('video').observation;
    Object.assign(observation.response, patch);
    const result = scope.onObservation(observation, api);
    assert.equal(result.handled, true);
    assert.equal((result.resources || []).length, 0);
  }
  const observation = fixture('video').observation;
  observation.request.url = 'https://unrelated.example/aweme/v1/web/aweme/detail/';
  assert.equal((scope.onObservation(observation, api).resources || []).length, 0);
  assert.equal(scope.onObservation(observation, api).handled, false);
});

test('explicit HTTPS default port from the proxy does not reject titles or the bridge', () => {
  const {scope, api} = runtime();
  const ctx = {...context, origin: 'https://www.douyin.com:443', pageUrl: 'https://www.douyin.com:443/video/7390040'};
  const item = {awemeId: '7390040', desc: '必须显示的作品描述', video: {playAddr: [{src: 'https://v11-weba.douyinvod.com/example.mp4'}]}};
  assert.equal(scope.onPageMessage({type: 'page-ready'}, ctx, api).ok, true);
  const result = scope.onPageMessage(message(item), ctx, api);
  assert.equal(result.ok, true);
  assert.equal(result.resources[0].title, item.desc);
});

test('www-hj single-detail fallback preserves title without a page bridge', () => {
  const {scope, api} = runtime();
  const observation = fixture('hj-detail-binary-json').observation;
  const result = scope.onObservation(observation, api);
  assert.equal(result.handled, true);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].title, '示例详情描述');
  assert.equal(result.resources[0].groupKey, 'douyin:7390041:video');
  observation.request.headers.Referer = ['https://www.douyin.com/video/7390099'];
  assert.equal(scope.onObservation(observation, api).resources[0].metadata.awemeId, '7390041');
});

test('opaque www-hj metadata is suppressed without fabricating a resource', () => {
  const {scope, api} = runtime();
  for (const type of ['application/octet-stream', 'binary/octet-stream', 'application/binary']) {
    const observation = fixture('hj-opaque-detail').observation;
    observation.response.contentType = type;
    const result = scope.onObservation(observation, api);
    assert.equal(result.handled, true);
    assert.equal((result.resources || []).length, 0);
  }
});

test('HTML target fallback emits only that work with a nonempty title', () => {
  const {scope, api} = runtime();
  const result = scope.onObservation(fixture('jingxuan-html').observation, api);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].title, '示例精选描述');
});

test('stale Referer must not select the previous work from a prefetched feed', () => {
  const {scope, api} = runtime();
  const observation = fixture('viewed-feed').observation;
  observation.request.headers.Referer = ['https://www.douyin.com/jingxuan?modal_id=7390003'];
  assert.equal(scope.onObservation(observation, api).resources.length, 0);
});

test('business API noise is claimed with no body, including history/write and errors', () => {
  const {scope, api} = runtime();
  for (const host of ['www.douyin.com', 'www-hj.douyin.com:443']) {
    for (const path of ['/aweme/v1/web/history/write/', '/aweme/v1/web/comment/list/', '/aweme/v2/web/notice/count/']) {
      for (const mime of ['application/octet-stream', 'binary/octet-stream', 'application/binary', 'application/json; charset=utf-8']) {
        const observation = {stage: 'response', request: {url: `https://${host}${path}`, headers: {}}, response: {statusCode: 200, contentType: mime}};
        assert.equal(scope.onObservation(observation, api).handled, true);
        observation.response.statusCode = 403;
        assert.equal(scope.onObservation(observation, api).handled, true);
        assert.equal((scope.onObservation(observation, api).resources || []).length, 0);
      }
    }
  }
});

test('business filtering leaves media, explicit downloads and other paths/domains untouched', () => {
  const {scope, api} = runtime();
  const observation = {stage: 'response', request: {url: 'https://www-hj.douyin.com/aweme/v1/web/export/', headers: {}}, response: {statusCode: 200, contentType: 'video/mp4'}};
  assert.equal(scope.onObservation(observation, api).handled, false);
  observation.response.contentType = 'application/octet-stream';
  observation.response.headers = {'Content-Disposition': ['attachment; filename="export.bin"']};
  assert.equal(scope.onObservation(observation, api).handled, false);
  observation.response.headers = {};
  for (const url of ['https://www-hj.douyin.com/download/file.bin', 'https://other.example/aweme/v1/web/history/write/', 'https://v11-weba.douyinvod.com/file.bin']) {
    observation.request.url = url;
    assert.equal(scope.onObservation(observation, api).handled, false);
  }
});

test('unfinished prime URLs stay suppressed until the player supplies complete parameters', () => {
  const {scope, api} = runtime();
  const pending = scope.onObservation(fixture('prime-pending').observation, api);
  assert.equal(pending.handled, true);
  assert.equal(pending.resources.length, 0);
  const full = scope.onObservation(fixture('prime-complete').observation, api).resources[0];
  assert.match(full.tracks[0].url, /webid=fixture-session/);
  assert.equal(scope.createDownloadPlan({resource: full}).inputs[0].url, full.tracks[0].url);
});
