-- ════════════════════════════════════════════════════════════════════════════
-- 20260610c — Auto-notify créneaux (push mobile cadreurs)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Quand un créneau est assigné / décalé / change de lieu / réassigné / annulé,
-- on prévient les cadreurs concernés. Résolution de la cible :
--   créneau → (lane type=personne).membre_id  ∪  creneau_membres.membre_id
--           → projet_membres.contact_id → contacts.user_id
--
-- Livraison : appel de l'Edge Function send-push via pg_net (elle logge la
-- notif → Realtime in-app, ET envoie le push). Si l'URL/clé ne sont pas
-- configurées (cf. plus bas), fallback : insertion directe dans notifications
-- (in-app seulement, pas de push système). Aucune dépendance dure.
--
-- ⚙️  SETUP À FAIRE UNE FOIS (sinon mode fallback in-app only) :
--    alter database postgres
--      set app.send_push_url = 'https://<PROJECT_REF>.supabase.co/functions/v1/send-push';
--    alter database postgres
--      set app.send_push_key = '<SERVICE_ROLE_KEY>';   -- côté serveur, jamais commité
--    -- puis reconnecter (les GUC custom sont lues à la nouvelle session).
--
-- ⚠️  Sécu : send-push n'exige aujourd'hui qu'un header Authorization présent
--    (pas de vérif du rôle). À durcir séparément (exiger le service_role pour
--    cibler d'autres users). Ici on passe la clé via GUC, hors git.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- ── Résolution des user_ids cadreurs d'un créneau ───────────────────────────
create or replace function _creneau_users(p_creneau_id uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  -- membres assignés directement
  select distinct c.user_id
  from projet_deroule_creneau_membres m
  join projet_membres pm on pm.id = m.membre_id
  join contacts c on c.id = pm.contact_id
  where m.creneau_id = p_creneau_id and c.user_id is not null
  union
  -- cadreur propriétaire de la lane (type personne)
  select distinct c.user_id
  from projet_deroule_creneaux cr
  join projet_deroule_lanes l on l.id = cr.lane_id and l.type = 'personne'
  join projet_membres pm on pm.id = l.membre_id
  join contacts c on c.id = pm.contact_id
  where cr.id = p_creneau_id and c.user_id is not null
$$;

-- ── Dispatch : push via send-push, sinon log direct (fallback) ──────────────
create or replace function _push_creneau(
  p_user_ids uuid[],
  p_type text,
  p_titre text,
  p_corps text,
  p_creneau_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := current_setting('app.send_push_url', true);
  v_key text := current_setting('app.send_push_key', true);
  v_link text := 'captivdesk://creneau/' || p_creneau_id::text;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  if v_url is null or v_url = '' then
    -- Fallback : in-app uniquement (Realtime), pas de push système
    insert into notifications (user_id, type, titre, corps, deep_link, data, envoye_at)
    select uid, p_type, p_titre, p_corps, v_link,
           jsonb_build_object('creneau_id', p_creneau_id), now()
    from unnest(p_user_ids) as uid;
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(v_key, '')
    ),
    body := jsonb_build_object(
      'user_ids', to_jsonb(p_user_ids),
      'type', p_type,
      'titre', p_titre,
      'corps', p_corps,
      'deep_link', v_link,
      'data', jsonb_build_object('creneau_id', p_creneau_id)
    )
  );
end $$;

-- ── Trigger : assignation d'un membre à un créneau ──────────────────────────
create or replace function trg_creneau_membre_assigne()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_titre text;
begin
  select c.user_id into v_uid
  from projet_membres pm
  join contacts c on c.id = pm.contact_id
  where pm.id = NEW.membre_id;

  if v_uid is null then return NEW; end if;

  select cr.titre into v_titre
  from projet_deroule_creneaux cr where cr.id = NEW.creneau_id;

  perform _push_creneau(
    array[v_uid], 'creneau_assigne',
    'Nouveau créneau',
    coalesce(v_titre, 'Un créneau t''a été assigné'),
    NEW.creneau_id
  );
  return NEW;
end $$;

drop trigger if exists creneau_membre_assigne on projet_deroule_creneau_membres;
create trigger creneau_membre_assigne
  after insert on projet_deroule_creneau_membres
  for each row execute function trg_creneau_membre_assigne();

-- ── Trigger : créneau modifié / annulé / réassigné de lane ──────────────────
create or replace function trg_creneau_update()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_titre text := coalesce(NEW.titre, 'Créneau');
  v_users uuid[];
begin
  -- 1. Annulation
  if NEW.statut = 'annule' and coalesce(OLD.statut, '') <> 'annule' then
    v_users := array(select _creneau_users(NEW.id));
    perform _push_creneau(v_users, 'creneau_annule', 'Créneau annulé', v_titre, NEW.id);
    return NEW;
  end if;

  -- 2. Décalage horaire ou changement de lieu
  if NEW.heure_debut_min is distinct from OLD.heure_debut_min
     or NEW.heure_fin_min is distinct from OLD.heure_fin_min
     or NEW.lieu_text is distinct from OLD.lieu_text then
    v_users := array(select _creneau_users(NEW.id));
    perform _push_creneau(v_users, 'creneau_modifie', 'Créneau modifié', v_titre, NEW.id);
  end if;

  -- 3. Réassignation à une autre lane cadreur → prévenir le nouveau cadreur
  if NEW.lane_id is distinct from OLD.lane_id then
    perform _push_creneau(
      array(
        select c.user_id
        from projet_deroule_lanes l
        join projet_membres pm on pm.id = l.membre_id
        join contacts c on c.id = pm.contact_id
        where l.id = NEW.lane_id and l.type = 'personne' and c.user_id is not null
      ),
      'creneau_assigne', 'Nouveau créneau', v_titre, NEW.id
    );
  end if;

  return NEW;
end $$;

drop trigger if exists creneau_update_notify on projet_deroule_creneaux;
create trigger creneau_update_notify
  after update on projet_deroule_creneaux
  for each row execute function trg_creneau_update();

comment on function _creneau_users(uuid) is
  'user_ids des cadreurs d''un créneau (lane personne ∪ creneau_membres → contacts.user_id).';
comment on function _push_creneau(uuid[], text, text, text, uuid) is
  'Dispatch notif créneau : send-push via pg_net si app.send_push_url configuré, sinon log direct (in-app).';
