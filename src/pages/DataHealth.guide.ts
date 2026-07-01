import { formatCurrency } from '../utils/formatCurrency'
import { formatDate } from '../utils/date'
import { normalizeSearchText } from '../utils/searchText'
import type { HealthIssue } from './DataHealth.logic'

type IssueGuide = {
  problem: string
  whyItMatters: string
  nextStep: string
}

export function severityClass(severity: HealthIssue['severity']) {
  if (severity === 'error') return 'bg-destructive/12 text-destructive'
  if (severity === 'warning') return 'bg-warning/12 text-warning'
  return 'bg-info/12 text-info'
}

export function buildIssueGuide(issue: HealthIssue): IssueGuide {
  if (issue.kind === 'cardScheduledDebt') {
    return {
      problem: 'Planlı kart taksitleri kayıtlı, ama kart borcuna tam yansımıyor.',
      whyItMatters: 'Kalan limit gerçekten daha yüksek görünür; bu da yeni harcama ve ödeme planını yanıltır.',
      nextStep: issue.fixable
        ? 'Kart borcunu taksit planıyla hizalamak için hızlı düzeltmeyi uygula.'
        : 'Kart borcunu ve taksit planını birlikte kontrol et; gerekiyorsa Kartlar ekranından düzelt.',
    }
  }

  if (issue.kind === 'cardLedgerDrift') {
    return {
      problem: 'Kartın kayıtlı borcu, borç hareketleri toplamından farklı.',
      whyItMatters: 'Borç hareketleri değişmez kayıttır; fark, hareketlere yazılmadan borcun değiştiği anlamına gelir.',
      nextStep: issue.fixable
        ? 'Hızlı düzeltmeyle borcu hareket geçmişine (gerçek kaynak) göre yeniden hesapla.'
        : 'Kartın borç hareketlerini Kartlar ekranından kontrol et.',
    }
  }

  if (issue.kind === 'accountLedgerDrift') {
    return {
      problem: 'Hesabın kayıtlı bakiyesi, hesap hareketleri toplamından farklı.',
      whyItMatters: 'Hesap hareketleri değişmez kayıttır; fark, hareketlere yazılmadan bakiyenin değiştiği anlamına gelir.',
      nextStep: issue.fixable
        ? 'Hızlı düzeltmeyle bakiyeyi hareket geçmişine (gerçek kaynak) göre yeniden hesapla.'
        : 'Hesabın hareketlerini Kartlar ekranından kontrol et.',
    }
  }

  if (issue.kind === 'cardDebtSplit' || issue.kind === 'cardStatementTotals') {
    return {
      problem: 'Kart borcunun ekstre, dönem içi veya arşiv kırılımında tutarsızlık var.',
      whyItMatters: 'Ödeme tutarı, aylık yük ve veri sağlığı kontrolleri bu kırılıma göre hesap yapar.',
      nextStep: issue.fixable
        ? 'Hızlı düzeltmeyle kırılımı yeniden hizala, sonra Kartlar ekranında toplamları gözden geçir.'
        : 'Kartın son ekstre ve dönem içi hareketlerini kontrol ederek kaynak kaydı düzelt.',
    }
  }

  if (issue.kind === 'cardOverduePayment') {
    return {
      problem: 'Açık ekstre son ödeme tarihini geçmiş.',
      whyItMatters: 'Bankada ödeme yapıldıysa uygulama açık bırakır; taksitler ve ekstre borcu yanlış açık görünür.',
      nextStep: 'Ekstre gerçekten ödendiyse ödeme çekmecesini açıp kaynak hesabı seçerek uygulamada da kapat.',
    }
  }

  if (
    issue.kind === 'cardExpenseAmount' ||
    issue.kind === 'cardSingleInstallments' ||
    issue.kind === 'cardMissingInstallments' ||
    issue.kind === 'cardInstallmentDueMonth' ||
    issue.kind === 'cardInstallmentPostedAt' ||
    issue.kind === 'cardInstallmentCount'
  ) {
    return {
      problem: 'Kart harcaması ile bağlı taksit satırları birbiriyle uyuşmuyor.',
      whyItMatters: 'Yaklaşan taksitler, dönem yükü ve kalan borç hatalı hesaplanabilir.',
      nextStep: issue.fixable
        ? 'Hızlı düzeltmeyi uygulayıp taksit planını yeniden hizala.'
        : 'Kartlar ekranında ilgili taksitli harcamayı açıp satırları tek tek kontrol et.',
    }
  }

  if (issue.kind === 'duplicateTransactionCandidate') {
    return {
      problem: issue.payload?.duplicateLevel === 'exact'
        ? 'Aynı kartta aynı tarih, tutar, durum ve açıklama parmak izine sahip birden fazla harcama var.'
        : 'Aynı kartta aynı gün ve aynı tutarda, açıklaması benzer ya da eksik olan harcamalar var.',
      whyItMatters: 'Duplicate kayıtlar kart borcunu, kategori harcamasını, bütçe uyarılarını ve mutabakat sonucunu olduğundan yüksek gösterebilir.',
      nextStep: 'Kartlar ekranında satırları yan yana kontrol et. İkisi de doğruysa bırak; değilse birini düzelt, iptal et veya silmeden önce neyin tekrar sayıldığını netleştir.',
    }
  }

  if (issue.kind === 'cardExpenseDataQuality') {
    return {
      problem: 'Bazı kart harcamalarında açıklama veya kategori eksik.',
      whyItMatters: 'Eksik açıklama/kategori, import eşleştirme kalitesini düşürür ve analizlerde harcamaların yanlış gruba düşmesine neden olur.',
      nextStep: 'Kartlar ekranında ilgili harcamaları açıp açıklama ve kategori alanlarını tamamla.',
    }
  }

  if (issue.kind === 'loanTotals' || issue.kind === 'loanInstallmentDueDay') {
    return {
      problem: 'Kredi özeti ile taksit planı birbirinden kopmuş görünüyor.',
      whyItMatters: 'Kalan borç, kalan taksit ve nakit akış projeksiyonu yanlış görünebilir.',
      nextStep: issue.fixable
        ? 'Hızlı düzeltmeyle kredi özetini plana göre güncelle.'
        : 'Kredi planını ve kredi kartını birlikte kontrol ederek eksik veya hatalı satırı düzelt.',
    }
  }

  if (issue.kind === 'loanPaidAtMissing' || issue.kind === 'loanPendingPaidAt') {
    return {
      problem: 'Kredi taksitinin ödeme tarihi alanı durumuyla uyuşmuyor.',
      whyItMatters: 'Ödenmiş/bekleyen ayrımı raporlarda ve veri sağlığı kontrollerinde güven kaybına yol açar.',
      nextStep: issue.fixable
        ? 'Tarih alanını hızlı düzeltmeyle senkronize et.'
        : 'Krediler ekranında ilgili taksiti açıp gerçek ödeme durumunu kontrol et.',
    }
  }

  if (issue.kind === 'paymentDueDay' || issue.kind === 'paymentRecurrenceFields') {
    return {
      problem: 'Ödeme takvimi alanları birbiriyle uyuşmuyor.',
      whyItMatters: 'Yaklaşan ödemeler ve aylık çıkış planı yanlış gün veya yanlış kayıtla hesaplanabilir.',
      nextStep: issue.fixable
        ? 'Takvim alanlarını hızlı düzeltmeyle güncelle.'
        : 'Ödemeler ekranında tekrar bilgilerini ve son tarihi kontrol et.',
    }
  }

  if (issue.kind === 'assetShape' || issue.kind === 'budgetMonth' || issue.kind === 'debtShape' || issue.kind === 'cardTypeFields') {
    return {
      problem: 'Kayıt formundaki teknik alanlar seçili türle veya beklenen formatla uyuşmuyor.',
      whyItMatters: 'Özet kartları, dağılımlar ve filtreler bu kaydı yanlış yorumlayabilir.',
      nextStep: issue.fixable
        ? 'Hızlı düzeltmeyle alanları normalize et.'
        : 'İlgili kaydı açıp tür, tarih ve tutar alanlarını gözden geçir.',
    }
  }

  return {
    problem: issue.description,
    whyItMatters:
      issue.severity === 'error'
        ? 'Bu uyumsuzluk hesaplamaları doğrudan bozabilir ve finansal özetlere güveni düşürür.'
        : issue.severity === 'warning'
          ? 'Bu kayıt zamanla daha büyük hesap farklarına veya hatalı hatırlatmalara dönüşebilir.'
          : 'Bu kaydı düzeltmek gelecekteki kontrollerin daha temiz ve anlaşılır olmasını sağlar.',
    nextStep: issue.fixable
      ? `Hızlı aksiyonlardaki "${issue.fixLabel ?? 'Düzelt'}" adımını kullan.`
      : 'İlgili kaydı açıp alanları elle kontrol et; emin değilsen daha sonra hatırlat ile listeden geçici olarak kaldır.',
  }
}

export function navigationAction(issue: HealthIssue) {
  const normalizedTitle = normalizeSearchText(issue.title)
  if (issue.id.includes('stale-installment')) return { to: '/kartlar?section=islemler', label: 'Döneme dahil et' }
  if (issue.id.includes('no-plan')) return { to: '/borclar/krediler', label: 'Planı oluştur' }

  if (issue.kind === 'cardOverduePayment') return { to: '/kartlar?section=ekstreler', label: 'Ekstreleri aç' }
  if (issue.kind.startsWith('card') || issue.kind === 'cardTypeFields' || issue.kind === 'duplicateTransactionCandidate') return { to: '/kartlar?section=kartlar', label: 'Kartlara git' }
  if (issue.kind.startsWith('loan')) return { to: '/borclar/krediler', label: 'Kredilere git' }
  if (issue.kind.startsWith('payment')) {
    return { to: '/odemeler', label: normalizedTitle.includes('vadesi ge') ? 'Ödendi işaretle' : 'Ödemelere git' }
  }
  if (issue.kind === 'debtShape' || normalizedTitle.includes('bor') || normalizedTitle.includes('alacak')) {
    return { to: '/borclar/kisiler', label: 'Borçlara git' }
  }
  if (issue.kind === 'assetShape' || normalizedTitle.includes('varl')) return { to: '/varliklar', label: 'Varlıklara git' }
  if (issue.kind === 'budgetMonth' || normalizedTitle.includes('hedef') || normalizedTitle.includes('maa')) {
    return { to: '/analiz', label: 'Kaydı aç' }
  }

  return null
}

function previewValue(value: string | number | null) {
  if (value === null) return 'boş'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : formatCurrency(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value)
  return value
}

function previewUpdates(updates: Record<string, string | number | null> | undefined) {
  if (!updates) return []
  return Object.entries(updates).map(([key, value]) => `${key}: ${previewValue(value)}`)
}

export function issuePreviewDetails(issue: HealthIssue) {
  const payload = issue.payload
  if (!payload || !issue.fixable) return []

  const previews: string[] = []
  const updatePreview = previewUpdates(payload.updates)
  const affectedRows = payload.ids?.length ?? 0

  if (issue.kind === 'cardSingleInstallments') {
    previews.push('Harcama kaydı korunur, sadece peşin işlem için oluşmuş taksit planı temizlenir.')
    previews.push(`${affectedRows} taksit planı satırı silinir.`)
  } else if (issue.kind === 'cardMissingInstallments') {
    previews.push(`${payload.installmentNos?.length ?? 0} eksik taksit satırı eklenecek.`)
    previews.push(`Başlangıç ayı: ${payload.baseMonth ? formatDate(payload.baseMonth) : 'hesaplanamadı'}`)
    previews.push('Geçmiş taksitler ödendi olarak, gelecek olanlar planlı olarak eklenir.')
  } else if (issue.kind === 'cardDebtSplit') {
    previews.push(`Ekstre borcu: ${formatCurrency(payload.statementDebt ?? 0)}`)
    previews.push(`Dönem içi kesinleşen: ${formatCurrency(payload.currentPeriod ?? 0)}`)
    previews.push(`Provizyon: ${formatCurrency(payload.provisionAmount ?? 0)}`)
  } else if (issue.kind === 'cardScheduledDebt') {
    previews.push(`Yeni toplam borç: ${formatCurrency(payload.nextDebtAmount ?? 0)}`)
    previews.push(`Planlı taksit tutarı borca eklenecek.`)
  } else if (issue.kind === 'cardLedgerDrift') {
    previews.push(`Borç hareket toplamına çekilecek: ${formatCurrency(payload.nextDebtAmount ?? 0)}`)
    previews.push('Yeni bir hareket yazılmaz; borç projeksiyona eşitlenir.')
  } else if (issue.kind === 'accountLedgerDrift') {
    previews.push(`Bakiye hareket toplamına çekilecek: ${formatCurrency(payload.nextDebtAmount ?? 0)}`)
    previews.push('Yeni bir hareket yazılmaz; bakiye projeksiyona eşitlenir.')
  } else if (issue.kind === 'loanTotals') {
    previews.push(`Kalan tutar: ${formatCurrency(payload.remainingAmount ?? 0)}`)
    previews.push(`Kalan taksit: ${payload.remainingInstallments ?? 0}`)
  } else if (issue.kind === 'loanPaidAtMissing') {
    previews.push(`${affectedRows} ödenmiş kredi taksidine ödeme tarihi eklenecek.`)
  } else if (issue.kind === 'loanPendingPaidAt') {
    previews.push(`${affectedRows} bekleyen kredi taksidinden ödeme tarihi kaldırılacak.`)
  } else if (issue.kind === 'paymentDueDay') {
    previews.push(`Yeni ödeme tarihi: ${payload.dueDate ? formatDate(payload.dueDate) : 'hesaplanamadı'}`)
  } else if (updatePreview.length > 0) {
    previews.push(`Güncellenecek alanlar: ${updatePreview.join(', ')}`)
  } else if (affectedRows > 0) {
    previews.push(`${affectedRows} kayıt güncellenecek.`)
  }

  previews.push('Uygulama öncesi kayıt görüntüsü bu oturumda geri alma için saklanır.')
  return previews
}
