-- ============================================================================
-- Migration : ÉQUIPE SHARE — priorité contact (live) sur surcharge membre
-- Date      : 2026-05-13
-- Contexte  : Suite au fix logistique (20260513_logistique_v0_share_name_priority).
--             Hugo : le bug "Ambroise-Mars" au lieu de "Ambroise-Marc" est
--             aussi visible sur la page share Équipe (`/share/equipe/:token`
--             et `/share/projet/:token/equipe`).
--
-- Cause : les RPC share_equipe_fetch et share_projet_equipe_fetch font
--   COALESCE(NULLIF(m.prenom, ''), c.prenom)
-- donc priorité à projet_membres.prenom (override) sur contacts.prenom
-- (live). Si une faute de frappe a été corrigée dans le contact APRÈS
-- l'attribution, la correction ne se propage pas car m.prenom garde la
-- valeur figée à l'instant T.
--
-- Pattern correct (aligné sur crew.js#fullNameFromPersona côté JS et le
-- fix logistique côté SQL) :
--   COALESCE(c.prenom, NULLIF(m.prenom, ''))
-- - contact_id rempli → c.prenom prioritaire (live, à jour)
-- - contact_id NULL → fallback m.prenom (hors-annuaire)
--
-- Trade-off conscient : si un admin avait délibérément modifié m.prenom
-- pour avoir un nom différent du contact sur ce projet (cas rare), on
-- écrase avec le contact. Décision Hugo : la cohérence "BDD = vérité"
-- l'emporte sur ce cas de figure rare. La "surcharge volontaire" n'est
-- de toute façon pas exposée dans l'UI d'édition de membre actuelle.
--
-- Effet : 2 fonctions ré-écrites en complet (CREATE OR REPLACE), seul
-- l'ordre du COALESCE change. Le reste du payload est strictement
-- identique aux migrations 20260507/20260508 précédentes.
-- ============================================================================

BEGIN;


-- ── 1. share_equipe_fetch (lien dédié /share/equipe/:token) ────────────────
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
          -- NAME-PRIORITY-FIX : contact lié prioritaire (live), fallback
          -- sur m.prenom pour les hors-annuaire (contact_id NULL).
          'prenom', COALESCE(
            (SELECT c.prenom FROM contacts c WHERE c.id = m.contact_id),
            NULLIF(m.prenom, '')
          ),
          'nom', COALESCE(
            (SELECT c.nom FROM contacts c WHERE c.id = m.contact_id),
            NULLIF(m.nom, '')
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
    'sessions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                  psm.id,
          'membre_id',           psm.membre_id,
          'session_id',          psm.session_id,
          'sort_order',          ps.sort_order,
          'label',               ps.label,
          'lieu_principal_id',   ps.lieu_principal_id,
          'lieu_principal_text', ps.lieu_principal_text,
          'couleur',             ps.couleur,
          'start_date',          ps.start_date,
          'end_date',            ps.end_date,
          'notes',               ps.notes,
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


-- ── 2. share_projet_equipe_fetch (sous-page portail projet) ────────────────
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
          -- NAME-PRIORITY-FIX : contact lié prioritaire (live), fallback
          -- sur m.prenom pour les hors-annuaire (contact_id NULL).
          'prenom', COALESCE(
            (SELECT c.prenom FROM contacts c WHERE c.id = m.contact_id),
            NULLIF(m.prenom, '')
          ),
          'nom', COALESCE(
            (SELECT c.nom FROM contacts c WHERE c.id = m.contact_id),
            NULLIF(m.nom, '')
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


NOTIFY pgrst, 'reload schema';

COMMIT;
