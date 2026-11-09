import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const {
  VERCEL_TOKEN,
  VERCEL_ORG_ID,
  VERCEL_PROJECT_ID,
  DEPLOYMENT_URL,
} = process.env

for (const [name, value] of Object.entries({
  VERCEL_TOKEN,
  VERCEL_ORG_ID,
  VERCEL_PROJECT_ID,
  DEPLOYMENT_URL,
})) {
  if (!value) throw new Error(`${name} is required.`)
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))
const run = promisify(execFile)

const api = async (path, options = {}) => {
  const separator = path.includes('?') ? '&' : '?'
  const response = await fetch(
    `https://api.vercel.com${path}${separator}teamId=${encodeURIComponent(VERCEL_ORG_ID)}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    },
  )
  const text = await response.text()
  const body = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(
      `Vercel API ${response.status}: ${body?.error?.message ?? text ?? response.statusText}`,
    )
  }

  return body
}

const getProject = () =>
  api(`/v9/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}`)

const waitForProductionTarget = async (deploymentId) => {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const project = await getProject()
    if (project.targets?.production?.id === deploymentId) return
    await sleep(2_000)
  }
  throw new Error(`Production target ${deploymentId} olmadı.`)
}

const getCanonicalProductionDomain = async () => {
  const result = await api(
    `/v9/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/domains?production=true&redirects=false`,
  )
  const domain = result.domains
    ?.filter((item) => item.verified && !item.redirect)
    .sort((left, right) => left.name.length - right.name.length)[0]

  if (!domain?.name) {
    throw new Error('Doğrulanmış production domain bulunamadı.')
  }
  return domain.name
}

const smokeProduction = async (domain) => {
  const origin = new URL(`https://${domain}`).origin
  const env = { ...process.env, PLAYWRIGHT_BASE_URL: origin }
  delete env.VERCEL_TOKEN
  let lastError

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await run(process.execPath, [
        'node_modules/@playwright/test/cli.js', 'test', 'tests/e2e/auth-smoke.spec.ts',
        '--timeout=15000', '--retries=0', '--reporter=line', '--trace=off',
      ], {
        env,
        timeout: 25_000,
      })
      console.log(`Production tarayıcı kontrolü başarılı: ${origin}/login`)
      return
    } catch (error) {
      lastError = error
      console.warn(`Production tarayıcı denemesi ${attempt}/3 başarısız.`)
      if (error.stdout) console.warn(error.stdout.trim())
      if (error.stderr) console.warn(error.stderr.trim())
      if (attempt < 3) await sleep(5_000)
    }
  }

  throw lastError
}

const deploymentHostname = new URL(DEPLOYMENT_URL).hostname
const staged = await api(
  `/v13/deployments/${encodeURIComponent(deploymentHostname)}`,
)
const projectBefore = await getProject()
const previousDeploymentId = projectBefore.targets?.production?.id

if (staged.projectId !== VERCEL_PROJECT_ID) {
  throw new Error('Staged deployment beklenen Vercel projesine ait değil.')
}
if (staged.team?.id !== VERCEL_ORG_ID) {
  throw new Error('Staged deployment beklenen Vercel takımına ait değil.')
}
if (staged.readyState !== 'READY') {
  throw new Error(`Staged deployment hazır değil: ${staged.readyState}`)
}

console.log(`Promoting staged deployment ${staged.id}…`)
await api(
  `/v10/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/promote/${encodeURIComponent(staged.id)}`,
  { method: 'POST', body: '{}' },
)

try {
  await waitForProductionTarget(staged.id)
  const domain = await getCanonicalProductionDomain()
  await smokeProduction(domain)
} catch (smokeError) {
  if (!previousDeploymentId || previousDeploymentId === staged.id) {
    throw smokeError
  }

  console.error(
    `Production smoke başarısız; ${previousDeploymentId} sürümüne dönülüyor.`,
  )
  const description = encodeURIComponent(
    'Automated rollback after failed production smoke',
  )
  await api(
    `/v1/projects/${encodeURIComponent(VERCEL_PROJECT_ID)}/rollback/${encodeURIComponent(previousDeploymentId)}?description=${description}`,
    { method: 'POST', body: '{}' },
  )
  await waitForProductionTarget(previousDeploymentId)
  throw new Error(
    `Production smoke başarısız; rollback tamamlandı: ${smokeError.message}`,
  )
}
