-- ============================================================================
-- Migration : EQUIPE-P4 — category_order respecté côté partage public
-- Date      : 2026-05-03
-- Contexte  : Sur la Crew list (admin), l'utilisateur peut réordonner les
--             blocs de catégories par drag & drop. Cet ordre est persisté
--             en localStorage côté client (UI immédiate) ET dans
--             projects.metadata->'equipe'->'category_order' (vector de
--             strings) pour qu'il soit consultable par les vues read-only :
--               - Mode "Vue seule" admin (EquipePreviewModal) → lit
--                 directement allCategories côté front (rien à faire DB).
--               - Export PDF → idem, propage allCategories.
--               - Page partage publique /share/equipe/:token → ne peut PAS
--                 lire le localStorage admin. Doit récupérer l'ordre depuis
--                 le payload de la RPC.
--
--             Cette migration met à jour `share_equipe_fetch` pour inclure
--             `category_order` au top-level du payload retourné. Tout le
--             reste de la fonction est strictement identique à la version
--             d'origine (cf. 20260502_equipe_p42_share_tokens.sql) — seul
--             ajout : la clé `category_order` dans jsonb_build_object.
--
--             Si projects.metadata->'equipe'->'category_order' n'existe pas
--             (cas legacy : projet jamais réordonné), on retourne un
--             tableau vide. Le client retombera alors sur l'ordre par
--             défaut (À TRIER → DEFAULT_CATEGORIES → custom).
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260502_equipe_p42_share_tokens.sql (RPC originelle).
-- ============================================================================

BEGIN;

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
  -- Résout token → contexte (raise si invalide/expiré).
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
    -- EQUIPE-P4 : ordre custom des catégories tel que défini par l'admin sur
    -- la Crew list (drag & drop). Stocké dans
    -- projects.metadata->'equipe'->'category_order' (array de strings
    -- UPPERCASE). Vide = retombée sur l'ordre par défaut côté client.
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
          (m.category IS NOT NULL) ASC, -- À trier (NULL) en premier
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
  )
  INTO v_result;

  -- Bump compteur de vues (best effort).
  UPDATE equipe_share_tokens
     SET last_accessed_at = now(),
         view_count       = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_equipe_fetch$;

REVOKE ALL ON FUNCTION share_equipe_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_equipe_fetch(text) TO anon, authenticated;

COMMIT;
