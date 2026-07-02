-- ════════════════════════════════════════════════════════════════════════════
-- Envoi client : mot d'accompagnement personnalisé (affiché sur la page client)
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase.

alter table devis add column if not exists message_client text;
