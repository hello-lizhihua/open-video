// 中英文空格后处理：语音模型不做排版间距，由 autocorrect（Rust 原生绑定）统一补齐。
let formatFn = null

async function loadFormatter() {
  try {
    const mod = await import('autocorrect-node')
    if (typeof mod.format === 'function') return mod.format
  } catch {
    // 依赖未安装时跳过空格化,不影响转写主流程
  }
  return null
}

formatFn = await loadFormatter()

export function spaceText(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  if (!formatFn) return text
  return formatFn(text)
}
