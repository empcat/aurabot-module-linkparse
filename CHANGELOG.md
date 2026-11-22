# Changelog

## 1.0.0 — 2026-11-22

首个公开版本，从自用模块整理而来。

- 支持平台：B站、抖音、快手、微博、小红书、AcFun、小黑盒
- QQ 分享卡片（json / xml / ark / lightapp / raw_message）提取目标链接，忽略卡片里的封面图
- 短链展开：b23.tv、bili2233.cn、v.douyin.com、v.kuaishou.com、xhslink.com、xhslink.cn、t.cn 等
- 小红书改为解析分享页 `masterUrl`，优先 h264 流，不依赖第三方接口
- 视频改为**先下载到本机再上传**（带 Referer/UA），失败依次退回直链消息段、标题+链接
- 图集：无视频时按 `imageLimit` 发图
- m3u8 支持 ffmpeg 合并，路径可配置（`ffmpegPath` / `FFMPEG_PATH` / PATH）
- 解析失败重试一次，并可通过 `tellOnFail` 决定是否提示
- 同一聊天冷却、同链接去重、临时文件两小时自动清理
- 调试接口：`/parse`（只看结果）、`/send`（真的发出去）
