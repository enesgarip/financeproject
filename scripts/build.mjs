import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const phases = [
  ['TypeScript', '../node_modules/typescript/bin/tsc', '-b'],
  ['Vite', '../node_modules/vite/bin/vite.js', 'build'],
  ['Source map archive', './archive-source-maps.mjs', ...process.argv.slice(2)],
]

for (const [name, script, ...args] of phases) {
  const started = performance.now()
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log(`[build] ${name} ${((performance.now() - started) / 1000).toFixed(2)} sn`)
}
