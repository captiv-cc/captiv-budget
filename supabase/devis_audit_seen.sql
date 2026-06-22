-- ════════════════════════════════════════════════════════════════════════════
-- Devis R4+ — Suivi "vu / non-vu" de l'historique, synchronisé entre appareils
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase.
--
-- Mémorise, par (utilisateur, devis), la date de dernière consultation du
-- panneau Historique. La pastille "non lu" = nb d'entrées d'audit faites par
-- d'AUTRES après ce last_seen_at. Côté serveur → cohérent sur tous les appareils.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists devis_audit_seen (
  user_id      uuid not null references profiles(id) on delete cascade,
  devis_id     uuid not null references devis(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, devis_id)
);

alter table devis_audit_seen enable row level security;

-- Chaque utilisateur ne lit/écrit que ses propres marques.
drop policy if exists "devis_audit_seen_select" on devis_audit_seen;
create policy "devis_audit_seen_select" on devis_audit_seen
  for select using (user_id = auth.uid());

drop policy if exists "devis_audit_seen_insert" on devis_audit_seen;
create policy "devis_audit_seen_insert" on devis_audit_seen
  for insert with check (user_id = auth.uid());

drop policy if exists "devis_audit_seen_update" on devis_audit_seen;
create policy "devis_audit_seen_update" on devis_audit_seen
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
