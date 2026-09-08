# Kullanıcı gözüyle uçtan uca tur — 2026-09-08

Yerel docker + seed (t@t.com) üzerinde bir "ay döngüsü" gerçek kullanıcı gibi
oynandı; her adımda arayüz rakamı DB ile karşılaştırıldı, masaüstü (1440) ve
mobil (375) tam-sayfa ekran görüntüleri açık/koyu temada alındı. **Kod
değiştirilmedi**; bu dosya yalnız bulgu listesidir. Düzeltme kararı ayrı.

## Oynanan senaryo (sırayla) ve sonuç

| # | Adım | Sonuç |
|---|------|-------|
| 1 | Giriş, Özet rakamlarını seed ile karşılaştır | Tümü tutarlı (kart borcu 31.300, ekstre 17.400, likit 223.133, 14. taksit) |
| 2 | Hızlı harcama: Bonus Gold 850 ₺ "Migros Ataşehir" | Kayıt + ledger debit doğru; kategori Market otomatik. **Liste yenilenmedi (B2)** |
| 3 | Taksitli harcama: World 6.000 ₺ / 3 taksit | Borç 6.000, dönem içi 2.000, 3 taksit satırı, gelecek taksit 4.000 — doğru |
| 4 | Provizyonu kesinleştir (MEDIA MARKT 1.500) | reclass olayı, borç sabit — doğru |
| 5 | Bonus Gold ekstresini Vadesiz TL'den tam öde (12.000) | Kart, hesap, iki ledger, ödeme kaydı, arşiv `paid` — doğru |
| 6 | Bonus Platin'e kısmi ödeme (2.000 / 5.400) | Kalan 3.400 açık, "2.000 ödendi" etiketi — doğru |
| 7 | Kredi 14. taksitini Birikim'den öde | Kalan 92.500 / 10 taksit — doğru |
| 8 | Planlı ödeme (kasko, ~4.800) gerçek 5.100 ile **kredi kartından** öde | Ödeme kapandı, karta harcama yazıldı. **B1, B4, B5** |
| 9 | Ali alacağını tahsil et (5.000 → Vadesiz TL) | Kayıt kapandı, hesap +5.000 — doğru |
| 10 | Hesaplar arası transfer (Birikim → Vadesiz 10.000) | Doğru |
| 11 | Hedefe "Ayır" (15.500 → Acil fon kasası) | Kova güncellendi. **Onaysız tek tık + liste yenilenmedi (B3)** |
| 12 | Harcama iptali (850 ₺) | Ters kayıt (credit) + `cancelled` — doğru |
| 13 | Canlı mutabakat: Platin banka 7.900 (uygulama 7.800) → "Farkı düzelt" | Borç 7.900 oldu ama **100 ₺ hiçbir kovaya girmedi (B1)** |
| 14 | Analiz, Ayrıntılar, Asistan, Veri sağlığı | Türetilmiş alanlar tur sonunda da "Tutarlı"; asistan yerelde anahtar yok (beklenen) |

**Test edilemeyenler:** Panodan doldur / SMS (tarayıcı panosu yazılamadı),
kamera/galeri fiş, ekstre PDF importu, ekstre kesimi (kesim 30'unda; elle
kesme arayüzü yok), push bildirimleri, "Ya şöyle olsaydı?" senaryoları.

## Bulgular (önem sırasıyla)

Etiketler: **M** mantık, **A** akış/etkileşim, **G** görsel, **Y** metin.

**Durum (2026-09-08):** Kullanıcı hepsinin düzeltilmesine karar verdi. Paketler:
UX-1 mantık (B1, B4, B5, B6, B11, B12, B15, B27) — ✅ uygulandı;
UX-2 akış (B2, B3, B7, B8, B9, B10, B19, B20, B29); UX-3 görsel/metin (kalanlar).

### Yüksek

- **B1 · M · "Farkı düzelt" borcu artırıyor ama kovaya dağıtmıyor.** Mutabakat
  kartında banka rakamı girilip "Farkı düzelt" denince kart borcu +100 oldu,
  ledger'a `adjustment` (statement/current delta 0) yazıldı; ekstre 3.400 +
  dönem içi 4.400 = 7.800 kaldı. Sonuç: uygulamanın kendi düzeltmesi Veri
  Sağlığı'nda "borç kırılımında eksik pay" bulgusu üretiyor; kart kartındaki
  "Gelecek taksit 0" ile kontrol merkezi toplamı çelişiyor. Ayrıca işlem
  onaysız ve tek tık. Beklenen: fark için kova seçtirmek (varsayılan dönem
  içi) veya en azından onay + "nereye yazıldı" özeti.
- **B2 · A · Hızlı harcama kaydından sonra "Son kart hareketleri" yenilenmiyor.**
  Dönem içi tutar ve "tekrarla" çipleri anında güncellenirken liste eski
  kalıyor (11 kayıt), sayfa yenilenince 12 oluyor. İptal akışında liste
  yenileniyor; yalnız ekleme yolunda invalidation eksik. Kullanıcı "kayıt
  olmadı" sanıp ikinci kez girebilir.
- **B3 · A · Hedefe "Ayır" onaysız çalışıyor ve kasa listesi bayat kalıyor.**
  Tek tıkla 15.500 kovaya taşındı; hemen altındaki Kasa modu (Rezerve 60.000,
  kova 45.000) yenilenmedi, sayfa yenilenince 75.500 / 60.500 oldu. Yanında
  duran "Tekrar ayır" ikinci bir yanlış tıkla çift ayırma yapar.

### Orta

- **B4 · M · Kartla ödenen planlı ödeme aylık raporda çift sayılıyor.** Kasko
  5.100 kredi kartından ödenince hem "Kart harcaması" (Sigorta 5.100) hem
  "Ödenen tutar → Fatura/ödeme 5.100" içinde; "Gelirden kalan" 5.100 eksik.
  Ekstre ödenince aynı para "Kart ödemesi" olarak bir kez daha düşecek.
  Kartla ödeme nakit çıkışı değil; yalnız kart harcaması sayılmalı.
- **B5 · M · Planlı ödeme kategorisi kart taksonomisine sızıyor.** Karta yazılan
  harcama `category='Sigorta'`, `source=NULL`. 14+1'lik kart kategori
  paletinde "Sigorta" yok → kategori dağılımında etiketsiz/renksiz kalem.
  Eşleme (Sigorta→Finansman/Fatura) + `source='payment_auto'` beklenir.
- **B6 · M · Kategori dağılımı toplamı yalnız gösterilen 7 kalemi topluyor.**
  `AnalysisPage.wealth.tsx` `categoryTotals.slice(0, 7)` → "Bu ay 25.350"
  derken aylık rapor "Kart harcaması 25.850" diyor (Abonelik 200 + Eğlence 300
  düştü). Aynı ekranda iki farklı "bu ay" toplamı. Toplam tam olmalı, 8+
  kalem "Diğer" olarak birleşmeli.
- **B7 · A · Kart harcaması düzenlenemiyor.** İşlem satırı menüsü yalnız
  "Taksitlendir / İptal et". Yanlış tutar/tarih/kategori için iptal + yeniden
  giriş gerekiyor (iki ledger olayı). Sen "tek menü" kararı verdin ama
  "Düzenle" yokluğu günlük kullanımda en sık sürtünme olacak.
- **B8 · A · Planlı ödeme listesinden "Öde" yok.** Kart menüsü "Düzenle / Sil";
  ödeme ancak takvimde günü seçince açılan "Seçili gün" panelinden yapılıyor.
  Özet'te "Öde" var, Plan sayfasında yok — tutarsız.
- **B9 · M · Ödeme diyaloğu tarihi planlanan gün, bugün değil.** Kasko
  8 Eylül'de ödendi, diyalog "Tarih: 28 Eyl" gösterdi ve değiştirilemiyor;
  `payments.due_date` 28 Eyl kaldı, kart harcaması bugüne yazıldı. Geçmişe
  bakınca "28'inde ödendi" görünür. Ödeme tarihi alanı (varsayılan bugün)
  gerekli. Aynı durum kredi taksiti için de geçerli (5 Eki taksiti 8 Eyl'de
  ödendi, `paid_at` bugün ama arayüzde erken ödeme izi yok).
- **B10 · A · Ödenen planlı ödeme takvimden siliniyor.** Kasko ödenince 28 Eyl
  hücresi boşaldı, "Takvim temiz · bu ay 1 kayıt ödendi" tek iz. Ay içinde
  bugün yapılan 23.250 ₺ çıkış (ekstre + kısmi + taksit) takvimde hiç yok.
  Kullanıcı aya dönüp "ne ödedim" göremiyor. Ödenmiş kayıtlar soluk/üstü
  çizili kalmalı.
- **B11 · M · "Beklenen giriş" geçmiş maaşı sayıyor.** 8 Eylül'de takvim
  "Beklenen giriş 110.000" (1 Eylül maaşı + Ali); maaş 7 gün önce yatmış
  sayılıyor (Özet bunu 1 Ekim'e atıyor). Aynı ay için iki sayfa iki farklı
  varsayım. Not: maaşın gerçekten yattığını işaretleyecek bir akış yok;
  hesap bakiyesi elle "Para geldi" ile güncelleniyor.
- **B12 · M · İki farklı "kart borcu sonrası nakit".** Özet: 191.833 (döviz
  nakit dahil, provizyon dahil). Hesaplar: 135.190 (yalnız banka hesabı,
  provizyon hariç). Aynı kavram, iki rakam, açıklama dipnotta.
- **B13 · M · Altın iki modelde yaşıyor.** Varlıklar'da "Gram altın 60 g
  411.790 ₺" varken Altın sekmesi "Henüz altın işlemi yok" (gold_lots boş).
  Kullanıcı hangisine güveneceğini bilemez; Altın sayfası varlık kaydını
  görmeli ya da varlık kaydı lot'a dönüştürülmeli.
- **B14 · G · Masaüstü sayfaların sağ yarısı boş.** Krediler (tek kart sol
  üçte bir), Analiz (Kategori harcaması ve Abonelik kartları 5/12 genişlikte,
  yanı boş), Özet (sağ sütun 720 px'te bitiyor, sol 1.850 px). 1440'ta
  belirgin.
- **B15 · A · "Ay sonuna kalan" tahsil edilmemiş alacağı nakit sayıyor.**
  140.933 = ... + Ali 5.000. Alacak gelmezse rakam 5.000 iyimser. Ayrı satır
  ("+5.000 beklenen tahsilat") daha dürüst.

### Düşük

- **B16 · Y · Aktivite akışında çift satır ve ASCII Türkçe.** Her işlem hem
  "Borç artışı — Borç değişimi (otomatik kayıt)" hem "Vatan Bilgisayar — 3
  taksitli kart harcamasi." olarak iki kez; geçmiş notları "odendi, islendi,
  Pesin, arasi" (Türkçe karakter yok). Ledger notu her zaman "Borç değişimi
  (otomatik kayıt)"; açıklama taşımıyor.
- **B17 · Y · Taksit takvimi "Eylül 0 ₺ · Taksit yok"** derken hemen üstte
  "1/3. taksit · Bu dönem 2.000" var (ilk taksit dönem içine yazıldığı için).
  Ayrıca "4.000,00 ₺· 2 taksit" boşluk hatası.
- **B18 · Y · Hızlı harcama başlığındaki çip iki anlamlı.** Seçili karta göre
  "Provizyon 1.500" ya da "Toplam 6.000" (kart borcu) yazıyor; formun toplamı
  sanılıyor.
- **B19 · A · Varsayılan kategori "Market".** Açıklama eşleşmeyince (Vatan
  Bilgisayar) kategori Market kalıyor; "Diğer" daha güvenli.
- **B20 · A · "Doğrulanmadı" uyarısı boş kart için de.** World (0 borç, hareket
  yok) "3 kart kontrol bekliyor"a giriyor.
- **B21 · Y · Mobil takvimde "−5b" kısaltması** 4.800'ü 5 bin gösteriyor; "+105b".
  "4,8b" ya da tam rakam.
- **B22 · Y · Kırpılan etiketler (mobil + 1440).** "Araç kask…", "Kayıtlarda ar",
  kur kaynağı satırı "8 Eyl 15:58 iti…".
- **B23 · Y · "…takip kaynağından hesaplanır.Bu kovayı kaynak yap"** — cümle ile
  buton arasında boşluk yok.
- **B24 · G · Hedefler sayfasında bütçe iki kez listeleniyor** (ilerleme
  çubukları + yalnız "LİMİT" gösteren kartlar).
- **B25 · Y · Asistan hata metni ham env adı:** "GEMINI_API_KEY tanımlı değil."
- **B26 · A · Vadeler listesi "Tüm vadeleri göster (7)"** 6 satır gösterip 7
  diyor; Netflix (12 Eki) 30 günün dışında, Ali alacağı (tahsilat) listede yok.
- **B27 · M · 6 aylık nakit projeksiyonu gelecek kart taksitlerini (4.000)
  düşmüyor.** Kasım/Aralık net'i World taksitlerini içermiyor.
- **B28 · Y · Seed verisi Veri Sağlığı'nda 4 uyarı üretiyor** (Ali `amount`,
  altın/hisse/BES teknik alanları). "0 hata" doğru ama "temiz seed" iddiası
  için bunlar da giderilmeli.
- **B29 · A · Kredi taksit diyaloğunda "İşlem sonrası" satırı** hesap seçilene
  kadar yok; ekstre diyaloğuyla aynı ama kaynak hesap ön-seçili değil (ekstre
  diyaloğunda da değil). Kullanıcı hep aynı hesaptan ödüyorsa son kullanılan
  hesap hatırlanmalı.

## Doğru çalıştığı teyit edilenler

- Tüm para invariantları: her adımdan sonra kart borcu = ledger toplamı,
  hesap bakiyesi = ledger toplamı, kova toplamı ≤ borç, kredi özeti = ödenmemiş
  taksitler. Tur sonunda Veri Sağlığı "Türetilmiş alan tutarlılığı: Tutarlı".
- Taksitli harcama modeli (borç = tam tutar, dönem içi = ilk taksit, kalan =
  gelecek taksit), provizyon reclass, kısmi ekstre ödemesi, iptal = ters kayıt.
- Aile ortak limiti tek sayılıyor (200.000), limit % her sayfada tutarlı
  (yuvarlama farkı %15,7 / %16 hariç).
- Nakit projeksiyonu Ekim rakamı doğru (ödenen 14. taksit düşülmüyor).
- Yatay taşma yok (22 rota × 2 genişlik), konsolda uygulama hatası yok.

## Yöntem notları (tekrar için)

- Yüksek çözünürlüklü görüntü: scratchpad `shots.mjs` (Playwright, giriş +
  22 rota × 1440/375, `colorScheme` ile koyu tema). Tarayıcı paneli 1440
  emülasyonunda tıklamaları panel boyutuna kırpıyor → buton tıklamaları JS ile,
  metin girişi `form_input` ile yapıldı.
- Docker `psql -f /tmp/x.sql` Git Bash'te `MSYS_NO_PATHCONV=1` ister.
