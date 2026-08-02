/**
 * Kaynak belgenin/mesajın kararlı kimliği. Aynı artefakt yeniden işlendiğinde
 * aynı değer üretilir; satır sıra numarası aynı belgedeki birebir eş satırları
 * birbirinden ayırır.
 */
export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function importedRowEventIds(artifactHash: string, rowSignatures: string[]): Promise<string[]> {
  const occurrences = new Map<string, number>()
  return Promise.all(rowSignatures.map(async (signature) => {
    const occurrence = occurrences.get(signature) ?? 0
    occurrences.set(signature, occurrence + 1)
    return `${artifactHash}:${await sha256Hex(signature)}:${occurrence}`
  }))
}
