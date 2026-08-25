-- Bütçe limit çıpası (Canlı Sayılar turu, PR-3).
--
-- Sorun: bütçe limiti elle girilen sabit TL; enflasyonda sessizce anlamsızlaşır
-- (hedef tutarındaki problemin bire bir simetriği — 20260824170000).
--
-- Çözüm: limit bir KURALA bağlanabilir:
--   avg_spend  → son 3 TAM ayın kategori harcaması ortalaması × çarpan
--   salary_pct → güncel maaşın yüzdesi (salary_history'nin son satırı)
-- Çıpalı satırda limit_amount 0'a çekilir (türetilebilen saklanmaz — hedef
-- çıpası deseni); çözüm okuma anında saf TS'te (utils/budgetAnchor.ts).
-- Ortalama, satırın KENDİ ayından önceki 3 tam aya bakar: geçmiş aylar
-- değişmediği için ay içinde stabildir, geçmiş bütçe satırları da tarihsel
-- olarak doğru çözülür.

alter table public.budgets
  add column limit_anchor text not null default 'manual'
    check (limit_anchor in ('manual', 'avg_spend', 'salary_pct')),
  add column limit_anchor_value numeric null;

-- Çıpa ile değerin kombinasyonu: manual'de değer olmaz, kurallıda pozitif şart.
alter table public.budgets add constraint budgets_limit_anchor_fields check (
  (limit_anchor = 'manual' and limit_anchor_value is null)
  or (limit_anchor <> 'manual' and limit_anchor_value is not null and limit_anchor_value > 0)
);
