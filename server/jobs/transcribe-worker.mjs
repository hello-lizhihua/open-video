// 转写编排进程:短音频直接转写;长音频切块并行(每块带接缝重叠),合并后做全局说话人聚类。
// 用法:node transcribe-worker.mjs <fileName(哔哩哔哩ID)> <wavPath> <clusteringJson>
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
process.chdir(rootDir)

const fileName = process.argv[2]
const wavPath = process.argv[3]
let clustering = process.argv[4] === 'false' ? false : process.argv[4] ? JSON.parse(process.argv[4]) : undefined
const seeds = process.argv[5] ? JSON.parse(process.argv[5]) : null
const trimStart = Number(process.argv[6]) || 0
// 有种子时,簇数至少覆盖全部种子
if (seeds && seeds.length > 0) {
  if (!clustering || clustering === false) clustering = { numClusters: seeds.length }
  else clustering.numClusters = Math.max(clustering.numClusters || 0, seeds.length)
}

if (!fileName || !wavPath) {
  console.error('用法:node transcribe-worker.mjs <fileName> <wavPath> [clusteringJson]')
  process.exit(1)
}

const send = (payload) => process.stdout.write(JSON.stringify(payload) + '\n')

const CHUNK_SECONDS = Number(process.env.PV_CHUNK_SECONDS) || 300
const OVERLAP_SECONDS = Number(process.env.PV_OVERLAP_SECONDS) || 20
const PARALLEL_WORKERS = Number(process.env.PV_PARALLEL_WORKERS) || 4
const SAMPLE_RATE = 16000

const { runTranscription } = await import('../jobs/transcribe.js')
const { createLineReader } = await import('../jobs/line-reader.js')
const { ffmpegPath } = await import('../binaries.js')
const { writeArtifacts } = await import('./artifacts.js')
const { assignGlobalSpeakers } = await import('./speaker-cluster.js')

function probeDurationSeconds(path) {
  // ffmpeg -i 把信息写到 stderr
  const result = spawnSync(ffmpegPath(), ['-i', path], { encoding: 'utf8' })
  const match = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(result.stderr || '')
  if (!match) throw new Error('无法读取音频时长')
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function chunkBoundaries(totalSeconds) {
  const step = CHUNK_SECONDS - OVERLAP_SECONDS
  const starts = []
  for (let start = 0; start < totalSeconds; start += step) {
    if (start > 0 && totalSeconds - start <= OVERLAP_SECONDS) break
    starts.push(start)
  }
  return starts
}

function realErrorLine(stderr) {
  const lines = stderr
    .trim()
    .split('\n')
    .filter((line) => line.trim() && !line.includes('trace-warnings') && !line.includes('ExperimentalWarning'))
  return lines[lines.length - 1]
}

function spawnChunkWorker(wavPath, offsetSeconds, clustering) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      join(rootDir, 'jobs', 'transcribe-chunk.mjs'),
      wavPath,
      String(offsetSeconds),
      clustering === false ? 'false' : JSON.stringify(clustering || {}),
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let result = null
    let done = false
    // 按字节缓冲到换行再解码,防止块边界的多字节字符变成替换符
    const readLine = createLineReader((line) => {
      try {
        const payload = JSON.parse(line)
        if (payload.type === 'result') result = payload.segments
        if (payload.type === 'warn') console.error('[chunk]', payload.message)
      } catch {
        // 非进度行忽略
      }
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 30 * 60_000)
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
      if (code === 0 && result) resolve(result)
      else reject(new Error(realErrorLine(stderr) || `分块进程退出码 ${code}`))
    })
  })
}

// 触碰分块边界的分段视为被切断,合并时优先保留完整版本
function edgeTruncated(seg, boundaries) {
  const boundary = boundaries[seg.chunkIndex]
  const chunkEnd = boundary + (seg.chunkIndex === boundaries.length - 1
    ? Infinity
    : CHUNK_SECONDS)
  return seg.start <= boundary + 0.05 || seg.end >= chunkEnd - 0.05
}

function mergeSegments(chunks, starts) {
  const all = []
  chunks.forEach((segments, chunkIndex) => {
    for (const seg of segments) {
      all.push({ ...seg, chunkIndex })
    }
  })
  all.sort((a, b) => a.start - b.start || a.chunkIndex - b.chunkIndex)

  const kept = []
  for (const seg of all) {
    const last = kept[kept.length - 1]
    if (!last) {
      kept.push(seg)
      continue
    }
    const overlap = Math.min(seg.end, last.end) - Math.max(seg.start, last.start)
    const shorter = Math.min(seg.end - seg.start, last.end - last.start)
    if (overlap > 0.55 * shorter) {
      // 接缝重复:优先保留未被切断的;同等则保留更长的
      const segTrunc = edgeTruncated(seg, starts)
      const lastTrunc = edgeTruncated(last, starts)
      if (lastTrunc && !segTrunc) kept[kept.length - 1] = seg
      else if (!lastTrunc && segTrunc) {
        // 保留 last
      } else if (seg.end - seg.start > last.end - last.start) kept[kept.length - 1] = seg
    } else {
      kept.push(seg)
    }
  }

  // 收口:保证时间轴单调,残余重叠做钳位或丢弃
  const monotonic = []
  for (const seg of kept) {
    const last = monotonic[monotonic.length - 1]
    if (!last || seg.start >= last.end - 0.01) {
      monotonic.push(seg)
      continue
    }
    const inside = seg.start >= last.start - 0.2 && seg.end <= last.end + 0.2
    if (inside) continue
    const clamped = { ...seg, start: last.end }
    if (clamped.end - clamped.start > 0.3) monotonic.push(clamped)
  }
  return monotonic
}

async function main() {
  const totalSeconds = probeDurationSeconds(wavPath)
  const effectiveSeconds = totalSeconds - trimStart
  if (effectiveSeconds <= 0) throw new Error('转写起点超过音频时长')
  const starts = chunkBoundaries(effectiveSeconds).map((offset) => offset + trimStart)

  if (starts.length <= 1 && trimStart <= 0) {
    const { segments } = await runTranscription({ id: videoId }, wavPath, {
      clustering,
      onPhase: (phase) => send({ type: 'phase', phase }),
      onProgress: (done, total) => send({ type: 'progress', done, total }),
      noWrite: true,
    })
    writeArtifacts(fileName, segments)
    send({ type: 'done' })
    return
  }

  send({ type: 'phase', phase: 'chunks', total: starts.length })

  // 用 ffmpeg 从原 wav 精确切块(PCM 字节级 seek)
  const workDir = mkdtempSync(join(tmpdir(), 'pv-chunks-'))
  const chunkFiles = []
  try {
    for (let i = 0; i < starts.length; i += 1) {
      const file = join(workDir, `chunk-${i}.wav`)
      const duration = (i === starts.length - 1 ? totalSeconds : starts[i] + CHUNK_SECONDS) - starts[i]
      execFileSync(ffmpegPath(), [
        '-y', '-loglevel', 'error',
        '-ss', String(starts[i]),
        '-i', wavPath,
        '-t', String(duration),
        '-ac', '1', '-ar', '16000',
        file,
      ], { timeout: 300_000 })
      chunkFiles.push(file)
    }

    // 有限并发池
    const results = new Array(starts.length)
    let nextIndex = 0
    let finished = 0
    async function runner() {
      while (nextIndex < starts.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await spawnChunkWorker(chunkFiles[index], starts[index], clustering)
        finished += 1
        send({ type: 'phase', phase: 'chunks', done: finished, total: starts.length })
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL_WORKERS, starts.length) }, () => runner()),
    )

    send({ type: 'phase', phase: 'merge' })
    let merged = mergeSegments(results, starts)

    // 全局说话人聚类:跨分块编号一致
    const labels = assignGlobalSpeakers(merged, {
      numClusters: clustering && clustering.numClusters ? clustering.numClusters : 0,
      threshold: 0.5,
      seeds: seeds || null,
    })
    merged = merged.map((seg, index) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
      speaker: labels[index],
    }))

    writeArtifacts(fileName, merged)
    send({ type: 'done' })
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  send({ type: 'error', message: err && err.message ? err.message : String(err) })
  process.exit(1)
})
