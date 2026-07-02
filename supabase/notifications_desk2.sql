-- ════════════════════════════════════════════════════════════════════════════
-- Notifications desk v2 : préférences granulaires + notif « devis modifié »
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase. Idempotent.
--
-- 1. user_settings.notif_prefs (jsonb) : préférences par catégorie.
--    Clés devis : devis_consultations | devis_relances | devis_decisions |
--    devis_modifications. Absence de clé = activé (défaut true).
-- 2. Notif « devis modifié par quelqu'un » : trigger sur devis_audit.
--    CONDENSATION : tant que la notification du destinataire n'est pas lue,
--    les modifications suivantes (24 h) mettent à jour la même notification
--    (compteur + horodatage) au lieu d'en empiler une par changement.
--    L'auteur de la modification n'est jamais notifié de ses propres changements.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Préférences granulaires ──────────────────────────────────────────────────
alter table user_settings add column if not exists notif_prefs jsonb not null default '{}'::jsonb;

-- 2) Trigger devis modifié ────────────────────────────────────────────────────
create or replace function notify_devis_modified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_devis record;
  v_recipient uuid;
  v_recipients uuid[];
  v_prefs record;
  v_existing record;
  v_count int;
  v_titre text;
  v_actor text;
  v_project_title text;
begin
  -- Devis concerné (titulaires + libellé)
  select id, project_id, sent_by, created_by, version_number, title
    into v_devis
    from devis where id = new.devis_id;
  if v_devis.id is null then return null; end if;

  -- Destinataires : envoyeur + créateur, sans l'auteur de la modification
  v_recipients := array(
    select distinct u from unnest(array[v_devis.sent_by, v_devis.created_by]) as u
    where u is not null and u is distinct from new.actor_id
  );
  if coalesce(array_length(v_recipients, 1), 0) = 0 then return null; end if;

  v_titre := 'Devis V' || coalesce(v_devis.version_number, 1)
             || coalesce(' « ' || nullif(v_devis.title, '') || ' »', '')
             || ' modifié';
  v_actor := coalesce(new.actor_name, 'quelqu''un');
  select title into v_project_title from projects where id = v_devis.project_id;

  foreach v_recipient in array v_recipients loop
    -- Préférences : notif_devis global + catégorie modifications
    select notif_devis, notif_prefs into v_prefs
      from user_settings where user_id = v_recipient;
    if found then
      if v_prefs.notif_devis = false then continue; end if;
      if coalesce((v_prefs.notif_prefs->>'devis_modifications')::boolean, true) = false then
        continue;
      end if;
    end if;

    -- Condensation : notification non lue de moins de 24 h → on incrémente
    select id, coalesce((data->>'count')::int, 1) as cnt into v_existing
      from notifications
      where user_id = v_recipient
        and type = 'devis_modifie'
        and lu = false
        and data->>'devis_id' = new.devis_id::text
        and created_at > now() - interval '24 hours'
      order by created_at desc
      limit 1;

    if v_existing.id is not null then
      v_count := v_existing.cnt + 1;
      update notifications
        set corps = v_count || ' modifications récentes, dernière par ' || v_actor || '.',
            data = jsonb_set(coalesce(data, '{}'::jsonb), '{count}', to_jsonb(v_count)),
            created_at = now()
        where id = v_existing.id;
    else
      insert into notifications (user_id, type, titre, corps, link_web, project_id, data)
      values (
        v_recipient,
        'devis_modifie',
        v_titre,
        '1 modification par ' || v_actor || '.',
        '/projets/' || v_devis.project_id || '/devis/' || v_devis.id,
        v_devis.project_id,
        jsonb_build_object('devis_id', v_devis.id, 'count', 1, 'project_title', v_project_title)
      );
    end if;
  end loop;

  return null;
end $$;

drop trigger if exists trg_notify_devis_modified on devis_audit;
create trigger trg_notify_devis_modified
  after insert on devis_audit
  for each row execute function notify_devis_modified();
