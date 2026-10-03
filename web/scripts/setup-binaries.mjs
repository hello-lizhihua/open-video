// 把 yt-dlp 与 ffmpeg 落位到项目内部 bin 目录。
// 下载顺序:官方源优先,失败切换镜像源;落位后验证可执行。
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const require = createRequire(import.meta.url)
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const binDir = join(rootDir, 'bin')
mkdirSync(binDir, { recursive: true })

const GITHUB_MIRRORS = ['', 'https://gh-proxy.com/', 'https://ghfast.top/', 'https://ghproxy.net/']

function log(message) {
  console.log(`[setup:bin] ${message}`)
}

async function downloadTo(url, targetPath) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }
  const tempPath = `${targetPath}.download`
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath))
    const size = statSync(tempPath).size
    if (size < 1024 * 1024) {
      throw new Error(`文件过小(${size} 字节),下载内容可疑`)
    }
    rmSync(targetPath, { force: true })
    renameSync(tempPath, targetPath)
    return size
  } catch (err) {
    rmSync(tempPath, { force: true })
    throw err
  }
}

async function fetchWithMirrors(githubPath, targetPath, label) {
  for (const mirror of GITHUB_MIRRORS) {
    const url = `${mirror}https://github.com/${githubPath}`
    try {
      log(`下载 ${label}:${url}`)
      const size = await downloadTo(url, targetPath)
      log(`${label} 完成,${(size / 1024 / 1024).toFixed(1)} MB`)
      return true
    } catch (err) {
      log(`${label} 该来源失败:${err.message}`)
    }
  }
  return false
}

function verifyBinary(path, args) {
  const output = execFileSync(path, args, { encoding: 'utf8', timeout: 30_000 })
  return output.trim().split('\n')[0]
}

async function setupYtDlp() {
  const target = join(binDir, 'yt-dlp')
  if (existsSync(target)) {
    try {
      log(`yt-dlp 已存在,版本 ${verifyBinary(target, ['--version'])}`)
      return true
    } catch {
      log('已有 yt-dlp 不可执行,重新下载')
    }
  }
  const ok = await fetchWithMirrors(
    'yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    target,
    'yt-dlp 独立二进制',
  )
  if (ok) {
    chmodSync(target, 0o755)
    try {
      log(`yt-dlp 就绪,版本 ${verifyBinary(target, ['--version'])}`)
      return true
    } catch (err) {
      log(`独立二进制验证失败:${err.message}`)
      rmSync(target, { force: true })
    }
  }

  // 兜底:zipapp 是纯 Python 单文件,需要系统 python3,写启动脚本包装
  log('独立二进制不可用,尝试 zipapp 方案')
  const zipappPath = join(binDir, 'yt-dlp.zipapp')
  const okZip = await fetchWithMirrors(
    'yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
    zipappPath,
    'yt-dlp zipapp',
  )
  if (!okZip) return false
  const launcher = join(binDir, 'yt-dlp')
  rmSync(launcher, { force: true })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(
    launcher,
    `#!/bin/sh\nexec /usr/bin/env python3 "${zipappPath}" "$@"\n`,
    { mode: 0o755 },
  )
  try {
    log(`yt-dlp(zipapp)就绪,版本 ${verifyBinary(launcher, ['--version'])}`)
    return true
  } catch (err) {
    log(`zipapp 验证失败:${err.message}`)
    return false
  }
}

async function setupFfmpeg() {
  const target = join(binDir, 'ffmpeg')
  if (existsSync(target)) {
    try {
      log(`ffmpeg 已存在,版本 ${verifyBinary(target, ['-version'])}`)
      return true
    } catch {
      log('已有 ffmpeg 不可执行,重新落位')
    }
  }

  // 首选 npm 平台包:二进制随 npm 包分发,国内 registry 友好
  let sourcePath = null
  try {
    const installer = require('@ffmpeg-installer/ffmpeg')
    sourcePath = installer.path
  } catch {
    log('缺少 @ffmpeg-installer/ffmpeg,尝试安装(开发依赖)')
    try {
      execFileSync('pnpm', ['add', '-D', '@ffmpeg-installer/ffmpeg'], {
        cwd: rootDir,
        stdio: 'inherit',
        timeout: 300_000,
      })
      sourcePath = require('@ffmpeg-installer/ffmpeg').path
    } catch (err) {
      log(`npm 方案失败:${err.message}`)
    }
  }

  if (sourcePath && existsSync(sourcePath)) {
    copyFileSync(sourcePath, target)
    chmodSync(target, 0o755)
    try {
      log(`ffmpeg 就绪,版本 ${verifyBinary(target, ['-version'])}`)
      return true
    } catch (err) {
      log(`ffmpeg 验证失败:${err.message}`)
      rmSync(target, { force: true })
    }
  }
  return false
}

const ytDlpOk = await setupYtDlp()
const ffmpegOk = await setupFfmpeg()

if (!ytDlpOk || !ffmpegOk) {
  console.error('[setup:bin] 部分工具落位失败:yt-dlp=' + ytDlpOk + ' ffmpeg=' + ffmpegOk)
  process.exit(1)
}
log('全部工具就绪')
