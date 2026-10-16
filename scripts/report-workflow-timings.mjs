// Read-only GitHub Actions süre raporu. Secret veya ortam dosyası okumaz/yazmaz.
import { appendFileSync } from 'node:fs'

const { GITHUB_API_URL = 'https://api.github.com', GITHUB_REPOSITORY,
  GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_TOKEN, GITHUB_STEP_SUMMARY } = process.env

const api = async (path) => {
  const response = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub Actions API: HTTP ${response.status}`)
  return response.json()
}
const seconds = (start, end) => Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000))
const duration = (value) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
const clean = (value) => String(value).replace(/[|\r\n]/g, ' ')

try {
  const run = await api(`/actions/runs/${GITHUB_RUN_ID}`)
  const history = await api(`/actions/workflows/${run.workflow_id}/runs?branch=${encodeURIComponent(run.head_branch)}&event=${encodeURIComponent(run.event)}&status=success&per_page=16`)
  const jobs = []
  for (let page = 1; ; page += 1) {
    const result = await api(`/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100&page=${page}`)
    jobs.push(...result.jobs)
    if (result.jobs.length < 100) break
  }
  const previous = history.workflow_runs.filter((item) => String(item.id) !== GITHUB_RUN_ID).slice(0, 15)
  const elapsed = seconds(run.created_at, new Date().toISOString())
  const lines = [
    '## CI/deploy süreleri', '',
    `Rapor anına kadar toplam: **${duration(elapsed)}** (runner beklemesi dahil).`,
    'Bu rapor yayın/kalite kapısı değildir. İlk koşu ve önbellek isabeti süreleri etkiler.', '',
    '| İş | Sonuç | Süre |', '| --- | --- | ---: |',
  ]
  for (const job of jobs.filter((item) => item.name !== 'Workflow Timings')) {
    const value = job.started_at && job.completed_at ? duration(seconds(job.started_at, job.completed_at)) : '—'
    lines.push(`| ${clean(job.name)} | ${clean(job.conclusion ?? job.status)} | ${value} |`)
    for (const step of job.steps ?? []) {
      if (step.conclusion !== 'success' || !step.started_at || !step.completed_at) continue
      const length = seconds(step.started_at, step.completed_at)
      if (length >= 5) lines.push(`| ↳ ${clean(step.name)} | success | ${duration(length)} |`)
    }
  }
  if (previous.length) {
    const values = previous.map((item) => seconds(item.created_at, item.updated_at)).sort((a, b) => a - b)
    const mean = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    lines.push('', `Aynı dal/tetikleyicide önceki ${values.length} başarılı koşu: ortalama **${duration(mean)}**, aralık **${duration(values[0])}–${duration(values.at(-1))}**.`,
      'Değişiklik kapsamı farklı olabilir; frontend ve migration koşularını ayrı karşılaştırın.')
  }
  appendFileSync(GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
} catch (error) {
  // Raporlama erişimi/ağ hatası tamamlanmış release sonucunu değiştirmesin.
  console.warn(`Süre raporu oluşturulamadı: ${error.message}`)
}
