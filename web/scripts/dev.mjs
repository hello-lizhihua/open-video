import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// rootDir = playground;后端在 packages/server/server
const playgroundDir = dirname(dirname(fileURLToPath(import.meta.url)))
const serverEntry = join(playgroundDir, '..', 'server', 'index.js')

const children = [
  spawn('node', [serverEntry], { stdio: 'inherit' }),
  spawn('pnpm', ['exec', 'vite', '--port', '5173'], { cwd: playgroundDir, stdio: 'inherit' }),
]

function stop(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(exitCode)
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

for (const child of children) {
  child.on('exit', (code) => {
    console.error(`子进程退出(code=${code}),停止全部开发进程`)
    stop(code ?? 1)
  })
}
