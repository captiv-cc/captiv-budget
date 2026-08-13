-- ════════════════════════════════════════════════════════════════════════════
-- MUS-7 — Notification équipe quand un RP agit sur le portail autorisations
-- ════════════════════════════════════════════════════════════════════════════
--
-- Décision Hugo 13/08 : notifier la cloche desk à chaque action RP (statut,
-- commentaire) et CONDENSER — plusieurs modifs non lues = une seule
-- notification par membre et par projet, avec compteur et dernière action.
--
-- Pattern copié de notify_devis_modified (notifications_desk2.sql) :
--   - trigger AFTER INSERT sur projet_musique_autorisation_events
--   - UNIQUEMENT les événements du portail (author_id IS NULL — les actions
--     internes ne notifient pas l'équipe qui les fait)
--   - destinataires = tous les profils de l'org du projet
--   - préférence user_settings.notif_prefs->>'musiques_autorisations'
--     (défaut true)
--   - condensation : notif non lue de type 'musique_autor' du même projet
--     de moins de 24 h → incrément du compteur + remontée en tête
--
-- Dépend de : notifications_desk*.sql (link_web/project_id/notif_prefs)
-- et 20260804a/b. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION notify_musique_autor_rp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $notify_musique_autor_rp$
DECLARE
  v_org           uuid;
  v_project_title text;
  v_track         text;
  v_media         text;
  v_actor         text;
  v_action        text;
  v_recipient     uuid;
  v_prefs         jsonb;
  v_existing      record;
  v_count         int;
BEGIN
  -- Actions internes : l'équipe les fait, pas besoin de se notifier.
  IF NEW.author_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT title, org_id INTO v_project_title, v_org
    FROM projects WHERE id = NEW.project_id;
  IF v_org IS NULL THEN RETURN NULL; END IF;

  -- Libellé track + média
  SELECT
    trim(BOTH ' ·' FROM
      COALESCE(NULLIF(pr.artiste_text, ''), ar.nom, '')
      || COALESCE(' · ' || NULLIF(pr.titre, ''), '')),
    li.nom
    INTO v_track, v_media
    FROM projet_musique_autorisations a
    JOIN projet_musique_livrable_link l ON l.id = a.link_id
    JOIN projet_musique_propositions pr ON pr.id = l.proposition_id
    LEFT JOIN projet_artistes ar ON ar.id = pr.artiste_id
    JOIN livrables li ON li.id = l.livrable_id
   WHERE a.id = NEW.autorisation_id;

  v_actor := COALESCE(NULLIF(NEW.author_name, ''), 'Un RP');
  IF NEW.kind = 'statut' THEN
    v_action := v_actor || ' : « ' ||
      CASE NEW.body
        WHEN 'a_lancer' THEN 'À lancer'
        WHEN 'envoyee'  THEN 'En cours'
        WHEN 'accordee' THEN 'Autorisé'
        WHEN 'refusee'  THEN 'Refusé'
        ELSE NEW.body
      END || ' » sur ' || COALESCE(v_track, '') ||
      COALESCE(' (' || v_media || ')', '');
  ELSE
    v_action := v_actor || ' a commenté ' || COALESCE(v_track, '') ||
      COALESCE(' (' || v_media || ')', '');
  END IF;

  FOR v_recipient IN SELECT id FROM profiles WHERE org_id = v_org LOOP
    SELECT notif_prefs INTO v_prefs FROM user_settings WHERE user_id = v_recipient;
    IF v_prefs IS NOT NULL
       AND COALESCE((v_prefs->>'musiques_autorisations')::boolean, true) = false THEN
      CONTINUE;
    END IF;

    -- Condensation : une notif non lue < 24 h du même projet → incrément.
    SELECT id, COALESCE((data->>'count')::int, 1) AS cnt INTO v_existing
      FROM notifications
     WHERE user_id = v_recipient
       AND type = 'musique_autor'
       AND lu = false
       AND data->>'project_id' = NEW.project_id::text
       AND created_at > now() - interval '24 hours'
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      v_count := v_existing.cnt + 1;
      UPDATE notifications
         SET corps = v_count || ' mises à jour RP, dernière : ' || v_action,
             data = jsonb_set(COALESCE(data, '{}'::jsonb), '{count}', to_jsonb(v_count)),
             created_at = now()
       WHERE id = v_existing.id;
    ELSE
      INSERT INTO notifications (user_id, type, titre, corps, link_web, project_id, data)
      VALUES (
        v_recipient,
        'musique_autor',
        'Autorisations musiques',
        v_action,
        '/projets/' || NEW.project_id || '/musiques',
        NEW.project_id,
        jsonb_build_object(
          'project_id', NEW.project_id,
          'count', 1,
          'project_title', v_project_title
        )
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$notify_musique_autor_rp$;

DROP TRIGGER IF EXISTS trg_notify_musique_autor_rp ON projet_musique_autorisation_events;
CREATE TRIGGER trg_notify_musique_autor_rp
  AFTER INSERT ON projet_musique_autorisation_events
  FOR EACH ROW EXECUTE FUNCTION notify_musique_autor_rp();

-- Vérification post-deploy : agir sur le portail RP (statut ou commentaire)
-- puis SELECT titre, corps, data FROM notifications WHERE type = 'musique_autor';
