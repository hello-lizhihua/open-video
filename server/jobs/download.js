import { execFile, spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { audioDir } from '../db.js'
import { cookieArgs, ffmpegPath, ytDlpPath } from '../binaries.js'

const run = promisify(execFile)

const MEGABYTE = 1024 * 1024
const CHILD_TIMEOUT_MS = 30 * 60_000

export async function fetchMetadata(url) {
  const { stdout } = await run(
    ytDlpPath(),
    [...cookieArgs(), '--dump-single-json', '--no-playlist', url],
    { maxBuffer: 32 * MEGABYTE, timeout: 60_000 },
  )
  return JSON.parse(stdout)
}

// 下载与解码产物文件名使用哔哩哔哩 ID（bvid），不用数字编号
export function downloadAudio(fileName, url, { onProgress } = {}) {
  const template = join(audioDir, `${fileName}.%(ext)s`)
  return new Promise((resolve, reject) => {
    const child = spawn(
      ytDlpPath(),
      [...cookieArgs(), '-f', 'bestaudio/best', '--no-playlist', '--newline', '-o', template, url],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    let lastReported = -1
    const timer = setTimeout(() => child.kill('SIGKILL'), CHILD_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      if (!onProgress) return
      const text = chunk.toString()
      for (const match of text.matchAll(/\[download\]\s+([\d.]+)%/g)) {
        const pct = Math.floor(parseFloat(match[1]))
        if (pct !== lastReported) {
          lastReported = pct
          onProgress(pct)
        }
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        const candidates = readdirSync(audioDir).filter(
          (name) => name.startsWith(`${fileName}.`) && !name.endsWith('.wav'),
        )
        if (candidates.length === 0) {
          reject(new Error('下载完成但未找到音频文件'))
          return
        }
        resolve(join(audioDir, candidates[0]))
      } else {
        reject(new Error(stderr.trim().split('\n').pop() || `yt-dlp 退出码 ${code}`))
      }
    })
  })
}

export async function toWav(inputPath, fileName, { onProgress } = {}) {
  const wavPath = join(audioDir, `${fileName}.wav`)
  if (onProgress) onProgress()
  await run(
    ffmpegPath(),
    ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', wavPath],
    { maxBuffer: 32 * MEGABYTE, timeout: CHILD_TIMEOUT_MS },
  )
  if (!existsSync(wavPath)) {
    throw new Error('音频解码失败,未生成 wav 文件')
  }
  return wavPath
}

export function probeWavDuration(wavPath) {
  const result = spawnSync(ffmpegPath(), ['-i', wavPath], { encoding: 'utf8' })
  const match = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(result.stderr || '')
  if (!match) return null
  return Math.round(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]))
}

export async function prepareAudio(video) {
  if (!video.bvid) throw new Error('视频缺少哔哩哔哩 ID,无法定位音频')
  const wavPath = join(audioDir, `${video.bvid}.wav`)
  if (existsSync(wavPath)) return wavPath
  const metadata = await fetchMetadata(video.url)
  const audioFile = await downloadAudio(video.bvid, video.url)
  return toWav(audioFile, video.bvid)
}
