# Sadeleştirme uygulama planı — 26 Ekim 2026

Durum: **Dört sunum paketi uygulandı.** Kullanıcı 26 Ekim'de uygulamayı ve
kontroller uygunsa canlıya alınmasını istedi. İnceleme sırasında elle finans
kaydı/ayar değiştirilmedi; uygulama ve tarayıcı testleri sentetik verilerle yapıldı.
Finans hesabı, veri modeli ve mevcut otomasyonların yazma sözleşmesi korunur.
Kanıtlar: `docs/SIMPLIFICATION_AUDIT_2026-10-26.md`.

## Hedef düzen

Her işin ayrıntılı yönetimi bir ekranda; diğer yerlerde kısa özet, bağlamsal
eylem ve bağlantı. Bir ekran açıldığında önce mevcut durum ve yapılacak iş
görünmeli. Uzun kayıt listeleri, teknik kanıt ve giriş formları isteğe bağlı
açılmalı. Hata, gerçek fark ve finansal kapsam açıklaması saklanmamalı.

## Tamamlanan inceleme

- [x] Repo kuralları, UI sözlüğü ve mevcut kaynak haritası okundu.
- [x] İlk 16 bulgu plan kapsamına alındı.
- [x] 19 içerik rotası Chrome'da masaüstünde açıldı.
- [x] Hesap/kart ayrıntısı, borç kırılımı, dönem hareketleri ve Sadece takip incelendi.
- [x] Transfer kısayolunun listeye gitmesi canlıda doğrulandı.
- [x] Harcama ekle formu boş olarak açıldı; kaydetme yapılmadı.
- [x] Alsam mı?'da kaydedilmeyen örnek hesap incelenip örnek tutar temizlendi.
- [x] Canlı tarama sonunda uygulama Özet'e döndürüldü.
- [x] Bulgulara kaynak/canlı kanıt ayrımı ve mevcut veride denenmeyen durumlar eklendi.

## Paket 1 — Günlük kullanım ve girişlerin bulunması

Bu paket mevcut bileşenlerde dar sunum değişiklikleriyle uygulandı. Kart listesi ve Harcama ekle'nin zaten sade ana yapısı korunur.

- [x] **1A / S03:** Transfer kaydet → kaynak hesap seçimi → mevcut para hareketi
  formunun transfer modu. Eski `hesap-merkezi` panelini geri getirme.
- [x] **1B / S01–S02:** Özet'te ana tutar ve açıklaması, en çok üç öncelikli vade,
  tümünü açma yolu; hesap listesi ve kart kırılımı kısa özet bağlantılarına iner.
  Kart ödeme döngüsünün ayrıntıları kartların bağlamında erişilebilir kalır.
- [x] **1C / S04:** Ödemeler'de Yaklaşanlar/Takvim ile Kayıtlı planlar yönetimini
  ayır; seçili ay ve kayıtlı görünüm tercihini koru. Kredi ve tahsilat ikinci kez
  plan kaydına dönüştürülmez.
- [x] **1D / S13:** Araçlar/Gider grupları özet ve hatırlatıcıyla başlar.
  Gider ekleme, yönetim ve kart ilişkilendirme açık düğmelerle açılır.
  Uzun atama listesinde arama/filtre ve kademeli gösterim değerlendir.
- [x] **1E / S17:** Kart hareketlerinde dönem toplamı ile son hareket listesini
  açık adlandır; kapsamları karıştırma. Mevcut kart/döküm URL'leri çalışmalı.
- [x] **1F / S22:** Kontrol'de önce bulgular ve durum; hesap karşılaştırmaları
  kısa satırdan seçilerek açılır. Gerçek farklar ve kapatılmış uyarı sayısı görünür.
- [x] **1G / S15:** Plan araçları arasında her sayfada yeniden menü açma adımını
  azalt. Masaüstü kısa araç satırı ve mobil seçici prototipini karşılaştır;
  ana gezinme ve onaylı adlar korunur.

**Kabul:** ilgili işe bir açık eylemle ulaşılır; özetlere ulaşmak için uzun form
ve atama listesi geçilmez. Transfer formunu açmak kayıt üretmez. Yaklaşan
ödeme/tahsilat kısayolları ve kesin/tahmini kapsam açıklamaları erişilebilir kalır.

## Paket 2 — Analiz ve kişi bilgisini toplama

- [x] **S05/S23:** Analiz'de abonelikler kısa toplam/değişim; plan yönetimine
  bağlantı. Yeni/belirsiz adaylar ayrı incelemede; zaten kayıtlılar isteğe bağlı.
  Uzun sağ sütun yüzünden solda uzayan boş panel kalmaz.
- [x] **S06:** Net değer için tek ayrıntılı trend; üstte yalnız değer/değişim.
  Canlı hesap ile tarihsel fotoğraf farklıysa kapsam/zaman etiketleri korunur.
- [x] **S07:** Aylık rapor kontrol listesinden önce gelir; ay kapanışı gerektiğinde
  kısa uyarı ve adlandırılmış ayrıntı olarak açılır.
- [x] **S08/S24:** Ayrıntılar'da İşlem geçmişi, Dönem raporları, Diğer araçlar
  grupları; kredi notu kısa özet ve kompakt tarihçe olur. Sekme adı değişikliği
  ayrıca kararlaştırılmadan yapılmaz.
- [x] **S19:** Tutar değiştirmeyen teknik olayların sunumu ayrışır; bütün olaylara
  ulaşma yolu korunur. Geçmiş/ledger kayıtlarına yazılmaz.
- [x] **S21:** Kişi özeti Kişiler'e taşınır veya orada birincil hale gelir;
  borç/alacak kayıtları açılan ayrıntıda kalır. Analiz bağlantı verir.

**Kabul:** aynı planın tam listesi birden fazla ekranı doldurmaz; kişi kaydı
birleştirilmez; eşleşme, aktif uyarı ve geçmiş kanıtı kaybolmaz. Asistan'ın sohbet
akışı korunur; yeni konuşma sistemi bu paket için gerekli değildir.

## Paket 3 — Portföy ve basit tarihçeler

- [x] **S12:** Varlıklar genel dağılımı gösterir; altın/hisse ayrıntısı ilgili
  ekrana açık bağlantıyla erişilir. Genel portföyün tüm pozisyonları varsayılan
  büyük işlem kartlarıyla tekrarlaması azaltılır.
- [x] **S20:** Hisseler'de Pozisyonlar/İşlem geçmişi ayrımı; Baştan beri görünümünde
  aynı metrikler tekrar çizilmez. Kaynak ve zaman bandı BIST bağlamını anlatır.
- [x] **S18:** Altın tek türde tek miktar/değer özeti; çok türde gerekli kırılım.
- [x] **S19:** Kanıtlı teknik aktarım bilgisi kayıt ayrıntısında; kullanıcı notu
  korunur, ham veriye dokunulmaz.
- [x] **S24:** Maaş ve kredi notu gibi tarihçelerde tarih/değer/değişim satırları;
  ayrıntılı grafik isteğe bağlı. Aynı yaklaşımın plan listesindeki gereksiz
  aylık/tahmini metin tekrarını azaltması değerlendirilir.

**Kabul:** gerçek Al/Sat, geçmiş defter kaydı ve değer güncelleme farklı eylemler
olarak anlaşılır. Varlık toplamı ve kanonik pozisyon hesabı değişmez.

## Paket 4 — Planlama dili, hedefler ve bakım

- [x] **S09:** Bütçe ilerlemesi başlığa yakın; hedef ve bağlı rezerv aynı görsel
  bağlamda, bağımsız ayrılan para kompakt bölümde. Dolu kasa senaryosu temsili
  veriyle ayrıca görülmeli; canlı incelemede kasa boştu.
- [x] **S10:** Alınacaklar'da ürün/fiyat/bekleme/kısa durum; ayrıntılı senaryo
  Alsam mı?'ya gider. Üç soruluk testi kaldırma kararı ayrıca verilir.
- [x] **S11:** Alsam mı? tutar → ödeme şekli → kartsa taksit → sonuç sırasına
  gelir; uzun kart kıyasları ikincil olur. Senaryo hesabı değiştirilmez.
- [x] **S16:** Kasa/kova/rezerve metinleri için günlük Türkçe adayları; gerçek
  ayırma etkisi ve hedef kaynağı ilişkisi açık kalır.
- [x] **S14:** Bakım'da Yedek ve geri yükleme / Bildirimler / Otomasyon ve teşhis
  grupları; silme alt bölümde. Mevcut onay/yedek koşulları korunur.
- [x] **S15:** Borçlar'dan kart borçlarına ve Plan'dan maaşa bağlamsal bağlantı;
  maaşı taşıma veya ana menüyü değiştirme ancak ayrıca kararlaştırılır.

## Uygulama ve doğrulama sınırı

- Finans hesabı, RPC, SQL, ledger, otomatik bakım ve veri modeli bu sunum
  planında değiştirilmez. Para/rezerv/toplam formülleri aynı yardımcıları kullanır.
- Görünür satırları gruplamak kayıtları birleştirmek değildir. Aynı görünen kişi
  adları için kimlik eşitliği varsayılmaz. Sadece takip finans toplamına katılmaz.
- Yeni görünümler önce üretimden bağımsız temsili verilerle incelenir: aktif ve
  kapalı kredi; dolu/boş bütçe, kasa ve hedef bağı; tek/çok altın türü;
  açık ekstre, kısmi ödeme, provizyon ve geçmiş kayıt; bekleyen/tamamlanan ürün.
- 320/390px ve masaüstü, açık/koyu tema, klavye/odak, gizlilik, hata/yükleme,
  doğrudan URL ve geri dönüş doğrulanır. Canlı finansal yazma testi yapılmaz.
- Paketlerin değişen akışları için anlamlı regresyonlar ve `npm run verify`;
  gereken davranış/rota kontrolleri mevcut test desenleriyle tamamlanır.
- Her uygulama adımında `docs/BACKLOG.md`, `docs/AI_CONTEXT_INDEX.md` ve ilgili
  domain/UI sözleşmesi aynı değişiklikte güncel kalır. Önceden onaylı adların
  sözlüğü kaynak olarak korunur. Canlıya alma kullanıcı tarafından ayrıca onaylandı; feature branch → PR → yeşil CI → main merge hattı kullanılır.

## Uygulama ve doğrulama kaydı

- Özet ilk üç vadeyi gösterir, kalanlar açılır; ayrıntılı hesap/kart dökümleri
  ilgili ekrana bağlanır. Kart ödeme döngüsü Kartlar'daki açılır bölümdedir;
  Özet kısayolu `cycle=1` ile doğrudan açar. Transfer `task=transfer` ile kaynak
  seçtirir ve mevcut formu transfer modunda açar.
- Ödemeler takvim ayını görünüm değişiminde korur; `view=plans` ve `new=1`
  kayıtlı planları açar. Plan araçları masaüstünde sabit sekme, mobilde seçicidir.
- Araç/grup özetleri formlardan önce; atama listeleri arama ve ilk 10/tümü
  görünümü sunar. Yönetim boş durumda otomatik açılır.
- Analiz aylık raporla başlar. Ay kapanışının uyarı sayısı kapalıyken de görünür.
  Tek ayrıntılı net değer trendi kalır; abonelikler toplam ve plan bağlantısıdır.
  Aday incelemede planlanmışlar isteğe bağlıdır. Kişi özeti Kişiler'dedir;
  Ayrıntılar bağlantı verir, kayıt kimliği ve kişi eşleştirme hesabı değişmez.
- Varlık kayıtları isteğe bağlı, hisse pozisyonu/geçmişi ayrı görünümdür.
  Gerçek Al/Sat bağlantısı genel varlık kayıtlarını açar; baştan beri işlem toplamları isteğe bağlı hesap ayrıntısında korunur. Kur eşitlemesi gizli
  bant bileşeninde çalışmaya devam eder; BIST kaynak/zaman açıklaması görünür.
- Teknik sıfır tutarlı kart olayları filtreyle açılır; geçmiş silinmez.
  Altın aktarım notunda yalnız tanınan `gold-import` öneki katlanır.
- Hedefe bağlı paylar hedef kartında; bağımsız pay yönetiminde hedefe bağlıları
  açma seçeneği vardır. Toplam ayrılan para her iki türü içerir ve bunu söyler.
  Alınacaklar kısa karar + açılır ayrıntı gösterir; üç soruluk test korunur.
- Bakım yedek/geri yükleme ile başlar; bildirim, teşhis ve sıfırlama ayrı
  açılır bölümlerdir. Kontrol'de gerçek bulgular rutin banka formlarından öncedir.

Doğrulama: `npm run verify` (169 dosyada 1.777 test, 7 Node guard,
lint/coverage, 0 production dependency açığı, TypeScript/build, bundle bütçesi,
6 edge tip kontrolü). `tests/e2e/simplification.spec.ts` dış isteklerin tamamını
sentetik yanıtlar: 19 rota × 320/390/1280px; açık/koyu tema, taşma ve JS hatası;
transfer formu, plan yönetimi, teşhis erişimi, klavye, gizlilik, dolu/bağlı paylar,
kredi notu doğrudan ekleme ve tek/çok tür altın notları. Mevcut ödeme, cache,
borç/provizyon/kısmi ödeme, hedef kaynağı ve hata testleri korunur. Canlıda
finansal yazma testi yapılmaz; bu kontroller bütün veri durumlarının görsel
sertifikası değildir.
