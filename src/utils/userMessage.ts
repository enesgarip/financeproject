/** Teknik ayrıntı cause içinde kalır; kullanıcıya eyleme dönük Türkçe mesaj. */
export function userMessage(message: string | undefined, code?: string, fallback = 'İşlem tamamlanamadı. Lütfen yeniden dene.') {
  if ((!message && code === '23505') || /duplicate key/i.test(message ?? '')) return 'Bu kayıt zaten var. Mevcut kaydı kontrol et.'
  if ((!message && code === '23514') || /check constraint|invalid input syntax/i.test(message ?? '')) return 'Girilen değerler geçersiz. Tutar, tarih ve miktar alanlarını kontrol et.'
  if ((!message && code === '42501') || /row.level security|permission denied/i.test(message ?? '')) return 'Bu işlem için erişim doğrulanamadı. Oturumunu yenileyip tekrar dene.'
  if (/JWT|token.*expired/i.test(message ?? '')) return 'Oturumun sona erdi. Yeniden giriş yap.'
  if (/Failed to fetch|NetworkError|fetch failed|timeout/i.test(message ?? '')) return 'Sunucuya ulaşılamadı. Bağlantını kontrol edip yeniden dene.'
  if (/Once siradaki taksit/i.test(message ?? '')) return 'Önce sıradaki taksiti ödemelisin.'
  return message || fallback
}
