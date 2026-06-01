const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL

if (!hookUrl) {
  console.error('VERCEL_DEPLOY_HOOK_URL is required.')
  process.exit(1)
}

const response = await fetch(hookUrl, {
  method: 'POST',
})

if (!response.ok) {
  const body = await response.text()
  console.error(`Deploy hook failed: ${response.status} ${response.statusText}`)
  console.error(body)
  process.exit(1)
}

const data = await response.json().catch(() => null)

if (data?.job?.id) {
  console.log(`Triggered Vercel deploy job ${data.job.id} (${data.job.state ?? 'unknown'}).`)
} else {
  console.log('Triggered Vercel deploy hook successfully.')
}
