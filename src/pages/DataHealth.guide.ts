import { formatCurrency } from '../utils/formatCurrency'
import { formatDate } from '../utils/date'
import type { HealthIssue } from './DataHealth.logic'
import { resolveHealthIssue } from './DataHealth.resolution'

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
  const resolution = resolveHealthIssue(issue)
  const hasFixAction = resolution.primaryAction === 'fix'
  if (issue.kind === 'cardScheduledDebt') {
    return {
      problem: 'Planlı kart taksitleri ile kaydedilen toplam borç uyuşmuyor.',
      whyItMatters: 'Banka doğrulaması olmadan borcun mu yoksa taksit durumlarının mı eski olduğu belirlenemez.',
      nextStep: 'Kart borcunu ve taksit planını birlikte kontrol et; gerekiyorsa Kartlar ekranından düzelt.',
    }
  }

  if (issue.kind === 'cardInstallmentOverflow') {
    return {
      problem: 'Planlı taksitlerin toplamı kartın güncel borcundan yüksek.',
      whyItMatters: 'Borç düşük kalmış olabilir veya bazı taksitler artık geçersizdir; iki olasılık da aynı veriden çıkarılamaz.',
      nextStep: 'Taksit planını ve banka borcunu birlikte kontrol et; ödenen veya iptal edilmesi gereken taksitler olabilir.',
    }
  }

  if (issue.kind === 'cardLedgerDrift') {
    return {
      problem: 'Kartın kayıtlı borcu, borç hareketleri toplamından farklı.',
      whyItMatters: 'Borç hareketleri değişmez kayıttır; fark, hareketlere yazılmadan borcun değiştiği anlamına gelir.',
      nextStep: hasFixAction
        ? 'Hızlı düzeltmeyle borcu hareket geçmişine (gerçek kaynak) göre yeniden hesapla.'
        : 'Kartın borç hareketlerini Kartlar ekranından kontrol et.',
    }
  }

  if (issue.kind === 'accountLedgerDrift') {
    return {
      problem: 'Hesabın kayıtlı bakiyesi, hesap hareketleri toplamından farklı.',
      whyItMatters: 'Hesap hareketleri değişmez kayıttır; fark, hareketlere yazılmadan bakiyenin değiştiği anlamına gelir.',
      nextStep: hasFixAction
        ? 'Hızlı düzeltmeyle bakiyeyi hareket geçmişine (gerçek kaynak) göre yeniden hesapla.'
        : 'Hesabın hareketlerini Kartlar ekranından kontrol et.',
    }
  }

  if (issue.kind === 'cardStatementStatus') {
    return {
      problem: 'Ekstre arşivi beklenen open/paid dışı bir statüde.',
      whyItMatters: 'Bu kayıt geçmiş arşivde duruyor olsa bile raporlar ve sağlık kontrolleri statüyü güvenilir yorumlayamaz.',
      nextStep: hasFixAction
        ? 'Hızlı düzeltmeyle kaydı borca yeniden bindirmeden ödenmiş geçmiş arşive al.'
        : 'Kartlar ekranında ilgili ekstre arşivini kontrol et.',
    }
  }

  if (issue.kind === 'cardDebtSplit' || issue.kind === 'cardStatementTotals') {
    return {
      problem: 'Kart borcunun ekstre, dönem içi veya arşiv kırılımında tutarsızlık var.',
      whyItMatters: 'Ödeme tutarı, aylık yük ve veri sağlığı kontrolleri bu kırılıma göre hesap yapar.',
      nextStep: hasFixAction
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
      nextStep: hasFixAction
        ? 'Hızlı düzeltmeyi uygulayıp taksit planını yeniden hizala.'
        : 'Kartlar ekranında ilgili taksitli harcamayı açıp satırları tek tek kontrol et.',
    }
  }

  if (issue.kind === 'duplicateTransactionCandidate') {
    return {
      problem: issue.payload?.duplicateLevel === 'same_fingerprint'
        ? 'Aynı kartta aynı tarih, tutar, durum ve açıklama parmak izine sahip birden fazla harcama var.'
        : 'Aynı kartta aynı gün ve aynı tutarda, açıklaması benzer ya da eksik olan harcamalar var.',
      whyItMatters: 'Tekrarlanan kayıtlar kart borcunu, kategori harcamasını, bütçe uyarılarını ve mutabakat sonucunu olduğundan yüksek gösterebilir.',
      nextStep: 'Bu sayfadaki karşılaştırma aksiyonunda satırları yan yana kontrol et. İkisi de doğruysa bulguyu kapat; tekrarlanan kayıt varsa yalnız hatalı kaydı kart işlem iptaliyle tersle.',
    }
  }

  if (issue.kind === 'cardExpenseDataQuality') {
    return {
      problem: 'Bazı kart harcamalarında açıklama veya kategori eksik.',
      whyItMatters: 'Eksik açıklama veya kategori, içe aktarma eşleştirme kalitesini düşürür ve analizlerde harcamaların yanlış gruba düşmesine neden olur.',
      nextStep: 'Bu sayfadaki harcama düzenleme aksiyonuyla işaretli kayıtların açıklama ve kategori alanlarını tamamla.',
    }
  }

  if (issue.kind === 'loanTotals' || issue.kind === 'loanInstallmentDueDay') {
    return {
      problem: 'Kredi özeti ile taksit planı birbirinden kopmuş görünüyor.',
      whyItMatters: 'Kalan borç, kalan taksit ve nakit akış projeksiyonu yanlış görünebilir.',
      nextStep: hasFixAction
        ? 'Hızlı düzeltmeyle kredi özetini plana göre güncelle.'
        : 'Kredi planını, kredi kaydını ve banka sözleşmesini birlikte kontrol ederek eksik veya hatalı satırı düzelt.',
    }
  }

  if (issue.kind === 'loanPaidAtMissing' || issue.kind === 'loanPendingPaidAt') {
    return {
      problem: 'Kredi taksitinin ödeme tarihi alanı durumuyla uyuşmuyor.',
      whyItMatters: 'Ödenmiş/bekleyen ayrımı raporlarda ve veri sağlığı kontrollerinde güven kaybına yol açar.',
      nextStep: hasFixAction
        ? 'Tarih alanını hızlı düzeltmeyle senkronize et.'
        : 'Krediler ekranında ilgili taksiti açıp gerçek ödeme durumunu kontrol et.',
    }
  }

  if (issue.kind === 'paymentDueDay' || issue.kind === 'paymentRecurrenceFields') {
    return {
      problem: 'Ödeme takvimi alanları birbiriyle uyuşmuyor.',
      whyItMatters: 'Yaklaşan ödemeler ve aylık çıkış planı yanlış gün veya yanlış kayıtla hesaplanabilir.',
      nextStep: hasFixAction
        ? 'Takvim alanlarını hızlı düzeltmeyle güncelle.'
        : 'Ödemeler ekranında tekrar bilgilerini ve son tarihi kontrol et.',
    }
  }

  if (issue.kind === 'assetShape' || issue.kind === 'budgetMonth' || issue.kind === 'debtShape' || issue.kind === 'cardTypeFields') {
    return {
      problem: 'Kayıt formundaki teknik alanlar seçili türle veya beklenen formatla uyuşmuyor.',
      whyItMatters: 'Özet kartları, dağılımlar ve filtreler bu kaydı yanlış yorumlayabilir.',
      nextStep: hasFixAction
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
    nextStep: hasFixAction
      ? `Hızlı aksiyonlardaki "${resolution.label}" adımını kullan.`
      : `Hızlı aksiyonlardaki "${resolution.label}" adımıyla ilgili çözüm akışını aç.`,
  }
}

type NavigationAction = {
  to: string
  label: string
}

const areaNavigationActions: Record<HealthIssue['area'], NavigationAction> = {
  Varlıklar: { to: '/varliklar', label: 'Varlığı düzenle' },
  Bütçeler: { to: '/odemeler/hedefler', label: 'Bütçeyi düzenle' },
  Kartlar: { to: '/kartlar?section=kartlar', label: 'Kartı incele' },
  Krediler: { to: '/borclar/krediler', label: 'Krediyi incele' },
  Kişiler: { to: '/borclar/kisiler', label: 'Borç veya alacağı incele' },
  Planlı: { to: '/odemeler', label: 'Ödemeyi incele' },
  Maaş: { to: '/varliklar/maas', label: 'Maaş kaydını aç' },
  Hedefler: { to: '/odemeler/hedefler', label: 'Hedefi düzenle' },
}

const cardInstallmentKinds = new Set<HealthIssue['kind']>([
  'cardExpenseAmount',
  'cardSingleInstallments',
  'cardMissingInstallments',
  'cardInstallmentDueMonth',
  'cardInstallmentPostedAt',
  'cardInstallmentCount',
  'cardScheduledDebt',
  'cardScheduledDebtOverlap',
  'cardInstallmentOverflow',
])

const cardStatementKinds = new Set<HealthIssue['kind']>([
  'cardStatementTotals',
  'cardStatementStatus',
  'cardOverduePayment',
])

const cardDetailKinds = new Set<HealthIssue['kind']>([
  'cardDebtSplit',
  'cardTypeFields',
  'cardLedgerDrift',
  'cardSplitDrift',
  'accountLedgerDrift',
])

function startsWithAny(value: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => value.startsWith(prefix))
}

export function navigationAction(issue: HealthIssue): NavigationAction {
  const { id, kind } = issue

  if (id.startsWith('asset-gold-amount-')) return { to: '/varliklar/altin', label: 'Altın kaydını aç' }
  if (id.startsWith('budget-')) return { to: '/odemeler/hedefler', label: 'Bütçeyi düzenle' }
  if (id.startsWith('goal-')) return { to: '/odemeler/hedefler', label: 'Hedefi düzenle' }
  if (id.startsWith('salary-')) return { to: '/varliklar/maas', label: 'Maaş kaydını aç' }

  if (id.startsWith('card-expense-duplicate-') || kind === 'duplicateTransactionCandidate') {
    return { to: '/kartlar?section=islemler', label: 'Kayıtları karşılaştır' }
  }
  // Bu ID'ler artık etkilenen kayıt kümesinin imzasıyla biter
  // (`card-expense-missing-category-3-1a2b`), bu yüzden eşleşme ÖNEK ile yapılır.
  if (
    id.startsWith('card-expense-missing-description')
    || id.startsWith('card-expense-missing-category')
    || kind === 'cardExpenseDataQuality'
  ) {
    return { to: '/kartlar?section=islemler', label: 'Harcamaları düzenle' }
  }
  if (
    id.startsWith('card-scheduled-debt-')
    || id.startsWith('card-installment-overflow-')
    || kind === 'cardScheduledDebt'
    || kind === 'cardScheduledDebtOverlap'
    || kind === 'cardInstallmentOverflow'
  ) {
    return { to: '/kartlar?section=islemler', label: 'Borç ve taksitleri karşılaştır' }
  }
  if (id.includes('stale-installment') || id.startsWith('card-scheduled-')) {
    return { to: '/kartlar?section=islemler', label: 'Döneme dahil et' }
  }
  if (
    startsWithAny(id, ['card-expense-', 'card-installment-'])
    || cardInstallmentKinds.has(kind)
  ) {
    return { to: '/kartlar?section=islemler', label: 'Taksit planını incele' }
  }
  if (
    startsWithAny(id, ['card-archive-', 'card-overdue-statement-', 'card-orphan-statement-debt-', 'card-statement-provision-leftover-'])
    || cardStatementKinds.has(kind)
  ) {
    return { to: '/kartlar?section=ekstreler', label: 'Ekstreleri aç' }
  }
  if (id.startsWith('account-ledger-drift-') || kind === 'accountLedgerDrift') {
    return { to: '/kartlar?section=kartlar', label: 'Hesap hareketlerini incele' }
  }
  if (id.startsWith('card-ledger-drift-') || kind === 'cardLedgerDrift') {
    return { to: '/kartlar?section=kartlar', label: 'Borç hareketlerini incele' }
  }
  if (
    startsWithAny(id, ['card-split-', 'card-unclassified-debt-', 'card-type-fields-', 'card-missing-days-', 'card-limit-'])
    || cardDetailKinds.has(kind)
  ) {
    return { to: '/kartlar?section=kartlar', label: 'Kart borcunu incele' }
  }

  if (id.includes('no-plan')) return { to: '/borclar/krediler', label: 'Planı oluştur' }
  if (
    id.startsWith('loan-installment-')
    || kind.startsWith('loanInstallment')
    || kind === 'loanPaidAtMissing'
    || kind === 'loanPendingPaidAt'
  ) {
    return { to: '/borclar/krediler', label: 'Taksit planını aç' }
  }
  if (id.startsWith('loan-') || kind.startsWith('loan')) {
    return { to: '/borclar/krediler', label: 'Krediyi incele' }
  }

  if (id.startsWith('debt-overdue-')) {
    return { to: '/borclar/kisiler', label: 'Ödeme durumunu güncelle' }
  }
  if (id.startsWith('debt-') || kind === 'debtShape') {
    return { to: '/borclar/kisiler', label: 'Borç veya alacağı düzenle' }
  }

  if (id.startsWith('payment-overdue-')) return { to: '/odemeler', label: 'Ödendi işaretle' }
  if (id.startsWith('payment-') || kind.startsWith('payment')) {
    return { to: '/odemeler', label: 'Ödemeyi düzenle' }
  }

  if (id.startsWith('asset-') || kind === 'assetShape') {
    return { to: '/varliklar', label: 'Varlığı düzenle' }
  }
  if (kind === 'budgetMonth') return { to: '/odemeler/hedefler', label: 'Bütçeyi düzenle' }

  return areaNavigationActions[issue.area]
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
  const resolution = resolveHealthIssue(issue)
  if (!payload || resolution.primaryAction !== 'fix') return []

  const previews: string[] = []
  const updatePreview = previewUpdates(payload.updates)
  const affectedRows = payload.ids?.length ?? 0

  if (issue.kind === 'cardSingleInstallments') {
    previews.push('Harcama kaydı korunur, sadece peşin işlem için oluşmuş taksit planı temizlenir.')
    previews.push(`${affectedRows} taksit planı satırı silinir.`)
  } else if (issue.kind === 'cardMissingInstallments') {
    previews.push(`${payload.installmentNos?.length ?? 0} eksik taksit satırı eklenecek.`)
    previews.push(`Başlangıç tarihi: ${payload.baseDate ? formatDate(payload.baseDate) : 'hesaplanamadı'}`)
    previews.push('Geçmiş için ödeme kaydı üretilmez; plan değişikliği Kartlar akışında yeniden doğrulanır.')
  } else if (issue.kind === 'cardDebtSplit') {
    previews.push(`Ekstre borcu: ${formatCurrency(payload.statementDebt ?? 0)}`)
    previews.push(`Dönem içi kesinleşen: ${formatCurrency(payload.currentPeriod ?? 0)}`)
    previews.push(`Provizyon: ${formatCurrency(payload.provisionAmount ?? 0)}`)
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

  if (resolution.undoPolicy === 'session_snapshot') {
    previews.push('Uygulama öncesi kayıt görüntüsü bu oturumda geri alma için saklanır.')
  } else if (resolution.undoPolicy === 'not_available') {
    previews.push('Kaynak projeksiyonu geri alınmaz; işlem kalıcı denetim fişine yazılır.')
  }
  return previews
}
