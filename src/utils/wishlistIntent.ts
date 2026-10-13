/** Ekleme sırasında düşünme desteği; cevaplar ve sonuç kalıcı kaydedilmez. */
export type WishlistIntentAnswers = {
  essential: boolean | null
  alternative: boolean | null
  delayCost: boolean | null
}

export function assessWishlistIntent(answers: WishlistIntentAnswers): { label: string; reason: string } | null {
  if (answers.essential === null || answers.alternative === null || answers.delayCost === null) return null
  if (answers.essential && !answers.alternative) {
    return answers.delayCost
      ? { label: 'İhtiyaç gibi görünüyor', reason: 'Temel bir işi karşılıyor, uygun alternatifin yok ve ertelemek somut bir sorun yaratıyor.' }
      : { label: 'İhtiyaç olabilir, acil görünmüyor', reason: 'Temel bir işi karşılıyor; bir ay beklemek sorun yaratmıyorsa bütçene uygun zamanı seçebilirsin.' }
  }
  return {
    label: 'İstek gibi görünüyor',
    reason: answers.alternative
      ? 'Aynı işi gören bir çözümün var. Yeni alımın sana ne ekleyeceğini düşün.'
      : 'Temel bir gereksinimden çok sana keyif veya konfor katıyor. Bütçende yer varsa buna da pay ayırabilirsin.',
  }
}
