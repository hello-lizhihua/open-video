// 转写产物的统一格式化。
// 转写文档 = 标签形式的段落序列（与分段同构，段落带 hash 与讲述人）；
// hash 由原始内容计算，洗稿段落复用原始 hash 以维持对应关系。
// 词汇表替换与中英文空格在传入前由调用方完成（本模块不改动 content）。
// XML 输出带缩进，便于阅读与下游处理。
import { speakerDisplayName } from './speaker-name.js'
import { spaceText } from './cjk-space.js'

export { speakerDisplayName }

// 词汇表替换：误识别词支持多变体（| 分隔）；
// 跨词条统一按「误识别词最长优先」替换，避免短变体先替换破坏长变体的匹配
export function decorateText(text, glossaries) {
  if (!glossaries || glossaries.length === 0) return text
  const pairs = []
  for (const entry of glossaries) {
    if (!entry.misread) continue
    for (const variant of entry.misread.split('|').map((v) => v.trim()).filter(Boolean)) {
      pairs.push({ variant, term: entry.term })
    }
  }
  pairs.sort((a, b) => b.variant.length - a.variant.length)
  let result = text
  for (const { variant, term } of pairs) {
    if (result.includes(variant)) {
      result = result.split(variant).join(term)
    }
  }
  return result
}

// 语音模型偶发生僻字输出（如「𠱁」），在解码层变成 U+FFFD 替换符；
// 这类字符没有阅读价值，统一清洗掉
export function cleanAsrText(text) {
  return text.replace(/\uFFFD+/g, '')
}

// 中英文空格由 cjk-space（autocorrect）提供，见文末 re-export

function formatParagraph(para, names) {
  const indent = '  '
  const hashAttr = para.hash ? ` hash="${para.hash}"` : ''
  const speakerTag =
    para.speaker === null || para.speaker === undefined
      ? ''
      : `\n${indent}  <speaker>${speakerDisplayName(para.speaker, names)}</speaker>`
  return `${indent}<paragraph${hashAttr}>${speakerTag}\n${indent}  <content>${para.content}</content>\n${indent}</paragraph>`
}

// paragraphs: [{hash, speaker, content}]
export function formatParagraphs(paragraphs, names) {
  const body = paragraphs.map((para) => formatParagraph(para, names)).join('\n')
  return `<transcript>\n${body}\n</transcript>`
}

function toSrtTime(seconds) {
  const total = Math.max(0, Math.floor(seconds * 1000))
  const ms = total % 1000
  const rest = Math.floor(total / 1000)
  const s = rest % 60
  const m = Math.floor(rest / 60) % 60
  const h = Math.floor(rest / 3600)
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

export function formatSrt(segments, names) {
  const multi =
    new Set(
      segments
        .map((seg) => seg.speaker)
        .filter((spk) => spk !== null && spk !== undefined),
    ).size > 1
  return segments
    .filter((seg) => seg.text)
    .map((seg, index) => {
      const from = toSrtTime(seg.start)
      const to = toSrtTime(seg.end)
      const label = multi && seg.speaker !== null && seg.speaker !== undefined
        ? `[${speakerDisplayName(seg.speaker, names)}] `
        : ''
      return `${index + 1}\n${from} --> ${to}\n${label}${seg.text}\n`
    })
    .join('\n')
}

export { spaceText } from './cjk-space.js'
