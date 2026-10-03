import sherpa from 'sherpa-onnx-node'
import { diarizationPaths, modelPaths } from '../binaries.js'
import { buildRawParagraphs } from './paragraphs.js'
import { cleanAsrText, formatParagraphs } from './transcript-format.js'
import { spaceText } from './cjk-space.js'

const SAMPLE_RATE = 16000
const WINDOW_SIZE = 512
const MAX_SPEECH_SECONDS = 8

let recognizer = null

function getRecognizer() {
  if (!recognizer) {
    const { model, tokens } = modelPaths()
    recognizer = new sherpa.OfflineRecognizer({
      modelConfig: {
        senseVoice: { model, language: '', useInverseTextNormalization: 1 },
        tokens,
        numThreads: 4,
        debug: 0,
        provider: 'cpu',
      },
    })
  }
  return recognizer
}

let diarizer = null
let diarizerKey = ''

// 返回可用的说话人分离器;模型未落位时返回 false,表示本轮无说话人标注
function getDiarizer(clustering) {
  const key = JSON.stringify(clustering || {})
  if (diarizer !== null && diarizerKey === key) return diarizer
  const paths = diarizationPaths()
  if (!paths) {
    diarizer = false
    diarizerKey = key
    return diarizer
  }
  try {
    const instance = new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: paths.seg }, numThreads: 2, debug: 0, provider: 'cpu' },
      embedding: { model: paths.emb, numThreads: 2, debug: 0, provider: 'cpu' },
      clustering: clustering || { threshold: 0.5 },
      minDurationOn: 0.35,
      minDurationOff: 0.4,
    })
    diarizer = instance.sampleRate === SAMPLE_RATE ? instance : false
    if (!diarizer) {
      console.error(`[transcribe] 说话人分离采样率不符(${instance.sampleRate}),跳过说话人标注`)
    }
  } catch (err) {
    console.error('[transcribe] 说话人分离器初始化失败,跳过说话人标注:', err.message)
    diarizer = false
  }
  diarizerKey = key
  return diarizer
}

function detectSegments(samples, vadModelPath) {
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

  const segments = []
  const collect = () => {
    while (!vad.isEmpty()) {
      segments.push(vad.front())
      vad.pop()
    }
  }

  for (let offset = 0; offset < samples.length; offset += WINDOW_SIZE) {
    vad.acceptWaveform(samples.slice(offset, offset + WINDOW_SIZE))
    collect()
  }
  vad.flush()
  collect()
  return segments
}

function assignSpeakers(segments, diaSegments) {
  for (const seg of segments) {
    let bestSpeaker = null
    let bestOverlap = 0
    for (const dia of diaSegments) {
      const overlap = Math.min(seg.end, dia.end) - Math.max(seg.start, dia.start)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestSpeaker = dia.speaker
      }
    }
    seg.speaker = bestSpeaker
  }
}

// 一个 VAD 段可能横跨说话人切换点(例如「把话筒还给杜雨博士」+ 主持人的接话),
// 整段只有一个标签必然错一半。按分离结果的轮次边界把段切开,每侧单独识别与标注。
// 只在说话人变化处切,且两侧都至少 1.2 秒,避免把同一人的停顿切开或切出碎段。
function splitSegmentsAtTurns(vadSegments, diaSegments) {
  if (diaSegments.length === 0) return vadSegments
  const splits = []
  for (const seg of vadSegments) {
    const segStart = seg.start / SAMPLE_RATE
    const segEnd = (seg.start + seg.samples.length) / SAMPLE_RATE
    const turns = diaSegments
      .filter((dia) => Math.min(segEnd, dia.end) - Math.max(segStart, dia.start) > 0.3)
      .sort((a, b) => a.start - b.start)
    const cuts = []
    for (let i = 1; i < turns.length; i += 1) {
      if (turns[i].speaker === turns[i - 1].speaker) continue
      const boundary = turns[i].start
      if (boundary - segStart > 1.2 && segEnd - boundary > 1.2) {
        if (cuts.length === 0 || boundary - cuts[cuts.length - 1] > 1.2) cuts.push(boundary)
      }
    }
    if (cuts.length === 0) {
      splits.push(seg)
      continue
    }
    let prev = segStart
    for (const cut of [...cuts, segEnd]) {
      const from = Math.round((prev - segStart) * SAMPLE_RATE)
      const to = Math.round((cut - segStart) * SAMPLE_RATE)
      if (to - from >= SAMPLE_RATE * 0.5) {
        splits.push({ start: seg.start + from, samples: seg.samples.slice(from, to) })
      }
      prev = cut
    }
  }
  return splits
}

export async function runTranscription(video, wavPath, { onProgress, onPhase, clustering, noWrite } = {}) {
  const { vad: vadModelPath } = modelPaths()
  const recognizer = getRecognizer()
  const wave = sherpa.readWave(wavPath)
  const samples = wave.samples

  let diaSegments = []
  // clustering 为 false 时跳过说话人分离(基准测试与分块声纹提取场景)
  if (clustering !== false) {
    const dia = getDiarizer(clustering)
    if (dia) {
      try {
        if (onPhase) onPhase('diarize')
        diaSegments = dia.process(samples)
      } catch (err) {
        console.error('[transcribe] 说话人分离执行失败,跳过说话人标注:', err.message)
      }
    }
  }

  const segments = splitSegmentsAtTurns(detectSegments(samples, vadModelPath), diaSegments)
  const results = []

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (!segment.samples || segment.samples.length === 0) continue
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: segment.samples })
    recognizer.decode(stream)
    const result = recognizer.getResult(stream)
    results.push({
      start: segment.start / SAMPLE_RATE,
      end: (segment.start + segment.samples.length) / SAMPLE_RATE,
      text: cleanAsrText(String(result.text || '')).trim(),
      speaker: null,
    })
    if (onProgress && (index % 5 === 0 || index === segments.length - 1)) {
      onProgress(index + 1, segments.length)
    }
  }

  if (diaSegments.length > 0) {
    assignSpeakers(results, diaSegments)
  }

  if (onPhase) onPhase('write')
  const paragraphs = buildRawParagraphs(results).map((para) => ({
    ...para,
    content: spaceText(para.content),
  }))
  const text = formatParagraphs(paragraphs, null)
  return { text, segments: results }
}
