// 转写产物写出：txt（标签形式转写文档）、srt（字幕）、json（分段事实来源）。
// 文件名使用哔哩哔哩 ID（bvid），不用数字编号。
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transcriptDir } from '../db.js'
import { buildRawParagraphs } from './paragraphs.js'
import { formatParagraphs, formatSrt } from './transcript-format.js'
import { spaceText } from './cjk-space.js'

export function writeArtifacts(fileName, segments) {
  const paragraphs = buildRawParagraphs(segments).map((para) => ({
    ...para,
    content: spaceText(para.content),
  }))
  const txt = formatParagraphs(paragraphs, null)
  const srt = formatSrt(
    segments.map((seg) => ({ ...seg, text: spaceText(seg.text) })),
    null,
  )
  writeFileSync(join(transcriptDir, `${fileName}.txt`), txt, 'utf8')
  writeFileSync(join(transcriptDir, `${fileName}.srt`), srt, 'utf8')
  writeFileSync(join(transcriptDir, `${fileName}.json`), JSON.stringify(segments, null, 2), 'utf8')
  return { txt }
}
