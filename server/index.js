import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import {
  addGlossary,
  addGlossaryCategory,
  addGlobalGlossary,
  audioDir,
  confirmVoiceSamples,
  db,
  deleteGlossary,
  deleteGlossaryCategory,
  deleteGlobalGlossary,
  deletePolishedOverride,
  getEffectiveGlossaries,
  getGlossaries,
  getGlossaryCategories,
  getGlobalGlossaries,
  getTestCase,
  getTestCasesByGroup,
  getTestCaseGroups,
  addTestCaseGroupRow,
  renameTestCaseGroup,
  deleteTestCaseGroup,
  getPolishedOverrides,
  getSetting,
  getSpeakerNames,
  getVideo,
  getVideoSections,
  getChapters,
  getVoiceSamples,
  mountVideoSections,
  clearVideoSections,
  renameGlossaryCategory,
  renameVideoGlossaryCategory,
  rootPath,
  setChapters,
  samplesConfirmed,
  setPolishedOverride,
  setSpeakerName,
  setVideoDisplayName,
  transcriptDir,
  updateGlobalGlossary,
  updateGlossary,
  clearVideoGlossaryCategory,
} from './db.js'
import { cookieArgs, ffmpegPath, saveCookie, ytDlpPath } from './binaries.js'
import { enqueueJob, startQueue } from './queue.js'
import { buildPolishedParagraphs, buildRawParagraphs } from './jobs/paragraphs.js'
import { parseSectionXml } from './sections.js'
import { decorateText, cleanAsrText, formatParagraphs, formatSrt } from './jobs/transcript-format.js'
import { spaceText } from './jobs/cjk-space.js'

process.chdir(rootPath)

const app = new Hono()

app.use('/api/*', async (c, next) => {
  await next()
  if (c.req.method !== 'GET') {
    console.log(`[api] ${c.req.method} ${c.req.path} -> ${c.res.status}`)
  }
})

app.onError((err, c) => {
  console.error('[api]', err)
  return c.json({ error: err.message }, 500)
})

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/settings', (c) => {
  return c.json({ cookieMask: getSetting('cookieMask') || '' })
})

app.put('/api/settings', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = saveCookie(String(body.cookie || ''))
    return c.json({ ok: true, ...result })
  } catch (err) {
    return c.json({ error: err.message }, 400)
  }
})

app.get('/api/projects', (c) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.created_at AS createdAt,
        (SELECT COUNT(*) FROM videos v WHERE v.project_id = p.id) AS videoCount
      FROM projects p ORDER BY p.id DESC`,
    )
    .all()
  return c.json(rows)
})

app.post('/api/projects', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name) return c.json({ error: '项目名称不能为空' }, 400)
  const result = db.prepare('INSERT INTO projects (name) VALUES (?)').run(name)
  const id = Number(result.lastInsertRowid)
  return c.json({ id, name, videoCount: 0, createdAt: null })
})

function projectVideos(projectId) {
  const rows = db
    .prepare(
      `SELECT v.id, v.url, v.title, v.status, v.error, v.audio_path,
        v.num_speakers AS numSpeakers, v.duration_seconds AS durationSeconds,
        v.trim_start_seconds AS trimStartSeconds,
        v.display_name AS displayName, v.bvid AS bvid, v.video_type AS videoType,
        v.source_published_at AS publishedAt,
        v.created_at AS createdAt,
        (SELECT COUNT(*) FROM video_samples_confirmed c WHERE c.video_id = v.id) AS samplesConfirmed,
        (SELECT message FROM jobs WHERE video_id = v.id ORDER BY id DESC LIMIT 1) AS progressMessage
      FROM videos v WHERE v.project_id = ? ORDER BY v.id DESC`,
    )
    .all(projectId)
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt || null,
    numSpeakers: row.numSpeakers || 0,
    durationSeconds: row.durationSeconds || null,
    displayName: row.displayName || null,
    bvid: row.bvid || null,
    videoType: row.videoType || 'unknown',
    trimStartSeconds: row.trimStartSeconds ?? 0,
    samplesConfirmed: Boolean(row.samplesConfirmed),
    progressMessage: row.progressMessage || '',
    // 音频定位:优先按哔哩哔哩 ID 找本地文件(m4a/wav),旧字段仅作回退
    hasAudio: Boolean(
      (row.bvid && (existsSync(join(audioDir, `${row.bvid}.m4a`)) || existsSync(join(audioDir, `${row.bvid}.wav`)))) ||
        (row.audio_path && existsSync(row.audio_path)),
    ),
    hasTranscript: existsSync(join(transcriptDir, `${row.bvid || row.id}.txt`)),
  }))
}

app.get('/api/projects/:id', (c) => {
  const id = Number(c.req.param('id'))
  const project = db
    .prepare('SELECT id, name, created_at AS createdAt FROM projects WHERE id = ?')
    .get(id)
  if (!project) return c.json({ error: '项目不存在' }, 404)
  return c.json({ project, videos: projectVideos(id) })
})

app.put('/api/projects/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id)
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name) return c.json({ error: '项目名称不能为空' }, 400)
  db.prepare(`UPDATE projects SET name = ? WHERE id = ?`).run(name, id)
  return c.json({ ok: true })
})

app.delete('/api/projects/:id', (c) => {
  const id = Number(c.req.param('id'))
  const videos = db.prepare('SELECT id FROM videos WHERE project_id = ?').all(id)
  for (const video of videos) removeVideoFiles(video.id)
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return c.json({ ok: true })
})

function assertBilibiliUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('网址格式不正确')
  }
  const host = parsed.hostname
  const ok = host === 'b23.tv' || host.endsWith('bilibili.com')
  if (!ok) throw new Error('请输入哔哩哔哩视频网址(bilibili.com 或 b23.tv)')
}

app.post('/api/projects/:id/videos', async (c) => {
  const projectId = Number(c.req.param('id'))
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
  if (!project) return c.json({ error: '项目不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  // 支持单个 url 或多行批量 urls
  const rawList = Array.isArray(body.urls) && body.urls.length > 0
    ? body.urls
    : [String(body.url || '')]
  const added = []
  const errors = []
  const seen = new Set()
  const videoType = ['live', 'solo', 'unknown'].includes(String(body.videoType))
    ? String(body.videoType)
    : 'unknown'
  const existing = db
    .prepare('SELECT id, url, bvid FROM videos WHERE project_id = ?')
    .all(projectId)
  for (const raw of rawList) {
    const url = String(raw || '').trim()
    if (!url) continue
    if (seen.has(url)) continue
    seen.add(url)
    try {
      assertBilibiliUrl(url)
      const bvidMatch = /BV[0-9A-Za-z]+/.exec(url)
      const duplicate = existing.find(
        (row) =>
          row.url === url ||
          (bvidMatch && row.bvid === bvidMatch[0]) ||
          (bvidMatch && /BV[0-9A-Za-z]+/.test(row.url) && row.url.includes(bvidMatch[0])),
      )
      if (duplicate) {
        errors.push({ url, message: '该视频已在项目中' })
        continue
      }
      const result = db
        .prepare('INSERT INTO videos (project_id, url, video_type) VALUES (?, ?, ?)')
        .run(projectId, url, videoType)
      added.push({ id: Number(result.lastInsertRowid), url })
    } catch (err) {
      errors.push({ url, message: err.message })
    }
  }
  if (added.length === 0) {
    return c.json({ error: errors[0]?.message || '没有可添加的网址' }, 400)
  }
  return c.json({ added, errors })
})

function removeVideoFiles(videoId) {
  const video = getVideo(videoId)
  const prefixes = [`${videoId}.`]
  if (video && video.bvid) prefixes.push(`${video.bvid}.`)
  for (const prefix of prefixes) {
    for (const name of readdirSync(audioDir)) {
      if (name.startsWith(prefix)) {
        try {
          unlinkSync(join(audioDir, name))
        } catch {
          // 文件可能已被清理
        }
      }
    }
    for (const ext of ['txt', 'srt', 'json']) {
      const path = join(transcriptDir, `${prefix}${ext}`)
      if (existsSync(path)) {
        try {
          unlinkSync(path)
        } catch {
          // 同上
        }
      }
    }
  }
}

app.delete('/api/videos/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  removeVideoFiles(id)
  db.prepare('DELETE FROM videos WHERE id = ?').run(id)
  return c.json({ ok: true })
})

app.post('/api/videos/:id/jobs', async (c) => {
  const id = Number(c.req.param('id'))
  const video = getVideo(id)
  if (!video) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const kind = String(body.kind || '')
  if (!['download', 'transcribe', 'pipeline'].includes(kind)) {
    return c.json({ error: '未知任务类型' }, 400)
  }
  const runningJob = db
    .prepare(`SELECT id FROM jobs WHERE video_id = ? AND status = 'running'`)
    .get(id)
  if (runningJob) {
    return c.json({ error: '该视频有任务正在运行,请等待完成' }, 409)
  }
  enqueueJob(id, kind)
  return c.json({ ok: true })
})

function loadTranscriptSegments(video) {
  // 产物文件以哔哩哔哩 ID 命名;旧数据回退按数字编号查找
  const candidates = video.bvid ? [video.bvid, String(video.id)] : [String(video.id)]
  for (const name of candidates) {
    const jsonPath = join(transcriptDir, `${name}.json`)
    if (existsSync(jsonPath)) {
      try {
        const segments = JSON.parse(readFileSync(jsonPath, 'utf8'))
        // 旧产物里的替换符乱码在读取时统一清洗
        for (const seg of segments) seg.text = cleanAsrText(String(seg.text || ''))
        return segments
      } catch {
        // 尝试下一个候选
      }
    }
  }
  return null
}


app.get('/api/videos/:id/transcript', (c) => {
  const video = getVideo(Number(c.req.param('id')))
  if (!video) return c.json({ error: '视频不存在' }, 404)
  const segments = loadTranscriptSegments(video)
  const names = getSpeakerNames(video.id)
  const glossaries = getEffectiveGlossaries(video.id)
  const overrides = getPolishedOverrides(video.id)
  if (segments) {
    const decorated = segments.map((seg) => ({
      ...seg,
      text: decorateText(seg.text, glossaries),
    }))
    const rawParagraphs = buildRawParagraphs(segments).map((para) => ({
      hash: para.hash,
      speaker: para.speaker,
      start: para.start,
      content: decorateText(para.content, glossaries),
    }))
    const polishedParagraphs = buildPolishedParagraphs(segments, overrides).map((para) => {
      const found = rawParagraphs.find((raw) => raw.hash === para.hash)
      return {
        hash: para.hash,
        speaker: para.speaker,
        start: found ? found.start : null,
        content: decorateText(para.content, glossaries),
        edited: para.edited,
      }
    })
    return c.json({
      text: formatParagraphs(rawParagraphs, names),
      polished: formatParagraphs(polishedParagraphs, names),
      paragraphs: rawParagraphs,
      polishedParagraphs,
      chapters: getChapters(video.id),
      segments: decorated,
      speakers: Object.entries(names).map(([spk, name]) => ({ spk: Number(spk), name })),
    })
  }
  const txtPath = join(transcriptDir, `${video.bvid || video.id}.txt`)
  if (!existsSync(txtPath)) return c.json({ error: '转写文本不存在' }, 404)
  return c.json({
    text: readFileSync(txtPath, 'utf8'),
    polished: '',
    paragraphs: [],
    polishedParagraphs: [],
    segments: [],
    speakers: [],
  })
})

// 洗稿段落手动编辑覆盖
app.put('/api/videos/:id/polished', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const hash = String(body.hash || '').trim()
  const content = String(body.content ?? '')
  if (!/^[0-9a-f]{12}$/.test(hash)) return c.json({ error: '段落 hash 不正确' }, 400)
  if (content.length > 20000) return c.json({ error: '内容过长' }, 400)
  setPolishedOverride(id, hash, content)
  return c.json({ ok: true })
})

app.delete('/api/videos/:id/polished/:hash', (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  deletePolishedOverride(id, c.req.param('hash'))
  return c.json({ ok: true })
})

// 章节:把段落 hash 区间组织成章节,标题由用户维护
app.get('/api/videos/:id/chapters', (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  return c.json({ chapters: getChapters(id) })
})

app.put('/api/videos/:id/chapters', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const chapters = Array.isArray(body.chapters) ? body.chapters : []
  const cleaned = chapters
    .map((chapter) => ({
      hashStart: String(chapter.hashStart || ''),
      hashEnd: String(chapter.hashEnd || ''),
      title: String(chapter.title || '').trim(),
    }))
    .filter((chapter) => /^[0-9a-f]{12}$/.test(chapter.hashStart) && chapter.title)
  setChapters(id, cleaned)
  return c.json({ ok: true, count: cleaned.length })
})

// 章节结构:挂载 section.xml(标签化格式,唯一属性是段落 hash)。
// 段落本体不导入,只存边界 hash 与分析信息;重要段落与边界按 hash 对齐到转写段落。
app.get('/api/videos/:id/sections', (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  return c.json(getVideoSections(id))
})

app.post('/api/videos/:id/sections/mount', async (c) => {
  const video = getVideo(Number(c.req.param('id')))
  if (!video) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const filePath = String(body.path || '').trim()
  if (!filePath) return c.json({ error: '请提供 section.xml 文件路径' }, 400)
  if (!existsSync(filePath)) return c.json({ error: '文件不存在' }, 400)
  let parsed
  try {
    parsed = parseSectionXml(readFileSync(filePath, 'utf8'))
  } catch (err) {
    return c.json({ error: `解析失败：${err.message}` }, 400)
  }
  const segments = loadTranscriptSegments(video)
  const paraHashes = new Set(buildRawParagraphs(segments || []).map((para) => para.hash))
  const anchors = parsed.sections.flatMap((section) => [
    section.hashStart,
    section.hashEnd,
    ...section.marks.map((mark) => mark.hash),
  ])
  const missing = [...new Set(anchors.filter((hash) => !paraHashes.has(hash)))]
  mountVideoSections(video.id, parsed)
  return c.json({
    ok: true,
    sections: parsed.sections.length,
    paragraphs: parsed.paragraphCount,
    missing,
  })
})

app.delete('/api/videos/:id/sections', (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  clearVideoSections(id)
  return c.json({ ok: true })
})

// 词汇表:提升识别与阅读准确率;带误识别词的词条在展示层自动替换
app.get('/api/videos/:id/glossaries', (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  return c.json({ glossaries: getGlossaries(id) })
})

function readGlossaryBody(body) {
  return {
    category: String(body.category || '').trim().slice(0, 30),
    term: String(body.term || '').trim(),
    misread: String(body.misread || '').trim(),
    note: String(body.note || '').trim(),
  }
}

function assertGlossaryBody({ term, category, misread, note }) {
  if (!term || term.length > 60) return '词条需为 1 到 60 个字符'
  if (category.length > 30 || misread.length > 60 || note.length > 200) {
    return '分类、误识别词或说明过长'
  }
  return null
}

app.post('/api/videos/:id/glossaries', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const payload = readGlossaryBody(body)
  const invalid = assertGlossaryBody(payload)
  if (invalid) return c.json({ error: invalid }, 400)
  // 继承关系:全局已有的词条禁止在视频中重复添加(全局词条对所有视频自动生效)
  const globalHit = db.prepare('SELECT id FROM global_glossaries WHERE term = ?').get(payload.term)
  if (globalHit) {
    return c.json({ error: '该词条已在全局词汇表中,对所有视频自动生效,无需在视频中重复添加' }, 409)
  }
  const glossId = addGlossary(id, payload.term, payload.misread, payload.note, payload.category)
  return c.json({ ok: true, id: glossId })
})

app.put('/api/videos/:id/glossaries/:gid', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const payload = readGlossaryBody(body)
  const invalid = assertGlossaryBody(payload)
  if (invalid) return c.json({ error: invalid }, 400)
  const updated = updateGlossary(id, Number(c.req.param('gid')), payload)
  if (!updated) return c.json({ error: '词条不存在' }, 404)
  return c.json({ ok: true })
})

// 视频级分类改名/删除(删除分类不删词条,词条回到未分类)
app.put('/api/videos/:id/glossary-categories/:name', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const oldName = decodeURIComponent(c.req.param('name'))
  const body = await c.req.json().catch(() => ({}))
  const newName = String(body.name || '').trim().slice(0, 30)
  if (!newName) return c.json({ error: '分类名需为 1 到 30 个字符' }, 400)
  renameVideoGlossaryCategory(id, oldName, newName)
  return c.json({ ok: true })
})

app.delete('/api/videos/:id/glossary-categories/:name', (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  clearVideoGlossaryCategory(id, decodeURIComponent(c.req.param('name')))
  return c.json({ ok: true })
})

app.delete('/api/videos/:id/glossaries/:gid', (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  deleteGlossary(id, Number(c.req.param('gid')))
  return c.json({ ok: true })
})

// 全局词汇表:跨视频生效,按分类组织,分类支持增删改
app.get('/api/glossaries/global', (c) => {
  return c.json({ glossaries: getGlobalGlossaries(), categories: getGlossaryCategories() })
})

app.post('/api/glossaries/global', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const category = String(body.category || '').trim()
  const term = String(body.term || '').trim()
  const misread = String(body.misread || '').trim()
  const note = String(body.note || '').trim()
  if (!term || term.length > 60) return c.json({ error: '词条需为 1 到 60 个字符' }, 400)
  if (category.length > 30 || misread.length > 60 || note.length > 200) {
    return c.json({ error: '分类、误识别词或说明过长' }, 400)
  }
  const glossId = addGlobalGlossary(category, term, misread, note)
  return c.json({ ok: true, id: glossId })
})

app.put('/api/glossaries/global/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const category = String(body.category || '').trim()
  const term = String(body.term || '').trim()
  const misread = String(body.misread || '').trim()
  const note = String(body.note || '').trim()
  if (!term || term.length > 60) return c.json({ error: '词条需为 1 到 60 个字符' }, 400)
  if (category.length > 30 || misread.length > 60 || note.length > 200) {
    return c.json({ error: '分类、误识别词或说明过长' }, 400)
  }
  const updated = updateGlobalGlossary(id, { category, term, misread, note })
  if (!updated) return c.json({ error: '词条不存在' }, 404)
  return c.json({ ok: true })
})

app.delete('/api/glossaries/global/:id', (c) => {
  deleteGlobalGlossary(Number(c.req.param('id')))
  return c.json({ ok: true })
})

app.post('/api/glossary-categories', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name || name.length > 30) return c.json({ error: '分类名需为 1 到 30 个字符' }, 400)
  const exists = getGlossaryCategories().some((row) => row.name === name)
  if (exists) return c.json({ error: '分类已存在' }, 409)
  const catId = addGlossaryCategory(name)
  return c.json({ ok: true, id: catId })
})

app.put('/api/glossary-categories/:name', async (c) => {
  const oldName = decodeURIComponent(c.req.param('name'))
  const body = await c.req.json().catch(() => ({}))
  const newName = String(body.name || '').trim()
  if (!newName || newName.length > 30) return c.json({ error: '分类名需为 1 到 30 个字符' }, 400)
  if (!getGlossaryCategories().some((row) => row.name === oldName)) {
    return c.json({ error: '分类不存在' }, 404)
  }
  renameGlossaryCategory(oldName, newName)
  return c.json({ ok: true })
})

app.delete('/api/glossary-categories/:name', (c) => {
  deleteGlossaryCategory(decodeURIComponent(c.req.param('name')))
  return c.json({ ok: true })
})

// 音频流:优先使用下载的 m4a(懒生成 faststart 版本),支持 Range 以便拖动进度条
app.put('/api/videos/:id/trim-start', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const seconds = Number(body.seconds)
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 4 * 3600) {
    return c.json({ error: '开始时间需为 0 到 14400 秒' }, 400)
  }
  db.prepare(
    `UPDATE videos SET trim_start_seconds = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
  ).run(seconds, id)
  return c.json({ ok: true })
})

// 测试用例执行:按配置的时间段截取音频转写,产出「使用前(无截断/无词汇表)」与
// 「使用后(按配置)」两份转写文档,写入 last_run 供用户对照
app.post('/api/test-cases/:id/run', (c) => {
  const id = Number(c.req.param('id'))
  const testCase = getTestCase(id)
  if (!testCase) return c.json({ error: '测试用例不存在' }, 404)
  if (!testCase.video_id) return c.json({ error: '该用例未关联视频' }, 400)
  const runner = spawn(process.execPath, [
    join(rootPath, 'server', 'jobs', 'testcase-runner.mjs'),
    String(id),
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
  let stderr = ''
  runner.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  runner.on('close', (code) => {
    if (code !== 0) {
      console.error(`[testcase ${id}] 执行失败:`)
      console.error(stderr.slice(-4000))
    } else {
      console.log(`[testcase ${id}] 执行完成`)
    }
  })
  runner.unref()
  return c.json({ ok: true, started: true })
})

// 多分P探测:返回分P清单;单P视频返回空数组
app.get('/api/video-parts', async (c) => {
  const url = String(c.req.query('url') || '').trim()
  try {
    assertBilibiliUrl(url)
  } catch (err) {
    return c.json({ error: err.message }, 400)
  }
  try {
    const stdout = execFileSync(
      ytDlpPath(),
      [...cookieArgs(), '--dump-single-json', '--flat-playlist', url],
      { maxBuffer: 64 * 1024 * 1024, timeout: 60_000, encoding: 'utf8' },
    )
    const info = JSON.parse(stdout)
    if (info._type !== 'playlist' || !Array.isArray(info.entries) || info.entries.length <= 1) {
      return c.json({ parts: [] })
    }
    const base = url.split('?')[0]
    const parts = info.entries.map((entry, index) => ({
      p: entry.playlist_index || index + 1,
      title: entry.title || `P${index + 1}`,
      url: `${base}?p=${entry.playlist_index || index + 1}`,
    }))
    return c.json({ parts })
  } catch (err) {
    return c.json({ error: err.message }, 500)
  }
})

app.get('/api/videos-index', (c) => {
  const rows = db
    .prepare(
      `SELECT v.id, v.project_id, p.name AS projectName,
        COALESCE(NULLIF(v.display_name, ''), v.title, v.url) AS label
      FROM videos v JOIN projects p ON p.id = v.project_id ORDER BY v.id DESC`,
    )
    .all()
  return c.json({ videos: rows })
})

app.get('/api/videos/:id/audio', (c) => {  const video = getVideo(Number(c.req.param('id')))
  if (!video) return c.json({ error: '视频不存在' }, 404)
  let source = null
  if (video.bvid) {
    const m4aPath = join(audioDir, `${video.bvid}.m4a`)
    if (existsSync(m4aPath)) source = m4aPath
  }
  if (!source && video.audio_path && existsSync(video.audio_path)) source = video.audio_path
  if (!source) return c.json({ error: '音频不存在' }, 404)
  let servePath = source
  if (video.bvid) {
    const playPath = join(audioDir, `${video.bvid}.play.m4a`)
    try {
      if (!existsSync(playPath) || statSync(playPath).size === 0) {
        unlinkSync(playPath)
      }
    } catch {
      // 文件不存在即无需清理
    }
    if (!existsSync(playPath)) {
      const isWav = source.toLowerCase().endsWith('.wav')
      const args = ['-y', '-loglevel', 'error', '-i', source]
      if (isWav) args.push('-c:a', 'aac', '-b:a', '128k')
      else args.push('-c', 'copy')
      args.push('-movflags', '+faststart', playPath)
      try {
        execFileSync(ffmpegPath(), args, { timeout: 600_000 })
      } catch (err) {
        console.error('[audio] faststart 重封装失败:', err.message)
      }
    }
    if (existsSync(playPath) && statSync(playPath).size > 0) servePath = playPath
  }
  const stat = statSync(servePath)
  const range = c.req.header('range')
  const baseHeaders = {
    'Content-Type': 'audio/mp4',
    'Accept-Ranges': 'bytes',
  }
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    const start = match && match[1] ? Number(match[1]) : 0
    const end = match && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
    if (start >= stat.size) {
      return c.body(null, 416, { 'Content-Range': `bytes */${stat.size}` })
    }
    const buffer = Buffer.alloc(end - start + 1)
    const fd = openSync(servePath, 'r')
    readSync(fd, buffer, 0, buffer.length, start)
    closeSync(fd)
    return c.body(buffer, 206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': String(buffer.length),
    })
  }
  return c.body(readFileSync(servePath), 200, {
    ...baseHeaders,
    'Content-Length': String(stat.size),
  })
})

app.put('/api/videos/:id/name', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (name.length > 100) return c.json({ error: '名称需在 100 字符以内' }, 400)
  setVideoDisplayName(id, name)
  return c.json({ ok: true, name })
})

app.put('/api/videos/:id/video-type', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const videoType = String(body.videoType || 'unknown')
  if (!['live', 'solo', 'unknown'].includes(videoType)) {
    return c.json({ error: '视频类型需为 live、solo 或 unknown' }, 400)
  }
  db.prepare(`UPDATE videos SET video_type = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(
    videoType,
    id,
  )
  return c.json({ ok: true })
})

// 声纹样本:下载后自动采样;用户试听并命名后确认,转写即以样本为聚类种子
app.get('/api/videos/:id/voice-samples', (c) => {
  const id = Number(c.req.param('id'))
  const video = getVideo(id)
  if (!video) return c.json({ error: '视频不存在' }, 404)
  const samples = getVoiceSamples(id)
  return c.json({
    samples: samples.map((sample) => ({
      idx: sample.idx,
      start: sample.start,
      end: sample.end,
      duration: sample.duration,
    })),
    confirmed: samplesConfirmed(id),
  })
})

app.post('/api/videos/:id/voice-samples/resample', (c) => {
  const id = Number(c.req.param('id'))
  const video = getVideo(id)
  if (!video) return c.json({ error: '视频不存在' }, 404)
  const wavPath = video.audio_path
  if (!wavPath || !existsSync(wavPath)) return c.json({ error: '音频不存在,请先下载音频' }, 400)
  const sampler = spawn(process.execPath, [
    join(rootPath, 'server', 'jobs', 'voice-sampler.mjs'),
    String(id),
    wavPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
  sampler.unref()
  return c.json({ ok: true, started: true })
})

app.put('/api/videos/:id/voice-samples/confirm', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const names = body.names || {}
  const samples = getVoiceSamples(id)
  if (samples.length === 0) return c.json({ error: '还没有声纹样本,请先下载音频' }, 400)
  for (const [idx, name] of Object.entries(names)) {
    const trimmed = String(name || '').trim()
    if (!trimmed) continue
    setSpeakerName(id, Number(idx), trimmed.slice(0, 50))
  }
  confirmVoiceSamples(id)
  return c.json({ ok: true })
})

// 测试用例
app.get('/api/test-cases', (c) => {
  return c.json({
    cases: db.prepare('SELECT * FROM test_cases ORDER BY id').all(),
    groups: getTestCaseGroups(),
  })
})

app.post('/api/test-cases', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  if (!title) return c.json({ error: '标题不能为空' }, 400)
  const result = db
    .prepare('INSERT INTO test_cases (title, steps, status, group_name) VALUES (?, ?, ?, ?)')
    .run(title, String(body.steps || ''), String(body.status || 'pending'), String(body.group_name || '').trim().slice(0, 50))
  return c.json({ ok: true, id: Number(result.lastInsertRowid) })
})

app.put('/api/test-cases/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = db.prepare('SELECT * FROM test_cases WHERE id = ?').get(id)
  if (!existing) return c.json({ error: '测试用例不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const title = body.title !== undefined ? String(body.title).trim() : existing.title
  const steps = body.steps !== undefined ? String(body.steps) : existing.steps
  const status = body.status !== undefined ? String(body.status) : existing.status
  const videoId = body.video_id !== undefined ? Number(body.video_id) || null : existing.video_id
  const config = body.config !== undefined ? JSON.stringify(body.config) : existing.config
  const expected = body.expected !== undefined ? String(body.expected) : existing.expected
  const groupName = body.group_name !== undefined
    ? String(body.group_name).trim().slice(0, 50)
    : existing.group_name
  if (!title) return c.json({ error: '标题不能为空' }, 400)
  if (!['pending', 'pass', 'fail'].includes(status)) return c.json({ error: '状态不正确' }, 400)
  db.prepare(
    `UPDATE test_cases SET title = ?, steps = ?, status = ?, video_id = ?, config = ?, expected = ?,
      group_name = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
  ).run(title, steps, status, videoId, config, expected, groupName, id)
  return c.json({ ok: true })
})

app.delete('/api/test-cases/:id', (c) => {
  db.prepare('DELETE FROM test_cases WHERE id = ?').run(Number(c.req.param('id')))
  return c.json({ ok: true })
})

// 测试组增删改:组名独立成表,可先建空组;改名/删除同步组内用例
app.post('/api/test-case-groups', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name || name.length > 50) return c.json({ error: '测试组名需为 1 到 50 个字符' }, 400)
  const exists = getTestCaseGroups().some((row) => row.name === name)
  if (exists) return c.json({ error: '测试组已存在' }, 409)
  const groupId = addTestCaseGroupRow(name)
  return c.json({ ok: true, id: groupId })
})

app.put('/api/test-case-groups/:name', async (c) => {
  const oldName = decodeURIComponent(c.req.param('name'))
  const body = await c.req.json().catch(() => ({}))
  const newName = String(body.name || '').trim()
  if (!newName || newName.length > 50) return c.json({ error: '测试组名需为 1 到 50 个字符' }, 400)
  renameTestCaseGroup(oldName, newName)
  return c.json({ ok: true })
})

app.delete('/api/test-case-groups/:name', (c) => {
  deleteTestCaseGroup(decodeURIComponent(c.req.param('name')))
  return c.json({ ok: true })
})

// 测试组运行:同组用例顺序执行,把多个时间段的音频整合验证
app.post('/api/test-case-groups/run', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const group = String(body.group || '').trim()
  if (!group) return c.json({ error: '测试组名称不能为空' }, 400)
  const members = getTestCasesByGroup(group).filter((row) => row.video_id)
  if (members.length === 0) return c.json({ error: '该组没有可运行的用例(需关联视频)' }, 400)
  const runner = spawn(process.execPath, [
    join(rootPath, 'server', 'jobs', 'testcase-runner.mjs'),
    ...members.map((row) => String(row.id)),
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
  let stderr = ''
  runner.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  runner.on('close', (code) => {
    if (code !== 0) {
      console.error(`[testcase-group ${group}] 执行失败:`)
      console.error(stderr.slice(-4000))
    } else {
      console.log(`[testcase-group ${group}] 执行完成(${members.length} 个用例)`)
    }
  })
  runner.unref()
  return c.json({ ok: true, started: true, count: members.length })
})

app.put('/api/videos/:id/num-speakers', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getVideo(id)) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const count = Number(body.count)
  if (!Number.isInteger(count) || count < 0 || count > 8) {
    return c.json({ error: '说话人数需为 0(自动)或 2 到 8' }, 400)
  }
  db.prepare('UPDATE videos SET num_speakers = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(
    count,
    id,
  )
  return c.json({ ok: true })
})

app.get('/api/videos/:id/speakers', (c) => {
  const id = Number(c.req.param('id'))
  const names = getSpeakerNames(id)
  return c.json({
    speakers: Object.entries(names).map(([spk, name]) => ({ spk: Number(spk), name })),
  })
})

app.put('/api/videos/:id/speakers', async (c) => {
  const id = Number(c.req.param('id'))
  const video = getVideo(id)
  if (!video) return c.json({ error: '视频不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const spk = Number(body.spk)
  const name = String(body.name || '').trim()
  if (!Number.isInteger(spk) || spk < 0) return c.json({ error: '说话人编号不正确' }, 400)
  if (!name || name.length > 50) return c.json({ error: '名称需为 1 到 50 个字符' }, 400)
  setSpeakerName(id, spk, name)
  // 磁盘 txt 与 srt 同步刷新,让改名立即体现在文件里
  const segments = loadTranscriptSegments(video)
  if (segments) {
    const names = getSpeakerNames(id)
    const glossaries = getEffectiveGlossaries(id)
    const fileName = video.bvid || String(video.id)
    const rawParagraphs = buildRawParagraphs(segments).map((para) => ({
      ...para,
      content: decorateText(para.content, glossaries),
    }))
    writeFileSync(join(transcriptDir, `${fileName}.txt`), formatParagraphs(rawParagraphs, names), 'utf8')
    writeFileSync(
      join(transcriptDir, `${fileName}.srt`),
      formatSrt(
        segments.map((seg) => ({ ...seg, text: decorateText(seg.text, glossaries) })),
        names,
      ),
      'utf8',
    )
  }
  return c.json({ ok: true })
})

app.get('/api/videos/:id/artifacts/:ext', (c) => {
  const video = getVideo(Number(c.req.param('id')))
  if (!video) return c.json({ error: '视频不存在' }, 404)
  const ext = c.req.param('ext')
  if (!['txt', 'srt', 'json', 'polished.txt'].includes(ext)) {
    return c.json({ error: '不支持的产物类型' }, 400)
  }
  const segments = loadTranscriptSegments(video)
  const names = getSpeakerNames(video.id)
  const glossaries = getEffectiveGlossaries(video.id)
  const downloadName = video.bvid || `video-${video.id}`
  if (segments) {
    let content
    if (ext === 'srt') {
      content = formatSrt(
        segments.map((seg) => ({ ...seg, text: decorateText(seg.text, glossaries) })),
        names,
      )
    } else if (ext === 'polished.txt') {
      const overrides = getPolishedOverrides(video.id)
      const polishedParagraphs = buildPolishedParagraphs(segments, overrides).map((para) => ({
        ...para,
        content: decorateText(para.content, glossaries),
      }))
      content = formatParagraphs(polishedParagraphs, names)
    } else if (ext === 'txt') {
      const rawParagraphs = buildRawParagraphs(segments).map((para) => ({
        ...para,
        content: decorateText(para.content, glossaries),
      }))
      content = formatParagraphs(rawParagraphs, names)
    } else {
      content = JSON.stringify(segments, null, 2)
    }
    return c.body(content, 200, {
      'Content-Type': ext === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${downloadName}.${ext}"`,
    })
  }
  const path = join(transcriptDir, `${video.bvid || video.id}.${ext}`)
  if (!existsSync(path)) return c.json({ error: '产物不存在' }, 404)
  const contentType =
    ext === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'
  return c.body(readFileSync(path), 200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="video-${id}.${ext}"`,
  })
})

const distDir = join(rootPath, 'web', 'dist')
if (existsSync(join(distDir, 'index.html'))) {
  app.use('*', serveStatic({ root: 'web/dist' }))
  app.get('*', serveStatic({ root: 'web/dist', rewriteRequestPath: () => '/index.html' }))
}

startQueue()

const port = Number(process.env.PORT) || 3000
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`视频转文本管理系统已启动:http://127.0.0.1:${info.port}`)
})
