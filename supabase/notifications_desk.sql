-- ════════════════════════════════════════════════════════════════════════════
-- Notifications desk N1 : extension du socle notifications pour le web admin
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase. Idempotent.
--
-- Le socle mobile (table notifications + send-push + realtime) est réutilisé
-- tel quel. On ajoute :
--   1. notifications.link_web  : cible de navigation côté desk
--      (ex. /projets/X/devis/Y) ; deep_link reste le format mobile.
--      notifications.project_id : filtrage/regroupement par projet.
--   2. devis.sent_by : qui a envoyé le devis (destinataire "titulaire").
--   3. org_settings : réglages org clé/valeur (délais de relance devis).
--   4. user_settings.notif_devis : opt-out des notifications devis par user.
--
-- Types de notification ajoutés (colonne type = texte libre, pas de CHECK) :
--   devis_consulte | devis_accepte | devis_refuse | devis_relance | devis_expire
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Extension notifications ─────────────────────────────────────────────────
alter table notifications add column if not exists link_web   text;
alter table notifications add column if not exists project_id uuid references projects(id) on delete cascade;

-- Policy DELETE (migration mobile 20260610d pas forcément appliquée : sans
-- elle, la suppression échoue en silence et les notifs « reviennent » au reload).
drop policy if exists "notifications_delete_own" on notifications;
create policy "notifications_delete_own" on notifications
  for delete using (auth.uid() = user_id);

-- Dédup côté production (ex. « devis consulté » max 1 fois/24 h) : les
-- fonctions cherchent la dernière notif d'un type pour un devis donné.
create index if not exists notifications_type_created_idx
  on notifications (type, created_at desc);

-- 2) Traçabilité de l'envoyeur ───────────────────────────────────────────────
alter table devis add column if not exists sent_by uuid references profiles(id) on delete set null;

-- 3) Réglages org (clé/valeur) ───────────────────────────────────────────────
-- Clés utilisées par le scheduler devis (défauts appliqués côté code) :
--   devis_relance_non_ouvert_jours   (défaut 5)
--   devis_relance_sans_reponse_jours (défaut 10)
--   devis_relance_intervalle_jours   (défaut 7 : re-proposition au plus tous les N jours)
create table if not exists org_settings (
  org_id     uuid not null references organisations(id) on delete cascade,
  key        text not null,
  value      text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);

alter table org_settings enable row level security;

drop policy if exists "org_settings_select" on org_settings;
create policy "org_settings_select" on org_settings
  for select using (org_id = get_user_org_id());

-- Écriture réservée aux admins de l'org.
drop policy if exists "org_settings_upsert" on org_settings;
create policy "org_settings_upsert" on org_settings
  for insert with check (org_id = get_user_org_id() and current_user_role() = 'admin');

drop policy if exists "org_settings_update" on org_settings;
create policy "org_settings_update" on org_settings
  for update using (org_id = get_user_org_id() and current_user_role() = 'admin')
  with check (org_id = get_user_org_id() and current_user_role() = 'admin');

-- 4) Préférence user : notifications devis ───────────────────────────────────
alter table user_settings add column if not exists notif_devis boolean not null default true;
