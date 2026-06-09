-- ---------------------------------------------------------------------------
-- Fix card_expenses wrongly labelled "Ulaşım" by the old substring matcher.
--
-- Root cause: the importer matched category keywords with a raw substring, so
-- the Ulaşım keyword "taksi" matched inside "taksit"/"taksitli" and every
-- instalment purchase fell into Ulaşım.
--
-- This script only touches rows where:
--   * a Ulaşım keyword appears as a SUBSTRING (the old logic fired), AND
--   * no Ulaşım keyword appears as a WHOLE WORD (the fixed logic disagrees).
-- Genuinely-Ulaşım rows are left untouched:
--   * real keyword rows (e.g. "SHELL PETROL")      -> whole-word match, skipped
--   * PDF-section rows with no keyword (e.g. "BUPET") -> no substring, skipped
--
-- It recomputes the correct category with the same whole-word priority the app
-- uses (Market -> Yemek -> Ulaşım -> Fatura -> Sağlık -> Eğitim -> Eğlence ->
-- Alışveriş); rows with no real keyword become 'Diğer'.
--
-- Run as the project owner in the Supabase SQL editor. The pg_temp.* helpers are
-- session-local and disappear when you close the editor tab.
--
-- WORKFLOW: run section (1)+(2) first to review, then run (3) to apply.
-- ---------------------------------------------------------------------------

-- (1) Helpers ---------------------------------------------------------------
-- Whole-word match: keyword bounded by start/end or a non-alphanumeric char.
-- The critical taksi/taksit case is pure ASCII, so this is locale-independent.
create or replace function pg_temp.kwmatch(txt text, kws text) returns boolean
  language sql immutable as $$
  select txt ~* ('(^|[^[:alnum:]])(' || kws || ')([^[:alnum:]]|$)')
$$;

-- Recompute the category from the description (mirrors src/utils/categories.ts).
create or replace function pg_temp.recat(txt text) returns text
  language sql immutable as $$
  select case
    when pg_temp.kwmatch(txt, 'market|migros|bim|a101|şok|sok|carrefour|macrocenter|kasap|manav') then 'Market'
    when pg_temp.kwmatch(txt, 'yemek|restoran|restaurant|cafe|kahve|starbucks|yemeksepeti|getir yemek|burger|pizza|döner|doner|kebap') then 'Yemek'
    when pg_temp.kwmatch(txt, 'ulaşım|ulasim|benzin|yakıt|yakit|petrol|shell|opet|bp|total|taksi|uber|metro|marmaray|akbil|otobüs|otobus') then 'Ulaşım'
    when pg_temp.kwmatch(txt, 'fatura|elektrik|su faturası|su faturasi|doğalgaz|dogalgaz|internet|abonelik|turkcell|vodafone|türk telekom|turk telekom|superonline') then 'Fatura'
    when pg_temp.kwmatch(txt, 'sağlık|saglik|eczane|hastane|doktor|diş|dis|medikal') then 'Sağlık'
    when pg_temp.kwmatch(txt, 'eğitim|egitim|okul|kurs|kitap|udemy|kırtasiye|kirtasiye') then 'Eğitim'
    when pg_temp.kwmatch(txt, 'eğlence|eglence|sinema|konser|tiyatro|netflix|spotify|oyun|etkinlik') then 'Eğlence'
    when pg_temp.kwmatch(txt, 'alışveriş|alisveris|trendyol|hepsiburada|amazon|n11|giyim|zara|lcw|teknosa|media markt|telefon') then 'Alışveriş'
    else 'Diğer'
  end
$$;

-- A row is a false "Ulaşım" if a Ulaşım keyword matched as substring but not as
-- a whole word.
create or replace function pg_temp.is_false_ulasim(txt text) returns boolean
  language sql immutable as $$
  select txt ~* '(ulaşım|ulasim|benzin|yakıt|yakit|petrol|shell|opet|bp|total|taksi|uber|metro|marmaray|akbil|otobüs|otobus)'
     and not pg_temp.kwmatch(txt, 'ulaşım|ulasim|benzin|yakıt|yakit|petrol|shell|opet|bp|total|taksi|uber|metro|marmaray|akbil|otobüs|otobus')
$$;

-- (2) PREVIEW — review BEFORE applying. Nothing is written here. ------------
select id, spent_at, amount, description,
       category               as simdiki,
       pg_temp.recat(description) as onerilen
from card_expenses
where category = 'Ulaşım'
  and pg_temp.is_false_ulasim(description)
order by amount desc;

-- (3) APPLY — run this only after the preview looks right. ------------------
-- update card_expenses
-- set category = pg_temp.recat(description)
-- where category = 'Ulaşım'
--   and pg_temp.is_false_ulasim(description);
