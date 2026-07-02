-- ════════════════════════════════════════════════════════════════════════════
-- Notifications desk v3 : sourdines ciblées (mute devis / projet)
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase. Idempotent.
--
-- Les sourdines vivent dans user_settings.notif_prefs.mutes :
--   [{ "type": "devis"|"project", "id": "<uuid>", "label": "…" }]
-- Elles sont posées depuis le panneau desk (BellOff sur une notif ou un
-- en-tête de groupe projet) et retirées depuis les réglages (section
-- Sourdines). Ce fichier met à jour le trigger « devis modifié » pour les
-- respecter (les edge functions les respectent via _shared/devisNotify).
-- ════════════════════════════════════════════════════════════════════════════

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
  select id, project_id, sent_by, created_by, version_number, title
    into v_devis
    from devis where id = new.devis_id;
  if v_devis.id is null then return null; end if;

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
    select notif_devis, notif_prefs into v_prefs
      from user_settings where user_id = v_recipient;
    if found then
      if v_prefs.notif_devis = false then continue; end if;
      if coalesce((v_prefs.notif_prefs->>'devis_modifications')::boolean, true) = false then
        continue;
      end if;
      -- Sourdines ciblées : devis précis ou projet entier
      if exists (
        select 1
        from jsonb_array_elements(coalesce(v_prefs.notif_prefs->'mutes', '[]'::jsonb)) m
        where (m->>'type' = 'devis'   and m->>'id' = new.devis_id::text)
           or (m->>'type' = 'project' and m->>'id' = v_devis.project_id::text)
      ) then continue; end if;
    end if;

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
