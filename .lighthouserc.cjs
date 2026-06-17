const ciChromeFlags = '--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu'
const localChromeFlags = '--no-sandbox --disable-dev-shm-usage --disable-gpu'

/** @type {import('@lhci/utils/src/lighthouserc').Config} */
module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      isSinglePageApplication: true,
      url: ['http://localhost/login'],
      numberOfRuns: 1,
      settings: {
        chromeFlags: process.env.CI ? ciChromeFlags : localChromeFlags,
        throttlingMethod: 'provided',
        maxWaitForFcp: 90000,
        maxWaitForLoad: 90000,
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
