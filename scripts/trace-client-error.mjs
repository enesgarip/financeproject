// Kullanım: node scripts/trace-client-error.mjs <bundle.js.map> <satır> <sütun>
import { readFile } from 'node:fs/promises'
import { SourceMap } from 'node:module'

const [file, lineText, columnText] = process.argv.slice(2)
const line = Number(lineText)
const column = Number(columnText)
if (!file || !Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) {
  throw new Error('Kullanım: node scripts/trace-client-error.mjs <bundle.js.map> <satır> <sütun> (1 tabanlı)')
}
const map = new SourceMap(JSON.parse(await readFile(file, 'utf8')))
const entry = map.findEntry(line - 1, column - 1)
if (!entry.originalSource) throw new Error('Bu konum için source map kaydı bulunamadı; sürümü ve bundle adını kontrol et.')
console.log(`${entry.originalSource}:${entry.originalLine + 1}:${entry.originalColumn + 1}${entry.name ? ` (${entry.name})` : ''}`)
