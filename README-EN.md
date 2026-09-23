# res-downloader-plugin-douyin

[中文](README.md) | [English](README-EN.md)

A Douyin video and image-post plugin for `res-downloader`.

## Features

- Supports featured and recommended feeds, individual videos, and image posts.
- Captures the current post by default, continues as you scroll, and merges duplicate entries.
- Prefers the quality played on the page and supports both complete videos and merged video/audio downloads.
- Stores image posts as expandable collections, with optional background music.

## Installation

Once published, the plugin can be installed from Plugin Management in `res-downloader`. You can also download the source ZIP for the desired version and import it using the option to install from an archive.

## Settings

- **Capture scope**: Defaults to **Viewed works**. **All API works** also captures recommended and preloaded posts.
- **Include image-post audio**: Enabled by default. Adds background music as a separate collection item without affecting video audio tracks.

## Notes

- Merging video and audio requires FFmpeg 6.0 or later. Separate tracks must be downloaded and merged before playback; complete MP4 files support previews.
- Live recording is not supported. Complete any login or verification required by the site in your browser first.
- If a resource is incomplete, let playback continue. If its URL expires or a download fails, reopen the post to capture it again and check that browser and download proxy traffic use the same outbound network route.
- If the page script fails to load or the site changes, continuous capture may stop working. Refresh the page, or disable the plugin if necessary to restore generic capture.
- Some preloaded posts may still be captured. Duplicate entries created before an upgrade need to be removed manually.

## Development and Validation

Run these commands from the host repository root:

```bash
go run main.go plugin lint ./plugins/resd-plugin-douyin
for fixture in ./plugins/resd-plugin-douyin/fixtures/*.json; do
  go run main.go plugin replay ./plugins/resd-plugin-douyin "$fixture" || exit 1
done
node --test plugins/resd-plugin-douyin/tests/*.test.js
go run main.go plugin pack ./plugins/resd-plugin-douyin
```

All files in `fixtures/` contain replayable, sanitized, fictional data. `tests/` adds offline checks for page messages, simulated DOM behavior, separate-track download plans, and the `handled` contract. Replaying a single plugin cannot verify the behavior of the full plugin chain. These checks do not establish that application installation, live capture, previews, or actual downloads have been verified.

## License

[MIT](LICENSE)
