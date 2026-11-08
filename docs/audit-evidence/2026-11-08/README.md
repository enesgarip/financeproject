# 8 Kasım 2026 mantık denetimi kanıtları

Ana rapor: `docs/LOGIC_UI_AUDIT_2026-11-08.md`.
Bu dosyalar mevcut hatalı davranışı gözlemleyen araştırma kayıtlarıdır;
yeşil sonuçları hatanın düzeltildiği anlamına gelmez.

- `browser-observations.spec.txt`: dokuz sentetik Chromium gözlemi. Tekrar
  çalıştırmak için geçici olarak `tests/e2e/audit-temporary.spec.ts` yoluna
  kopyala ve `npm exec -- playwright test audit-temporary.spec.ts --workers=1`
  çalıştır. Dış istekler sentetik yanıtlanır/engellenir.
- `domain-observations.test.txt`: M04 ve M11 saf hesap gözlemleri. Geçici
  olarak `src/audit-temporary.test.ts` yoluna kopyala ve
  `npm exec -- vitest run src/audit-temporary.test.ts` çalıştır.
- `browser-results.txt`, `domain-results.txt`: bu gözlemlerin son koşu çıktısı.
- `live-results.txt`: yerel gerçek backend'deki iki başarı ve T01 seçici
  hatası. Logda bağlantı anahtarı/oturum token'ı yoktur.
- `audit-budget-stale.png`: aynı ekranda 2.000 TL üst toplam / 1.000 TL satır.
- `audit-privacy-leak.png`: gizlilik açıkken cümlelerde 33.000 TL.
- `audit-unknown-reserve.png`: bilinmeyen rezervle olumlu karar.
- `audit-target-double-reserve.png`: eksik hedef çözümü ve tekrar ayırma sonucu.
- `audit-loan-double-create.png`: ana kayıt başarılı/plan hatalıyken açık form.
- `audit-loan-false-empty.png`: sorgu hatasının boş ödeme planına dönüşmesi.
- `audit-schema-green.png`: eksik tabloya rağmen başarılı erişim metni.

Görüntüler sentetik hesap/veri içerir. Senaryo saati 26 Ekim 2026'ya sabittir;
araştırmanın gerçek tarihi 8 Kasım 2026'dır. Yeniden koşu sonrası geçici test
dosyalarını kaldır; mevcut kusuru bekleyen testleri normal pakete ekleme.

SQL ek gözlemi yalnız yerel container'da BEGIN/ROLLBACK içinde yapıldı:
9.000 TL rezervli geçici kovada aynı `contribute_to_goal_bucket` çağrısı
2.000 TL ile iki kez çalıştırılınca 11.000 ve 13.000 döndü. Kalıcı kayıt yok.
