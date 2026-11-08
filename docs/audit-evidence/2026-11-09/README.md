# Düzeltme sonrası görsel kabul — 9 Kasım 2026

Bütün kayıtlar sentetiktir; dış servisler engellenmiştir. Üretim verisi yoktur.
`tests/e2e/audit-fixtures.ts` ve `tests/e2e/audit-remediation.spec.ts` kaynakları.

- `budget-320.png`: milyonluk harcama/limit, 320px, ayrı etiketler ve taşmayan sayı.
- `gram-trend-light.png`, `gram-trend-dark.png`: seçili gram serisi,
  20→11 gram, −9 gram değişim, doğru en yüksek/en düşük ve gram ekseni.
- `month-close-light.png`, `month-close-dark.png`: opak detay metni,
  iki temada canvas tabanlı bileşik renk kontrastı >= 4,5:1 kabulü.

PNG'ler viewport görüntüsüdür; sayfalar normal kaydırılır ve sabit navbar
viewport altındadır. Fiziksel telefon klavyesi/PWA/U01 kanıtı değildir.
Komutlar/diğer kontroller: `docs/AUDIT_REMEDIATION_2026-11-09.md`.
