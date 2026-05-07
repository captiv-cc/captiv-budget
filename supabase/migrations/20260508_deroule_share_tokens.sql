-- ============================================================================
-- Migration : DÉROULÉ V2 — Tokens de partage public du déroulé
-- Date      : 2026-05-08
-- Contexte  : Vague 2 du chantier Déroulé (cf. CHANTIER_DEROULE.md). Permet
--             d'exposer une vue READ-ONLY du déroulé d'un projet à un
--             destinataire externe (membre équipe, régisseur, prod, client)
--             via un lien public, sans authentification.
--
-- Pattern aligné sur EQUIPE-P4.2A (equipe_share_tokens) :
--   - Token opaque généré côté client (~32 chars base64url)
--   - RLS org-scopée pour les users auth (admin/charge_prod/coordinateur)
--   - RPC SECURITY DEFINER pour l'accès anonyme
--   - Soft revoke + expiration optionnelle + view counter
--
-- Différences clés avec equipe_share_tokens :
--   - Pas de `scope` / `lot_id` : un déroulé concerne le projet entier
--     (multi-jours possible). Filtrer par lot n'aurait pas de sens.
--   - `show_sensitive` contrôle l'exposition des notes internes (créneaux
--     + déroulé) et des coordonnées membres (tel/email). Default true.
--   - Le payload retourne TOUS les déroulés du projet (pas juste un jour),
--     pour que la page publique puisse afficher un sélecteur de date
--     comme dans la tab admin.
--
-- Périmètre :
--   1. Table deroule_share_tokens + indexes + RLS
--   2. Helper interne _deroule_share_resolve(token)
--   3. RPC publique share_deroule_fetch(token) — payload complet
--   4. RPC publique share_projet_deroule_fetch(token, password) — variante
--      portail projet (lit la config dans page_configs->'deroule')
--   5. Update share_projet_fetch — ajout du teaser 'deroule'
--   6. RPC admin revoke_deroule_share_token(uuid)
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--              DROP POLICY IF EXISTS.
-- Dépend de  : 20260508_deroule_v1_schema.sql, 20260508_deroule_v0_5_minutes_int.sql
--              (schéma déroulé), 20260504_project_share_tokens.sql + password
--              (helpers _project_share_token_resolve, _project_share_bump).
-- ============================================================================

BEGIN;

-- ── 1. deroule_share_tokens ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deroule_share_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope : un projet entier (tous ses déroulés). Pas de filtrage par jour
  -- côté token — la page publique offre un sélecteur de date.
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Token secret opaque (~32 chars base64url). Généré côté client via
  -- crypto.getRandomValues. Pattern aligné sur equipe_share_tokens.
  token            text NOT NULL UNIQUE,

  -- Libellé interne ("Régisseur Paul", "Live ZLAN J3"…). Affiché dans la
  -- modale admin uniquement. Optionnel — fallback "Lien #abc123".
  label            text,

  -- Toggle d'affichage des notes internes + coordonnées membres.
  -- - true  (default) : notes créneaux/déroulés + tel/email visibles
  -- - false           : masqués (lien "anonymisé" — utile pour cast tournage)
  show_sensitive   boolean NOT NULL DEFAULT true,

  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Soft revoke : la ligne reste pour l'historique (qui a créé, combien de
  -- vues, dernière vue). RPC fetch raise si revoked.
  revoked_at       timestamptz,

  -- Expiration optionnelle. NULL = lien permanent.
  expires_at       timestamptz,

  -- Bumpé par la RPC fetch à chaque hit.
  last_accessed_at timestamptz,
  view_count       integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS deroule_share_tokens_token_idx
  ON deroule_share_tokens(token);
CREATE INDEX IF NOT EXISTS deroule_share_tokens_project_idx
  ON deroule_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS deroule_share_tokens_active_idx
  ON deroule_share_tokens(project_id, created_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE deroule_share_tokens IS
  'Tokens de partage public du déroulé (Vague 2). Un par destinataire / scénario. Accès anonyme via RPC share_deroule_fetch SECURITY DEFINER.';
COMMENT ON COLUMN deroule_share_tokens.show_sensitive IS
  'Si true (default), expose les notes internes (créneaux + déroulés) et les coordonnées membres (tel/email).';
COMMENT ON COLUMN deroule_share_tokens.token IS
  'Secret opaque (~32 chars base64url). Généré côté client via crypto.getRandomValues — jamais en clair côté serveur avant insertion.';


-- ── 2. RLS — admin/auth seulement ───────────────────────────────────────────
ALTER TABLE deroule_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deroule_share_tokens_org" ON deroule_share_tokens;

CREATE POLICY "deroule_share_tokens_org" ON deroule_share_tokens
  FOR ALL
  USING (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  );


-- ── 3. RPC interne — résolution du token ────────────────────────────────────
CREATE OR REPLACE FUNCTION _deroule_share_resolve(p_token text)
RETURNS TABLE(
  project_id     uuid,
  show_sensitive boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_deroule_share_resolve$
BEGIN
  RETURN QUERY
    SELECT t.project_id, t.show_sensitive
      FROM deroule_share_tokens t
     WHERE t.token = p_token
       AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '28000';
  END IF;
END;
$_deroule_share_resolve$;

REVOKE ALL ON FUNCTION _deroule_share_resolve(text) FROM PUBLIC;


-- ── 4. RPC publique — fetch du payload de partage déroulé ───────────────────
-- Un round-trip pour la page publique. Tout est filtré côté serveur :
-- pas de notes internes si show_sensitive=false, pas de coordonnées membres,
-- pas de champs financiers.
--
-- Sécurité : la RPC bypasse les RLS (SECURITY DEFINER) — le token fait
-- office d'authentification. Toutes les sous-requêtes sont strictement
-- scopées au project_id résolu, impossible de remonter à un autre projet.
CREATE OR REPLACE FUNCTION share_deroule_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_deroule_fetch$
DECLARE
  v_project_id     uuid;
  v_show_sensitive boolean;
  v_result         jsonb;
BEGIN
  -- Résout token → contexte (raise si invalide/expiré).
  SELECT project_id, show_sensitive
    INTO v_project_id, v_show_sensitive
    FROM _deroule_share_resolve(p_token);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',          (SELECT label FROM deroule_share_tokens WHERE token = p_token),
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
    -- Branding org (cf. share_equipe_fetch).
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
    -- Tous les déroulés du projet (1 row par jour). Tri par date_jour ASC.
    -- Notes filtrées selon show_sensitive.
    'deroules', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',               d.id,
          'date_jour',        d.date_jour,
          'titre',            d.titre,
          'granularite_min',  d.granularite_min,
          'display_step_min', d.display_step_min,
          'heure_debut_min',  d.heure_debut_min,
          'heure_fin_min',    d.heure_fin_min,
          'statut',           d.statut,
          'revision',         d.revision,
          'notes',            CASE WHEN v_show_sensitive THEN d.notes ELSE NULL END
        ) ORDER BY d.date_jour ASC, d.created_at ASC
      )
      FROM projet_deroules d
      WHERE d.project_id = v_project_id
    ), '[]'::jsonb),
    -- Lanes de tous les déroulés du projet. Filtrage côté front via
    -- deroule_id du déroulé sélectionné.
    'lanes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         l.id,
          'deroule_id', l.deroule_id,
          'sort_order', l.sort_order,
          'libelle',    l.libelle
        ) ORDER BY l.deroule_id, l.sort_order
      )
      FROM projet_deroule_lanes l
      JOIN projet_deroules d ON d.id = l.deroule_id
      WHERE d.project_id = v_project_id
    ), '[]'::jsonb),
    -- Créneaux de tous les déroulés. Notes filtrées si show_sensitive=false.
    -- member_ids array embarqué pour éviter un JOIN side-table côté front.
    'creneaux', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',              c.id,
          'deroule_id',      c.deroule_id,
          'lane_id',         c.lane_id,
          'multi_lane',      c.multi_lane,
          'heure_debut_min', c.heure_debut_min,
          'heure_fin_min',   c.heure_fin_min,
          'titre',           c.titre,
          'description',     c.description,
          'type',            c.type,
          'couleur',         c.couleur,
          'lieu_text',       c.lieu_text,
          'statut',          c.statut,
          'sort_order',      c.sort_order,
          'notes',           CASE WHEN v_show_sensitive THEN c.notes ELSE NULL END,
          'member_ids',      COALESCE((
            SELECT jsonb_agg(cm.membre_id ORDER BY cm.created_at)
              FROM projet_deroule_creneau_membres cm
             WHERE cm.creneau_id = c.id
          ), '[]'::jsonb)
        ) ORDER BY c.deroule_id, c.heure_debut_min, c.sort_order
      )
      FROM projet_deroule_creneaux c
      JOIN projet_deroules d ON d.id = c.deroule_id
      WHERE d.project_id = v_project_id
    ), '[]'::jsonb),
    -- Membres : pour les avatars/initiales/noms. Uniquement ceux qui sont
    -- assignés à au moins un créneau (utile pour minimiser le payload).
    -- Coords filtrées par show_sensitive.
    'membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         m.id,
          'prenom',     COALESCE(m.prenom, c.prenom),
          'nom',        COALESCE(m.nom, c.nom),
          'specialite', m.specialite,
          'category',   m.category,
          'couleur',    m.couleur,
          'email',      CASE WHEN v_show_sensitive THEN COALESCE(m.email, c.email) ELSE NULL END,
          'telephone',  CASE WHEN v_show_sensitive THEN COALESCE(m.telephone, c.telephone) ELSE NULL END
        ) ORDER BY m.category NULLS FIRST, m.sort_order, m.created_at
      )
      FROM projet_membres m
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE m.project_id = v_project_id
        AND m.parent_membre_id IS NULL
        AND EXISTS (
          SELECT 1
            FROM projet_deroule_creneau_membres cm
            JOIN projet_deroule_creneaux cr ON cr.id = cm.creneau_id
            JOIN projet_deroules d2 ON d2.id = cr.deroule_id
           WHERE cm.membre_id = m.id
             AND d2.project_id = v_project_id
        )
    ), '[]'::jsonb),
    'generated_at', now()
  )
  INTO v_result;

  -- Bump compteur de vues (best effort).
  UPDATE deroule_share_tokens
     SET last_accessed_at = now(),
         view_count       = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_deroule_fetch$;

REVOKE ALL ON FUNCTION share_deroule_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_deroule_fetch(text) TO anon, authenticated;


-- ── 5. RPC publique — fetch DÉROULÉ via portail projet ──────────────────────
-- Mirror de share_deroule_fetch, mais lit la config (show_sensitive) depuis
-- project_share_tokens.page_configs->'deroule'. Pattern aligné sur
-- share_projet_equipe_fetch / share_projet_livrables_fetch.
--
-- Note : ne touche pas à share_deroule_fetch (qui sert le lien dédié
-- /share/deroule/:token). Les 2 cohabitent.
CREATE OR REPLACE FUNCTION share_projet_deroule_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_projet_deroule_fetch$
DECLARE
  v_project_id     uuid;
  v_config         jsonb;
  v_show_sensitive boolean;
  v_result         jsonb;
BEGIN
  -- Résout token + config déroulé (raise si invalide/page non activée/mdp ko).
  SELECT project_id, page_config
    INTO v_project_id, v_config
    FROM _project_share_token_resolve(p_token, 'deroule', p_password);

  v_show_sensitive := COALESCE((v_config->>'show_sensitive')::boolean, true);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',          NULL,
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
    'deroules', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',               d.id,
          'date_jour',        d.date_jour,
          'titre',            d.titre,
          'granularite_min',  d.granularite_min,
          'display_step_min', d.display_step_min,
          'heure_debut_min',  d.heure_debut_min,
          'heure_fin_min',    d.heure_fin_min,
          'statut',           d.statut,
          'revision',         d.revision,
          'notes',            CASE WHEN v_show_sensitive THEN d.notes ELSE NULL END
        ) ORDER BY d.date_jour ASC, d.created_at ASC
      )
      FROM projet_deroules d
      WHERE d.project_id = v_project_id
    ), '[]'::jsonb),
    'lanes', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         l.id,
          'deroule_id', l.deroule_id,
          'sort_order', l.sort_order,
          'libelle',    l.libelle
        ) ORDER BY l.deroule_id, l.sort_order
      )
      FROM projet_deroule_lanes l
      JOIN projet_deroules d ON d.id = l.deroule_id
      WHERE d.project_id = v_project_id
    ), '[]'::jsonb),
    'creneaux', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',              c.id,
          'deroule_id',      c.deroule_id,
          'lane_id',         c.lane_id,
          'multi_lane',      c.multi_lane,
          'heure_debut_min', c.heure_debut_min,
          'heure_fin_min',   c.heure_fin_min,
          'titre',           c.titre,
          'description',     c.description,
          'type',            c.type,
          'couleur',         c.couleur,
          'lieu_text',       c.lieu_text,
          'statut',          c.statut,
          'sort_order',      c.sort_order,
          'notes',           CASE WHEN v_show_sensitive THEN c.notes ELSE NULL END,
          'member_ids',      COALESCE((
            SELECT jsonb_agg(cm.membre_id ORDER BY cm.created_at)
              FROM projet_deroule_creneau_membres cm
             WHERE cm.creneau_id = c.id
          ), '[]'::jsonb)
        ) ORDER BY c.deroule_id, c.heure_debut_min, c.sort_order
      )
      FROM projet_deroule_creneaux c
      JOIN projet_deroules d ON d.id = c.deroule_id
      WHERE d.project_id = v_project_id
    ), '[]'::jsonb),
    'membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         m.id,
          'prenom',     COALESCE(m.prenom, c.prenom),
          'nom',        COALESCE(m.nom, c.nom),
          'specialite', m.specialite,
          'category',   m.category,
          'couleur',    m.couleur,
          'email',      CASE WHEN v_show_sensitive THEN COALESCE(m.email, c.email) ELSE NULL END,
          'telephone',  CASE WHEN v_show_sensitive THEN COALESCE(m.telephone, c.telephone) ELSE NULL END
        ) ORDER BY m.category NULLS FIRST, m.sort_order, m.created_at
      )
      FROM projet_membres m
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE m.project_id = v_project_id
        AND m.parent_membre_id IS NULL
        AND EXISTS (
          SELECT 1
            FROM projet_deroule_creneau_membres cm
            JOIN projet_deroule_creneaux cr ON cr.id = cm.creneau_id
            JOIN projet_deroules d2 ON d2.id = cr.deroule_id
           WHERE cm.membre_id = m.id
             AND d2.project_id = v_project_id
        )
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, 'deroule');

  RETURN v_result;
END;
$share_projet_deroule_fetch$;

REVOKE ALL ON FUNCTION share_projet_deroule_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_deroule_fetch(text, text)
  TO anon, authenticated;


-- ── 6. Update share_projet_fetch — ajout teaser 'deroule' ───────────────────
-- On ré-écrit la RPC du hub pour inclure un nouveau teaser 'deroule' (nombre
-- de jours + nombre de créneaux du projet). Identique à la version précédente
-- pour les autres teasers.
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
      END,
      -- Nouveau : nombre de jours planifiés + total créneaux. Affiché sur
      -- la carte "Déroulé" du hub ("3 jours · 42 créneaux").
      'deroule', CASE
        WHEN v_enabled ? 'deroule' THEN (
          SELECT jsonb_build_object(
            'jours',    COUNT(DISTINCT d.id),
            'creneaux', (
              SELECT COUNT(*)
                FROM projet_deroule_creneaux c
                JOIN projet_deroules d2 ON d2.id = c.deroule_id
               WHERE d2.project_id = v_project_id
            )
          )
          FROM projet_deroules d
          WHERE d.project_id = v_project_id
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


-- ── 7. RPC admin — révocation soft d'un token ───────────────────────────────
CREATE OR REPLACE FUNCTION revoke_deroule_share_token(p_token_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $revoke_deroule_share_token$
BEGIN
  UPDATE deroule_share_tokens
     SET revoked_at = COALESCE(revoked_at, now())
   WHERE id = p_token_id;
END;
$revoke_deroule_share_token$;


-- ── 8. Reload PostgREST pour exposer les nouvelles RPCs ─────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifications post-deploy :
--
-- 1. Table créée ?
--    SELECT * FROM information_schema.tables WHERE table_name = 'deroule_share_tokens';
--    SELECT indexname FROM pg_indexes WHERE tablename = 'deroule_share_tokens';
--
-- 2. RPCs exposées ?
--    SELECT proname FROM pg_proc
--     WHERE proname IN ('share_deroule_fetch','share_projet_deroule_fetch',
--                       '_deroule_share_resolve','revoke_deroule_share_token');
--
-- 3. Smoke test création (auth admin attaché) :
--    INSERT INTO deroule_share_tokens (project_id, token, label, show_sensitive)
--    VALUES ('<project_id>', 'test-deroule-abc', 'Test régisseur', true);
--
-- 4. Smoke test fetch (anon) :
--    SELECT share_deroule_fetch('test-deroule-abc');
--    -- doit retourner project + org + deroules + lanes + creneaux + membres
--    -- et bumper view_count à 1.
--
-- 5. Token expiré → 28000 :
--    UPDATE deroule_share_tokens SET expires_at = now() - interval '1 day'
--     WHERE token = 'test-deroule-abc';
--    SELECT share_deroule_fetch('test-deroule-abc');
--    -- doit raise 28000 'invalid or expired token'.
--
-- 6. Hub teaser 'deroule' :
--    UPDATE project_share_tokens SET enabled_pages = '["deroule"]'::jsonb
--     WHERE token = '<projet-token>';
--    SELECT share_projet_fetch('<projet-token>')->'teasers'->'deroule';
--    -- doit retourner { jours: N, creneaux: M }.
--
-- 7. Page non activée :
--    UPDATE project_share_tokens SET enabled_pages = '[]'::jsonb
--     WHERE token = '<projet-token>';
--    SELECT share_projet_deroule_fetch('<projet-token>');
--    -- doit raise 28000 'invalid or expired token (or page not enabled)'.
-- ============================================================================
