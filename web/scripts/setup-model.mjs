// 把 SenseVoice int8 模型与 silero VAD 模型落位到项目内部 models 目录。
// 按文件下载:hf-mirror.com 镜像优先(实测快),官方 GitHub release 兜底。
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const modelsDir = join(rootDir, 'models')
const senseVoiceDir = join(modelsDir, 'sense-voice')
mkdirSync(senseVoiceDir, { recursive: true })

const SENSE_VOICE_DIR_NAME = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
const HF_MIRROR_BASE = `https://hf-mirror.com/csukuangfj/${SENSE_VOICE_DIR_NAME}/resolve/main`
const HF_MAIN_BASE = `https://huggingface.co/csukuangfj/${SENSE_VOICE_DIR_NAME}/resolve/main`

function log(message) {
  console.log(`[setup:model] ${message}`)
}

async function downloadTo(url, targetPath, minBytes) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }
  const tempPath = `${targetPath}.download`
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath))
    const size = statSync(tempPath).size
    if (size < minBytes) {
      throw new Error(`文件过小(${size} 字节)`)
    }
    renameSync(tempPath, targetPath)
    return size
  } catch (err) {
    rmSync(tempPath, { force: true })
    throw err
  }
}

async function fileFromSources(sources, targetPath, minBytes, label) {
  for (const url of sources) {
    try {
      log(`下载 ${label}:${url}`)
      const size = await downloadTo(url, targetPath, minBytes)
      log(`${label} 完成,${(size / 1024 / 1024).toFixed(1)} MB`)
      return true
    } catch (err) {
      log(`${label} 该来源失败:${err.message}`)
    }
  }
  return false
}

const modelTarget = join(senseVoiceDir, 'model.int8.onnx')
const tokensTarget = join(senseVoiceDir, 'tokens.txt')
const vadTarget = join(modelsDir, 'silero-vad.onnx')
const diarDir = join(modelsDir, 'diarization')
mkdirSync(diarDir, { recursive: true })
const segTarget = join(diarDir, 'pyannote-segmentation-3-0.onnx')
const embTarget = join(diarDir, '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx')

let ok = true

if (existsSync(modelTarget) && existsSync(tokensTarget)) {
  log('SenseVoice 模型已存在,跳过')
} else {
  const modelOk = await fileFromSources(
    [`${HF_MIRROR_BASE}/model.int8.onnx`, `${HF_MAIN_BASE}/model.int8.onnx`],
    modelTarget,
    100 * 1024 * 1024,
    'SenseVoice int8 模型',
  )
  const tokensOk = await fileFromSources(
    [`${HF_MIRROR_BASE}/tokens.txt`, `${HF_MAIN_BASE}/tokens.txt`],
    tokensTarget,
    100 * 1024,
    'SenseVoice tokens',
  )
  if (!modelOk || !tokensOk) ok = false
}

if (existsSync(vadTarget)) {
  log('silero VAD 模型已存在,跳过')
} else {
  const downloaded = await fileFromSources(
    [`${RELEASE_BASE}/silero_vad.onnx`, 'https://hf-mirror.com/csukuangfj/sherpa-onnx-silero-vad/resolve/main/silero_vad.onnx'],
    vadTarget,
    500 * 1024,
    'silero VAD 模型',
  )
  if (!downloaded) ok = false
}

if (existsSync(segTarget) && existsSync(embTarget)) {
  log('说话人分离模型已存在,跳过')
} else {
  // 分段模型是 tar 包,解压后取其中唯一的 onnx
  const segTarName = 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2'
  const segTarPath = join(modelsDir, segTarName)
  const segOk = await fileFromSources(
    [`https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/${segTarName}`],
    segTarPath,
    5 * 1024 * 1024,
    '说话人分段模型',
  )
  if (segOk) {
    execFileSync('tar', ['-xjf', segTarPath, '-C', modelsDir], { timeout: 300_000 })
    const extractedDir = join(modelsDir, 'sherpa-onnx-pyannote-segmentation-3-0')
    const found = readdirSync(extractedDir).find((name) => name.endsWith('.onnx'))
    if (found) {
      renameSync(join(extractedDir, found), segTarget)
    } else {
      log(`分段模型包内容异常:${readdirSync(extractedDir).join(', ')}`)
      ok = false
    }
    rmSync(extractedDir, { recursive: true, force: true })
    rmSync(segTarPath, { force: true })
  } else {
    ok = false
  }

  const embOk = await fileFromSources(
    ['https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx'],
    embTarget,
    20 * 1024 * 1024,
    '说话人声纹模型',
  )
  if (!embOk) ok = false
}

if (!ok) {
  console.error('[setup:model] 模型落位失败,请查看上方日志')
  process.exit(1)
}
log('全部模型就绪')
