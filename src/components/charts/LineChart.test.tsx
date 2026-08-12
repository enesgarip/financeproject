// @vitest-environment happy-dom
//
// LineChart null-segment davranışı (denetim 2026-08-12 K17 + G2). Proje varsayılan
// test ortamı `node`; bu dosya SimpleModal.test.tsx gibi pragma ile happy-dom'a
// geçer. useChartWidth ResizeObserver + getBoundingClientRect kullanır; happy-dom
// genişliği 0 döndürdüğü için ikisi de aşağıda deterministik olarak mock'lanır
// (chartWidth > 0 olmadan SVG hiç render edilmez).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { BalancePrivacyProvider } from '../../hooks/useBalancePrivacy'
import { LineChart, type LineDataPoint, type LineSeriesConfig } from './LineChart'

beforeAll(() => {
  // happy-dom'da ResizeObserver bulunmayabilir; gözlem davranışı test konusu
  // değil, yalnız ilk ölçümün çalışması yeterli.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  }

  // Layout motoru yok: container genişliğini sabitle ki chartWidth=600 olsun.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600,
    height: 260,
    top: 0,
    left: 0,
    right: 600,
    bottom: 260,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(cleanup)

function renderChart(data: LineDataPoint[], series: LineSeriesConfig[]) {
  return render(
    <BalancePrivacyProvider>
      <LineChart data={data} series={series} />
    </BalancePrivacyProvider>,
  )
}

const gappyData: LineDataPoint[] = [
  { label: 'Oca', value: 10 },
  { label: 'Şub', value: 20 },
  { label: 'Mar', value: null },
  { label: 'Nis', value: 30 },
  { label: 'May', value: 40 },
]

describe('LineChart — null segment davranışı', () => {
  it('connectNulls=false: null nokta çizgiyi böler, birden çok path segmenti üretir (K17)', () => {
    const { container } = renderChart(gappyData, [
      { key: 'value', name: 'Seri', stroke: '#22c55e', connectNulls: false },
    ])
    // [10,20] ve [30,40] iki ayrı koşu → 2 path. Eski no-op hali null'ları
    // filtreleyip tek kesintisiz path çiziyordu; eksik ay gerçek trend gibi
    // okunuyordu.
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(2)
  })

  it('connectNulls=true: null üzerinden tek kesintisiz path çizilir', () => {
    const { container } = renderChart(gappyData, [
      { key: 'value', name: 'Seri', stroke: '#22c55e', connectNulls: true },
    ])
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(1)
  })

  it('tüm değerler null ise "Veri yok" kutusu render edilir (G2)', () => {
    const { container, getByText } = renderChart(
      [
        { label: 'Oca', value: null },
        { label: 'Şub', value: null },
      ],
      [{ key: 'value', name: 'Seri', stroke: '#22c55e' }],
    )
    expect(getByText('Veri yok')).toBeTruthy()
    // NaN koordinatlı bozuk SVG üretilmemeli.
    expect(container.querySelector('svg')).toBeNull()
  })
})
