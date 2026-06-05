import type { User } from '@supabase/supabase-js'
import type { HelpTooltipContent } from '../ui/help-tooltip'

export const dashboardHelp = {
  netWorth: {
    calculation: 'Varlıklardan kart, kredi, kişisel borç ve bekleyen fatura/ödeme yükleri düşülür; alacaklar ayrıca gösterilir.',
    importance: 'Alacakları tahsil edilmiş varsaymadan gerçek net değerin artıda mı ekside mi olduğunu gösterir.',
    source: 'Varlıklar, banka kartları, kredi kartları, krediler, planlı ödemeler ve borç/alacak kayıtları.',
  },
  cashFlow: {
    calculation: 'Bu ayki maaş ve alacaklardan; kart ekstresi, kredi, ödeme ve kişisel borç çıkışları düşülür.',
    importance: 'Ay bitmeden nakit açığı oluşup oluşmayacağını erkenden görmeni sağlar.',
    source: 'Maaş geçmişi, ödemeler, kart son ödeme günleri, krediler ve borç kayıtları.',
  },
  periodDebt: {
    calculation: 'Bu ay ödenmesi beklenen kart ekstresi, kredi taksidi, fatura/ödeme ve kişisel borçlar gruplanır.',
    importance: 'Ay içindeki gerçek ödeme baskısını hangi kalemin oluşturduğunu ayırır.',
    source: 'Kart, kredi, ödeme ve borç kayıtlarındaki vade/tarih alanları.',
  },
  nextMonthLoad: {
    calculation: 'Gelecek ayki planlı ödemeler, açık ekstreler, kart taksit planı, kredi taksitleri ve kişisel borçlar toplanır.',
    importance: 'Önümüzdeki ayın yükünü bugünden görüp nakit ayırmana yardım eder.',
    source: 'Ödeme planları, kart taksitleri, kredi taksitleri ve açık borç kayıtları.',
  },
  currentDebt: {
    calculation: 'Kredi kartı toplam borcu, aktif kredi kalan borcu, açık kişisel borçlar ve bekleyen planlı ödemeler toplanır.',
    importance: 'Bugün kapatılması veya yönetilmesi gereken toplam yükü gösterir.',
    source: 'Kartlar, krediler, planlı ödemeler ve borç/alacak ekranındaki açık kayıtlar.',
  },
  totalLimit: {
    calculation: 'Ortak limit grubunda limitler toplanmaz; grup için en yüksek limit alınır, tekil kartlar ayrıca eklenir.',
    importance: 'Kredi limitini olduğundan yüksek göstermeden gerçek kullanım alanını anlatır.',
    source: 'Kartlar ekranındaki kredi limiti ve ortak limit grubu alanları.',
  },
  loanPayment: {
    calculation: 'Aktif kredilerin aylık ödeme tutarları toplanır.',
    importance: 'Her ay düzenli ayrılması gereken kredi nakdini hızlıca gösterir.',
    source: 'Krediler ekranındaki aktif kredi kayıtları.',
  },
  receivable: {
    calculation: 'Durumu açık olan “borç verdim” kayıtlarının tahmini TL değeri toplanır.',
    importance: 'Gelebilecek parayı borç yükünden ayrı görmeni sağlar.',
    source: 'Kişiler ekranındaki açık alacak kayıtları.',
  },
  creditLimit: {
    calculation: 'Her limit grubunda en yüksek limit alınır; grup borcu ise kart borçlarının toplamıdır.',
    importance: 'Özellikle ortak limitli kartlarda kalan alanı daha doğru takip eder.',
    source: 'Kredi kartı limitleri, borç tutarları ve ortak limit grubu kayıtları.',
  },
} satisfies Record<string, HelpTooltipContent>

export function getUserDisplayName(user: User | null) {
  const metadata = user?.user_metadata
  const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name.trim() : ''
  const name = typeof metadata?.name === 'string' ? metadata.name.trim() : ''

  return fullName || name
}

