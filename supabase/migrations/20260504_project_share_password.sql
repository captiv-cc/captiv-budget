-- ============================================================================
-- Migration : PROJECT-SHARE PASSWORD — protection optionnelle par mot de passe
-- Date      : 2026-05-04
-- Contexte  : Demande Hugo. Permettre de protéger un portail projet par
--             mot de passe (optionnel — par défaut pas de mdp). Le destinataire
--             doit saisir le mdp avant d'accéder au hub OU à n'importe quelle
--             sous-page.
--
-- Sécurité :
--   - On ne stocke JAMAIS le mdp en clair. Hash bcrypt via pgcrypto (crypt
--     + gen_salt('bf')). Le hash ne quitte pas la DB — la vérification se
--     fait dans la RPC SECURITY DEFINER.
--   - Le mdp est envoyé en clair côté client (HTTPS uniquement, comme tout
--     login). Pas d'auth state — chaque RPC accepte un p_password optionnel.
--   - Le front mémorise le mdp en sessionStorage (par-tab, ephémère) pour
--     éviter de redemander à chaque navigation interne au portail.
--
-- Périmètre :
--   1. CREATE EXTENSION IF NOT EXISTS pgcrypto (déjà présent sur Supabase
--      en général, défensif)
--   2. ALTER TABLE project_share_tokens
--        + password_hash text  — bcrypt(plain) | NULL = pas de protection
--        + password_hint text  — texte libre affiché côté gate (ex: "Code
--                                projet" / "Demande à Paul"). Optionnel.
--   3. set_project_share_password(token_id, plain) — SECURITY DEFINER RPC
--      pour poser/effacer le mdp depuis le front (le hash est calculé
--      côté DB).
--   4. _project_share_token_resolve(token, page, password) — étendu pour
--      vérifier le mdp si password_hash IS NOT NULL.
--      Codes d'erreur :
--        '28000' — token invalide / expiré / page non activée (inchangé)
--        '28P01' — mdp requis OU invalide (PG std SQLSTATE = invalid_password)
--                  Le HINT contient password_hint pour le front.
--   5. share_projet_fetch / equipe_fetch / livrables_fetch — étendus
--      avec p_password text DEFAULT NULL. Les anciens appels sans password
--      restent valides (et raise 28P01 si le token est protégé).
--
-- Idempotent : ALTER ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

-- =====================================================================
-- 1. Extension pgcrypto (bcrypt)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =====================================================================
-- 2. Schema : ajout password_hash + password_hint
-- =====================================================================
ALTER TABLE project_share_tokens
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_hint text;

COMMENT ON COLUMN project_share_tokens.password_hash IS
  'Hash bcrypt du mot de passe (pgcrypto crypt + gen_salt(''bf'')). NULL = portail public, pas de gate.';
COMMENT ON COLUMN project_share_tokens.password_hint IS
  'Indice optionnel affiché sur le password gate ("Code projet", "Demande à Paul"…). Pas un secret — visible avant authentification.';


-- =====================================================================
-- 3. RPC admin — set/clear password
-- =====================================================================
-- SECURITY DEFINER pour bypasser RLS (les admins ont déjà l'INSERT/UPDATE
-- via RLS, mais on encapsule le hashing serveur-side pour ne JAMAIS faire
-- transiter du plain text dans le client). Vérification d'autorisation
-- via une SELECT préalable + RAISE si le caller ne peut pas modifier le
-- token (RLS auto via policy USING).
CREATE OR REPLACE FUNCTION set_project_share_password(
  p_token_id uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $set_project_share_password$
DECLARE
  v_can boolean;
BEGIN
  -- Vérifie que le caller a le droit de modifier ce token (RLS lit le
  -- contexte auth.uid() même en SECURITY DEFINER — on lance la SELECT en
  -- mode simulé). L'astuce : on tente un UPDATE à blanc protégé par la RLS.
  PERFORM 1
    FROM project_share_tokens t
   WHERE t.id = p_token_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token not found' USING ERRCODE = '42704';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM project_share_tokens t
     WHERE t.id = p_token_id
       AND (
         is_admin()
         OR t.created_by = auth.uid()
         OR is_project_member(t.project_id)
       )
  ) INTO v_can;

  IF NOT v_can THEN
    RAISE EXCEPTION 'permission denied to modify this token'
      USING ERRCODE = '42501';
  END IF;

  UPDATE project_share_tokens
     SET password_hash = CASE
           WHEN p_password IS NULL OR length(trim(p_password)) = 0 THEN NULL
           ELSE crypt(p_password, gen_salt('bf'))
         END
   WHERE id = p_token_id;
END;
$set_project_share_password$;

REVOKE ALL ON FUNCTION set_project_share_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_project_share_password(uuid, text)
  TO authenticated;


-- =====================================================================
-- 4. Helper interne — résolution + check password
-- =====================================================================
-- On ÉTEND la signature : ajout de p_password text DEFAULT NULL.
-- Comportement :
--   - Si token n'existe pas / expiré / page non activée → 28000 (inchangé)
--   - Si password_hash IS NULL (pas de protection) → OK (toujours)
--   - Si password_hash IS NOT NULL :
--       · p_password NULL ou vide       → 28P01 + HINT (password_hint)
--       · crypt(p_password, hash) match → OK
--       · ne match pas                  → 28P01 + HINT
--
-- Le HINT permet au front d'afficher un indice ("Code projet") sur le gate
-- sans avoir à faire un round-trip supplémentaire.
CREATE OR REPLACE FUNCTION _project_share_token_resolve(
  p_token text,
  p_page text DEFAULT NULL,
  p_password text DEFAULT NULL
)
RETURNS TABLE(project_id uuid, page_config jsonb, enabled_pages jsonb, label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_project_share_token_resolve$
DECLARE
  v_password_hash text;
  v_password_hint text;
  v_found         boolean := false;
BEGIN
  -- Phase 1 : token existe + page activée + non expiré + non révoqué
  SELECT t.password_hash, t.password_hint, true
    INTO v_password_hash, v_password_hint, v_found
    FROM project_share_tokens t
   WHERE t.token = p_token
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND (p_page IS NULL OR t.enabled_pages ? p_page);

  IF NOT v_found THEN
    RAISE EXCEPTION 'invalid or expired token (or page not enabled)'
      USING ERRCODE = '28000';
  END IF;

  -- Phase 2 : password gate (si protégé)
  IF v_password_hash IS NOT NULL THEN
    IF p_password IS NULL OR length(p_password) = 0 THEN
      RAISE EXCEPTION 'password required'
        USING ERRCODE = '28P01',
              HINT    = COALESCE(v_password_hint, '');
    END IF;
    IF crypt(p_password, v_password_hash) <> v_password_hash THEN
      RAISE EXCEPTION 'invalid password'
        USING ERRCODE = '28P01',
              HINT    = COALESCE(v_password_hint, '');
    END IF;
  END IF;

  -- Phase 3 : retourne les colonnes utiles aux RPCs appelantes
  RETURN QUERY
    SELECT t.project_id,
           CASE
             WHEN p_page IS NULL THEN '{}'::jsonb
             ELSE COALESCE(t.page_configs->p_page, '{}'::jsonb)
           END,
           t.enabled_pages,
           t.label
      FROM project_share_tokens t
     WHERE t.token = p_token;
END;
$_project_share_token_resolve$;

REVOKE ALL ON FUNCTION _project_share_token_resolve(text, text, text) FROM PUBLIC;


-- =====================================================================
-- 5. RPCs publiques — étendues avec p_password
-- =====================================================================
-- On REMPLACE chaque RPC pour ajouter le paramètre p_password. Le client
-- existant (qui appelle sans p_password) continue de fonctionner pour les
-- tokens publics ; pour les tokens protégés il recevra 28P01 et devra
-- réessayer avec mdp.

-- 5.1. Hub
CREATE OR REPLACE FUNCTION share_projet_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_projet_fetch$
DECLARE
  v_project_id uuid;
  v_enabled    jsonb;
  v_label      text;
  v_result     jsonb;
BEGIN
  SELECT project_id, enabled_pages, label
    INTO v_project_id, v_enabled, v_label
    FROM _project_share_token_resolve(p_token, NULL, p_password);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label', v_label,
      'enabled_pages', v_enabled
    ),
    'project', (
      SELECT jsonb_build_object(
        'id',         p.id,
        'title',      p.title,
        'ref_projet', p.ref_projet,
        'cover_url',  p.cover_url
      )
      FROM projects p WHERE p.id = v_project_id
    ),
    'org', (
      SELECT jsonb_build_object(
        'id',                o.id,
        'display_name',      o.display_name,
        'legal_name',        o.legal_name,
        'tagline',           o.tagline,
        'logo_url_clair',    o.logo_url_clair,
        'logo_url_sombre',   o.logo_url_sombre,
        'logo_banner_url',   o.logo_banner_url,
        'brand_color',       o.brand_color,
        'website_url',       o.website_url
      )
      FROM projects p
      LEFT JOIN organisations o ON o.id = p.org_id
      WHERE p.id = v_project_id
    ),
    'teasers', jsonb_build_object(
      'equipe', CASE
        WHEN v_enabled ? 'equipe' THEN (
          SELECT jsonb_build_object(
            'persons',      COUNT(DISTINCT COALESCE(m.contact_id::text, m.id::text)),
            'attributions', COUNT(*)
          )
          FROM projet_membres m
          WHERE m.project_id = v_project_id
            AND m.parent_membre_id IS NULL
        )
        ELSE NULL
      END,
      'livrables', CASE
        WHEN v_enabled ? 'livrables' THEN (
          SELECT jsonb_build_object(
            'count', COUNT(*)
          )
          FROM livrables l
          WHERE l.project_id = v_project_id
            AND l.deleted_at IS NULL
        )
        ELSE NULL
      END
    ),
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, '_hub');

  RETURN v_result;
END;
$share_projet_fetch$;

REVOKE ALL ON FUNCTION share_projet_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_fetch(text, text)
  TO anon, authenticated;


-- 5.2. Équipe
CREATE OR REPLACE FUNCTION share_projet_equipe_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_projet_equipe_fetch$
DECLARE
  v_project_id     uuid;
  v_config         jsonb;
  v_scope          text;
  v_lot_id         uuid;
  v_show_sensitive boolean;
  v_result         jsonb;
BEGIN
  SELECT project_id, page_config
    INTO v_project_id, v_config
    FROM _project_share_token_resolve(p_token, 'equipe', p_password);

  v_scope          := COALESCE(v_config->>'scope', 'all');
  v_lot_id         := NULLIF(v_config->>'lot_id', '')::uuid;
  v_show_sensitive := COALESCE((v_config->>'show_sensitive')::boolean, true);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',          NULL,
      'scope',          v_scope,
      'lot_id',         v_lot_id,
      'show_sensitive', v_show_sensitive
    ),
    'project', (
      SELECT jsonb_build_object(
        'id',         p.id,
        'title',      p.title,
        'ref_projet', p.ref_projet,
        'cover_url',  p.cover_url
      )
      FROM projects p WHERE p.id = v_project_id
    ),
    'category_order', (
      SELECT COALESCE(p.metadata->'equipe'->'category_order', '[]'::jsonb)
      FROM projects p WHERE p.id = v_project_id
    ),
    'org', (
      SELECT jsonb_build_object(
        'id',                o.id,
        'display_name',      o.display_name,
        'legal_name',        o.legal_name,
        'tagline',           o.tagline,
        'logo_url_clair',    o.logo_url_clair,
        'logo_url_sombre',   o.logo_url_sombre,
        'logo_banner_url',   o.logo_banner_url,
        'brand_color',       o.brand_color,
        'website_url',       o.website_url
      )
      FROM projects p
      LEFT JOIN organisations o ON o.id = p.org_id
      WHERE p.id = v_project_id
    ),
    'lots', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           l.id,
          'title',        l.title,
          'sort_order',   l.sort_order,
          'ref_devis_id', (
            SELECT d.id
              FROM devis d
             WHERE d.lot_id = l.id
             ORDER BY (d.status = 'accepte') DESC, d.version_number DESC
             LIMIT 1
          )
        ) ORDER BY l.sort_order, l.created_at
      )
      FROM devis_lots l
      WHERE l.project_id = v_project_id
        AND l.archived = false
    ), '[]'::jsonb),
    'membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                m.id,
          'category',          m.category,
          'sort_order',        m.sort_order,
          'specialite',        m.specialite,
          'regime',            m.regime,
          'movinmotion_statut',m.movinmotion_statut,
          'secteur',           m.secteur,
          'hebergement',       m.hebergement,
          'chauffeur',         m.chauffeur,
          'presence_days',     m.presence_days,
          'couleur',           m.couleur,
          'arrival_date',      m.arrival_date,
          'arrival_time',      m.arrival_time,
          'departure_date',    m.departure_date,
          'departure_time',    m.departure_time,
          'logistique_notes',  m.logistique_notes,
          'prenom',            m.prenom,
          'nom',               m.nom,
          'email',             CASE WHEN v_show_sensitive THEN m.email ELSE NULL END,
          'telephone',         CASE WHEN v_show_sensitive THEN m.telephone ELSE NULL END,
          'devis_line_id',     m.devis_line_id,
          'devis_line', CASE
            WHEN m.devis_line_id IS NOT NULL THEN (
              SELECT jsonb_build_object(
                'id',       dl.id,
                'devis_id', dl.devis_id,
                'produit',  dl.produit,
                'regime',   dl.regime
              )
              FROM devis_lines dl WHERE dl.id = m.devis_line_id
            )
            ELSE NULL
          END,
          'contact', CASE
            WHEN m.contact_id IS NOT NULL THEN (
              SELECT jsonb_build_object(
                'id',                c.id,
                'specialite',        c.specialite,
                'regime_alimentaire',c.regime_alimentaire,
                'taille_tshirt',     c.taille_tshirt,
                'email',     CASE WHEN v_show_sensitive THEN c.email ELSE NULL END,
                'telephone', CASE WHEN v_show_sensitive THEN c.telephone ELSE NULL END,
                'ville',     CASE WHEN v_show_sensitive THEN c.ville     ELSE NULL END
              )
              FROM contacts c WHERE c.id = m.contact_id
            )
            ELSE NULL
          END
        ) ORDER BY
          (m.category IS NOT NULL) ASC,
          m.category NULLS FIRST,
          m.sort_order,
          m.created_at
      )
      FROM projet_membres m
      WHERE m.project_id = v_project_id
        AND m.parent_membre_id IS NULL
        AND (
          v_scope = 'all'
          OR (
            v_scope = 'lot'
            AND m.devis_line_id IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM devis_lines dl
                JOIN devis d ON d.id = dl.devis_id
               WHERE dl.id = m.devis_line_id
                 AND d.lot_id = v_lot_id
            )
          )
        )
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, 'equipe');

  RETURN v_result;
END;
$share_projet_equipe_fetch$;

REVOKE ALL ON FUNCTION share_projet_equipe_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_equipe_fetch(text, text)
  TO anon, authenticated;


-- 5.3. Livrables (alignée sur la fix précédente — mirror share_livrables_fetch
--      post-MT-PRE-1.A, sans le bug ev.event_type_id)
CREATE OR REPLACE FUNCTION share_projet_livrables_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_projet_livrables_fetch$
DECLARE
  v_project_id      uuid;
  v_config          jsonb;
  v_calendar_level  text;
  v_show_periodes   boolean;
  v_show_envoi      boolean;
  v_show_feedback   boolean;
  v_result          jsonb;
BEGIN
  SELECT project_id, page_config
    INTO v_project_id, v_config
    FROM _project_share_token_resolve(p_token, 'livrables', p_password);

  v_calendar_level := COALESCE(v_config->>'calendar_level', 'hidden');
  v_show_periodes  := COALESCE((v_config->>'show_periodes')::boolean,    true);
  v_show_envoi     := COALESCE((v_config->>'show_envoi_prevu')::boolean, true);
  v_show_feedback  := COALESCE((v_config->>'show_feedback')::boolean,    true);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',  NULL,
      'config', v_config
    ),
    'org', (
      SELECT jsonb_build_object(
        'id',                o.id,
        'display_name',      o.display_name,
        'legal_name',        o.legal_name,
        'tagline',           o.tagline,
        'logo_url_clair',    o.logo_url_clair,
        'logo_url_sombre',   o.logo_url_sombre,
        'logo_banner_url',   o.logo_banner_url,
        'brand_color',       o.brand_color,
        'share_intro_text',  o.share_intro_text,
        'website_url',       o.website_url
      )
      FROM projects p
      LEFT JOIN organisations o ON o.id = p.org_id
      WHERE p.id = v_project_id
    ),
    'project', (
      SELECT jsonb_build_object(
        'id',         p.id,
        'title',      p.title,
        'ref_projet', p.ref_projet,
        'cover_url',  p.cover_url,
        'periodes', CASE
          WHEN v_show_periodes THEN COALESCE(p.metadata->'periodes', 'null'::jsonb)
          ELSE 'null'::jsonb
        END
      )
      FROM projects p WHERE p.id = v_project_id
    ),
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         b.id,
          'nom',        b.nom,
          'prefixe',    b.prefixe,
          'couleur',    b.couleur,
          'sort_order', b.sort_order
        ) ORDER BY b.sort_order, b.created_at
      )
      FROM livrable_blocks b
      WHERE b.project_id = v_project_id
        AND b.deleted_at IS NULL
    ), '[]'::jsonb),
    'livrables', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',             l.id,
          'block_id',       l.block_id,
          'numero',         l.numero,
          'nom',            l.nom,
          'format',         l.format,
          'duree',          l.duree,
          'version_label',  l.version_label,
          'statut',         l.statut,
          'date_livraison', l.date_livraison,
          'lien_frame',     l.lien_frame,
          'lien_drive',     l.lien_drive,
          'sort_order',     l.sort_order
        ) ORDER BY l.sort_order, l.created_at
      )
      FROM livrables l
      WHERE l.project_id = v_project_id
        AND l.deleted_at IS NULL
    ), '[]'::jsonb),
    'versions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                v.id,
          'livrable_id',       v.livrable_id,
          'numero_label',      v.numero_label,
          'date_envoi',        v.date_envoi,
          'date_envoi_prevu',  CASE WHEN v_show_envoi THEN v.date_envoi_prevu ELSE NULL END,
          'lien_frame',        v.lien_frame,
          'statut_validation', v.statut_validation,
          'feedback_client',   CASE WHEN v_show_feedback THEN v.feedback_client ELSE NULL END,
          'sort_order',        v.sort_order,
          'created_at',        v.created_at
        ) ORDER BY v.livrable_id, v.sort_order, v.created_at
      )
      FROM livrable_versions v
      JOIN livrables l ON l.id = v.livrable_id
      WHERE l.project_id = v_project_id
        AND l.deleted_at IS NULL
    ), '[]'::jsonb),
    'etapes', CASE
      WHEN v_calendar_level = 'phases' THEN COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',            e.id,
            'livrable_id',   e.livrable_id,
            'nom',           e.nom,
            'kind',          e.kind,
            'date_debut',    e.date_debut,
            'date_fin',      e.date_fin,
            'event_type_id', e.event_type_id,
            'sort_order',    e.sort_order
          ) ORDER BY e.date_debut, e.sort_order
        )
        FROM livrable_etapes e
        JOIN livrables l ON l.id = e.livrable_id
        WHERE l.project_id = v_project_id
          AND l.deleted_at IS NULL
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    'event_types', CASE
      WHEN v_calendar_level = 'phases' THEN COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',       et.id,
            'slug',     et.slug,
            'label',    et.label,
            'color',    et.color,
            'category', et.category
          )
        )
        FROM event_types et
        WHERE et.id IN (
          SELECT DISTINCT le.event_type_id
            FROM livrable_etapes le
            JOIN livrables l ON l.id = le.livrable_id
           WHERE l.project_id = v_project_id
             AND l.deleted_at IS NULL
             AND le.event_type_id IS NOT NULL
        )
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, 'livrables');

  RETURN v_result;
END;
$share_projet_livrables_fetch$;

REVOKE ALL ON FUNCTION share_projet_livrables_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_livrables_fetch(text, text)
  TO anon, authenticated;


NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Tests rapides
-- ============================================================================
-- 1. Token sans mdp (mode public) :
--    SELECT share_projet_fetch('xxx');                     -- OK
--    SELECT share_projet_fetch('xxx', NULL);               -- OK
--    SELECT share_projet_fetch('xxx', 'whatever');         -- OK (ignoré)
--
-- 2. Token avec mdp 'hello' :
--    UPDATE project_share_tokens SET password_hint = 'Code projet'
--      WHERE id = '...';
--    SELECT set_project_share_password('...'::uuid, 'hello');
--
--    SELECT share_projet_fetch('xxx');
--    -- → 28P01 password required, HINT='Code projet'
--    SELECT share_projet_fetch('xxx', 'wrong');
--    -- → 28P01 invalid password, HINT='Code projet'
--    SELECT share_projet_fetch('xxx', 'hello');            -- OK
--
-- 3. Effacer le mdp :
--    SELECT set_project_share_password('...'::uuid, NULL);
--    SELECT share_projet_fetch('xxx');                     -- OK (de nouveau public)
-- ============================================================================
