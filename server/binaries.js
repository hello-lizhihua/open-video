import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { rootPath } from './db.js'
import { getSetting, setSetting, deleteSetting } from './db.js'

const COOKIE_FILE = join(rootPath, 'data', 'cookies.txt')

// 用户粘贴 Netscape cookies.txt 全文,或仅 SESSDATA=xxx 键值对;系统统一落成 cookies 文件
export function saveCookie(content) {
  const text = String(content || '').trim()
  if (!text) {
    if (existsSync(COOKIE_FILE)) unlinkSync(COOKIE_FILE)
    deleteSetting('cookieMask')
    return { saved: false }
  }
  let fileContent
  if (text.startsWith('#')) {
    fileContent = text
  } else {
    const pair = text.replace(/^Cookie:\s*/i, '')
    if (!/^SESSDATA=[^;\s]+/.test(pair)) {
      throw new Error('凭证需为 cookies.txt 全文或 SESSDATA=xxx 键值对')
    }
    fileContent = [
      '# Netscape HTTP Cookie File',
      '# 合成文件:仅包含用户提供的 SESSDATA',
      '.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\t' + pair.slice('SESSDATA='.length).replace(/;.*$/, ''),
    ].join('\n')
  }
  writeFileSync(COOKIE_FILE, fileContent, 'utf8')
  const mask = `${text.slice(0, 6)}…（共 ${text.length} 字符）`
  setSetting('cookieMask', mask)
  return { saved: true, mask }
}

export function cookieArgs() {
  if (!existsSync(COOKIE_FILE)) return []
  const mask = getSetting('cookieMask')
  if (!mask) return []
  return ['--cookies', COOKIE_FILE]
}

function firstExisting(paths) {
  return paths.find((path) => path && existsSync(path))
}

export function ytDlpPath() {
  const found = firstExisting([join(rootPath, 'bin', 'yt-dlp')])
  if (found) return found
  throw new Error('未找到 yt-dlp,请先在仓库根目录运行 pnpm setup:bin')
}

export function ffmpegPath() {
  const found = firstExisting([join(rootPath, 'bin', 'ffmpeg')])
  if (found) return found
  throw new Error('未找到 ffmpeg,请先在仓库根目录运行 pnpm setup:bin')
}

export function modelPaths() {
  const senseVoiceDir = join(rootPath, 'models', 'sense-voice')
  const vadPath = join(rootPath, 'models', 'silero-vad.onnx')
  const model = join(senseVoiceDir, 'model.int8.onnx')
  const tokens = join(senseVoiceDir, 'tokens.txt')
  for (const path of [model, tokens, vadPath]) {
    if (!existsSync(path)) {
      throw new Error('未找到语音模型,请先在仓库根目录运行 pnpm setup:model')
    }
  }
  return { model, tokens, vad: vadPath }
}

export function diarizationPaths() {
  const dir = join(rootPath, 'models', 'diarization')
  const seg = join(dir, 'pyannote-segmentation-3-0.onnx')
  const emb = join(dir, '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx')
  if (!existsSync(seg) || !existsSync(emb)) return null
  return { seg, emb }
}
