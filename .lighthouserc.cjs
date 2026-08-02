const headful = process.env.LIGHTHOUSE_HEADFUL === 'true'
const ciChromeFlags = [
  headful ? '' : '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
]
  .filter(Boolean)
  .join(' ')
const localChromeFlags = '--no-sandbox --disable-dev-shm-usage --disable-gpu'
const previewHost = '127.0.0.1'
const previewPort = 4173
const maxWaitMs = Number(process.env.LHCI_MAX_WAIT_MS ?? 45000)

/** @type {import('@lhci/utils/src/lighthouserc').Config} */
module.exports = {
  ci: {
    collect: {
      headful,
      startServerCommand: `npm run preview -- --host ${previewHost} --port ${previewPort} --strictPort`,
      startServerReadyPattern: 'Local',
      startServerReadyTimeout: 30000,
      url: [`http://${previewHost}:${previewPort}/login`],
      // Fast PR feedback uses one run; the scheduled CI audit sets this to 3.
      numberOfRuns: Number(process.env.LHCI_NUMBER_OF_RUNS ?? 1),
      settings: {
        chromeFlags: process.env.CI ? ciChromeFlags : localChromeFlags,
        throttlingMethod: 'provided',
        maxWaitForFcp: maxWaitMs,
        maxWaitForLoad: maxWaitMs,
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.7 }],
        'categories:accessibility': ['error', { minScore: 0.85 }],
        'categories:best-practices': ['error', { minScore: 0.85 }],
        'categories:seo': ['warn', { minScore: 0.8 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
}
