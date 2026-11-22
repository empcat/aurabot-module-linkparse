// 链接解析：识别视频/图集分享链接，取出可播放的直链。
// 纯函数 + 网络请求，不依赖 Aurabot 的任何东西，方便单独用 node 测。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export const PLATFORMS = {
  bilibili: { label: 'B站', hosts: ['bilibili.com', 'b23.tv', 'bili2233.cn'] },
  douyin: { label: '抖音', hosts: ['douyin.com', 'iesdouyin.com'] },
  kuaishou: { label: '快手', hosts: ['kuaishou.com', 'kuaishouapp.com', 'chenzhongtech.com'] },
  weibo: { label: '微博', hosts: ['weibo.com', 'weibo.cn', 't.cn'] },
  xiaohongshu: { label: '小红书', hosts: ['xiaohongshu.com', 'xhslink.com', 'xhslink.cn'] },
  acfun: { label: 'AcFun', hosts: ['acfun.cn', 'acfun.com'] },
  xiaoheihe: { label: '小黑盒', hosts: ['xiaoheihe.cn', 'heybox.com'] },
}

const SHORT_HOSTS = ['b23.tv', 'bili2233.cn', 'v.douyin.com', 'v.kuaishou.com', 'xhslink.com', 'xhslink.cn', 't.cn', 'url.cn', 'dwz.cn']

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function classify(url) {
  const host = hostOf(url)
  if (!host) return ''
  for (const [id, p] of Object.entries(PLATFORMS)) {
    if (p.hosts.some((h) => host === h || host.endsWith('.' + h))) return id
  }
  return ''
}

/** 从一段文字里挑出第一个 http(s) 链接 */
export function firstLink(text) {
  const raw = String(text || '')
  const m = raw.match(/https?:\/\/[^\s<>"'）)】]+/i)
  if (m) {
    // 结尾常粘着标点/括号（比如 markdown 的 ] 或中文句号），去掉
    return m[0].replace(/[.,;:!?，。；：！？、\]\)】}>"'”’]+$/g, '')
  }
  // 有的分享只写 b23.tv/xxx 这种裸域名
  const bare = raw.match(/(?:b23\.tv|bili2233\.cn|v\.douyin\.com|v\.kuaishou\.com|xhslink\.com|t\.cn)\/[A-Za-z0-9_-]+/i)
  return bare ? 'https://' + bare[0] : ''
}

const URL_IN_TEXT = /https?:\/\/[^\s"'\\<>]+/gi

function unescapeCard(text) {
  return String(text)
    .replace(/\\\//g, '/')
    .replace(/\\u002[fF]/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&#44;/g, ',')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * 从 OneBot 消息里的卡片拿目标链接。
 * QQ 的分享卡片可能是 json（structmsg）、xml、ark、lightapp 几种；
 * 卡片里通常还夹着封面图/头像，所以只认「能认出平台」的网址。
 */
export function linkFromCard(raw) {
  const chunks = []
  const segs = raw?.message
  if (Array.isArray(segs)) {
    for (const seg of segs) {
      const t = String(seg?.type || '')
      if (!['json', 'xml', 'ark', 'lightapp', 'share', 'contact'].includes(t)) continue
      const d = seg?.data || {}
      for (const key of ['data', 'content', 'url', 'file', 'text']) {
        if (d[key]) chunks.push(String(d[key]))
      }
    }
  }
  // 兜底：整条原始消息（CQ 码里也常带 url）
  if (raw?.raw_message) chunks.push(String(raw.raw_message))
  for (const chunk of chunks) {
    const text = unescapeCard(chunk)
    const urls = text.match(URL_IN_TEXT) || []
    for (const u of urls) {
      const clean = u.replace(/[\\"'<>),]+$/g, '')
      if (classify(clean)) return clean
    }
  }
  return ''
}

export function isShort(url) {
  const host = hostOf(url)
  return SHORT_HOSTS.some((h) => host === h || host.endsWith('.' + h))
}

/** 短链先跟一次（最多 3 跳），拿到真实地址 */
export async function resolveShort(url, timeoutMs = 12000) {
  let current = url
  for (let i = 0; i < 3; i++) {
    if (!isShort(current)) break
    try {
      const r = await fetch(current, {
        redirect: 'follow',
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(timeoutMs),
      })
      const finalUrl = r.url || ''
      try {
        await r.body?.cancel()
      } catch {}
      if (finalUrl && finalUrl !== current) current = finalUrl
    } catch {
      break
    }
  }
  return current
}

function pick(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function firstImage(v) {
  if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === 'string' && /^https?:\/\//.test(x)) return x
      if (x && typeof x === 'object') {
        const u = pick(x.url, x.src, x.pic, x.img)
        if (u) return u
      }
    }
  }
  if (v && typeof v === 'object') return pick(v.url, v.src, v.pic)
  return ''
}

function imageList(v) {
  const out = []
  const push = (x) => {
    if (typeof x === 'string' && /^https?:\/\//.test(x)) out.push(x)
    else if (x && typeof x === 'object') {
      const u = pick(x.url, x.src, x.pic, x.img)
      if (u) out.push(u)
    }
  }
  if (Array.isArray(v)) v.forEach(push)
  else if (v) push(v)
  return [...new Set(out)]
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function endpointHost(tpl) {
  try {
    return new URL(tpl.replace('{}', '')).host
  } catch {
    return tpl.slice(0, 40)
  }
}

const isNetworkError = (error) =>
  error?.name !== 'TimeoutError' && /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket|network/i.test(String(error?.message || ''))

/** 第三方解析接口：GET，{} 换成编码后的链接 */
export async function parseViaEndpoints(url, endpoints, { timeoutMs = 25000 } = {}) {
  const errors = []
  for (const tpl of endpoints || []) {
    if (!tpl || !tpl.includes('{}')) continue
    const host = endpointHost(tpl)
    const target = tpl.replace('{}', encodeURIComponent(url))
    let text = ''
    let failed = false
    // 网络层错误（DNS/TLS/连接重置）重试一次；业务错误不重试
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(target, {
          headers: { 'user-agent': UA, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!r.ok) {
          errors.push(`${host}: HTTP ${r.status}`)
          failed = true
          break
        }
        text = (await r.text()).trim()
        failed = false
        break
      } catch (error) {
        const net = isNetworkError(error)
        if (net && attempt === 0) {
          await sleep(600)
          continue
        }
        errors.push(`${host}: ${error?.name === 'TimeoutError' ? '超时' : String(error?.message || error)}`)
        failed = true
        break
      }
    }
    if (failed || !text) continue
    let j
    try {
      j = JSON.parse(text)
    } catch {
      errors.push(`${host}: 返回的不是 JSON`)
      continue
    }
    const data = j?.data && typeof j.data === 'object' ? j.data : j
    const video = pick(
      data.url,
      data.video,
      data.video_url,
      data.videoUrl,
      data.play,
      data.playUrl,
      data.mp4,
      data.hd,
      data.download_url,
    )
    const images = imageList(data.imageUrl ?? data.images ?? data.imgs ?? data.pics ?? data.imagesUrl)
    const title = pick(data.title, data.desc, data.text, data.caption)
    const cover = firstImage(data.cover ?? data.coverUrl ?? data.pic)
    if (video || images.length) {
      return { ok: true, via: 'endpoint', platform: classify(url), pageUrl: url, title, cover, video, images, raw: data }
    }
    // 把接口自己的话带出来（限流/不支持这类原因一看就知道）
    const reason = pick(j?.msg, j?.message, data?.msg, data?.message) || (j?.code !== undefined ? `code=${j.code}` : '没有媒体地址')
    errors.push(`${host}: ${reason}`)
  }
  return { ok: false, error: errors.join('；') || '没有可用的解析接口', errors }
}

/** 同一个链接先按原样试，再按展开后的地址试（有的接口只认其中一种） */
async function tryEndpoints(urls, endpoints, timeoutMs) {
  const tried = [...new Set(urls.filter(Boolean))]
  const errors = new Set()
  for (const u of tried) {
    const r = await parseViaEndpoints(u, endpoints, { timeoutMs })
    if (r.ok) return r
    for (const e of r.errors || [r.error]) if (e) errors.add(e)
  }
  return { ok: false, error: [...errors].join('；') || '没有可用的解析接口', urls: tried }
}

/** B站官方的公开信息接口（不要签名，拿标题/封面用） */
export async function bilibiliInfo(url) {
  const m = url.match(/BV([0-9A-Za-z]{8,12})/) || url.match(/av(\d+)/i)
  if (!m) return null
  const q = url.includes('/av') || /^av/i.test(m[1]) ? `aid=${m[1]}` : `bvid=BV${m[1]}`
  try {
    const r = await fetch(`https://api.bilibili.com/x/web-interface/view?${q}`, {
      headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(12000),
    })
    const j = await r.json()
    if (j?.code !== 0 || !j.data) return null
    return {
      title: pick(j.data.title),
      cover: pick(j.data.pic),
      author: pick(j.data.owner?.name),
      duration: Number(j.data.duration) || 0,
      pages: (j.data.pages || []).length,
      bvid: j.data.bvid,
    }
  } catch {
    return null
  }
}

/** 小红书分享页里就有笔记数据：视频直链、封面、图集都能抠出来 */
const decodeXhs = (s) => String(s).replace(/\\u002F/g, '/').replace(/\\\//g, '/')

function metaContent(html, key) {
  const a = new RegExp(`<meta[^>]*(?:property|name)="${key}"[^>]*content="([^"]*)"`, 'i').exec(html)
  if (a) return a[1]
  const b = new RegExp(`<meta[^>]*content="([^"]*)"[^>]*(?:property|name)="${key}"`, 'i').exec(html)
  return b ? b[1] : ''
}

export async function parseXiaohongshu(pageUrl, { timeoutMs = 20000 } = {}) {
  const r = await fetch(pageUrl, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'accept-language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}` }
  const html = await r.text()
  const finalUrl = r.url || pageUrl

  let title = decodeXhs(metaContent(html, 'og:title') || metaContent(html, 'title')).replace(/\s*-\s*小红书\s*$/, '').trim()
  let cover = decodeXhs(metaContent(html, 'og:image'))
  if (cover.startsWith('https://ci.xiaohongshu.com/')) cover = cover.slice('https://ci.xiaohongshu.com/'.length)

  // 视频：优先 h264（QQ 更能播）；同一个笔记会列出多种编码/清晰度
  const vids = []
  const reVid = /"masterUrl":"([^"]+)"/g
  let m
  while ((m = reVid.exec(html))) {
    const url = decodeXhs(m[1])
    if (!/^https?:/.test(url)) continue
    const around = html.slice(Math.max(0, m.index - 500), m.index + 500)
    vids.push({ url, h264: /"videoCodec":"h264"/.test(around) })
  }
  const video = ((vids.find((v) => v.h264) || vids[0] || {}).url || '').replace(/^http:\/\//, 'https://')

  const images = []
  const reImg = /"urlDefault":"([^"]+)"/g
  while ((m = reImg.exec(html))) {
    const url = decodeXhs(m[1])
    if (/^https?:/.test(url)) images.push(url)
  }

  if (!video && !images.length && !title) return { ok: false, error: '页面里没有媒体数据（可能要 cookie）' }
  return { ok: true, via: 'xhs-page', platform: 'xiaohongshu', pageUrl: finalUrl, title, cover, video, images: [...new Set(images)] }
}

/**
 * 解析一个链接：短链先展开，再按平台试。
 * 返回 { ok, platform, pageUrl, title, cover, video, images, via, error }
 */
export async function parseMedia(inputUrl, { endpoints = [], timeoutMs = 20000 } = {}) {
  const cleaned = String(inputUrl || '')
    .trim()
    .replace(/[.,;:!?，。；：！？、\]\)】}>"'”’]+$/g, '')
  const pageUrl = await resolveShort(cleaned)
  const platform = classify(pageUrl)
  // 有的接口只认「原样的分享短链」，有的只认展开后的地址，两种都试
  const candidates = [cleaned, pageUrl]
  if (platform === 'bilibili') {
    const info = await bilibiliInfo(pageUrl)
    if (info) {
      const r = await tryEndpoints(candidates, endpoints, timeoutMs)
      if (r.ok) return { ...r, title: info.title || r.title, cover: info.cover || r.cover, pageUrl }
      return { ok: true, via: 'bilibili-api', platform, pageUrl, title: info.title, cover: info.cover, video: '', images: [], note: '只有文字信息' }
    }
  }
  if (platform === 'xiaohongshu') {
    const r = await tryEndpoints(candidates, endpoints, timeoutMs)
    if (r.ok) return { ...r, platform, pageUrl }
    // 小红书的笔记数据在分享短链的跳转响应里，必须拿原始短链去请求
    let p = await parseXiaohongshu(cleaned, { timeoutMs }).catch((error) => ({ ok: false, error: error.message }))
    if (!p.ok && pageUrl !== cleaned) {
      p = await parseXiaohongshu(pageUrl, { timeoutMs }).catch((error) => ({ ok: false, error: error.message }))
    }
    if (p.ok) return p
    return { ...r, platform, pageUrl, error: `${r.error || ''} / ${p.error || ''}` }
  }
  const r = await tryEndpoints(candidates, endpoints, timeoutMs)
  return { ...r, platform, pageUrl: r.pageUrl || pageUrl }
}

export function humanSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** HEAD 一下看大小（拿不到就返回 0，不影响发送） */
export async function remoteSize(url, timeoutMs = 8000) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) })
    return Number(r.headers.get('content-length')) || 0
  } catch {
    return 0
  }
}
