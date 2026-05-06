-- ============================================================================
-- Migration : ÉQUIPE SESSIONS — Inclure les sessions dans les RPC share
-- Date      : 2026-05-07
-- Contexte  : Les fonctions share_equipe_fetch et share_projet_equipe_fetch
--             ont été écrites avant la Phase A. Elles ne retournent que les
--             agrégats persona-level (presence_days, arrival_date,
--             departure_date) sur projet_membres, pas les sessions Phase A.
--
--             Conséquence : la page partagée publique (/share/equipe/:token)
--             et le partage projet (/share/projet/:token/equipe) affichent
--             les cellules X en vert plat sans légende sessions, alors que
--             la vue interne affiche déjà les couleurs + légende.
--
-- Solution : ajouter un champ `sessions` au payload, format shape unifié
--            (= 1 row par participation, avec les champs SESSION-LEVEL
--            aplatis dedans). Côté React, on consomme exactement comme
--            sessionsByMembre dans useCrew.
--
-- Scope : on respecte le scope du token (all / lot). En lot, seules les
--         participations des membres dans le lot sont incluses.
-- ============================================================================

BEGIN;

-- ── 1. share_equipe_fetch (standalone /share/equipe/:token) ───────────────
CREATE OR REPLACE FUNCTION share_equipe_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_equipe_fetch$
DECLARE
  v_project_id     uuid;
  v_scope          text;
  v_lot_id         uuid;
  v_show_sensitive boolean;
  v_result         jsonb;
BEGIN
  SELECT project_id, scope, lot_id, show_sensitive
    INTO v_project_id, v_scope, v_lot_id, v_show_sensitive
    FROM _equipe_share_resolve(p_token);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',          (SELECT label FROM equipe_share_tokens WHERE token = p_token),
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
          'prenom', COALESCE(
            NULLIF(m.prenom, ''),
            (SELECT c.prenom FROM contacts c WHERE c.id = m.contact_id)
          ),
          'nom', COALESCE(
            NULLIF(m.nom, ''),
            (SELECT c.nom FROM contacts c WHERE c.id = m.contact_id)
          ),
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
                'prenom',            c.prenom,
                'nom',               c.nom,
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
    -- ── Sessions Phase A (NEW 2026-05-07) ─────────────────────────────────
    -- Shape unifié (1 row par participation, SESSION-LEVEL fields aplatis).
    -- Le filtre `scope` reproduit la logique des membres : en mode lot,
    -- seules les participations des membres du lot apparaissent.
    'sessions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                  psm.id,
          'membre_id',           psm.membre_id,
          'session_id',          psm.session_id,
          'sort_order',          ps.sort_order,
          'label',               ps.label,
          'lieu_principal_text', ps.lieu_principal_text,
          'couleur',             ps.couleur,
          'presence_days',       psm.presence_days,
          'arrival_date',        psm.arrival_date,
          'arrival_time',        CASE WHEN v_show_sensitive THEN psm.arrival_time   ELSE NULL END,
          'departure_date',      psm.departure_date,
          'departure_time',      CASE WHEN v_show_sensitive THEN psm.departure_time ELSE NULL END,
          'statut',              psm.statut
        )
        ORDER BY ps.sort_order, psm.membre_id
      )
      FROM projet_session_membres psm
      JOIN projet_sessions ps ON ps.id = psm.session_id
      WHERE psm.project_id = v_project_id
        -- Filtre scope identique aux membres : on ne renvoie une
        -- participation QUE si son membre est dans le scope du token.
        AND EXISTS (
          SELECT 1 FROM projet_membres m
          WHERE m.id = psm.membre_id
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
        )
    ), '[]'::jsonb),
    'generated_at', now()
  )
  INTO v_result;

  UPDATE equipe_share_tokens
     SET last_accessed_at = now(),
         view_count       = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_equipe_fetch$;

REVOKE ALL ON FUNCTION share_equipe_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_equipe_fetch(text) TO anon, authenticated;


-- ── 2. share_projet_equipe_fetch (sous-page /share/projet/:token/equipe) ──
-- Même logique, mais avec password gate via _project_share_token_resolve.
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
    -- Sessions Phase A — même bloc que share_equipe_fetch
    'sessions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                  psm.id,
          'membre_id',           psm.membre_id,
          'session_id',          psm.session_id,
          'sort_order',          ps.sort_order,
          'label',               ps.label,
          'lieu_principal_text', ps.lieu_principal_text,
          'couleur',             ps.couleur,
          'presence_days',       psm.presence_days,
          'arrival_date',        psm.arrival_date,
          'arrival_time',        CASE WHEN v_show_sensitive THEN psm.arrival_time   ELSE NULL END,
          'departure_date',      psm.departure_date,
          'departure_time',      CASE WHEN v_show_sensitive THEN psm.departure_time ELSE NULL END,
          'statut',              psm.statut
        )
        ORDER BY ps.sort_order, psm.membre_id
      )
      FROM projet_session_membres psm
      JOIN projet_sessions ps ON ps.id = psm.session_id
      WHERE psm.project_id = v_project_id
        AND EXISTS (
          SELECT 1 FROM projet_membres m
          WHERE m.id = psm.membre_id
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


-- ── 3. Reload PostgREST ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Vérifications post-migration
-- ============================================================================
--
-- 1. Le payload contient bien le champ `sessions` :
--    SELECT jsonb_object_keys(share_equipe_fetch('<un-token-valide>'));
--    -- Doit inclure 'sessions' dans la liste.
--
-- 2. Comptage cohérent avec la DB :
--    SELECT COUNT(*) FROM projet_session_membres psm
--    WHERE psm.project_id = (SELECT project_id FROM equipe_share_tokens WHERE token='<token>');
--    -- Doit matcher la length de payload->>'sessions' (en mode scope='all').
-- ============================================================================
