# Denge — Türkçe arayüz sözlüğü

16 Ekim 2026. Kullanıcının dil/sözlük incelemesi isteğiyle oluşturuldu.
Bu belge kullanıcıya görünen kelimelerin kaynağıdır. Finans tanımları için
`FINANCE_RULES.md`, görsel sözleşme için `UI_ARCHITECTURE.md` geçerlidir.
DB enum'u, rota, RPC, kategori eşleştirmesi veya geçmiş kayıt metni bu
sözlüğe uydurmak için değiştirilmez.

## Ses ve cümleler

- Kısa, doğal ve sakin Türkçe; yönlendirmelerde “sen” hitabı.
- Başlık konuyu, düğme yapılacak işi, sonuç mesajı gerçekleşen sonucu söyler.
- Cümle düzeni kullanılır: “Ödeme kaydet”, “Banka karşılaştırması”.
- Kaydetme bitmeden başarı söylenmez. Beklerken “Kaydediliyor…”, sonunda
  “Ödeme kaydedildi.”; hata durumunda “Ödeme kaydedilemedi.” ve mevcut hata
  nedeni/uygulanabilir çözüm. Kanıt olmadan “ağ sorunu”, “eksik tablo” gibi
  neden veya “Tekrar dene” gibi tehlikeli yinelenen yazma önerisi uydurulmaz.
- Tahmini, beklenen, gerçekleşen ve kayıtlı tutar aynı şey değildir.
- Kritik açıklama yalnız title/hover içinde saklanmaz. Uzun metin dar
  ekranda sarılır; açıklamayı kaldırarak veya tutarı keserek kısaltılmaz.

## Finans kavramları

| Kullanılan ad | Anlamı ve sınırı |
| --- | --- |
| Harcama | Mal/hizmet için yapılan harcamanın kaydı. Kart harcaması eklemek, kart borcu ödemek değildir. |
| Ödeme | Fatura, taksit veya borca ilişkin ödeme kaydı. Uygulama bankadan para göndermez; uygulamadaki bakiye/borç kaydı mevcut kurallarla güncellenir. |
| Tahsilat | Beklenen alacağın alınmasına ilişkin kayıt. “Gelir” ile her yerde birbirinin yerine kullanılmaz. |
| Planlı ödeme | Fatura, kira, abonelik veya tek seferlik gelecekteki ödeme kaydı. Henüz ödendiği anlamına gelmez. |
| Bakiye | Hesapta kayıtlı para tutarı. Kart borcu düşülmüş tutar veya harcanabilir tutar değildir. |
| Kullanılabilir limit | Kart limitinin kullanılabilen bölümü. “Limit boşluğu” denmez; nakit bakiye gibi sunulmaz. |
| Ekstre | Bankanın kesilmiş kart ekstresi. “Ödenecek ekstre” kısmi ödemeler düşülmüş kalandır. |
| Dönem içi harcama | Henüz kesilmiş ekstreye girmeyen kesinleşmiş kart harcamaları. |
| Provizyon | Henüz kesinleşmemiş kart harcaması. Gerektiğinde yakın açıklama “Bekleyen harcama”dır; kesin borç gibi anlatılmaz. |
| Toplam kart yükü | Ekstre, dönem içi harcama, provizyon ve gelecek taksitleri kapsayan mevcut toplam. Sadece bugünkü ödenecek borç diye yeniden adlandırılmaz. |
| Net değer | Varlıklardan borçlar çıkarıldıktan sonraki değer. Hesap bakiyesi veya ay sonu tahmini değildir. |
| Ay sonuna kalan | Özet'teki mevcut harcanabilir tutar hesabı. Tampon, ayrılan para ve beklenen alacak açıklamaları rakamın yanında kalır. |
| Güvenlik tamponu | Harcanabilir tutardan düşülen, elde tutmak istediğin tutar. |
| Tahmin | Modelin/önceki kayıtların hesapladığı değer. Kullanıcı metninde “projeksiyon” yerine kullanılır; kesinlik iddiası taşımaz. |
| Beklenen gelir | Henüz gerçekleşmiş kabul edilmeyen gelir. Hesaptaki para diye sunulmaz. |

## İşlemler ve durumlar

| Önceki/kaçınılan ifade | Tercih edilen ifade | Kullanım |
| --- | --- | --- |
| Öde / Ödeme yap | Ödeme kaydet | Ödeme kayıt ekranını açan eylem |
| Ödemeyi tamamla / Ekstreyi öde | Ödemeyi kaydet | Kayıt formunun son düğmesi; başlık ödemenin türünü belirtir |
| Tahsil et / Tahsilatı tamamla | Tahsilat kaydet / Tahsilatı kaydet | Ekranı açma / formu kaydetme |
| Transfer yap | Transfer kaydet | Hesaplar arasındaki aktarım kaydı; banka işlemi başlatmaz |
| Mutabakat | Bankayla karşılaştırma | Bankadaki tutarla uygulamadaki tutarı kontrol etme |
| Mutabık / Hiç mutabık olunmadı | Uyumlu / Karşılaştırılmadı | Kontrolün sonucu; kontrol yapıldıysa fark yine açık olabilir |
| Manuel | Elle girilen / Kendim ödüyorum | Kayıt girişi / ödeme yöntemi seçimi; teknik `manual` anahtarı korunur |
| Aksiyon | İşlem / Yapılabilecek işlemler | Kullanıcının yapabileceği somut iş |
| App | Uygulama | Kullanıcıya görünen açıklamalar |
| Ödeme çekmecesi | Ödeme kaydı | Kullanıcının amacı; panelin teknik biçimi anlatılmaz |
| Kova | Borç bölümü / Borç dağılımı | Ekstre, dönem içi harcama ve provizyon ayrımının teknik adı yerine |
| Olmadı / İşleniyor | İlgili işlem tamamlanamadı / Kaydediliyor… | Konuyu ve güncel durumu belirten mesaj |
| Günü eksik | Vade günü tanımlı değil | Hangi bilginin eksik olduğunu söyler |
| Takip dışı (ödeme hesabı) | Başka bir yerden ödendi | Alt açıklamada kayıtlı hesapların bakiyesinin değişmediği söylenir |

“Ödendi say” ayrı bir geçiştir: geçmişte bankada yapılmış ödemeyi yeni nakit
hareketi oluşturmadan işaretler. “Ödeme kaydet” ile birleştirilmez. “Sil”,
“Geri al” ve “Düzelt” de farklı işlemlerdir; tek bir “Tamam” düğmesinde gizlenmez.

## Uygulanan kapsam ve bakım

Ödeme/tahsilat eylemleri Özet, Ödemeler, kartlar, krediler, kişiler ve Veri
kontrolü üzerinden aynı kayıt dilini kullanır. Ortak formun başlığı, hesap
etiketi, önizleme ve son düğmesi birlikte düzenlenmiştir. Teknik arayüz
ifadeleri banka karşılaştırması, bildirim ayarları ve iki banka içe aktarma
panelinde sadeleştirilmiştir. Girişteki sabit tutarlar açıkça örnektir.

Bu çalışma bütün olası sunucu hata metinlerinin veya geçmiş kayıt
açıklamalarının yeniden yazıldığı iddiasını taşımaz. Yeni ekran/metin
eklenirken önce bu sözlük, sonra ilgili işlemin gerçek sonucu kontrol edilir.
Uygulama ve doğrulama kaydı: `UI_COPY_REVIEW.md`.
