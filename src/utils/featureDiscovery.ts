import { normalizeSearchText } from './searchText'

export type AppFeature = { id: string; title: string; description: string; group: string; location: string; to: string; keywords: string }

/** Yalnız uygulama özellikleri: finans kayıtları veya tutarlar bu dizine girmez. */
export const appFeatures: readonly AppFeature[] = [
  { id: 'overview', title: 'Finans özeti', description: 'Harcanabilir tutarını ve yaklaşan ödemelerini gör.', group: 'Günlük işlemler', location: 'Özet', to: '/', keywords: 'ana sayfa durum bugün nakit' },
  { id: 'accounts', title: 'Hesaplar ve nakit', description: 'Banka bakiyelerini ve hesap hareketlerini incele.', group: 'Günlük işlemler', location: 'Hesaplar › Hesaplar ve nakit', to: '/kartlar?section=hesaplar', keywords: 'banka cüzdan bakiye hesap hareketi' },
  { id: 'cards', title: 'Kredi kartları', description: 'Kart borçlarını, ekstrelerini ve taksitlerini yönet.', group: 'Günlük işlemler', location: 'Hesaplar › Kredi kartları', to: '/kartlar?section=kartlar', keywords: 'ekstre provizyon limit taksit borç' },
  { id: 'expense', title: 'Harcama ekle', description: 'Hesap veya kart harcaması kaydet; fişten ya da panodan doldur.', group: 'Günlük işlemler', location: 'Hesaplar › Harcama ekle', to: '/kartlar?section=kartlar&panel=manuel', keywords: 'fiş tara fotoğraf pano yapıştır alışveriş gider' },
  { id: 'transfer', title: 'Hesaplar arası transfer', description: 'Kaynak hesabı seçerek para aktar.', group: 'Günlük işlemler', location: 'Hesaplar › Transfer', to: '/kartlar?section=hesaplar&task=transfer', keywords: 'havale eft virman para gönder' },
  { id: 'card-cycle', title: 'Kart döngüsü', description: 'Ekstre ve ödeme günlerine göre kart kullanımını karşılaştır.', group: 'Günlük işlemler', location: 'Hesaplar › Kart döngüsü', to: '/kartlar?section=kartlar&cycle=1', keywords: 'hangi kart kesim günü vade' },
  { id: 'assets', title: 'Varlıklar', description: 'Nakit ve yatırımlarını, değerlerini ve işlem kayıtlarını yönet.', group: 'Birikim ve yatırımlar', location: 'Varlıklar', to: '/varliklar', keywords: 'portföy yatırım fon döviz dolar euro bes' },
  { id: 'gold', title: 'Altın defteri', description: 'Gram ve çeyrek alımlarını, satışlarını ve birikimini izle.', group: 'Birikim ve yatırımlar', location: 'Varlıklar › Altın', to: '/varliklar/altin', keywords: 'gram çeyrek altın alış satış maliyet kar zarar' },
  { id: 'stocks', title: 'Hisseler', description: 'Hisse pozisyonlarını, işlemlerini ve portföy performansını gör.', group: 'Birikim ve yatırımlar', location: 'Varlıklar › Hisseler', to: '/varliklar/borsa', keywords: 'borsa bist hisse senedi temettü' },
  { id: 'salary', title: 'Maaş geçmişi', description: 'Gelir kayıtlarını ve maaş değişimlerini takip et.', group: 'Birikim ve yatırımlar', location: 'Varlıklar › Maaş', to: '/varliklar/maas', keywords: 'maaş zam gelir ücret' },
  { id: 'cars', title: 'Araç giderleri', description: 'Araç başına yakıt, bakım ve diğer masrafları izle.', group: 'Birikim ve yatırımlar', location: 'Varlıklar › Araçlar', to: '/varliklar/araclar', keywords: 'araba otomobil yakıt bakım sigorta muayene' },
  { id: 'loans', title: 'Krediler', description: 'Kredilerini ve kalan taksit planlarını yönet.', group: 'Borç ve ödemeler', location: 'Borçlar › Krediler', to: '/borclar/krediler', keywords: 'kredi banka faiz taksit' },
  { id: 'people', title: 'Kişisel borç ve alacaklar', description: 'Kişilere olan borcunu, alacağını ve takip kayıtlarını gör.', group: 'Borç ve ödemeler', location: 'Borçlar › Kişiler', to: '/borclar/kisiler', keywords: 'kişiler borç verdim aldım tahsilat' },
  { id: 'payments', title: 'Ödemeler ve takvim', description: 'Yaklaşan vadeleri, tahsilatları ve nakit takvimini incele.', group: 'Borç ve ödemeler', location: 'Plan › Ödemeler', to: '/odemeler', keywords: 'ödeme vade fatura takvim son gün' },
  { id: 'payment-plans', title: 'Kayıtlı ödeme planları', description: 'Aylık ve tek seferlik ödeme planlarını düzenle.', group: 'Borç ve ödemeler', location: 'Plan › Ödemeler › Kayıtlı planlar', to: '/odemeler?view=plans', keywords: 'ödeme planla otomatik talimat fatura düzenli sabit gider' },
  { id: 'budget', title: 'Kategori bütçeleri', description: 'Kategori limitlerini ve bu ayki bütçe kullanımını takip et.', group: 'Planlama', location: 'Plan › Bütçe ve hedefler', to: '/odemeler/hedefler', keywords: 'bütçe limit harcama kategori' },
  { id: 'goals', title: 'Birikim hedefleri', description: 'TL, altın ve karma hedeflerini, birikim kaynaklarını yönet.', group: 'Planlama', location: 'Plan › Bütçe ve hedefler › Birikim hedefleri', to: '/odemeler/hedefler#birikim-hedefleri', keywords: 'hedef biriktir acil fon karma' },
  { id: 'monthly-goals', title: 'Aylık hedef takibi', description: 'Her ay ne kadar biriktirdiğini tiklerle takip et; karma hedefte bileşenlere ayrı plan kur.', group: 'Planlama', location: 'Plan › Bütçe ve hedefler › Aylık takip', to: '/odemeler/hedefler#aylik-hedef', keywords: 'aylık plan her ay altın gram çeyrek checklist tik alışkanlık düzenli alım' },
  { id: 'reserves', title: 'Ayrılan para ve kasa', description: 'Belirli amaçlara ayırdığın bağımsız para paylarını yönet.', group: 'Planlama', location: 'Plan › Bütçe ve hedefler › Bağımsız ayrılan para', to: '/odemeler/hedefler#kasa', keywords: 'kasa kova rezerv ayır birikim' },
  { id: 'purchase', title: 'Alsam mı?', description: 'Bir alışverişin önümüzdeki aylara ve hedeflerine etkisini değerlendir.', group: 'Planlama', location: 'Plan › Alsam mı?', to: '/odemeler/alsam-mi', keywords: 'alabilir miyim satın alma karar alışveriş' },
  { id: 'wishlist', title: 'Alınacaklar listesi', description: 'Almak istediğin ürünleri ve bekleme süresini takip et.', group: 'Planlama', location: 'Plan › Alınacaklar', to: '/odemeler/liste', keywords: 'istek ihtiyaç alışveriş bekleyen ürün' },
  { id: 'contexts', title: 'Gider grupları', description: 'Proje, etkinlik veya evcil hayvan giderlerini bir arada gör.', group: 'Planlama', location: 'Plan › Gider grupları', to: '/odemeler/baglamlar', keywords: 'evcil hayvan proje tatil etkinlik grup bütçe' },
  { id: 'monthly-report', title: 'Aylık rapor ve PDF', description: 'Ayın finansal özetini incele, paylaş veya yazdır.', group: 'Analiz ve raporlar', location: 'Analiz › Aylık rapor', to: '/analiz#aylik-rapor', keywords: 'rapor pdf paylaş dışa aktar yazdır' },
  { id: 'month-close', title: 'Ay kapanış kontrolü', description: 'Ekstre, taksit, maaş ve bütçe kontrollerini birlikte gör.', group: 'Analiz ve raporlar', location: 'Analiz › Ay kapanış kontrolü', to: '/analiz#ay-kapanisi', keywords: 'ay sonu kapanış kontrol checklist' },
  { id: 'categories', title: 'Kategori harcama analizi', description: 'Kart ve dönem seçerek harcamaların dağılımını incele.', group: 'Analiz ve raporlar', location: 'Analiz › Kategori harcaması', to: '/analiz#kategori-analizi', keywords: 'nereye harcadım kategori gider grafik ekstre' },
  { id: 'subscriptions', title: 'Abonelik adayları', description: 'Tekrarlayan kart harcamalarından abonelik adaylarını bul.', group: 'Analiz ve raporlar', location: 'Analiz › Abonelik adaylarını incele', to: '/analiz#abonelikler', keywords: 'abonelik netflix spotify tekrarlayan düzenli sabit gider' },
  { id: 'history', title: 'İşlem geçmişi', description: 'Finans hareketlerini zaman sırasıyla incele.', group: 'Analiz ve raporlar', location: 'Analiz › Ayrıntılar', to: '/analiz/detay', keywords: 'geçmiş hareket kayıt aktivite' },
  { id: 'record-search', title: 'Kayıtlarda arama ve dışa aktarım', description: 'Finans kayıtlarını ara ve dışa aktar.', group: 'Analiz ve raporlar', location: 'Analiz › Ayrıntılar › Genel arama ve dışa aktarım', to: '/analiz/detay#kayit-arama', keywords: 'genel arama kayıt csv dışa aktar' },
  { id: 'credit-score', title: 'Kredi notum', description: 'Kredi notunu kaydet ve zaman içindeki değişimini gör.', group: 'Analiz ve raporlar', location: 'Analiz › Ayrıntılar › Kredi notum', to: '/analiz/detay#kredi-notu', keywords: 'findeks kredi notu puan' },
  { id: 'inflation', title: 'Varlık dağılımı ve enflasyon', description: 'Birikiminin dağılımını ve satın alma gücünü incele.', group: 'Analiz ve raporlar', location: 'Analiz › Ayrıntılar › Varlık dağılımı ve enflasyon', to: '/analiz/detay#enflasyon', keywords: 'enflasyon reel değer dağılım satın alma gücü' },
  { id: 'year-report', title: 'Yıl sonu özeti', description: 'Yılın gelir, gider ve birikim özetini gör.', group: 'Analiz ve raporlar', location: 'Analiz › Ayrıntılar › Yıl sonu özeti', to: '/analiz/detay#yil-sonu', keywords: 'yıllık yıl rapor özet' },
  { id: 'zakat', title: 'Zekât hesaplayıcı', description: 'Varlıkların üzerinden zekât hesabını incele.', group: 'Analiz ve raporlar', location: 'Analiz › Ayrıntılar › Zekât hesaplayıcı', to: '/analiz/detay#zekat', keywords: 'zekat zekât nisap hesapla' },
  { id: 'assistant', title: 'Finans asistanı', description: 'Finansal verilerin hakkında sohbet et.', group: 'Analiz ve raporlar', location: 'Analiz › Asistan', to: '/analiz/asistan', keywords: 'yapay zeka ai asistan sor sohbet' },
  { id: 'data-health', title: 'Veri kontrolü', description: 'Kayıtlardaki tutarsızlıkları ve inceleme gerektiren bulguları gör.', group: 'Ayarlar ve kontrol', location: 'Kontrol › Bulgular', to: '/veri-sagligi', keywords: 'veri sağlık düzelt onar tutarsızlık hata' },
  { id: 'backup', title: 'Yedek ve geri yükleme', description: 'Finans verilerini JSON olarak yedekle veya yedekten geri yükle.', group: 'Ayarlar ve kontrol', location: 'Kontrol › Bakım › Yedek ve geri yükleme', to: '/veri-sagligi/islemler#yedek', keywords: 'yedek backup json geri yükle dosya' },
  { id: 'notifications', title: 'Bildirim ayarları', description: 'Hatırlatmaları, bildirim türlerini ve sessiz saatlerini yönet.', group: 'Ayarlar ve kontrol', location: 'Kontrol › Bakım › Bildirim ayarları', to: '/veri-sagligi/islemler#bildirimler', keywords: 'bildirim push hatırlatma sessiz saat izin' },
  { id: 'sms', title: 'SMS otomasyonu ve kayıtları', description: 'Banka SMS kayıtlarını ve otomatik veri giriş durumunu incele.', group: 'Ayarlar ve kontrol', location: 'Kontrol › Bakım › Otomasyon ve teşhis', to: '/veri-sagligi/islemler#otomasyon', keywords: 'sms yapıkredi yapı kredi otomasyon mesaj banka eşleşme' },
  { id: 'client-errors', title: 'İstemci hataları', description: 'Tarayıcıda kaydedilen uygulama hatalarını incele.', group: 'Ayarlar ve kontrol', location: 'Kontrol › Bakım › Otomasyon ve teşhis', to: '/veri-sagligi/islemler#otomasyon', keywords: 'istemci hata hatası client error tarayıcı teşhis' },
]

function fold(value: string) {
  return normalizeSearchText(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i')
}

const indexedFeatures = appFeatures.map(feature => ({ feature, title: fold(feature.title), text: fold(`${feature.title} ${feature.description} ${feature.group} ${feature.location} ${feature.keywords}`) }))

export function searchFeatures(query: string): readonly AppFeature[] {
  const normalized = fold(query)
  const words = normalized.split(' ').filter(Boolean)
  if (!words.length) return appFeatures
  return indexedFeatures.filter(item => words.every(word => item.text.includes(word)))
    .toSorted((a, b) => Number(b.title === normalized) - Number(a.title === normalized) || Number(b.title.startsWith(normalized)) - Number(a.title.startsWith(normalized)))
    .map(item => item.feature)
}

export function featureFavoritesKey(userId: string) { return `denge:feature-favorites:${userId}` }

export function parseFeatureFavorites(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter((id): id is string => typeof id === 'string' && appFeatures.some(feature => feature.id === id)))]
  } catch { return [] }
}
