// 测试用例执行子进程:按用例配置截取时间段音频转写,产出使用前/使用后两份转写文档写入 last_run。
// 使用前 = 从 0 开始且不做词汇表替换(基准,预期暴露问题);使用后 = 按配置(截断 + 词汇表)。
// 用法:node testcase-runner.mjs <caseId...>;多个用例顺序执行,用于测试组整合多时间段。
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
process.chdir(rootDir)

const caseIds = process.argv.slice(2).map(Number).filter(Boolean)
if (caseIds.length === 0) {
  console.error('用法:node testcase-runner.mjs <caseId...>')
  process.exit(1)
}

const send = (payload) => process.stdout.write(JSON.stringify(payload) + '\n')

const SAMPLE_RATE = 16000
const {
  getTestCase,
  getVideo,
  getSpeakerNames,
  getEffectiveGlossaries,
  getVoiceSamples,
  samplesConfirmed,
  updateTestCaseRun,
} = await import('../db.js')
const { diarizationPaths, ffmpegPath } = await import('../binaries.js')
const { prepareAudio } = await import('../download.js')
const { runTranscription } = await import('./transcribe.js')
const { buildRawParagraphs, buildPolishedParagraphs } = await import('./paragraphs.js')
const { decorateText, formatParagraphs, formatSrt } = await import('./transcript-format.js')
const { spaceText } = await import('./cjk-space.js')
const { assignGlobalSpeakers, seedsFromSamples } = await import('./speaker-cluster.js')
const sherpa = (await import('sherpa-onnx-node')).default



async function transcribeVariant({ caseId, videoId, wavPath, start, duration, numSpeakers, useGlossary, glossaries, names }) {
  const clipPath = `/tmp/pv-testcase-${caseId}-${start}-${duration}.wav`
  execFileSync(
    ffmpegPath(),
    ['-y', '-loglevel', 'error', '-ss', String(start), '-t', String(duration), '-i', wavPath,
      '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', clipPath],
    { timeout: 300_000 },
  )
  const { segments } = await runTranscription({ id: `testcase-${caseId}` }, clipPath, {
    noWrite: true,
    clustering: numSpeakers > 0 ? { numClusters: numSpeakers } : { threshold: 0.5 },
    onProgress: () => {},
  })

  // 讲述人一致性:有确认样本时以人名合并后的种子做全局聚类,编号与命名顺序一致
  let effective = segments
  if (numSpeakers > 0 && samplesConfirmed(videoId)) {
    const withEmbedding = []
    const paths = diarizationPaths()
    if (paths) {
      const extractor = new sherpa.SpeakerEmbeddingExtractor({
        model: paths.emb,
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      })
      const stream = extractor.createStream()
      const samples = sherpa.readWave(clipPath).samples
      for (const seg of segments) {
        const startSample = Math.max(0, Math.round(seg.start * SAMPLE_RATE))
        const endSample = Math.min(samples.length, Math.round(seg.end * SAMPLE_RATE))
        if (endSample - startSample > SAMPLE_RATE * 0.5) {
          try {
            stream.acceptWaveform({ samples: samples.slice(startSample, endSample), sampleRate: SAMPLE_RATE })
            if (extractor.isReady(stream)) {
              withEmbedding.push({ seg, embedding: extractor.compute(stream) })
            }
          } catch {
            // 声纹失败的分段走默认归属
          }
        }
      }
      if (withEmbedding.length > 0) {
        // 种子按人名合并,簇数即命名人数;分段必须带上 embedding,否则聚类拿不到声纹会全部塌到 0 号
        const seeds = seedsFromSamples(getVoiceSamples(videoId), getSpeakerNames(videoId))
        const labels = assignGlobalSpeakers(
          withEmbedding.map((item) => ({ ...item.seg, embedding: item.embedding })),
          {
            numClusters: seeds.length > 0 ? seeds.length : numSpeakers,
            seeds: seeds.length > 0 ? seeds : null,
          },
        )
        withEmbedding.forEach((item, index) => {
          item.seg.speaker = labels[index]
        })
        effective = withEmbedding.map((item) => item.seg)
      }
    }
  }

  const glossariesForVariant = useGlossary ? glossaries : []
  const rawParagraphs = buildRawParagraphs(effective).map((para) => ({
    ...para,
    content: decorateText(para.content, glossariesForVariant),
  }))
  const polishedParagraphs = buildPolishedParagraphs(effective).map((para) => ({
    ...para,
    content: decorateText(para.content, glossariesForVariant),
  }))
  return {
    document: formatParagraphs(rawParagraphs, names),
    polished: formatParagraphs(polishedParagraphs, names),
    srt: formatSrt(
      effective.map((seg) => ({ ...seg, text: decorateText(seg.text, glossariesForVariant) })),
      names,
    ),
  }
}

async function runCase(caseId) {
  const testCase = getTestCase(caseId)
  if (!testCase || !testCase.video_id) {
    updateTestCaseRun(caseId, { at: new Date().toLocaleString('sv-SE').replace('T', ' '), error: '用例不存在或未关联视频' })
    return
  }
  const config = JSON.parse(testCase.config || '{}')
  const video = getVideo(testCase.video_id)
  const videoId = video.id
  const glossaries = getEffectiveGlossaries(videoId)
  const names = getSpeakerNames(videoId)
  // 音频定位与主管线一致:按 BV 号找本地 wav,本地没有才触发下载
  const wavPath = await prepareAudio(video)

  const startedAt = Date.now()
  send({ type: 'phase', caseId, phase: 'before' })
  const before = await transcribeVariant({
    caseId,
    videoId,
    wavPath,
    start: 0,
    duration: config.duration || 60,
    numSpeakers: config.numSpeakers ?? 2,
    useGlossary: false,
    glossaries,
    names,
  })
  send({ type: 'phase', caseId, phase: 'after' })
  const after = await transcribeVariant({
    caseId,
    videoId,
    wavPath,
    start: config.start ?? 0,
    duration: config.duration || 60,
    numSpeakers: config.numSpeakers ?? 2,
    useGlossary: config.useGlossary !== false,
    glossaries,
    names,
  })
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)

  updateTestCaseRun(caseId, {
    at: new Date().toLocaleString('sv-SE').replace('T', ' '),
    seconds: Number(seconds),
    before: { document: before.document, polished: before.polished },
    after: { document: after.document, polished: after.polished },
  })
  send({ type: 'done', caseId, seconds: Number(seconds) })
}

for (const caseId of caseIds) {
  try {
    await runCase(caseId)
  } catch (err) {
    console.error(err)
    updateTestCaseRun(caseId, { at: new Date().toLocaleString('sv-SE').replace('T', ' '), error: err && err.message ? err.message : String(err) })
  }
}
