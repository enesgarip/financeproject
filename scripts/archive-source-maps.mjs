// Hidden source map'ler public dist'e veya Vercel staged çıktısına giremez.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
async function files(folder) {
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    return (await Promise.all(entries.map(entry => entry.isDirectory()
      ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]))).flat()
  } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
if (process.argv.includes('--check-public')) {
  for (const folder of ['dist', '.vercel/output/static']) {
    const maps = (await files(path.join(root, folder))).filter(file => file.endsWith('.map'))
    if (maps.length) throw new Error(`${folder}: public source map bulundu: ${maps.length}`)
  }
  console.log('Public çıktıda source map yok.')
} else {
  const release = (process.env.GITHUB_SHA || 'local').replace(/[^a-zA-Z0-9_-]/g, '')
  const destination = path.join(root, '.diagnostics/source-maps', release)
  await mkdir(destination, { recursive: true })
  const maps = (await files(path.join(root, 'dist/assets'))).filter(file => file.endsWith('.map'))
  if (!maps.length) throw new Error('Teşhis için source map üretilmedi.')
  const manifest = { release, built_at: new Date().toISOString(), files: [] }
  for (const file of maps) {
    const bundlePath = file.slice(0, -4)
    const bundle = await readFile(bundlePath)
    const name = path.basename(file)
    // Aynı build tekrar koşarsa yalnız aynı release'in aynı dosyası değiştirilir.
    await rename(file, path.join(destination, name))
    manifest.files.push({ bundle: path.basename(bundlePath), map: name, sha256: createHash('sha256').update(bundle).digest('hex') })
  }
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`${maps.length} source map özel teşhis arşivine taşındı (${release}).`)
}
