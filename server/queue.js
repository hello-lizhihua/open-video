import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audioDir, db, getJob, getSpeakerNames, getVideo, getVoiceSamples, rootPath, samplesConfirmed, setJob, setVideo } from './db.js'
import { downloadAudio, fetchMetadata, prepareAudio, probeWavDuration, publishedAtFromMetadata, toWav } from './jobs/download.js'
import { seedsFromSamples } from './jobs/speaker-cluster.js'
import { createLineReader } from './jobs/line-reader.js'

const WORKER_PATH = join(rootPath, 'server', 'jobs', 'transcribe-worker.mjs')
const SAMPLER_PATH = join(rootPath, 'server', 'jobs', 'voice-sampler.mjs')

const MAX_DOWNLOAD_JOBS = 2
const MAX_TRANSCRIBE_JOBS = 1

const running = new Set()
let ticking = false

function claimNext(kindSql, excludeIds) {
  const ids = excludeIds.length > 0 ? excludeIds : [-1]
  const placeholders = ids.map(() => '?').join(', ')
  const sql = `
    SELECT * FROM jobs
    WHERE status = 'queued' AND kind IN (${kindSql})
      AND id NOT IN (${placeholders})
    ORDER BY id
    LIMIT 1
  `
  return db.prepare(sql).get(...ids)
}

// 进度写库限频,避免高频覆盖同一行
function makeReporter(jobId) {
  let last = 0
  return (message) => {
    const now = Date.now()
    if (now - last < 900) return
    last = now
    try {
      setJob(jobId, { message })
    } catch {
      // 进度非关键路径,失败不影响任务
    }
  }
}

async function runDownloadPhase(video, report) {
  report('解析视频信息中…')
  const metadata = await fetchMetadata(video.url)
  // 原始标题、BV Hash 与原始发布时间都来自哔哩哔哩页面元数据
  setVideo(video.id, {
    title: metadata.title,
    bvid: metadata.id || null,
    source_published_at: publishedAtFromMetadata(metadata),
  })
  const fileName = metadata.id || video.bvid
  if (!fileName) throw new Error('无法确定哔哩哔哩 ID')
  report('下载音频中…')
  const audioFile = await downloadAudio(fileName, video.url, {
    onProgress: (pct) => report(`下载音频 ${pct}%`),
  })
  report('解码音频中…')
  const wavPath = await toWav(audioFile, fileName)
  const durationSeconds = probeWavDuration(wavPath)
  if (durationSeconds) setVideo(video.id, { duration_seconds: durationSeconds })
  // 声纹采样不阻塞转写:fire-and-forget,完成后写库,小红点亮起等用户确认
  if ((video.video_type || 'unknown') !== 'solo') {
    const sampler = spawn(process.execPath, [SAMPLER_PATH, String(video.id), wavPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
    })
    let samplerErr = ''
    sampler.stderr.on('data', (chunk) => {
      samplerErr += chunk.toString()
    })
    sampler.on('close', (code) => {
      if (code !== 0) console.error(`[sampler ${video.id}] 采样失败:`, samplerErr.trim().split('\n').pop())
      else console.log(`[sampler ${video.id}] 声纹样本就绪`)
    })
  }
  return wavPath
}

// 语音识别与说话人分离是长时阻塞的原生计算,放子进程执行,服务进程保持响应
function runTranscribeWorker(video, wavPath, report) {
  report('切分音频中…')
  const fileName = video.bvid
  if (!fileName) throw new Error('视频缺少哔哩哔哩 ID,无法写出产物')
  const videoType = video.video_type || 'unknown'
  // 个人录屏跳过说话人分离:更快更准;连麦与未知类型按人数/阈值分离
  const clustering =
    videoType === 'solo'
      ? false
      : video.num_speakers > 0
        ? { numClusters: video.num_speakers }
        : { threshold: 0.5 }
  // 用户确认过的声纹样本作为聚类种子:按人名合并质心,全局编号与命名顺序一致
  let seeds = null
  if (videoType !== 'solo' && samplesConfirmed(video.id)) {
    const names = getSpeakerNames(video.id)
    seeds = seedsFromSamples(getVoiceSamples(video.id), names)
    if (seeds.length === 0) seeds = null
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      WORKER_PATH,
      fileName,
      wavPath,
      JSON.stringify(clustering),
      seeds ? JSON.stringify(seeds) : '',
      String(video.trim_start_seconds || 0),
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let done = false
    const timer = setTimeout(() => child.kill('SIGKILL'), 60 * 60_000)
    // 按字节缓冲到换行再解码,防止块边界的多字节字符变成替换符
    const readLine = createLineReader((line) => {
      try {
        const payload = JSON.parse(line)
        if (payload.type === 'phase') {
          if (payload.phase === 'diarize') report('说话人分离中…')
          if (payload.phase === 'merge') report('合并与全局说话人聚类中…')
          if (payload.phase === 'chunks') {
            report(
              payload.done
                ? `并行转写 ${payload.done}/${payload.total} 块…`
                : `并行转写准备中(共 ${payload.total} 块)…`,
            )
          }
        }
        if (payload.type === 'progress') report(`语音识别中 ${payload.done}/${payload.total} 段`)
        if (payload.type === 'write') report('生成产物中…')
      } catch {
        // 非进度行忽略
      }
    })
    child.stdout.on('data', (chunk) => readLine(chunk))
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim().split('\n').filter(Boolean).pop() || `转写子进程退出码 ${code}`))
      }
    })
  })
}

async function runTranscribePhase(video, wavPath, report) {
  return runTranscribeWorker(video, wavPath, report)
}

async function executeJob(job) {
  const video = getVideo(job.video_id)
  if (!video) {
    setJob(job.id, { status: 'failed', message: '视频不存在', finished_at: datetimeNow() })
    return
  }
  const report = makeReporter(job.id)

  try {
    if (job.kind === 'download') {
      setVideo(video.id, { status: 'downloading', error: null })
      const wavPath = await runDownloadPhase(video, report)
      setVideo(video.id, { status: 'audioReady', audio_path: wavPath })
    } else if (job.kind === 'transcribe') {
      setVideo(video.id, { status: 'transcribing', error: null })
      report('准备音频中…')
      let target = video
      if (!target.bvid) {
        report('解析视频信息中…')
        const metadata = await fetchMetadata(target.url)
        setVideo(target.id, {
          bvid: metadata.id || null,
          title: metadata.title,
          source_published_at: publishedAtFromMetadata(metadata),
        })
        target = { ...target, bvid: metadata.id }
      }
      const wavPath = await prepareAudio(target)
      const fresh = getVideo(video.id)
      await runTranscribePhase({ ...fresh, bvid: fresh.bvid || target.bvid }, wavPath, report)
      setVideo(video.id, { status: 'done' })
    } else if (job.kind === 'pipeline') {
      setVideo(video.id, { status: 'downloading', error: null })
      const wavPath = await runDownloadPhase(video, report)
      setVideo(video.id, { status: 'transcribing', audio_path: wavPath })
      const fresh = getVideo(video.id)
      await runTranscribePhase(fresh, wavPath, report)
      setVideo(video.id, { status: 'done' })
    } else {
      throw new Error(`未知任务类型:${job.kind}`)
    }
    setJob(job.id, { status: 'done', message: null, finished_at: datetimeNow() })
  } catch (err) {
    console.error(`[job ${job.id}] 执行失败:`, err)
    const message = err && err.message ? err.message : String(err)
    setJob(job.id, { status: 'failed', message, finished_at: datetimeNow() })
    setVideo(video.id, { status: 'failed', error: message })
  }
}

function tryClaim() {
  const runningJobs = [...running].map((id) => getJob(id)).filter(Boolean)
  const downloadRunning = runningJobs.filter((job) => job.kind === 'download').length
  const transcribeRunning = runningJobs.filter((job) => job.kind !== 'download').length

  const claims = []
  if (downloadRunning < MAX_DOWNLOAD_JOBS) {
    const job = claimNext("'download'", [...running])
    if (job) claims.push(job)
  }
  if (transcribeRunning < MAX_TRANSCRIBE_JOBS) {
    const job = claimNext("'transcribe', 'pipeline'", [...running])
    if (job) claims.push(job)
  }

  for (const job of claims) {
    const result = db
      .prepare(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`)
      .run(datetimeNow(), job.id)
    if (result.changes !== 1) continue
    running.add(job.id)
    executeJob(job)
      .catch(() => {})
      .finally(() => {
        running.delete(job.id)
        setTimeout(tick, 0)
      })
  }
  return claims.length > 0
}

function tick() {
  if (ticking) return
  ticking = true
  try {
    while (tryClaim()) {
      // 循环认领,直到无法认领新任务
    }
  } finally {
    ticking = false
  }
}

export function startQueue() {
  // 服务重启后,把上次中断的任务放回队列
  db.prepare(`UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'`).run()
  db.prepare(`UPDATE videos SET status = 'queued' WHERE status IN ('downloading', 'transcribing')`).run()
  setInterval(tick, 800)
  setTimeout(tick, 0)
}

export function enqueueJob(videoId, kind) {
  // 新任务取代该视频还在排队的旧任务,避免按钮连点造成堆积
  db.prepare(`DELETE FROM jobs WHERE video_id = ? AND status = 'queued'`).run(videoId)
  const result = db
    .prepare(`INSERT INTO jobs (video_id, kind) VALUES (?, ?)`)
    .run(videoId, kind)
  setVideo(videoId, { status: 'queued', error: null })
  setTimeout(tick, 0)
  return result.lastInsertRowid
}

function datetimeNow() {
  return new Date().toLocaleString('sv-SE').replace('T', ' ')
}
