-- ============================================================================
-- Migration : PROJECT-SHARE — token "portail projet" multi-pages
-- Date      : 2026-05-04
-- Contexte  : Demande Hugo. Les pages share existantes (équipe, livrables,
--             checklist matos) sont dispersées : 1 lien par page. On veut
--             un lien unique "portail projet" qui ouvre une page d'accueil
--             projet (cover, nom, ref…) puis liste des cartes cliquables
--             vers les sous-pages activées.
--
--             Chaque token projet stocke :
--               - la liste des pages activées (jsonb array)
--               - une config par page (mêmes paramètres que dans les share
--                 séparés, en jsonb)
--               - des compteurs de vues par page (jsonb)
--
--             Pages prévues à terme : equipe, livrables, logistique, materiel,
--             planning, … Pour ajouter une page : 1 nouvelle RPC dédiée
--             share_projet_<page>_fetch + 1 entrée dans la modale admin.
--             Pas de migration de schéma à chaque ajout.
--
--             Les pages share existantes (equipe_share_tokens, livrable_share_tokens)
--             RESTENT EN PARALLÈLE. Aucun touch sur les RPCs existants. Cas
--             d'usage différent (lien dédié vs portail).
--
-- Périmètre :
--   1. Table project_share_tokens + index + RLS (admin/cp/coord attaché)
--   2. Helper interne _project_share_token_resolve(token, page)
--   3. Helper interne _project_share_bump(token, page) — incrément counter
--   4. RPC share_projet_fetch(token) — payload du hub (project + org + teasers)
--   5. RPC share_projet_equipe_fetch(token) — payload équipe (copie de
--      share_equipe_fetch avec config lue dans page_configs->equipe)
--   6. RPC share_projet_livrables_fetch(token) — payload livrables (copie
--      de share_livrables_fetch avec config lue dans page_configs->livrables)
--   7. RPC admin revoke_project_share_token(uuid)
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
--              CREATE OR REPLACE FUNCTION partout.
-- Dépend de  : 20260501_mt0_security_hardening.sql (helpers is_admin,
--              current_user_role, is_project_member, get_user_org_id).
-- ============================================================================

BEGIN;

-- =====================================================================
-- 1. Table project_share_tokens
-- =====================================================================
CREATE TABLE IF NOT EXISTS project_share_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,

  -- Libellé interne ("Régisseur Paul", "Prod externe", …). Affiché côté
  -- admin uniquement. Optionnel — fallback "Lien #abc123" côté UI.
  label           text,

  -- Liste ordonnée des pages activées. Array de strings.
  -- Ex : ["equipe", "livrables"]
  -- L'ordre est respecté côté hub pour l'ordre d'affichage des cartes.
  enabled_pages   jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Config par page activée. Shape conventionnel :
  --   {
  --     "equipe": {
  --       "scope": "all" | "lot",
  --       "lot_id": uuid | null,
  --       "show_sensitive": bool
  --     },
  --     "livrables": {
  --       "calendar_level": "hidden" | "milestones" | "phases",
  --       "show_periodes": bool,
  --       "show_envoi_prevu": bool,
  --       "show_feedback": bool
  --     }
  --   }
  -- Pas de CHECK SQL pour rester souple — la modale admin valide en amont.
  page_configs    jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Soft revoke pour conserver l'historique (qui a créé / combien de vues).
  revoked_at      timestamptz,

  -- Expiration optionnelle. NULL = lien permanent.
  expires_at      timestamptz,

  -- Compteurs de vues PAR PAGE. Inclut une clé spéciale "_hub" pour
  -- l'accès au portail. Permet d'afficher "Vu 12× dont équipe 8× / livrables 3×".
  view_counts     jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Dernière vue PAR PAGE (timestamp ISO en jsonb).
  last_accessed_at jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS project_share_tokens_token_idx
  ON project_share_tokens(token);
CREATE INDEX IF NOT EXISTS project_share_tokens_project_idx
  ON project_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS project_share_tokens_active_idx
  ON project_share_tokens(project_id, created_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE project_share_tokens IS
  'Tokens de partage public "portail projet" (multi-pages). Un par destinataire / scénario. Accès anonyme via RPCs share_projet_*_fetch SECURITY DEFINER.';
COMMENT ON COLUMN project_share_tokens.enabled_pages IS
  'Array jsonb des pages activées (ex: ["equipe","livrables"]). Ordre = ordre d''affichage du hub.';
COMMENT ON COLUMN project_share_tokens.page_configs IS
  'Config par page. Mêmes shapes que les share_tokens dédiés (equipe_share_tokens, livrable_share_tokens). Voir doc dans les RPCs share_projet_<page>_fetch.';
COMMENT ON COLUMN project_share_tokens.view_counts IS
  'Compteurs jsonb par page (incl. clé _hub). Bumpé à chaque RPC share_projet_*_fetch.';


-- =====================================================================
-- 2. RLS — admin/cp/coord attachés au projet uniquement
-- =====================================================================
ALTER TABLE project_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_share_tokens_scoped_read"  ON project_share_tokens;
DROP POLICY IF EXISTS "project_share_tokens_scoped_write" ON project_share_tokens;

CREATE POLICY "project_share_tokens_scoped_read" ON project_share_tokens
  FOR SELECT
  USING (
    is_admin()
    OR (current_user_role() IN ('charge_prod','coordinateur')
        AND is_project_member(project_id))
  );

CREATE POLICY "project_share_tokens_scoped_write" ON project_share_tokens
  FOR ALL
  USING (
    is_admin()
    OR (current_user_role() IN ('charge_prod','coordinateur')
        AND is_project_member(project_id))
  )
  WITH CHECK (
    is_admin()
    OR (current_user_role() IN ('charge_prod','coordinateur')
        AND is_project_member(project_id))
  );


-- =====================================================================
-- 3. Helper interne — résolution du token + extraction config page
-- =====================================================================
-- Renvoie (project_id, page_config, enabled_pages, label) si le token est
-- valide (non révoqué, non expiré, et page activée si p_page renseigné).
-- Sinon raise 28000.
--
-- Si p_page IS NULL : on valide juste l'existence du token (utilisé par
-- share_projet_fetch pour le hub).
-- Si p_page renseigné : on valide en plus que la page est activée
-- (enabled_pages contient p_page).
CREATE OR REPLACE FUNCTION _project_share_token_resolve(p_token text, p_page text DEFAULT NULL)
RETURNS TABLE(project_id uuid, page_config jsonb, enabled_pages jsonb, label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_project_share_token_resolve$
BEGIN
  RETURN QUERY
    SELECT t.project_id,
           CASE
             WHEN p_page IS NULL THEN '{}'::jsonb
             ELSE COALESCE(t.page_configs->p_page, '{}'::jsonb)
           END,
           t.enabled_pages,
           t.label
      FROM project_share_tokens t
     WHERE t.token = p_token
       AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > now())
       AND (p_page IS NULL OR t.enabled_pages ? p_page);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired token (or page not enabled)' USING ERRCODE = '28000';
  END IF;
END;
$_project_share_token_resolve$;

REVOKE ALL ON FUNCTION _project_share_token_resolve(text, text) FROM PUBLIC;


-- =====================================================================
-- 4. Helper interne — bump compteur d'une page
-- =====================================================================
-- Best-effort : on ne fait pas échouer la RPC si l'update concurrent
-- n'aboutit pas (Postgres serializable error rare en pratique).
CREATE OR REPLACE FUNCTION _project_share_bump(p_token text, p_page text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_project_share_bump$
BEGIN
  UPDATE project_share_tokens
     SET view_counts = view_counts || jsonb_build_object(
           p_page,
           COALESCE((view_counts->>p_page)::int, 0) + 1
         ),
         last_accessed_at = last_accessed_at || jsonb_build_object(
           p_page, to_jsonb(now())
         )
   WHERE token = p_token;
EXCEPTION WHEN OTHERS THEN
  -- best effort, on n'échoue jamais sur le bump
  NULL;
END;
$_project_share_bump$;

REVOKE ALL ON FUNCTION _project_share_bump(text, text) FROM PUBLIC;


-- =====================================================================
-- 5. RPC publique — fetch HUB (page d'accueil portail)
-- =====================================================================
-- Retourne :
--   {
--     share:  { label, enabled_pages },
--     project:{ id, title, ref_projet, cover_url },
--     org:    { ... } (branding pour le header),
--     teasers:{ equipe: { persons, attributions } | null,
--               livrables: { count } | null,
--               ... },
--     generated_at
--   }
--
-- Les "teasers" sont des compteurs simples par page activée pour afficher
-- des aperçus dans les cartes du hub ("7 personnes · 7 attributions").
-- Si une page n'est pas activée, la clé est null (pas absente — pratique
-- pour le rendu côté front).
CREATE OR REPLACE FUNCTION share_projet_fetch(p_token text)
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
    FROM _project_share_token_resolve(p_token, NULL);

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
    -- Teasers : compteurs simples pour cartes du hub. Calculés uniquement
    -- pour les pages activées, sinon clé = null.
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

REVOKE ALL ON FUNCTION share_projet_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_fetch(text) TO anon, authenticated;


-- =====================================================================
-- 6. RPC publique — fetch ÉQUIPE (sous-page du portail)
-- =====================================================================
-- Mirror de share_equipe_fetch, MAIS lit la config (scope/lot/show_sensitive)
-- depuis project_share_tokens.page_configs->'equipe' au lieu de la table
-- equipe_share_tokens. Le rendu retourné est identique (même shape) pour
-- que le composant <EquipeShareView> puisse être réutilisé tel quel.
--
-- Note : ne touche pas à share_equipe_fetch (qui sert toujours les liens
-- dédiés équipe-only via /share/equipe/:token). Les 2 cohabitent.
CREATE OR REPLACE FUNCTION share_projet_equipe_fetch(p_token text)
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
  -- Résout token + config équipe (raise si invalide ou page non activée).
  SELECT project_id, page_config
    INTO v_project_id, v_config
    FROM _project_share_token_resolve(p_token, 'equipe');

  v_scope          := COALESCE(v_config->>'scope', 'all');
  v_lot_id         := NULLIF(v_config->>'lot_id', '')::uuid;
  v_show_sensitive := COALESCE((v_config->>'show_sensitive')::boolean, true);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',          NULL,  -- pas de label par sous-page (label porté par le token global)
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

REVOKE ALL ON FUNCTION share_projet_equipe_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_equipe_fetch(text) TO anon, authenticated;


-- =====================================================================
-- 7. RPC publique — fetch LIVRABLES (sous-page du portail)
-- =====================================================================
-- Mirror de share_livrables_fetch, lit la config dans
-- project_share_tokens.page_configs->'livrables'.
CREATE OR REPLACE FUNCTION share_projet_livrables_fetch(p_token text)
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
    FROM _project_share_token_resolve(p_token, 'livrables');

  v_calendar_level := COALESCE(v_config->>'calendar_level', 'hidden');
  v_show_periodes  := COALESCE((v_config->>'show_periodes')::boolean,    true);
  v_show_envoi     := COALESCE((v_config->>'show_envoi_prevu')::boolean, true);
  v_show_feedback  := COALESCE((v_config->>'show_feedback')::boolean,    true);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',  NULL,
      'config', v_config
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
            'event_type_id', ev.event_type_id,
            'sort_order',    e.sort_order
          ) ORDER BY e.date_debut, e.sort_order
        )
        FROM livrable_etapes e
        JOIN livrables l ON l.id = e.livrable_id
        LEFT JOIN events ev ON ev.id = e.event_id
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
          SELECT DISTINCT ev.event_type_id
            FROM livrable_etapes le
            JOIN events ev ON ev.id = le.event_id
            JOIN livrables l ON l.id = le.livrable_id
           WHERE l.project_id = v_project_id
             AND l.deleted_at IS NULL
             AND ev.event_type_id IS NOT NULL
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

REVOKE ALL ON FUNCTION share_projet_livrables_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_livrables_fetch(text) TO anon, authenticated;


-- =====================================================================
-- 8. RPC admin — révocation soft d'un token projet
-- =====================================================================
CREATE OR REPLACE FUNCTION revoke_project_share_token(p_token_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $revoke_project_share_token$
BEGIN
  UPDATE project_share_tokens
     SET revoked_at = COALESCE(revoked_at, now())
   WHERE id = p_token_id;
END;
$revoke_project_share_token$;


-- ── Reload PostgREST pour exposer les nouvelles RPCs ────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifications post-migration
-- ============================================================================
--
-- 1. Table créée + indexes ?
--    SELECT * FROM information_schema.tables WHERE table_name = 'project_share_tokens';
--    SELECT indexname FROM pg_indexes WHERE tablename = 'project_share_tokens';
--
-- 2. RPCs exposées ?
--    SELECT proname FROM pg_proc WHERE proname LIKE 'share_projet_%' OR proname LIKE '_project_share_%';
--
-- 3. Smoke test création d'un token (en tant qu'admin attaché au projet) :
--    INSERT INTO project_share_tokens (project_id, token, label, enabled_pages, page_configs)
--    VALUES (
--      '<project_id>',
--      'test-token-abc',
--      'Test portail',
--      '["equipe","livrables"]'::jsonb,
--      jsonb_build_object(
--        'equipe',    jsonb_build_object('scope','all','lot_id',null,'show_sensitive',true),
--        'livrables', jsonb_build_object('calendar_level','hidden','show_periodes',true,'show_envoi_prevu',true,'show_feedback',true)
--      )
--    );
--
-- 4. Smoke test fetch hub (en anon) :
--    SELECT share_projet_fetch('test-token-abc');
--    → doit retourner project + org + teasers
--    → view_counts['_hub'] doit être incrémenté
--
-- 5. Smoke test fetch équipe :
--    SELECT share_projet_equipe_fetch('test-token-abc');
--    → doit retourner même shape que share_equipe_fetch
--    → view_counts['equipe'] incrémenté
--
-- 6. Smoke test fetch livrables :
--    SELECT share_projet_livrables_fetch('test-token-abc');
--    → doit retourner même shape que share_livrables_fetch
--
-- 7. Token désactivé pour une page (page non listée dans enabled_pages) :
--    UPDATE project_share_tokens SET enabled_pages = '["equipe"]'::jsonb WHERE token = 'test-token-abc';
--    SELECT share_projet_livrables_fetch('test-token-abc');
--    → doit raise "invalid or expired token (or page not enabled)"
--
-- ============================================================================
