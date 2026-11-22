# aurabot-module-linkparse

A **link-resolving module** for [Aurabot (dsh-aurabot-qq)](https://github.com/accomplish07zrh-eng/dsh-aurabot-qq). When someone drops a Bilibili / Douyin / Kuaishou / Weibo / Xiaohongshu / AcFun / Heybox share link in a whitelisted chat, the bot posts the actual video or image album instead of just a link.

> This is an Aurabot **extension module** (drop it into `modules/linkparse/`), not a DSH plugin. No Harness restart needed — modules hot-reload.

## Features

- **Auto take-over**: known-platform links in whitelisted chats are claimed by the module; the persona does not reply on top of it.
- **Share cards**: extracts the real URL from QQ `json` / `xml` / `ark` / `lightapp` segments and CQ `raw_message`; cover images inside cards are ignored.
- **Short links**: expands `b23.tv`, `v.douyin.com`, `xhslink.cn`, `t.cn`, …
- **Per-platform handling**:
  - Bilibili: direct URL from a parse endpoint, plus the official `view` API for title/cover/author.
  - Xiaohongshu: parses the share page itself (`masterUrl`), preferring **h264** streams (HEVC often won't play in QQ).
  - Douyin / Kuaishou / Weibo / AcFun / Heybox: configurable parse-endpoint chain.
- **Download-then-upload**: fetches the video locally with `Referer`/`User-Agent`, then uploads the file. Letting the gateway pull CDN URLs directly tends to time out or get rejected.
- **Three-step fallback**: local file → remote-URL segment → title + original link.
- **Image albums**: posts up to `imageLimit` images when the note has no video.
- **Anti-spam**: per-chat cooldown, per-chat dedupe, size cap, optional failure notice.

## Supported platforms

| Platform | Hosts | How |
| --- | --- | --- |
| Bilibili | `bilibili.com` / `b23.tv` / `bili2233.cn` | endpoint + official view API |
| Douyin | `douyin.com` / `v.douyin.com` | endpoint |
| Kuaishou | `kuaishou.com` / `v.kuaishou.com` | endpoint |
| Weibo | `weibo.com` / `t.cn` | endpoint |
| Xiaohongshu | `xiaohongshu.com` / `xhslink.com` / `xhslink.cn` | share-page parsing (built in) |
| AcFun | `acfun.cn` | endpoint |
| Heybox | `xiaoheihe.cn` | endpoint |

## Install

Modules live in:

- Windows: `%USERPROFILE%\.dsh\plugins-data\aurabot\modules\`
- or `$DSH_HOME/plugins-data/aurabot/modules/`

```powershell
git clone https://github.com/<you>/aurabot-module-linkparse.git
cd aurabot-module-linkparse
powershell -ExecutionPolicy Bypass -File .\install.ps1        # -Uninstall to remove
```

```bash
git clone https://github.com/<you>/aurabot-module-linkparse.git
cd aurabot-module-linkparse
bash ./install.sh
```

Or copy `index.mjs` and `parse.mjs` into `modules/linkparse/` manually. The module reloads within seconds.

## Configuration

Panel → **扩展 → 链接解析**:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | master switch |
| `platforms` | 7 platforms | comma separated |
| `endpoints` | 3 public endpoints | one per line, `{}` = URL placeholder, tried in order |
| `sendMode` | `media` | `media` uploads video/images; `link` sends title + link only |
| `imageLimit` | `9` | max images per album |
| `videoMaxMB` | `50` | larger videos fall back to a link |
| `cooldownSec` | `8` | per-chat cooldown |
| `tellOnFail` | `true` | say something when parsing fails |
| `ffmpegPath` | empty | only needed for m3u8 merging |

## Usage

- Automatic: send a link or a share card in a whitelisted chat.
- Manual: `/解析 <url>` (aliases `/parse`, `/链接`), owner only.
- Debug (local): `GET /aurabot/api/ext/linkparse/parse?url=...` and `POST /aurabot/api/ext/linkparse/send` with `{"chatId":"private:123","url":"..."}`.

## Limits

- Requires Aurabot extension API **v1** and Node 18+ (`fetch`).
- ffmpeg is optional, needed only for m3u8/DASH.
- Public parse endpoints are free third-party services — they can rate-limit or die; configure your own for stability.
- Xiaohongshu page parsing will break if the page structure changes; login-only notes are not accessible.
- QQ itself limits video size/length; oversized videos degrade to a link.

## License

[MIT](LICENSE). Parsing approach inspired by Yunzai's rconsole-plugin and its AstrBot port (Mulan PSL v2); this code is an independent implementation.
