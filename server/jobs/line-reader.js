// 管道行读取器:按字节缓冲并在换行处再解码。
// 大结果行(几百 KB)会跨多个 stdout 数据块,直接 chunk.toString() 会把
// 恰好落在块边界的多字节字符拆成 U+FFFD 替换符——转写文本乱码的根源。
export function createLineReader(onLine) {
  let buffer = Buffer.alloc(0)
  return (chunk) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
    let index
    while ((index = buffer.indexOf(0x0a)) !== -1) {
      const line = buffer.subarray(0, index).toString('utf8')
      buffer = buffer.subarray(index + 1)
      if (line.trim()) onLine(line)
    }
  }
}
