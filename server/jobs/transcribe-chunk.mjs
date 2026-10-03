// 分块转写子进程:对一块 wav 做本地分离与识别,为每个分段提取声纹,输出 JSON 行。
// 用法:node transcribe-chunk.mjs <wavPath> <offsetSeconds> <clusteringJson|"false">
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
process.chdir(rootDir)

const wavPath = process.argv[2]
const offsetSeconds = Number(process.argv[3])
const clusteringArg = process.argv[4]

if (!wavPath || Number.isNaN(offsetSeconds)) {
  console.error('用法:node transcribe-chunk.mjs <wavPath> <offsetSeconds> <clusteringJson|"false">')
  process.exit(1)
}
const clustering = clusteringArg === 'false' ? false : clusteringArg ? JSON.parse(clusteringArg) : undefined

const send = (payload) => process.stdout.write(JSON.stringify(payload) + '\n')

const sherpa = (await import('sherpa-onnx-node')).default
const { runTranscription } = await import('../jobs/transcribe.js')
const { diarizationPaths } = await import('../binaries.js')

const SAMPLE_RATE = 16000

try {
  const { segments } = await runTranscription(
    { id: 0 },
    wavPath,
    { noWrite: true, clustering, onProgress: () => {} },
  )

  // 为每个分段提取声纹(后续全局聚类用);时长过短的分段没有稳定声纹
  const paths = diarizationPaths()
  let extractor = null
  if (paths) {
    try {
      extractor = new sherpa.SpeakerEmbeddingExtractor({
        model: paths.emb,
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      })
    } catch (err) {
      send({ type: 'warn', message: `声纹提取器初始化失败:${err.message}` })
    }
  }

  const samples = extractor ? sherpa.readWave(wavPath).samples : null
  const stream = extractor ? extractor.createStream() : null

  const output = []
  for (const seg of segments) {
    let embedding = null
    if (extractor && stream) {
      // 分段时间是分块内的局部时间,直接用于切片
      const startSample = Math.max(0, Math.round(seg.start * SAMPLE_RATE))
      const endSample = Math.min(samples.length, Math.round(seg.end * SAMPLE_RATE))
      if (endSample - startSample > SAMPLE_RATE * 0.5) {
        try {
          stream.acceptWaveform({ samples: samples.slice(startSample, endSample), sampleRate: SAMPLE_RATE })
          if (extractor.isReady(stream)) {
            embedding = Array.from(extractor.compute(stream))
          }
        } catch {
          embedding = null
        }
      }
    }
    // 输出全局时间(加上分块偏移)
    output.push({
      start: seg.start + offsetSeconds,
      end: seg.end + offsetSeconds,
      text: seg.text,
      speaker: seg.speaker,
      embedding,
    })
  }
  send({ type: 'result', segments: output })
  send({ type: 'done' })
} catch (err) {
  console.error(err)
  send({ type: 'error', message: err && err.message ? err.message : String(err) })
  process.exit(1)
}
