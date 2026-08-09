-- Faz BM-4 / T9: Ölü taksit ödeme RPC'leri kaldırılır.
--
-- pay_card_installment / unpay_card_installment eski modelin (taksit başına
-- borç düşme) kalıntısıdır: UI hiçbir yerden çağırmıyor ama authenticated
-- grant'i duruyor. Bugünkü modelde ödeme ekstre/settlement üzerinden yürür;
-- bu RPC'ler bugün çağrılsa borcu İKİNCİ kez düşürürdü. Banka modelinde
-- karşılıkları yok — taksit tek tek "ödenmez", bağlı olduğu ekstre ödenir.

drop function if exists public.pay_card_installment(uuid, uuid);
drop function if exists public.pay_card_installment(uuid);
drop function if exists public.unpay_card_installment(uuid);
