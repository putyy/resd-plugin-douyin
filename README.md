# res-downloader-plugin-douyin

[中文](README.md) | [English](README-EN.md)

[res-downloader](https://github.com/putyy/res-downloader) 的抖音视频和图文资源插件。

## 功能

- 支持精选、推荐、独立视频和图文作品。
- 默认收录当前浏览的作品，下滑切换后继续收录，自动合并重复记录。
- 优先采用网页已播放的画质，支持完整视频下载和音视频合并。
- 图文作品按可展开合集保存，可选包含背景音乐。

## 安装

发布后可在 `res-downloader` 的“插件管理”页面安装。也可以下载对应版本的源码 ZIP，通过“从压缩包安装”导入。

## 设置

- **收录范围**：默认“当前浏览作品”；选择“全部接口作品”会包含推荐和预加载作品。
- **包含图文背景音乐**：默认开启，将背景音乐作为合集中的独立子资源，不影响视频音轨。

## 注意事项

- 音视频合并需要 FFmpeg 6.0 或更高版本；分轨资源需下载合并后播放，完整 MP4 可直接预览。
- 不支持直播录制。网站要求登录或验证时，请先在浏览器中完成。
- 资源不完整时请等待播放；地址过期或下载失败时，重新打开作品抓取，并检查浏览器与下载代理的网络出口是否一致。
- 页面脚本未正常加载或网站改版时，连续收录可能失效；可刷新页面，必要时停用插件恢复通用抓取。
- 偶尔可能收录预加载作品；升级前的重复记录需手动清理。

## 开发与校验

在宿主仓库根目录执行：

```bash
go run main.go plugin lint ./plugins/resd-plugin-douyin
for fixture in ./plugins/resd-plugin-douyin/fixtures/*.json; do
  go run main.go plugin replay ./plugins/resd-plugin-douyin "$fixture" || exit 1
done
node --test plugins/resd-plugin-douyin/tests/*.test.js
go run main.go plugin pack ./plugins/resd-plugin-douyin
```

`fixtures/` 全部是可回放的脱敏虚构数据。`tests/` 补充离线页面消息、DOM 模拟、分轨下载计划及 `handled` 契约检查；单插件回放无法断言完整插件链行为。这些检查不代表应用安装、线上抓取、预览或实际下载已经验收。

## License

[MIT](LICENSE)
