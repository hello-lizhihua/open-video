// 声纹采样子进程：下载完成后对音频做 VAD + 声纹提取 + 贪心聚类，
// 挑出最显著的几个声音（每人一段代表性片段），写入 video_voice_samples。
// 采样不阻塞转写：由下载阶段以 fire-and-forget 方式启动，完成后直接写库。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
process.chdir(rootDir)

const videoId = Number(process.argv[2])
const wavPath = process.argv[3]

if (!videoId || !wavPath) {
  console.error('用法:node voice-sampler.mjs <videoId> <wavPath>')
  process.exit(1)
}

const send = (payload) => process.stdout.write(JSON.stringify(payload) + '\n')

const SAMPLE_RATE = 16000
const WINDOW_SIZE = 512
const MAX_SPEECH_SECONDS = 10
const COS_THRESHOLD = 0.45
const MAX_LEADERS = 8
const MAX_SAMPLES = 4

const sherpa = (await import('sherpa-onnx-node')).default
const { modelPaths, diarizationPaths } = await import('../binaries.js')
const { replaceVoiceSamples } = await import('../db.js')

try {
  const { vad: vadModelPath } = modelPaths()
  const { emb: embModelPath } = diarizationPaths()
  const wave = sherpa.readWave(wavPath)
  const samples = wave.samples

  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: vadModelPath,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.35,
        windowSize: WINDOW_SIZE,
        maxSpeechDuration: MAX_SPEECH_SECONDS,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      debug: 0,
    },
    120,
  )

  const extractor = new sherpa.SpeakerEmbeddingExtractor({
    model: embModelPath,
    numThreads: 1,
    debug: 0,
    provider: 'cpu',
  })
  const stream = extractor.createStream()

  const leaders = [] // {centroid, totalDuration, best:{start,end,duration}}
  const collect = () => {
    while (!vad.isEmpty()) {
      const seg = vad.front()
      vad.pop()
      if (!seg.samples || seg.samples.length < SAMPLE_RATE * 1.0) continue
      stream.acceptWaveform({ samples: seg.samples, sampleRate: SAMPLE_RATE })
      if (!extractor.isReady(stream)) continue
      const embedding = extractor.compute(stream)
      // SpeechSegment 只有 start,结束时间由样本数推算
      const startSec = seg.start / SAMPLE_RATE
      const endSec = (seg.start + seg.samples.length) / SAMPLE_RATE
      const duration = seg.samples.length / SAMPLE_RATE
      let target = null
      let bestScore = -1
      for (const leader of leaders) {
        let dot = 0
        let na = 0
        let nb = 0
        for (let i = 0; i < embedding.length; i += 1) {
          dot += embedding[i] * leader.centroid[i]
          na += embedding[i] * embedding[i]
          nb += leader.centroid[i] * leader.centroid[i]
        }
        const score = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
        if (score > bestScore) {
          bestScore = score
          target = leader
        }
      }
      if (!target || (bestScore < COS_THRESHOLD && leaders.length < MAX_LEADERS)) {
        const leader = {
          centroid: Array.from(embedding),
          totalDuration: duration,
          best: { start: startSec, end: endSec, duration },
        }
        leaders.push(leader)
        target = leader
      } else if (!target) {
        target = leaders[0]
      }
      target.totalDuration += duration
      if (duration > target.best.duration) {
        target.best = { start: startSec, end: endSec, duration }
      }
    }
  }

  for (let offset = 0; offset < samples.length; offset += WINDOW_SIZE) {
    vad.acceptWaveform(samples.slice(offset, offset + WINDOW_SIZE))
    collect()
  }
  vad.flush()
  collect()

  const ranked = [...leaders].sort((a, b) => b.totalDuration - a.totalDuration).slice(0, MAX_SAMPLES)
  const rows = ranked.map((leader, idx) => ({
    idx,
    start: Number(leader.best.start.toFixed(2)),
    end: Number(Math.min(leader.best.end, leader.best.start + 15).toFixed(2)),
    duration: Number(Math.min(leader.best.duration, 15).toFixed(2)),
    centroid: leader.centroid.map((value) => Number(value.toFixed(5))),
  }))
  replaceVoiceSamples(videoId, rows)
  send({ type: 'done', samples: rows.map(({ centroid, ...rest }) => rest) })
} catch (err) {
  console.error(err)
  send({ type: 'error', message: err && err.message ? err.message : String(err) })
  process.exit(1)
}
