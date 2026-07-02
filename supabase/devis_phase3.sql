-- ════════════════════════════════════════════════════════════════════════════
-- Envoi client Phase 3 : validité, refus motivé, relance, page lot multi-options
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase. Idempotent.
--
-- 1. valid_until       : date limite de validité de l'offre (saisie à l'envoi).
--                        Passée cette date, la page client bloque l'acceptation.
-- 2. refused_reason    : raison saisie par le client lors d'un refus.
-- 3. last_reminded_at  : trace de la dernière relance (bouton Relancer admin).
-- 4. sent_total_ht/ttc : totaux FIGÉS à l'envoi (comme le PDF). Nécessaires à
--                        la page lot multi-options (les totaux ne sont pas
--                        stockés ailleurs, ils sont calculés côté éditeur).
-- 5. devis_lots.public_token : lien client par LOT (page comparant les
--                        versions envoyées ; le client consulte et signe
--                        l'option de son choix).
-- ════════════════════════════════════════════════════════════════════════════

alter table devis add column if not exists valid_until      timestamptz;
alter table devis add column if not exists refused_reason   text;
alter table devis add column if not exists last_reminded_at timestamptz;
alter table devis add column if not exists sent_total_ht    numeric;
alter table devis add column if not exists sent_total_ttc   numeric;

alter table devis_lots add column if not exists public_token uuid default uuid_generate_v4();
create unique index if not exists devis_lots_public_token_idx on devis_lots (public_token);

-- Backfill des lots créés avant l'ajout de la colonne (défaut non appliqué
-- si la colonne existait déjà sans valeur).
update devis_lots set public_token = uuid_generate_v4() where public_token is null;
