# res-downloader-plugin-douyin

`res-downloader` 的抖音资源识别插件，用于从抖音网页接口响应中识别视频和图文作品。

## 功能

- 识别抖音视频作品并保留标题、作者和封面信息。
- 将图文作品整理为可展开的合集。
- 可选将图文作品的背景音乐加入合集。
- 支持预览、下载、打开和复制资源地址。

## 要求

- `res-downloader` 插件 API v1。
- FFmpeg 6.0 或更高版本。

## 安装

发布后可在 `res-downloader` 的“插件管理”页面从插件商店安装。也可下载 GitHub Release 对应 Tag 的源码 ZIP，然后选择“从压缩包安装”。

插件会申请读取 `*.douyin.com` 和 `*.iesdouyin.com` JSON 响应的权限，安装时请核对权限提示。

## 开发与校验

在仓库根目录执行：

```bash
res-downloader plugin lint .
res-downloader plugin replay . fixtures/image-post.json
res-downloader plugin replay . fixtures/video.json
res-downloader plugin replay . fixtures/suffixless-audio.json
res-downloader plugin replay . fixtures/mp4-audio.json
```

Fixture 只包含脱敏后的虚构数据和示例地址。


## License

[MIT](LICENSE)
