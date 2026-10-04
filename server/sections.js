// section.xml 解析:标签化章节结构,唯一允许的属性是段落 hash。
// 输出 overview 与每章的 title/边界 hash/summary/要点/重要段落;段落本体不产出(转写已有)。

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseAttrs(raw) {
  const attrs = {}
  const re = /([a-zA-Z-]+)="([^"]*)"/g
  let m
  while ((m = re.exec(raw || ''))) attrs[m[1]] = m[2]
  return attrs
}

// 极简栈解析器:仅覆盖本格式用到的标签结构,不追求通用 XML
function buildTree(xml) {
  const cleaned = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const tokenRe = /<(\/?)([a-zA-Z-]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/?>|([^<]+)/g
  const doc = { tag: '#doc', attrs: {}, text: [], children: [] }
  const stack = [doc]
  let m
  while ((m = tokenRe.exec(cleaned))) {
    if (m[4] !== undefined) {
      stack[stack.length - 1].text.push(m[4])
      continue
    }
    const tag = m[2]
    if (m[1] === '/') {
      let found = false
      while (stack.length > 1) {
        const top = stack.pop()
        if (top.tag === tag) {
          found = true
          break
        }
      }
      if (!found) throw new Error(`标签不配对：</${tag}>`)
    } else if (m[0].endsWith('/>')) {
      stack[stack.length - 1].children.push({ tag, attrs: parseAttrs(m[3]), text: [], children: [] })
    } else {
      const node = { tag, attrs: parseAttrs(m[3]), text: [], children: [] }
      stack[stack.length - 1].children.push(node)
      stack.push(node)
    }
  }
  if (stack.length !== 1) throw new Error('存在未闭合标签')
  return doc
}

const kidsOf = (node, tag) => node.children.filter((child) => child.tag === tag)
const textOf = (node) => decodeEntities(node.text.join('')).trim()
const emptyNode = { text: [], children: [] }

export function parseSectionXml(xml) {
  const doc = buildTree(xml)
  const roots = kidsOf(doc, 'transcript-sections')
  if (roots.length !== 1) throw new Error('根元素必须是 transcript-sections')
  const root = roots[0]

  // 段落序号→hash 映射:仅用于把章节边界 from/to 解析成 hash,不导入段落本体
  const indexToHash = new Map()
  for (const section of kidsOf(root, 'section')) {
    for (const block of kidsOf(section, 'paragraphs')) {
      for (const para of kidsOf(block, 'paragraph')) {
        const hash = para.attrs.hash
        if (!hash) throw new Error('paragraph 缺少 hash 属性')
        const indexNode = kidsOf(para, 'index')[0]
        const index = indexNode ? Number(textOf(indexNode)) : indexToHash.size
        indexToHash.set(index, hash)
      }
    }
  }

  const overviewNode = kidsOf(root, 'overview')[0]
  // 讲述人分段统计(speakers)与构建说明(notes)不入库:索引类细节,与转写切块相关不稳定
  const overview = overviewNode
    ? { summary: textOf(kidsOf(overviewNode, 'summary')[0] || emptyNode) }
    : { summary: '' }

  const sections = kidsOf(root, 'section').map((node, seq) => {
    const boundaryHash = (tag) => {
      const valueNode = kidsOf(node, tag)[0]
      if (!valueNode) throw new Error(`第 ${seq + 1} 章缺少 <${tag}> 边界`)
      const hash = indexToHash.get(Number(textOf(valueNode)))
      if (!hash) throw new Error(`第 ${seq + 1} 章的 <${tag}> 无法对应到段落`)
      return hash
    }
    const points = kidsOf(kidsOf(node, 'key-points')[0] || emptyNode, 'point').map(textOf)
    const marks = kidsOf(kidsOf(node, 'important')[0] || emptyNode, 'paragraph').map((para) => {
      const hash = para.attrs.hash
      if (!hash) throw new Error('重要段落缺少 hash 属性')
      return { hash, why: textOf(kidsOf(para, 'why')[0] || emptyNode) }
    })
    return {
      ord: Number(textOf(kidsOf(node, 'id')[0] || emptyNode)) || seq + 1,
      title: textOf(kidsOf(node, 'title')[0] || emptyNode),
      hashStart: boundaryHash('from'),
      hashEnd: boundaryHash('to'),
      summary: textOf(kidsOf(node, 'summary')[0] || emptyNode),
      points,
      marks,
    }
  })

  if (sections.length === 0) throw new Error('未找到任何 <section>')
  return { overview, sections, paragraphCount: indexToHash.size }
}
