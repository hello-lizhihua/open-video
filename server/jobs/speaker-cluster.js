// 全局说话人一致性:把各分块独立分离出的局部说话人,经分段声纹向量聚类映射为全局编号。
// 指定人数用 k-means;自动模式用贪心领导聚类(余弦阈值)。

export function cosineSimilarity(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function meanOf(vectors) {
  const dim = vectors[0].length
  const mean = new Float64Array(dim)
  for (const vec of vectors) {
    for (let i = 0; i < dim; i += 1) mean[i] += vec[i]
  }
  for (let i = 0; i < dim; i += 1) mean[i] /= vectors.length
  return mean
}

function kmeans(vectors, k, seeds = [], iterations = 30) {
  // 初始质心:优先用外部种子(局部说话人均值),不足时补最远向量
  let centroids = seeds.slice(0, k).map((vec) => Array.from(vec))
  while (centroids.length < k && centroids.length < vectors.length) {
    let farIndex = 0
    let farScore = -Infinity
    vectors.forEach((vec, index) => {
      const score = centroids.length
        ? Math.min(...centroids.map((centroid) => cosineSimilarity(vec, centroid)))
        : 1
      if (score > farScore) {
        farScore = score
        farIndex = index
      }
    })
    centroids.push(Array.from(vectors[farIndex]))
  }
  if (centroids.length === 0) return vectors.map(() => 0)

  let labels = new Array(vectors.length).fill(-1)
  for (let iter = 0; iter < iterations; iter += 1) {
    const newLabels = vectors.map((vec) => {
      let best = 0
      let bestScore = -Infinity
      centroids.forEach((centroid, ci) => {
        const score = cosineSimilarity(vec, centroid)
        if (score > bestScore) {
          bestScore = score
          best = ci
        }
      })
      return best
    })
    const changed = newLabels.some((label, index) => label !== labels[index])
    labels = newLabels
    for (let ci = 0; ci < centroids.length; ci += 1) {
      const members = vectors.filter((_, index) => labels[index] === ci)
      if (members.length > 0) centroids[ci] = Array.from(meanOf(members))
    }
    if (!changed) break
  }
  return labels
}

function leaderCluster(vectors, threshold) {
  const leaders = []
  const labels = vectors.map((vec) => {
    for (let li = 0; li < leaders.length; li += 1) {
      if (cosineSimilarity(vec, leaders[li]) >= threshold) return li
    }
    leaders.push(vec)
    return leaders.length - 1
  })
  return labels
}

// labels 按首次出现顺序重编号为 0,1,2…
function relabel(labels, segments) {
  const order = []
  const indexOf = new Map()
  // segments 与 labels 同序,按时间先后决定新编号
  const sorted = segments
    .map((seg, index) => ({ index, start: seg.start }))
    .sort((a, b) => a.start - b.start)
  for (const { index } of sorted) {
    const label = labels[index]
    if (!indexOf.has(label)) {
      indexOf.set(label, order.length)
      order.push(label)
    }
  }
  return labels.map((label) => indexOf.get(label))
}

// segments: [{start,end,speaker(局部),embedding:Float32Array|null}](按时间顺序)
// options.seeds: 外部种子(按人名合并的声纹样本质心),存在时按最近种子归类,
// 全局编号与种子顺序一致;单人短片段不会被强制簇数拆错
export function assignGlobalSpeakers(segments, { numClusters = 0, threshold = 0.5, seeds: externalSeeds } = {}) {
  const withEmbedding = []
  segments.forEach((seg, index) => {
    if (seg.embedding && seg.embedding.length > 0) withEmbedding.push({ index, vec: seg.embedding })
  })

  let labels = new Array(segments.length).fill(-1)
  if (withEmbedding.length > 0) {
    const vectors = withEmbedding.map((item) => item.vec)
    let raw
    if (externalSeeds && externalSeeds.length > 0) {
      // 最近种子归类:不做质心迭代,同一人多种子不产生多余簇,片段里缺席的讲述人不占簇
      const seedVecs = externalSeeds.map((vec) => Array.from(vec))
      raw = vectors.map((vec) => {
        let best = 0
        let bestScore = -Infinity
        seedVecs.forEach((seed, si) => {
          const score = cosineSimilarity(vec, seed)
          if (score > bestScore) {
            bestScore = score
            best = si
          }
        })
        return best
      })
    } else if (numClusters > 0) {
      // 无种子时按局部说话人分组取均值当种子:跨分块的同一人大概率落在不同局部编号,合并后仍是同组声纹
      const groups = new Map()
      withEmbedding.forEach(({ index, vec }) => {
        const key = segments[index].speaker ?? 'x'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(vec)
      })
      const seeds = [...groups.values()]
        .sort((a, b) => b.length - a.length)
        .slice(0, numClusters)
        .map((vecs) => meanOf(vecs))
      raw = kmeans(vectors, Math.min(numClusters, vectors.length), seeds)
    } else {
      raw = leaderCluster(vectors, threshold)
    }
    withEmbedding.forEach((item, position) => {
      labels[item.index] = raw[position]
    })
  }
  // 缺声纹的分段:沿用前一个有编号的分段;仍无则 0
  let last = -1
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] === -1) labels[i] = last === -1 ? 0 : last
    else last = labels[i]
  }
  if (externalSeeds && externalSeeds.length > 0) {
    // 种子模式的编号即命名顺序,不做按首次出现重排
    return finalize(labels)
  }
  return relabel(labels, segments)
}

// 外部种子模式的收口:填默认值后直接返回,不走按首次出现重排
function finalize(labels) {
  return labels.map((label) => (label === -1 || label === undefined ? 0 : label))
}

function meanVector(vectors) {
  return Array.from(meanOf(vectors))
}

// 声纹样本按讲述人名称分组求均值:同一人多条样本合并为一个种子,
// 不再撑出多余簇;返回顺序按首次出现排列,全局编号即命名顺序
export function seedsFromSamples(samples, names) {
  const groups = new Map()
  for (const sample of samples) {
    const name = names[sample.idx]
    if (!name) continue
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(sample.centroid)
  }
  const seeds = [...groups.values()]
    .filter((vectors) => vectors.length > 0 && vectors[0].length > 0)
    .map(meanVector)
  return seeds
}
