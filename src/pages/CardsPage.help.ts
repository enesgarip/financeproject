import type { HelpTooltipContent } from '../components/ui/help-tooltip'

export const cardHelp = {
  summary: {
    calculation: 'Kredi kartı borçları, dönem içi harcamalar ve provizyonlar birlikte okunur; banka kartları ayrıca hesap bakiyesi olarak gösterilir.',
    importance: 'Kart tarafındaki toplam yükü ve eldeki hesap bakiyesini aynı anda görmeni sağlar.',
    source: 'Kartlar, kart harcamaları ve provizyon kayıtları.',
  },
  totalDebt: {
    calculation: 'Ekstre borcu, dönem içi kesinleşen harcama ve provizyon toplamıdır.',
    importance: 'Kart limitini kullanan toplam yükü gösterir.',
    source: 'Kart kaydındaki borç kırılımı ve kart harcama kayıtları.',
  },
  statementDebt: {
    calculation: 'Kesilmiş ekstreye düşmüş, artık ödenebilir olan kart borcudur.',
    importance: 'Son ödeme tarihine kadar ödenmesi gereken gerçek tutarı ayırır.',
    source: 'Kart kaydındaki ekstre borcu ve ekstre kesme işlemleri.',
  },
  currentPeriod: {
    calculation: 'Bu dönem kesinleşmiş ama henüz ekstreye aktarılmamış harcamalar toplanır.',
    importance: 'Bir sonraki ekstreye girecek yükü önceden görmeni sağlar.',
    source: 'Kesinleşmiş kart harcamaları ve dönem bilgileri.',
  },
  provision: {
    calculation: 'Provizyonda bekleyen kart işlemleri toplanır; henüz ödenebilir borç sayılmaz.',
    importance: 'Limitten düşen ama kesinleşmeden ödenmemesi gereken tutarı ayrı tutar.',
    source: 'Provizyon durumundaki kart harcama kayıtları.',
  },
  availableLimit: {
    calculation: 'Kredi limiti veya ortak limit grubundan toplam kart borcu düşülür.',
    importance: 'Yeni harcama için kalan gerçek alanı gösterir.',
    source: 'Kart limiti, ortak limit grubu ve toplam borç kayıtları.',
  },
  limit: {
    calculation: 'Ortak limit grubunda en yüksek limit alınır; tekil kartta kartın kendi limiti kullanılır.',
    importance: 'Aynı limiti paylaşan kartlarda limiti iki kez saymayı önler.',
    source: 'Kart limiti ve ortak limit grubu alanları.',
  },
  usage: {
    calculation: 'Toplam borç, kullanılabilir kredi limitine bölünerek yüzdeye çevrilir.',
    importance: 'Limit doluluğunu ve riskli kullanım seviyesini hızlı gösterir.',
    source: 'Kart borcu, provizyon ve limit kayıtları.',
  },
  cashBalance: {
    calculation: 'Banka kartı türündeki hesapların güncel bakiyeleri toplanır.',
    importance: 'Kart borçlarına karşı eldeki nakit hesabı birlikte görmeyi sağlar.',
    source: 'Banka kartı / hesap bakiyesi kayıtları.',
  },
  provisionsPanel: {
    calculation: 'Provizyon durumundaki kart harcamaları listelenir ve toplamı gösterilir.',
    importance: 'Kesinleşince dönem içine geçecek, iptalde limitten çıkacak işlemleri kontrol eder.',
    source: 'Kart harcama kayıtlarının provizyon durumu.',
  },
} satisfies Record<string, HelpTooltipContent>
