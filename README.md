# aurabot-module-linkparse

给 [Aurabot（dsh-aurabot-qq）](https://github.com/accomplish07zrh-eng/dsh-aurabot-qq) 用的**链接解析模块**：群里有人甩一条 B站 / 抖音 / 快手 / 微博 / 小红书 / AcFun / 小黑盒 的分享链接，她直接把视频或图集发出来，不用点开、不用跳转。

> 这是一个 Aurabot **扩展模块**（放进 `modules/linkparse/` 就生效），不是 DSH 插件，也不需要重启 Harness。

## 功能

- **自动接管**：白名单聊天里出现上述平台的链接时，模块接管这条消息（返回 `true`），她不再另外回话。
- **认分享卡片**：QQ 的 `json` / `xml` / `ark` / `lightapp` 卡片、CQ 码 raw_message 都能挖出目标链接，卡片里夹的封面图/头像不会被误当成视频。
- **短链展开**：`b23.tv`、`v.douyin.com`、`xhslink.cn`、`t.cn` 等先跟跳到真实页面。
- **平台特化**：
  - B站：第三方接口取直链 + 官方 `view` 接口补标题/封面/UP 主；
  - 小红书：直接解析分享页里的笔记数据（`masterUrl`），优先挑 **h264** 流（HEVC 在 QQ 里经常播不了）；
  - 抖音 / 快手 / 微博 / AcFun / 小黑盒：走可配置的解析接口链。
- **本机转存再发**：视频先带 `Referer`/`User-Agent` 下到本机，再上传——让网关自己去拉 CDN 直链经常超时或被拒。
- **三级兜底**：本机文件 → 直链消息段 → 标题 + 原链接；不会只剩封面不说话。
- **图集**：没有视频但有多图时，按上限发图（小红书图文、微博九宫格）。
- **防刷**：同聊天冷却、同链接去重、大小上限、失败提示可关。

## 支持平台

| 平台 | 域名 | 解析方式 |
| --- | --- | --- |
| B站 | `bilibili.com` / `b23.tv` / `bili2233.cn` | 接口直链 + 官方 view |
| 抖音 | `douyin.com` / `v.douyin.com` | 接口 |
| 快手 | `kuaishou.com` / `v.kuaishou.com` | 接口 |
| 微博 | `weibo.com` / `t.cn` | 接口 |
| 小红书 | `xiaohongshu.com` / `xhslink.com` / `xhslink.cn` | 分享页解析（自带，不依赖第三方） |
| AcFun | `acfun.cn` | 接口 |
| 小黑盒 | `xiaoheihe.cn` | 接口 |

## 安装

模块目录一般是：

- Windows：`%USERPROFILE%\.dsh\plugins-data\aurabot\modules\`
- 也可用环境变量 `DSH_HOME` 定位：`$env:DSH_HOME\plugins-data\aurabot\modules`

### 方式一：脚本（推荐）

```powershell
# Windows
git clone https://github.com/empcat/aurabot-module-linkparse.git
cd aurabot-module-linkparse
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

```bash
# Linux / macOS
git clone https://github.com/empcat/aurabot-module-linkparse.git
cd aurabot-module-linkparse
bash ./install.sh
```

脚本会把 `index.mjs`、`parse.mjs` 复制到 `modules/linkparse/`，已存在则先备份成 `linkparse.bak-<时间戳>`。

### 方式二：手动

```text
modules/
└── linkparse/
    ├── index.mjs
    └── parse.mjs
```

保存后几秒内自动热加载，面板「扩展」页能看到「链接解析」在跑。

### 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
# 或直接删掉 modules\linkparse 文件夹
```

## 配置

面板「扩展 → 链接解析」：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `platforms` | 7 个平台 | 逗号分隔；填 `general` 会把普通链接也尝试解析（不建议） |
| `endpoints` | 3 个公共接口 | 一行一个，`{}` 是链接占位；按顺序试，第一个成功就用 |
| `sendMode` | `media` | `media` 发视频/图片；`link` 只发标题和链接 |
| `imageLimit` | `9` | 图集最多发几张 |
| `videoMaxMB` | `50` | 超过就改发链接 |
| `cooldownSec` | `8` | 同一聊天解析冷却 |
| `tellOnFail` | `true` | 解析失败是否回一句提示 |
| `ffmpegPath` | 空 | m3u8 合并用；留空依次找 `FFMPEG_PATH`、`PATH` 里的 `ffmpeg` |

## 用法

- **自动**：在群里/私聊直接发链接或分享卡片。
- **手动**：`/解析 <链接>`（别名 `/parse`、`/链接`），只认主人。
- **调试接口**（本机）：
  - `GET /aurabot/api/ext/linkparse/parse?url=<链接>` 只看解析结果，不发消息
  - `POST /aurabot/api/ext/linkparse/send`，body `{"chatId":"private:123","url":"https://..."}`，会真的发出去

## 工作原理

```
消息 → firstLink(text) / linkFromCard(raw)
     → classify(host) 命中平台?
     → resolveShort(短链跳转)
     → B站: 接口 + view 接口     小红书: 分享页 masterUrl
        其他: endpoints 逐个试（失败 1.2s 后重试一次）
     → deliver():
        视频: 下载(带 Referer) → 发本机文件 → 失败发直链 → 仍失败发链接
        图集: 标题 + 最多 imageLimit 张图
        其他: 标题 + 链接
```

## 依赖与限制

- 需要 Aurabot 扩展接口 **v1**（`api: 1`），Node 18+（用全局 `fetch`）。
- **ffmpeg 可选**：只有 m3u8/DASH 需要合并；普通 mp4 直接下载。
- 第三方解析接口是公共免费服务，**随时可能挂、限流或失效**；接口挂了模块会重试一次并如实提示。想稳定就自己搭一个接口，填进 `endpoints`。
- 小红书走页面解析，页面结构变了就可能失效；需要登录态的内容拿不到。
- 受 QQ 网关限制：视频过大/过长可能发不出去，此时会退化成「标题 + 链接」。
- 只处理白名单内的聊天（由 Aurabot 的准入决定），不会去读别处的消息。

## 排错

| 现象 | 先看什么 |
| --- | --- |
| 完全没反应 | 面板「扩展」里模块是否在跑；链接域名是否在 `platforms` 里 |
| 只发了标题/封面，没视频 | 日志里「视频已下到本机」后面有没有发送失败；视频是否超过 `videoMaxMB` |
| 解析失败提示 | 日志「解析失败：<原因>」，多半是接口挂了，换个 `endpoints` |
| 小红书失败 | 日志「页面里没有媒体数据」——需要登录态或页面改版 |
| 发了两次 | `cooldownSec` 调大；同一链接在同一聊天只会解析一次 |

日志在 Aurabot 数据目录 `logs/`，按模块 id `linkparse` 过滤。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

[MIT](LICENSE)。解析思路参考了 Yunzai 的 rconsole-plugin 及其 AstrBot 移植版（Mulan PSL v2），本仓库代码为独立实现，未复制其源码。

## 致谢

- [Aurabot](https://github.com/accomplish07zrh-eng/dsh-aurabot-qq) 提供的模块扩展接口
- [rconsole-plugin](https://gitee.com/kyrzy0416/rconsole-plugin) 与 [AstrBot 移植版](https://github.com/luoxhei1101-maker/AstrBot-Viedo-Plugin) 提供的平台覆盖思路
