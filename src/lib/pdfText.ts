// pdfjs-dist v6 getTextContent() uses `for await...of ReadableStream` internally.
// Safari < 17.5 doesn't support ReadableStream async iteration — polyfill it
// using the universally-supported reader API so the library works on older iOS.
if (
  typeof ReadableStream !== 'undefined' &&
  typeof Symbol.asyncIterator !== 'undefined' &&
  !(Symbol.asyncIterator in ReadableStream.prototype)
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- polyfill must patch the prototype
  (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* (this: ReadableStream) {
    const reader = this.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  }
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const buffer = await file.arrayBuffer()
  // `destroy()` ŞART: pdfjs her dokümana bir worker + sayfa nesneleri bağlar,
  // bunlar GC ile toplanmaz. Bırakılırsa kullanıcı arka arkaya ekstre yüklerken
  // (import ekranında sık olur) worker'lar birikip sekmeyi şişirir. Hata yolunda
  // da temizlenmeli, o yüzden try/finally.
  const loadingTask = pdfjsLib.getDocument({ data: buffer })
  try {
    const pdf = await loadingTask.promise
    const pageTexts: string[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()

      type PdfTextItem = { str?: unknown; transform?: unknown }
      const items = (content.items as PdfTextItem[]).filter(
        (item): item is { str: string; transform: number[] } =>
          typeof item.str === 'string' &&
          Array.isArray(item.transform) &&
          item.transform.every((value) => typeof value === 'number'),
      )

      items.sort((left, right) => {
        const dy = right.transform[5] - left.transform[5]
        if (Math.abs(dy) > 3) return dy
        return left.transform[4] - right.transform[4]
      })

      const rows: string[][] = []
      let currentRow: string[] = []
      let lastY: number | null = null
      for (const item of items) {
        const y = item.transform[5]
        if (lastY !== null && Math.abs(y - lastY) > 3) {
          if (currentRow.length) rows.push(currentRow)
          currentRow = []
        }
        if (item.str.trim()) currentRow.push(item.str.trim())
        lastY = y
      }
      if (currentRow.length) rows.push(currentRow)

      // Sayfa nesnesini hemen bırak: 30+ sayfalık ekstrede tüm sayfaların
      // render/text katmanı bellekte tutulmasın.
      page.cleanup()
      pageTexts.push(rows.map((row) => row.join(' ')).join('\n'))
    }

    return pageTexts.join('\n')
  } finally {
    // loadingTask.destroy() dokümanı da kapatır (pdf.destroy()'u ayrıca çağırmak
    // gerekmez); temizlik hatası asıl sonucu/hatayı gölgelemesin.
    await loadingTask.destroy().catch(() => {})
  }
}
