import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根目录:从当前目录向上查找 pnpm-workspace.yaml(workspace 拆分后本包位于 packages/server)
function findWorkspaceRoot(startDir) {
  let dir = startDir
  while (dir !== '/' && !existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    dir = dirname(dir)
  }
  return dir
}
const rootDir = findWorkspaceRoot(dirname(fileURLToPath(import.meta.url)))

export const rootPath = rootDir
export const dataDir = join(rootDir, 'data')
export const audioDir = join(dataDir, 'audio')
export const transcriptDir = join(dataDir, 'transcripts')

mkdirSync(audioDir, { recursive: true })
mkdirSync(transcriptDir, { recursive: true })

export const db = new DatabaseSync(join(dataDir, 'app.db'))

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

// 迁移:移除讲述人分段统计与构建说明列(索引类数据,不稳定且无需关注);列已不存在时忽略
try {
  db.exec('ALTER TABLE video_sections_overview DROP COLUMN speakers')
} catch {
  // 新建库或已迁移
}
try {
  db.exec('ALTER TABLE video_sections_overview DROP COLUMN notes')
} catch {
  // 新建库或已迁移
}
// 迁移:补视频原始发布时间列(检测下载时从哔哩哔哩页面元数据读取)
try {
  db.exec('ALTER TABLE videos ADD COLUMN source_published_at TEXT')
} catch {
  // 新建库或列已存在
}

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    source_published_at TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    error TEXT,
    audio_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS video_speakers (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    spk INTEGER NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (video_id, spk)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_polished (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (video_id, hash)
  );

  CREATE TABLE IF NOT EXISTS video_chapters (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL,
    hash_start TEXT NOT NULL,
    hash_end TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (video_id, ord)
  );

  CREATE TABLE IF NOT EXISTS video_glossaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    misread TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS global_glossaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL DEFAULT '',
    term TEXT NOT NULL,
    misread TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS glossary_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    ord INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS video_voice_samples (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    start REAL NOT NULL,
    end REAL NOT NULL,
    duration REAL NOT NULL,
    centroid TEXT NOT NULL,
    PRIMARY KEY (video_id, idx)
  );

  CREATE TABLE IF NOT EXISTS video_samples_confirmed (
    video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    confirmed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS test_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS test_case_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    ord INTEGER NOT NULL DEFAULT 0
  );

  -- 章节结构(来自 section.xml 挂载):概述与每章的分析信息。
  -- 段落本体不导入(转写已有),章节边界与重要段落只存 hash 锚点。
  -- 讲述人分段统计、构建说明等索引类数据不入库:与转写切块相关,不稳定且无需关注。
  CREATE TABLE IF NOT EXISTS video_sections_overview (
    video_id INTEGER PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    summary TEXT NOT NULL DEFAULT '',
    mounted_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS video_sections (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL,
    title TEXT NOT NULL,
    hash_start TEXT NOT NULL,
    hash_end TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    points TEXT NOT NULL DEFAULT '[]',
    marks TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (video_id, ord)
  );
`)

// 轻量迁移:视频列扩展与测试用例列扩展(统一在此声明列清单)
const videoColumns = db.prepare(`PRAGMA table_info(videos)`).all().map((row) => row.name)
const testCaseColumns = db.prepare('PRAGMA table_info(test_cases)').all().map((row) => row.name)
if (!testCaseColumns.includes('video_id')) {
  db.exec('ALTER TABLE test_cases ADD COLUMN video_id INTEGER')
}
if (!testCaseColumns.includes('config')) {
  db.exec("ALTER TABLE test_cases ADD COLUMN config TEXT NOT NULL DEFAULT '{}'")
}
if (!testCaseColumns.includes('expected')) {
  db.exec('ALTER TABLE test_cases ADD COLUMN expected TEXT NOT NULL DEFAULT \'\'')
}
if (!testCaseColumns.includes('last_run')) {
  db.exec('ALTER TABLE test_cases ADD COLUMN last_run TEXT')
}
if (!testCaseColumns.includes('group_name')) {
  db.exec("ALTER TABLE test_cases ADD COLUMN group_name TEXT NOT NULL DEFAULT ''")
}
if (!videoColumns.includes('trim_start_seconds')) {
  db.exec('ALTER TABLE videos ADD COLUMN trim_start_seconds REAL NOT NULL DEFAULT 0')
}
if (!videoColumns.includes('num_speakers')) {
  db.exec('ALTER TABLE videos ADD COLUMN num_speakers INTEGER NOT NULL DEFAULT 0')
}
if (!videoColumns.includes('duration_seconds')) {
  db.exec('ALTER TABLE videos ADD COLUMN duration_seconds INTEGER')
}
if (!videoColumns.includes('display_name')) {
  db.exec('ALTER TABLE videos ADD COLUMN display_name TEXT')
}
if (!videoColumns.includes('bvid')) {
  db.exec('ALTER TABLE videos ADD COLUMN bvid TEXT')
}
if (!videoColumns.includes('video_type')) {
  db.exec("ALTER TABLE videos ADD COLUMN video_type TEXT NOT NULL DEFAULT 'unknown'")
}

// 轻量迁移:词汇表分类(全局与视频级共用左分类右表格布局,视频级词条同样带分类)
const videoGlossaryColumns = db.prepare('PRAGMA table_info(video_glossaries)').all().map((row) => row.name)
if (!videoGlossaryColumns.includes('category')) {
  db.exec("ALTER TABLE video_glossaries ADD COLUMN category TEXT NOT NULL DEFAULT ''")
}

export function getPolishedOverrides(videoId) {
  const rows = db
    .prepare('SELECT hash, content FROM video_polished WHERE video_id = ?')
    .all(videoId)
  const overrides = {}
  for (const row of rows) overrides[row.hash] = row.content
  return overrides
}

export function setPolishedOverride(videoId, hash, content) {
  db.prepare(
    `INSERT INTO video_polished (video_id, hash, content) VALUES (?, ?, ?)
    ON CONFLICT(video_id, hash) DO UPDATE SET content = excluded.content,
      updated_at = datetime('now','localtime')`,
  ).run(videoId, hash, content)
}

export function deletePolishedOverride(videoId, hash) {
  db.prepare('DELETE FROM video_polished WHERE video_id = ? AND hash = ?').run(videoId, hash)
}

export function getGlossaries(videoId) {
  return db
    .prepare('SELECT id, category, term, misread, note FROM video_glossaries WHERE video_id = ? ORDER BY id')
    .all(videoId)
}

export function addGlossary(videoId, term, misread, note, category = '') {
  // 按词条去重:已存在则合并(保留原误识别词与说明,补充新内容)
  const existing = db
    .prepare('SELECT id, category, misread, note FROM video_glossaries WHERE video_id = ? AND term = ?')
    .get(videoId, term)
  if (existing) {
    const misreads = new Set(
      [existing.misread, misread]
        .flatMap((value) => String(value || '').split('|'))
        .map((value) => value.trim())
        .filter(Boolean),
    )
    const mergedMisread = [...misreads].join('|')
    const mergedNote = [existing.note, note].filter(Boolean).join('；')
    db.prepare('UPDATE video_glossaries SET category = ?, misread = ?, note = ? WHERE id = ?').run(
      category || existing.category,
      mergedMisread,
      mergedNote,
      existing.id,
    )
    return existing.id
  }
  const result = db
    .prepare('INSERT INTO video_glossaries (video_id, category, term, misread, note) VALUES (?, ?, ?, ?, ?)')
    .run(videoId, category || '', term, misread || '', note || '')
  return Number(result.lastInsertRowid)
}

export function updateGlossary(videoId, id, { category, term, misread, note }) {
  const existing = db
    .prepare('SELECT id FROM video_glossaries WHERE video_id = ? AND id = ?')
    .get(videoId, id)
  if (!existing) return false
  db.prepare(
    'UPDATE video_glossaries SET category = ?, term = ?, misread = ?, note = ? WHERE id = ?',
  ).run(category || '', term, misread || '', note || '', id)
  return true
}

// 视频级分类增删改:分类由词条聚合而来,改名/删除只作用于该视频的词条
export function renameVideoGlossaryCategory(videoId, oldName, newName) {
  db.prepare('UPDATE video_glossaries SET category = ? WHERE video_id = ? AND category = ?').run(
    newName,
    videoId,
    oldName,
  )
}

export function clearVideoGlossaryCategory(videoId, name) {
  db.prepare("UPDATE video_glossaries SET category = '' WHERE video_id = ? AND category = ?").run(
    videoId,
    name,
  )
}

export function deleteGlossary(videoId, id) {
  db.prepare('DELETE FROM video_glossaries WHERE video_id = ? AND id = ?').run(videoId, id)
}

// 全局词汇表:跨视频生效,带分类;与视频级词条合并后统一替换
export function getGlobalGlossaries() {
  return db
    .prepare('SELECT id, category, term, misread, note FROM global_glossaries ORDER BY id')
    .all()
}

export function addGlobalGlossary(category, term, misread, note) {
  // 按词条去重:已存在则合并误识别词与说明,并更新分类
  const existing = db.prepare('SELECT id, category, misread, note FROM global_glossaries WHERE term = ?').get(term)
  if (existing) {
    const misreads = new Set(
      [existing.misread, misread]
        .flatMap((value) => String(value || '').split('|'))
        .map((value) => value.trim())
        .filter(Boolean),
    )
    const mergedNote = [existing.note, note].filter(Boolean).join('；')
    db.prepare('UPDATE global_glossaries SET category = ?, misread = ?, note = ? WHERE id = ?').run(
      category || existing.category,
      [...misreads].join('|'),
      mergedNote,
      existing.id,
    )
    return existing.id
  }
  const result = db
    .prepare('INSERT INTO global_glossaries (category, term, misread, note) VALUES (?, ?, ?, ?)')
    .run(category || '', term, misread || '', note || '')
  return Number(result.lastInsertRowid)
}

export function updateGlobalGlossary(id, { category, term, misread, note }) {
  const existing = db.prepare('SELECT id FROM global_glossaries WHERE id = ?').get(id)
  if (!existing) return false
  db.prepare('UPDATE global_glossaries SET category = ?, term = ?, misread = ?, note = ? WHERE id = ?').run(
    category || '',
    term,
    misread || '',
    note || '',
    id,
  )
  return true
}

export function deleteGlobalGlossary(id) {
  db.prepare('DELETE FROM global_glossaries WHERE id = ?').run(id)
}

export function getGlossaryCategories() {
  return db
    .prepare('SELECT id, name, ord FROM glossary_categories ORDER BY ord, id')
    .all()
}

export function addGlossaryCategory(name) {
  const result = db
    .prepare('INSERT INTO glossary_categories (name, ord) VALUES (?, (SELECT COALESCE(MAX(ord), 0) + 1 FROM glossary_categories))')
    .run(name)
  return Number(result.lastInsertRowid)
}

export function renameGlossaryCategory(oldName, newName) {
  db.prepare('UPDATE glossary_categories SET name = ? WHERE name = ?').run(newName, oldName)
  db.prepare('UPDATE global_glossaries SET category = ? WHERE category = ?').run(newName, oldName)
}

export function deleteGlossaryCategory(name) {
  // 删除分类不删词条:词条回到未分类
  db.prepare('DELETE FROM glossary_categories WHERE name = ?').run(name)
  db.prepare("UPDATE global_glossaries SET category = '' WHERE category = ?").run(name)
}

// 生效词汇表 = 全局 + 视频级;替换按误识别词匹配,两级并存不冲突
export function getEffectiveGlossaries(videoId) {
  const globalRows = getGlobalGlossaries().map((row) => ({
    id: `g${row.id}`,
    term: row.term,
    misread: row.misread,
    note: row.note,
    category: row.category,
    scope: 'global',
  }))
  const videoRows = db
    .prepare('SELECT id, term, misread, note FROM video_glossaries WHERE video_id = ? ORDER BY id')
    .all(videoId)
    .map((row) => ({ ...row, scope: 'video' }))
  return [...globalRows, ...videoRows]
}

export function getChapters(videoId) {
  return db
    .prepare('SELECT ord, hash_start AS hashStart, hash_end AS hashEnd, title FROM video_chapters WHERE video_id = ? ORDER BY ord')
    .all(videoId)
}

export function setChapters(videoId, chapters) {
  db.prepare('DELETE FROM video_chapters WHERE video_id = ?').run(videoId)
  chapters.forEach((chapter, ord) => {
    db.prepare(
      'INSERT INTO video_chapters (video_id, ord, hash_start, hash_end, title) VALUES (?, ?, ?, ?, ?)',
    ).run(videoId, ord, chapter.hashStart, chapter.hashEnd, chapter.title)
  })
}

// 章节结构挂载:整体替换式写入(先清后插,与 setChapters 同风格)
export function getVideoSections(videoId) {
  const overview = db
    .prepare('SELECT summary, mounted_at AS mountedAt FROM video_sections_overview WHERE video_id = ?')
    .get(videoId)
  const sections = db
    .prepare(
      `SELECT ord, title, hash_start AS hashStart, hash_end AS hashEnd, summary, points, marks
       FROM video_sections WHERE video_id = ? ORDER BY ord`,
    )
    .all(videoId)
    .map((row) => ({
      ord: row.ord,
      title: row.title,
      hashStart: row.hashStart,
      hashEnd: row.hashEnd,
      summary: row.summary,
      points: JSON.parse(row.points),
      marks: JSON.parse(row.marks),
    }))
  return { overview: overview || null, sections }
}

export function mountVideoSections(videoId, { overview, sections }) {
  db.prepare('DELETE FROM video_sections_overview WHERE video_id = ?').run(videoId)
  db.prepare('DELETE FROM video_sections WHERE video_id = ?').run(videoId)
  db.prepare(
    'INSERT INTO video_sections_overview (video_id, summary) VALUES (?, ?)',
  ).run(videoId, overview.summary)
  sections.forEach((section) => {
    db.prepare(
      `INSERT INTO video_sections (video_id, ord, title, hash_start, hash_end, summary, points, marks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      videoId,
      section.ord,
      section.title,
      section.hashStart,
      section.hashEnd,
      section.summary,
      JSON.stringify(section.points),
      JSON.stringify(section.marks),
    )
  })
}

export function clearVideoSections(videoId) {
  db.prepare('DELETE FROM video_sections_overview WHERE video_id = ?').run(videoId)
  db.prepare('DELETE FROM video_sections WHERE video_id = ?').run(videoId)
}

export function setVideoBvid(videoId, bvid) {
  db.prepare(`UPDATE videos SET bvid = ? WHERE id = ?`).run(bvid, videoId)
}

// 声纹样本：下载后采样、用户试听确认后作为转写聚类的种子与讲述人名称来源
export function replaceVoiceSamples(videoId, samples) {
  db.prepare('DELETE FROM video_voice_samples WHERE video_id = ?').run(videoId)
  for (const sample of samples) {
    db.prepare(
      'INSERT INTO video_voice_samples (video_id, idx, start, end, duration, centroid) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(videoId, sample.idx, sample.start, sample.end, sample.duration, JSON.stringify(sample.centroid))
  }
  db.prepare('DELETE FROM video_samples_confirmed WHERE video_id = ?').run(videoId)
}

export function getVoiceSamples(videoId) {
  return db
    .prepare('SELECT idx, start, end, duration, centroid FROM video_voice_samples WHERE video_id = ? ORDER BY idx')
    .all(videoId)
    .map((row) => ({ ...row, centroid: JSON.parse(row.centroid) }))
}

export function confirmVoiceSamples(videoId) {
  db.prepare(
    `INSERT INTO video_samples_confirmed (video_id) VALUES (?)
    ON CONFLICT(video_id) DO UPDATE SET confirmed_at = datetime('now','localtime')`,
  ).run(videoId)
}

export function samplesConfirmed(videoId) {
  return Boolean(db.prepare('SELECT video_id FROM video_samples_confirmed WHERE video_id = ?').get(videoId))
}

export function getTestCase(id) {
  return db.prepare('SELECT * FROM test_cases WHERE id = ?').get(id)
}

export function updateTestCaseRun(id, lastRun) {
  db.prepare(
    `UPDATE test_cases SET last_run = ?, status = CASE WHEN status = 'pending' THEN 'pending' ELSE status END,
      updated_at = datetime('now','localtime') WHERE id = ?`,
  ).run(JSON.stringify(lastRun), id)
}

// 测试组:同组用例整合多个时间段的音频一起验证一类识别能力。
// 组名独立成表(支持先建空组),同时聚合用例上的 group_name 计数。
export function getTestCaseGroupRows() {
  return db
    .prepare('SELECT id, name FROM test_case_groups ORDER BY ord, id')
    .all()
}

export function addTestCaseGroupRow(name) {
  const result = db
    .prepare('INSERT INTO test_case_groups (name, ord) VALUES (?, (SELECT COALESCE(MAX(ord), 0) + 1 FROM test_case_groups))')
    .run(name)
  return Number(result.lastInsertRowid)
}

export function renameTestCaseGroup(oldName, newName) {
  db.prepare('UPDATE test_case_groups SET name = ? WHERE name = ?').run(newName, oldName)
  db.prepare('UPDATE test_cases SET group_name = ? WHERE group_name = ?').run(newName, oldName)
}

export function deleteTestCaseGroup(name) {
  // 删除组不删用例:组内用例回到未分组
  db.prepare('DELETE FROM test_case_groups WHERE name = ?').run(name)
  db.prepare("UPDATE test_cases SET group_name = '' WHERE group_name = ?").run(name)
}

export function getTestCasesByGroup(group) {
  return db
    .prepare('SELECT * FROM test_cases WHERE group_name = ? ORDER BY id')
    .all(group)
}

export function getTestCaseGroups() {
  const rows = db
    .prepare("SELECT group_name AS name, COUNT(*) AS count FROM test_cases WHERE group_name != '' GROUP BY group_name")
    .all()
  const counts = new Map(rows.map((row) => [row.name, row.count]))
  for (const row of getTestCaseGroupRows()) {
    if (!counts.has(row.name)) counts.set(row.name, 0)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : null
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

export function deleteSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

export function getSpeakerNames(videoId) {
  const rows = db
    .prepare('SELECT spk, name FROM video_speakers WHERE video_id = ?')
    .all(videoId)
  const names = {}
  for (const row of rows) names[row.spk] = row.name
  return names
}

export function setSpeakerName(videoId, spk, name) {
  db.prepare(
    `INSERT INTO video_speakers (video_id, spk, name) VALUES (?, ?, ?)
    ON CONFLICT(video_id, spk) DO UPDATE SET name = excluded.name`,
  ).run(videoId, spk, name)
}

export function setVideo(videoId, fields) {
  const keys = Object.keys(fields)
  if (keys.length === 0) return
  const assignments = keys.map((key) => `${key} = ?`).join(', ')
  db.prepare(
    `UPDATE videos SET ${assignments}, updated_at = datetime('now','localtime') WHERE id = ?`,
  ).run(...keys.map((key) => fields[key]), videoId)
}

export function getVideo(videoId) {
  return db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId)
}

export function getJob(jobId) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId)
}

export function setJob(jobId, fields) {
  const keys = Object.keys(fields)
  if (keys.length === 0) return
  const assignments = keys.map((key) => `${key} = ?`).join(', ')
  db.prepare(`UPDATE jobs SET ${assignments} WHERE id = ?`).run(
    ...keys.map((key) => fields[key]),
    jobId,
  )
}

export function setVideoDisplayName(videoId, name) {
  db.prepare(
    `UPDATE videos SET display_name = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
  ).run(name, videoId)
}
