# AGENTS.md — Codex/AI giriş noktası

> Bu repo'da çalışan **her AI ajanı** (Codex, Claude, vb.) için ortak giriş.
> Amaç: soğuk oturumun kuralları sıfırdan keşfetmek zorunda kalmaması = daha az
> tur, daha az token, daha az regresyon.

## Önce şunu oku

**Kanonik kural seti `CLAUDE.md`'dir** (proje kökünde). Tam mimari, para modeli,
ledger invariant'ları ve deploy hattı orada. Bir task'a başlamadan önce `CLAUDE.md`'i
ve `docs/AI_CONTEXT_INDEX.md`'i oku — bu ikisi keşif turunu (grep fan-out) ortadan kaldırır.

**Yaşayan doküman kuralı:** `docs/BACKLOG.md`, `docs/AI_CONTEXT_INDEX.md`,
`docs/CARD_DEBT_TRANSITIONS.md`, `docs/BANKING_SIMPLIFICATION_AUDIT.md` ve ilgili
domain source-of-truth dokümanı, davranış/öncelik değiştiği commit'te güncel kalmalı.

İkincil bağlam (yalnız gerektiğinde aç, baştan okuma):
- `docs/AI_CONTEXT_INDEX.md` — görev rotası + "şu işi yapacaksan şu dosyalara bak" tablosu
- `docs/PROJECT_CONTEXT.md` — domain + tablo + route haritası
- `docs/FINANCE_RULES.md` — finansal iş kuralları
- `docs/KNOWN_RISKS.md` — bilinen tuzaklar
- `docs/PIPELINE.md` — CI/deploy detayı

## En kritik 6 kural (ihlal = regresyon)

1. **Para → `src/utils/money.ts`.** Çıplak `Math.round(x*100)/100` veya `+0.01`
   toleransı **YAZMA**. `roundTL/equalsTL/greaterThanTL/sumTL/toKurus/toTL` kullan.
   Ledger tabloları parayı **işaretli integer kuruş** (`amount_kurus bigint`) tutar.
2. **Katman sınırı (ESLint `no-restricted-imports` ile zorlanır).**
   `src/{pages,components,utils,hooks}` içinden `lib/supabase` import etmek **HATA**.
   Veri erişimi yalnız `data/repositories/*`, `services/*`, `lib/*`, `auth/*` katmanında.
   Yeni sorgu gerekiyorsa repo'ya ekle, UI'dan Supabase çağırma.
3. **Ledger invariant'ları.** Kart borcu/banka bakiyesi/kredi özeti olaylardan türetilir
   veya yazma anında SQL trigger ile korunur. Düzeltme = **ters kayıt** (append-only),
   asla geçmişi UPDATE etme. Her trigger'ın saf TS ikizi vardır (test edilir).
4. **`main`'e push = ÜRETİM DEPLOY.** Push'u yalnız kullanıcı açıkça isteyince yap.
   Commit Türkçe + faz/madde etiketli.
5. **Migration timestamp'i benzersiz olmalı** (`schema_migrations` PK = timestamp).
   Yeni migration dosyasından önce `supabase/migrations/` ve `git log`'a bak — başka
   bir oturum aynı timestamp'i kullanmış olabilir → `db reset` 23505 ile patlar.
6. **Yaşayan docs aynı commit'te güncel kalmalı.** Backlog, AI context index,
   domain source-of-truth notları ve tamamlanan audit dosyaları değişen davranışa
   göre güncellenmeden işi kapatma.

## "Bitti" demeden önce

```bash
npm run lint && npm run test:unit && npm run build
```

Migration/trigger değiştiyse ek olarak yerel gerçek Postgres'te doğrula
(`npm run db:seed:local` + `docker exec ... psql`).

## Çalışma stili (kullanıcı tercihi)

- **Plan önce.** Kullanıcı koddan önce planı birlikte kararlaştırmayı sever.
- Mevcut deseni yeni soyutlamaya tercih et; edit'i dar tut (task aksini istemedikçe).
- UI metni **Türkçe** kalır; kullanıcıya yanıtlar Türkçe.
- Finans mantığını gelişigüzel değiştirme — kaynak gerçeği (frontend util / page / RPC /
  migration) önce belirle.
