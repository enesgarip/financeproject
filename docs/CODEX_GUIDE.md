# Codex Guide — task çerçeveleme

> **Kurallar burada değil.** Kanonik kural seti `CLAUDE.md`, giriş noktası kök
> `AGENTS.md`. Görev bazlı en ucuz okuma rotası `docs/AI_CONTEXT_INDEX.md`; hızlı
> task→dosya tablosu da onun içinde. Bu dosya yalnız Codex'e **iyi task
> nasıl verilir** + oturum disiplinini anlatır. (Eski sürümdeki "money 2 ondalık"
> ve "frontend-only CRUD" bilgisi yanlıştı; artık `money.ts` + ledger/kuruş ve
> katmanlı mimari geçerli — `AGENTS.md`'e bak.)

## Bir task'a başlarken

1. `AGENTS.md`'deki 5 kritik kuralı içselleştir.
2. `docs/AI_CONTEXT_INDEX.md`'den konunun dosyalarını bul — grep ile keşif turu atma.
3. Az oku, mevcut deseni kopyala, edit'i dar tut.

## İyi task çerçevesi (kullanıcı verirken)

- hedef sayfa/özellik
- UI-only mi, data-only mi, ikisi mi
- Supabase migration'a izin var mı
- hangi finansal davranış **aynı kalmalı**
- hangi edge case'ler önemli

Örnek:
`CardsPage'de provizyon toplamını grup bazında göster, mevcut borç ödeme akışını
değiştirme. Migration yapma.`

## Bitirmeden önce kontrol listesi

1. Route / util / `src/types/database.ts` / migration hâlâ hizalı mı? Yeni
   repository/sayfa eklediysen `docs/AI_CONTEXT_INDEX.md`'i güncelle, dosya
   taşıdıysan docs referansını düzelt (`docs.guard.test.ts` CI'da zorlar).
2. Finans değişikliğiyse dashboard yan etkisi?
3. Türetilmiş toplam değiştiyse veri sağlığı (`DataHealthPage`) yan etkisi?
4. RPC/şema/release dokunuşu varsa: `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` +
   `docs/RPC_ACTION_REFERENCE.md`'i güncel tut.
5. `npm run lint && npm run test:unit && npm run build`. Migration/trigger
   değiştiyse yerel Postgres'te de doğrula.
6. Varsayımları net özetle.

## Kalıcı domain hatırlatmaları

- Paylaşımlı-limit kredi kartları var (`limit_group_name`).
- Kart borcu = ekstre borcu + dönem içi harcama + provizyon (`card_ledger`'dan
  türetilir). Borç alanlarına dokunmadan önce `docs/CARD_DEBT_TRANSITIONS.md`.
- Kredi takibi açık taksitlerle (`loan_installments`) ya da legacy özet alanlarıyla olur.
- Ödemeler aylık tekrarlı olabilir.
- Birikim hedefleri TRY, altın-bazlı veya kompozit olabilir.
- `DataHealthPage` gerçek bir operasyonel araç — debug sayfası değil.
- Düzeltme = ters kayıt (append-only), asla geçmişi UPDATE etme.
- `financeSummary.ts` TL agregasyonlarında çıplak `+`/`-` kullanma; `sum()` zaten
  `sumTL`'ye gider, yeni toplam/fark için `sumTL`/`diffTL` tercih et.
- Banka hesabı debit/credit yapan RPC'ler ortak iç helper'ları kullanır:
  `private.debit_bank_account` / `private.credit_bank_account`. Bu helper'ları
  public RPC yüzeyine açma; transaction history ve domain yan etkileri public
  RPC'lerde kalır.
