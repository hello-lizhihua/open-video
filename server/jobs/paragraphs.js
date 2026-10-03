// 段落聚合与洗稿对应关系。
// 段落与转写分段一一对应（不做讲述人合并——合并会让长视频洗稿变成一大块），
// hash 由原始内容计算（sha1 前 12 位），洗稿段落复用同一 hash 维持对应关系。
import { createHash } from 'node:crypto'

export function paragraphHash(speaker, content) {
  return createHash('sha1')
    .update(`${speaker ?? ''}|${content}`)
    .digest('hex')
    .slice(0, 12)
}

// 分段 → 原始段落 [{hash, speaker, content, start, end}]（与分段同构）
export function buildRawParagraphs(segments) {
  return segments
    .filter((seg) => seg.text)
    .map((seg) => {
      const content = seg.text
      return {
        hash: paragraphHash(seg.speaker, content),
        speaker: seg.speaker,
        content,
        start: seg.start,
        end: seg.end,
      }
    })
}

// 句级清洗：去纯语气词句、去段内重复句（去重只在段内——开场白跨段重复必须保留）
function cleanSentences(text) {
  const fillerRe = /^[嗯啊呃哦噢喔诶唉欸哎嘿哈哟嘛呢吧呀呗咯噢嗯呐就对是的好的啦]+[。,，、!！?？.~\s]*$/
  const normalizeKey = (value) => value.replace(/[\p{P}\p{S}\s]/gu, '').toLowerCase()
  const seen = new Set()
  const kept = []
  for (const sentence of text.split(/(?<=[。！？!?])/)) {
    const trimmed = sentence.trim()
    if (!trimmed || fillerRe.test(trimmed)) continue
    const key = normalizeKey(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    kept.push(trimmed)
  }
  return kept.join('')
}

// 分段 + 覆盖表 → 洗稿段落 [{hash, speaker, content, edited}]（与原始段落同构同 hash）
export function buildPolishedParagraphs(segments, overrides = {}) {
  return buildRawParagraphs(segments).map((para) => {
    const cleaned = cleanSentences(para.content)
    const override = overrides[para.hash]
    return {
      hash: para.hash,
      speaker: para.speaker,
      content: override ?? cleaned,
      edited: Boolean(override),
    }
  })
}
