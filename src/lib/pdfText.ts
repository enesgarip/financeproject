export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
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

    pageTexts.push(rows.map((row) => row.join(' ')).join('\n'))
  }

  return pageTexts.join('\n')
}
