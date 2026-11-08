import { expect, test, type Page } from '@playwright/test'
import { mockApp, base, now } from './audit-fixtures'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
async function dockAtBottom(page: Page) {
  await expect.poll(() => page.getByRole('navigation', { name: 'Ana gezinme' }).evaluate(nav => Math.abs(nav.parentElement!.getBoundingClientRect().bottom - innerHeight))).toBeLessThan(2)
  await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('')
}
for (const path of ['/kartlar?section=hesaplar', '/kartlar?section=kartlar', '/borclar/krediler', '/borclar/kisiler', '/odemeler', '/varliklar', '/varliklar/maas', '/varliklar/altin', '/odemeler/hedefler']) {
  test(`iptal sonrası form ve navbar: ${path}`, async ({ page }) => {
    await mockApp(page, 'light'); await page.goto(`${path}${path.includes('?') ? '&' : '?'}new=1`); await page.clock.resume()
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible()
    await dialog.locator('input[type="text"],input:not([type]),textarea').first().fill('İptal edilen taslak')
    page.once('dialog', prompt => prompt.accept()); await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0); await dockAtBottom(page)
  })
}
test('satır menüsünden iptal kalıcı tetikleyiciye odak döndürür', async ({ page }) => {
  await mockApp(page, 'light'); await page.goto('/varliklar/maas'); await page.clock.resume()
  const trigger = page.getByRole('button', { name: /işlemleri/ }).first()
  await trigger.click(); await page.getByRole('menuitem', { name: 'Düzenle', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused(); await dockAtBottom(page)
})
test('bekleyen kayıt X ve Escape ile kapanmaz; yeni taslağı eski yanıt kapatmaz', async ({ page }) => {
  await mockApp(page, 'light'); await page.goto('/varliklar/maas'); await page.clock.resume()
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve }); let posts = 0
  await page.route('**/rest/v1/salary_history*', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    posts++; await pending; await route.fulfill({ json: { ...base, ...route.request().postDataJSON(), id: 'saved-salary' } })
  })
  const add = page.getByRole('button', { name: 'Maaş ekle', exact: true }); await add.click()
  const dialog = page.getByRole('dialog'); await dialog.locator('[name="title"]').fill('İlk kayıt'); await dialog.locator('[name="amount"]').fill('60000')
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click(); await expect.poll(() => posts).toBe(1)
  await expect(dialog.getByRole('button', { name: 'Kapat', exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible()
  release(); await expect(dialog).toHaveCount(0); await add.click(); await dialog.locator('[name="title"]').fill('Yeni taslak')
  await expect(dialog.locator('[name="title"]')).toHaveValue('Yeni taslak'); expect(posts).toBe(1)
})
test('modal jesti arka planı yenilemez ve iptal edilen jest boşluk bırakmaz', async ({ page }) => {
  await mockApp(page, 'light'); let reads = 0
  await page.route('**/rest/v1/salary_history*', route => { if (route.request().method() === 'GET') reads++; return route.fallback() })
  await page.goto('/varliklar/maas'); await page.clock.resume(); await expect.poll(() => reads).toBeGreaterThan(0); await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Maaş ekle', exact: true }).click(); const before = reads
  await page.getByRole('dialog').evaluate(target => {
    for (const [type, y] of [['touchstart', 100], ['touchmove', 280], ['touchcancel', 280], ['touchend', 280]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'touches', { value: /end|cancel/.test(type) ? [] : [{ clientY: y, clientX: 100 }] }); target.dispatchEvent(event)
    }
  })
  await page.getByRole('button', { name: 'Kapat', exact: true }).click(); await page.waitForLoadState('networkidle'); expect(reads).toBe(before)
  await expect(page.locator('main > div[aria-hidden]').first()).toHaveCSS('height', '0px'); await dockAtBottom(page)
})
test('farklı diyaloğu kapatmak alttaki formun taslağını temizlemez', async ({ page }) => {
  await mockApp(page, 'light'); await page.goto('/odemeler/liste'); await page.clock.resume()
  const name = page.getByRole('textbox', { name: 'Alınacak ürün' }); await name.fill('Korunacak taslak')
  await page.getByRole('button', { name: /^Ara ve keşfet/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Ara ve keşfet' }); await expect(dialog).toBeVisible()
  let prompts = 0; page.on('dialog', async prompt => { prompts++; await prompt.dismiss() })
  await dialog.getByRole('button', { name: 'Kapat', exact: true }).click(); await expect(dialog).toHaveCount(0)
  expect(prompts).toBe(0)
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Özet', exact: true }).click()
  expect(prompts).toBe(1); await expect(name).toHaveValue('Korunacak taslak')
})
test('başlamış sayfa jestinin touchcancel temizliği', async ({ page }) => {
  await mockApp(page, 'light'); await page.goto('/varliklar/maas'); await page.clock.resume()
  await page.waitForLoadState('networkidle'); await page.evaluate(() => window.scrollTo(0, 0)); await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
  await page.locator('main').evaluate(target => {
    for (const [type, y] of [['touchstart', 100], ['touchmove', 280]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'touches', { value: [{ clientY: y, clientX: 100 }] }); target.dispatchEvent(event)
    }
  })
  const spacer = page.locator('main > div[aria-hidden]').first(); await expect(spacer).not.toHaveCSS('height', '0px')
  await page.locator('main').dispatchEvent('touchcancel'); await expect(spacer).toHaveCSS('height', '0px')
})
for (const width of [320, 390]) test(`uzun bütçe ve bakım eylemleri sığar: ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await mockApp(page, 'light', {
    budgets: [{ ...base, id: 'b', category: 'Market', month: '2026-10-01', limit_amount: 9876543.21, limit_anchor: 'manual', limit_anchor_value: null }],
    card_expenses: [{ ...base, id: 'e', card_id: 'credit-1', spent_at: '2026-10-25', description: 'Market', category: 'Market', amount: 1234567.89, status: 'posted', installment_count: 1 }],
    car_reminders: [{ ...base, id: 'r', car_id: 'car-1', title: 'Periyodik bakım ve yağ filtresi değişimi — ön takım kontrolü uzun açıklama', kind: 'bakim', due_date: '2026-10-25', due_odometer_km: 51000 }],
  })
  await page.goto('/odemeler/hedefler'); await expect(page.getByText('Ay bütçesi', { exact: true })).toBeVisible()
  expect(await page.getByLabel('Ay bütçesi harcama ve limit').evaluate(e => [...e.querySelectorAll('p')].every(p => p.scrollWidth <= p.clientWidth + 1))).toBe(true)
  await page.goto('/varliklar/araclar'); const button = page.getByRole('button', { name: 'Tamamlandı', exact: true }); await button.scrollIntoViewIfNeeded()
  const boxes = await button.evaluate(e => [e.getBoundingClientRect().toJSON(), e.nextElementSibling!.getBoundingClientRect().toJSON()])
  expect(boxes[0].width).toBeGreaterThanOrEqual(44); expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].left); expect(boxes[1].right).toBeLessThan(width)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
})
test('trend seçili gram serisinden farkı, uç değerleri ve tüm etiketleri hesaplar; gizlilik korur', async ({ page }) => {
  await mockApp(page, 'light', { net_worth_snapshots: [
    { ...base, id: 'n2', snapshot_date: '2026-10-26', net_worth: 110000, gold_try: 10000, usd_try: 55 },
    { ...base, id: 'n1', snapshot_date: '2026-10-25', net_worth: 100000, gold_try: 5000, usd_try: 40 },
  ] })
  await page.addInitScript(now => localStorage.setItem('fp.marketRates.v1', JSON.stringify({ rates: { GRA: { buying: 10000 }, USD: { buying: 55 } }, asOf: now, fetchedAt: now })), now)
  await page.goto('/analiz'); await page.getByRole('button', { name: 'Net değeri Gram altın cinsinden göster' }).click()
  const panel = page.locator('[data-slot="card"]').filter({ has: page.getByText('Net değer trendi', { exact: true }) })
  await expect(page.getByRole('button', { name: 'Net değeri Gram altın cinsinden göster' })).toHaveAttribute('aria-pressed', 'true')
  expect(await panel.locator('button').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 44))).toBe(true)
  await expect(panel).toContainText('-9'); await expect(panel).toContainText('20'); await expect(panel).toContainText('11')
  await expect(panel.locator('div[role=img]')).not.toHaveAttribute('aria-label', /₺|TL/)
  await page.getByRole('button', { name: /tutarları gizle/i }).click(); await expect(panel.locator('div[role=img]')).not.toHaveAttribute('aria-label', /20|11/)
})
test('rezerv okuması hatalıysa satın alma için uygun kararı vermez', async ({ page }) => {
  await mockApp(page, 'light'); await page.route('**/rest/v1/kasa_buckets*', route => route.fulfill({ status: 500, json: { message: 'offline' } }))
  await page.goto('/odemeler/alsam-mi?tutar=100'); await page.clock.resume()
  await expect(page.getByText('Rezerv veya finans verileri doğrulanamadı; satın alma kararı hesaplanmıyor.')).toBeVisible()
  await expect(page.getByText('Plana göre uygun', { exact: true })).toHaveCount(0)
})

for (const theme of ['light', 'dark']) test(`ay kapanışı metin kontrastı ${theme}`, async ({ page }) => {
  await mockApp(page, theme); await page.goto('/analiz#ay-kapanisi'); await page.clock.resume()
  await expect(page.getByText('Ay kapanış asistanı', { exact: true })).toBeVisible()
  const contrast = await page.locator('#ay-kapanisi').evaluate(main => {
    const c = document.createElement('canvas').getContext('2d')!
    function rgba(value: string): number[] { c.clearRect(0,0,1,1); c.fillStyle = value; c.fillRect(0,0,1,1); const a = c.getImageData(0,0,1,1).data; return [a[0],a[1],a[2],a[3]/255] }
    function over(a: number[], b: number[]) { return [0,1,2].map(i => a[i]*a[3]+b[i]*(1-a[3])).concat(1) }
    function lum(a: number[]) { return a.slice(0,3).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0) }
    const results: unknown[] = []
    for (const e of main.querySelectorAll<HTMLElement>('p,span,button,a,li,h2,h3,label')) {
      if (e.childElementCount || !e.textContent?.trim() || e.closest('[disabled],[aria-hidden="true"],.sr-only') || !e.getBoundingClientRect().height || e.closest('details:not([open])') && !e.closest('summary')) continue
      const chain: Element[] = []; for(let n: Element|null=e;n;n=n.parentElement) chain.unshift(n)
      let bg=[255,255,255,1],opacity=1
      for(const n of chain) { const s=getComputedStyle(n); bg=over(rgba(s.backgroundColor),bg); opacity*=Number(s.opacity) }
      const style=getComputedStyle(e), fg=rgba(style.color); fg[3]*=opacity
      const rendered=over(fg,bg), l1=lum(rendered), l2=lum(bg), ratio=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)
      const fs=parseFloat(style.fontSize), large=fs>=24 || fs>=18.66 && Number(style.fontWeight)>=700
      if(ratio<(large?3:4.5))results.push({text:e.textContent,ratio,fg:style.color,bg,opacity,font:style.fontSize,class:e.className})
    }
    return results
  })
  expect(contrast).toEqual([])
})

test('PDF işlenirken X ve Escape aynı busy korumasına uyar', async ({ page }) => {
  await mockApp(page, 'light')
  await page.route('**/src/lib/pdfText.ts', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function extractPdfText(){ return new Promise(()=>{}); }' }))
  await page.goto('/kartlar?section=kartlar&card=credit-1'); await page.clock.resume()
  await page.getByRole('button', { name: 'Örnek kart işlemleri', exact: true }).click()
  await page.getByRole('menu').getByRole('button', { name: 'Ekstre içe aktar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Ekstre İçe Aktar' })
  await dialog.locator('input[type=file]').setInputFiles({ name: 'sentetik.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% Synthetic audit fixture\n') })
  await expect(dialog.getByText('PDF okunuyor…', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Kapat', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible()
})
