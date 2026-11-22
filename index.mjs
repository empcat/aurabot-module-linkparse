import { join } from 'node:path'
import { mkdir, stat, unlink, readdir } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { firstLink, linkFromCard, classify, PLATFORMS, parseMedia, remoteSize, humanSize } from './parse.mjs'

const ALL = Object.keys(PLATFORMS)

const DEFAULT_ENDPOINTS = [
  'http://47.99.158.118/video-crack/v2/parse?content={}',
  'https://api.bugpk.com/api/pipixia?url={}',
  'https://api.yujn.cn/api/pipixia.php?url={}',
].join('\n')

const list = (text) =>
  String(text || '')
    .split(/[\s,，;；]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

const endpointList = (s) =>
  String(s.endpoints || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)

export default {
  id: 'linkparse',
  name: '链接解析',
  version: '1.0.0',
  api: 1,
  description: '聊天里出现视频/图集分享链接时，解析成直链发出来（B站/抖音/快手/微博/小红书/AcFun/小黑盒）',

  defaults: {
    enabled: true,
    platforms: 'bilibili,douyin,kuaishou,weibo,xiaohongshu,acfun,xiaoheihe',
    endpoints: DEFAULT_ENDPOINTS,
    sendMode: 'media',
    imageLimit: 9,
    videoMaxMB: 50,
    cooldownSec: 8,
    tellOnFail: true,
    ffmpegPath: '',
  },

  settings: [
    { key: 'enabled', label: '总开关', type: 'switch', hint: '关掉后她完全不管链接' },
    {
      key: 'platforms',
      label: '解析哪些平台',
      type: 'textarea',
      hint: '逗号分隔，可选：' + ALL.join(' / '),
    },
    {
      key: 'endpoints',
      label: '解析接口（一行一个，用 {} 占位链接）',
      type: 'textarea',
      hint: '按顺序试，第一个成功就用。可以换成自己搭的接口',
    },
    {
      key: 'sendMode',
      label: '发什么',
      type: 'select',
      options: [
        { value: 'media', label: '直接发视频/图片（推荐）' },
        { value: 'link', label: '只发标题和链接' },
      ],
    },
    { key: 'imageLimit', label: '图集最多发几张', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'videoMaxMB', label: '视频超过多少 MB 改发链接', type: 'number', min: 5, max: 500, step: 5 },
    { key: 'cooldownSec', label: '同一聊天解析冷却（秒）', type: 'number', min: 0, max: 600, step: 1 },
    { key: 'tellOnFail', label: '解析失败时说一句', type: 'switch', hint: '关掉就安静地当没看见' },
    {
      key: 'ffmpegPath',
      label: 'ffmpeg 路径（可选）',
      type: 'text',
      hint: '只在 m3u8 需要合并时用；留空依次找 FFMPEG_PATH 环境变量、PATH 里的 ffmpeg',
    },
  ],

  setup(api) {
    /** chatId -> { at, url } */
    const recent = new Map()
    /** chatId -> 最近解析过的链接 */
    const seen = new Map()

    const settings = () => api.settings()

    function allow(platform) {
      return list(settings().platforms).includes(platform)
    }

    function cooling(chatId) {
      const last = recent.get(chatId)
      if (!last) return false
      return Date.now() - last.at < Math.max(0, Number(settings().cooldownSec) || 0) * 1000
    }

    function alreadySeen(chatId, url) {
      return (seen.get(chatId) || []).includes(url)
    }

    function remember(chatId, url) {
      recent.set(chatId, { at: Date.now(), url })
      const arr = seen.get(chatId) || []
      arr.push(url)
      if (arr.length > 30) arr.shift()
      seen.set(chatId, arr)
    }

    /** 发一条解析结果 */
    async function deliver(msg, result) {
      const s = settings()
      const chatId = msg.chatId
      const title = (result.title || '').slice(0, 120)
      const pageUrl = result.pageUrl || ''
      const head = [title, result.author ? `UP：${result.author}` : ''].filter(Boolean).join('\n')
      const images = (result.images || []).slice(0, Math.max(1, Number(s.imageLimit) || 9))

      // 只发链接，或者既没视频也没图
      if (s.sendMode === 'link' || (!result.video && !images.length)) {
        const text = [head, result.video ? `视频：${result.video}` : '', pageUrl].filter(Boolean).join('\n')
        await api.sendSegments(chatId, [{ type: 'text', data: { text: text || pageUrl } }], '链接解析')
        return true
      }

      // 图集（小红书图文 / 微博九宫格这类）
      if (!result.video) {
        const segs = []
        if (head) segs.push({ type: 'text', data: { text: head } })
        for (const url of images) segs.push({ type: 'image', data: { file: url } })
        await api.sendSegments(chatId, segs, `链接解析（图集 ${images.length} 张）`)
        return true
      }

      // 视频太大就只发链接
      const bytes = await remoteSize(result.video)
      const maxMB = Number(s.videoMaxMB) || 50
      if (bytes && bytes > maxMB * 1024 * 1024) {
        const text = [head, `视频 ${humanSize(bytes)}，超过 ${maxMB} MB，点链接看：`, pageUrl].filter(Boolean).join('\n')
        await api.sendSegments(chatId, [{ type: 'text', data: { text } }], '链接解析')
        return true
      }

      const first = []
      if (head) first.push({ type: 'text', data: { text: head } })
      if (result.cover) first.push({ type: 'image', data: { file: result.cover } })
      if (first.length) {
        try {
          await api.sendSegments(chatId, first, '链接解析')
        } catch (error) {
          api.log.warn(`发标题/封面失败：${error.message}`)
        }
      }
      if (await sendVideo(chatId, result.video, pageUrl)) return true

      const text = [head, '视频直链发不出去，点这里看：', pageUrl].filter(Boolean).join('\n')
      await api.sendSegments(chatId, [{ type: 'text', data: { text } }], '链接解析')
      return true
    }

    /**
     * 视频一律先下到本机再发：让网关自己去拉直链经常超时/被 CDN 拒（B站要 Referer），
     * 本机带上 Referer 下下来再上传最稳。
     */
    async function sendVideo(chatId, url, referer) {
      let file = ''
      try {
        file = await downloadVideo(url, referer)
        api.log.info(`视频已下到本机：${humanSize((await stat(file)).size)}`)
        await sendLocalVideo(chatId, file)
        const done = file
        file = ''
        unlink(done).catch(() => setTimeout(() => unlink(done).catch(() => {}), 60000))
        return true
      } catch (error) {
        api.log.warn(`本机下载/发送失败（${error.message}），改让网关直接拉直链`)
        if (file) unlink(file).catch(() => {})
      }
      try {
        await api.sendSegments(chatId, [{ type: 'video', data: { file: url, url } }], '链接解析')
        return true
      } catch (error) {
        api.log.warn(`直链发视频也失败：${error.message}`)
        return false
      }
    }

    /** 本机文件先走正常发送（受试运行/总开关管）；网关 30 秒超时就换长超时再发一次 */
    async function sendLocalVideo(chatId, file) {
      const seg = [{ type: 'video', data: { file } }]
      try {
        await api.sendSegments(chatId, seg, '链接解析')
        return
      } catch (error) {
        api.log.warn(`本机文件发送失败（${error.message}），改用长超时重试`)
        const cfg = api.config()
        if (!cfg.enabled || cfg.dryRun) throw error
        const [kind, id] = String(chatId).split(':')
        const num = Number(id)
        const action = kind === 'group' ? 'send_group_msg' : 'send_private_msg'
        const params = kind === 'group' ? { group_id: num, message: seg } : { user_id: num, message: seg }
        await api.core.onebot.call(action, params, { timeoutMs: 180000 })
      }
    }

    function ffmpegBin() {
      const configured = String(settings().ffmpegPath || '').trim()
      if (configured) return configured
      if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
      return 'ffmpeg'
    }

    async function downloadVideo(url, referer) {
      const maxBytes = Math.max(5, Number(settings().videoMaxMB) || 50) * 1024 * 1024
      const dir = api.dataDir('tmp')
      await mkdir(dir, { recursive: true })
      const file = join(dir, `v-${Date.now()}.mp4`)
      const headers = {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      }
      headers.referer = referer || 'https://www.bilibili.com/'

      // m3u8 / dash 交给 ffmpeg 合一个 mp4
      if (/\.m3u8?(\?|$)/i.test(url)) {
        await runFfmpeg(ffmpegBin(), [
          '-y',
          '-loglevel',
          'error',
          '-headers',
          `Referer: ${headers.referer}\r\n`,
          '-user_agent',
          headers['user-agent'],
          '-i',
          url,
          '-c',
          'copy',
          '-bsf:a',
          'aac_adtstoasc',
          file,
        ])
      } else {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(180000) })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const len = Number(r.headers.get('content-length')) || 0
        if (len && len > maxBytes) throw new Error(`视频 ${humanSize(len)} 超过上限`)
        await pipeline(Readable.fromWeb(r.body), createWriteStream(file))
      }

      const info = await stat(file)
      if (info.size > maxBytes) throw new Error(`视频 ${humanSize(info.size)} 超过上限`)
      if (info.size < 20 * 1024) throw new Error('下下来的文件太小，可能不是视频')
      return file
    }

    function runFfmpeg(bin, args) {
      return new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: 300000, windowsHide: true }, (error, _stdout, stderr) => {
          if (error) {
            if (error.code === 'ENOENT') reject(new Error(`没找到 ffmpeg（${bin}），m3u8 无法合并`))
            else reject(new Error(String(stderr || error.message).slice(-300)))
          } else resolve()
        })
      })
    }

    async function handle(msg, url) {
      const s = settings()
      const platform = classify(url)
      if (!platform || !allow(platform)) return false
      if (cooling(msg.chatId)) return false
      const endpoints = endpointList(s)
      if (!endpoints.length) return false

      remember(msg.chatId, url)
      api.log.info(`解析 ${PLATFORMS[platform].label} 链接：${url.slice(0, 80)}`)
      let result
      try {
        result = await parseMedia(url, { endpoints })
        // 接口偶尔抽风：隔一秒再试一次
        if (!result.ok && !result.title) {
          api.log.info(`第一次没解析出来（${result.error || '无原因'}），重试`)
          await new Promise((r) => setTimeout(r, 1200))
          result = await parseMedia(url, { endpoints })
        }
      } catch (error) {
        api.log.warn(`解析出错：${error.message}`)
        result = { ok: false, error: error.message, platform }
      }
      if (!result.ok && !result.title) {
        api.log.info(`解析失败：${result.error || '未知原因'}`)
        if (s.tellOnFail) {
          await api.sendSegments(
            msg.chatId,
            [{ type: 'text', data: { text: `这个${PLATFORMS[platform].label}链接没解析出来（接口没给地址），先发原文吧` } }],
            '链接解析',
          )
        }
        return false
      }
      try {
        await deliver(msg, result)
      } catch (error) {
        api.log.warn(`发解析结果失败：${error.message}`)
      }
      return true
    }

    api.on('message', async (msg) => {
      if (!settings().enabled) return false
      if (msg.kind === 'system') return false
      const url = firstLink(msg.text) || linkFromCard(msg.raw)
      if (!url) return false
      if (alreadySeen(msg.chatId, url)) return false
      const platform = classify(url)
      if (!platform || !allow(platform)) return false
      // 已知平台的链接：接管，异步解析
      handle(msg, url).catch((error) => api.log.warn(`链接处理失败：${error.message}`))
      return true
    })

    api.command({
      name: '解析',
      aliases: ['parse', '链接'],
      desc: '解析一个视频/图集链接：/解析 https://...',
      run: async (arg, msg) => {
        const url = firstLink(arg)
        if (!url) return '用法：/解析 <链接>'
        const result = await parseMedia(url, { endpoints: endpointList(settings()) })
        if (!result.ok && !result.title) return `没解析出来：${result.error || '未知原因'}`
        if (!cooling(msg.chatId)) remember(msg.chatId, url)
        try {
          await deliver(msg, result)
        } catch (error) {
          return `解析到了但发不出去：${error.message}`
        }
        return ''
      },
    })

    // 调试：GET /aurabot/api/ext/linkparse/parse?url=...
    api.route('/parse', async (req) => {
      const query = api.core.http.query(req)
      const url = String(query.url || '')
      if (!url) return { ok: false, error: '缺少 url' }
      const result = await parseMedia(url, { endpoints: endpointList(settings()) })
      return { ok: true, result }
    })

    // 调试：POST /aurabot/api/ext/linkparse/send {"chatId","url"} —— 真的发到 QQ
    api.route('/send', async (req) => {
      const b = await api.core.http.body(req)
      const chatId = String(b.chatId || '')
      const url = String(b.url || '')
      if (!chatId || !url) return { ok: false, error: '需要 chatId 和 url' }
      const result = await parseMedia(url, { endpoints: endpointList(settings()) })
      if (!result.ok && !result.title) return { ok: false, error: result.error }
      await deliver({ chatId, kind: chatId.startsWith('group:') ? 'group' : 'private' }, result)
      return {
        ok: true,
        sent: {
          title: (result.title || '').slice(0, 60),
          hasVideo: Boolean(result.video),
          images: (result.images || []).length,
        },
      }
    })

    api.log.info(`链接解析就绪（平台：${list(settings().platforms).join('/') || '无'}）`)

    // 启动时清掉两小时前的残留视频（网关有时占着文件删不掉）
    cleanupTmp().catch(() => {})

    async function cleanupTmp() {
      const dir = api.dataDir('tmp')
      let names = []
      try {
        names = await readdir(dir)
      } catch {
        return
      }
      const now = Date.now()
      for (const name of names) {
        const file = join(dir, name)
        try {
          const info = await stat(file)
          if (now - info.mtimeMs > 2 * 3600_000) await unlink(file)
        } catch {}
      }
    }

    return {
      parse: (url) => parseMedia(url, { endpoints: endpointList(settings()) }),
      ffmpeg: () => ffmpegBin(),
    }
  },
}
