-- ════════════════════════════════════════════════════════════════════════════
-- DÉROULÉ — lane_ids (multi-colonnes) dans les payloads de partage
-- ════════════════════════════════════════════════════════════════════════════
--
-- D3 du chantier multi-colonnes (cf. 20260816a) : les deux RPCs de partage
-- exposent lane_ids (rendu fusionné côté pages publiques) et incluent dans
-- le payload membres les cadreurs qui n'ont qu'une lane perso sans
-- assignation directe (fix sélecteur vue Cadreur du share).
-- Base : 20260608b (dernière définition).
-- Idempotent. Dépend de : 20260816a_deroule_creneau_lane_ids.sql.
-- ════════════════════════════════════════════════════════════════════════════

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
        'id',            p.id,
        'title',         p.title,
        'ref_projet',    p.ref_projet,
        'cover_url',     p.cover_url,
        -- Types V2 : pour permettre aux destinataires de voir les libellés
        -- et couleurs des types personnalisés (sinon gris fallback).
        'creneau_types', COALESCE(p.creneau_types, '[]'::jsonb)
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
          'libelle',    l.libelle,
          'type',       l.type,
          'membre_id',  l.membre_id,
          'couleur',    l.couleur
        ) ORDER BY l.deroule_id, l.sort_order
      )
      FROM projet_deroule_lanes l
      JOIN projet_deroules d ON d.id = l.deroule_id
      WHERE d.project_id = v_project_id
    ), '[]'::jsonb),
    'creneaux', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                c.id,
          'deroule_id',        c.deroule_id,
          'lane_id',           c.lane_id,
          'multi_lane',        c.multi_lane,
          'lane_ids',          c.lane_ids,
          'heure_debut_min',   c.heure_debut_min,
          'heure_fin_min',     c.heure_fin_min,
          'titre',             c.titre,
          'description',       c.description,
          'type',              c.type,
          'couleur',           c.couleur,
          'lieu_text',         c.lieu_text,
          'statut',            c.statut,
          'sort_order',        c.sort_order,
          'alerte_text',       c.alerte_text,
          'alerte_niveau',     c.alerte_niveau,
          'source_creneau_id', c.source_creneau_id,
          'notes',             CASE WHEN v_show_sensitive THEN c.notes ELSE NULL END,
          'member_ids',        COALESCE((
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
          'prenom',     COALESCE(c.prenom, m.prenom),
          'nom',        COALESCE(c.nom, m.nom),
          'specialite', m.specialite,
          'category',   m.category,
          'couleur',    m.couleur,
          'email',      CASE WHEN v_show_sensitive THEN COALESCE(c.email, m.email) ELSE NULL END,
          'telephone',  CASE WHEN v_show_sensitive THEN COALESCE(c.telephone, m.telephone) ELSE NULL END
        ) ORDER BY m.category NULLS FIRST, m.sort_order, m.created_at
      )
      FROM projet_membres m
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE m.project_id = v_project_id
        AND m.parent_membre_id IS NULL
        AND (
          EXISTS (
            SELECT 1
              FROM projet_deroule_creneau_membres cm
              JOIN projet_deroule_creneaux cr ON cr.id = cm.creneau_id
              JOIN projet_deroules d2 ON d2.id = cr.deroule_id
             WHERE cm.membre_id = m.id
               AND d2.project_id = v_project_id
          )
          -- Cadreurs avec lane perso mais sans assignation directe : la vue
          -- Cadreur du share les liste via lanes.membre_id — le membre doit
          -- donc être présent dans le payload (fix « HM manquant »).
          OR EXISTS (
            SELECT 1
              FROM projet_deroule_lanes pl
              JOIN projet_deroules pd ON pd.id = pl.deroule_id
             WHERE pl.membre_id = m.id
               AND pd.project_id = v_project_id
          )
        )
    ), '[]'::jsonb),
    'generated_at', now()
  )
  INTO v_result;

  UPDATE deroule_share_tokens
     SET last_accessed_at = now(),
         view_count       = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_deroule_fetch$;

REVOKE ALL ON FUNCTION share_deroule_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_deroule_fetch(text) TO anon, authenticated;


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
        'id',            p.id,
        'title',         p.title,
        'ref_projet',    p.ref_projet,
        'cover_url',     p.cover_url,
        -- Idem que share_deroule_fetch.
        'creneau_types', COALESCE(p.creneau_types, '[]'::jsonb)
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
          'libelle',    l.libelle,
          'type',       l.type,
          'membre_id',  l.membre_id,
          'couleur',    l.couleur
        ) ORDER BY l.deroule_id, l.sort_order
      )
      FROM projet_deroule_lanes l
      JOIN projet_deroules d ON d.id = l.deroule_id
      WHERE d.project_id = v_project_id
    ), '[]'::jsonb),
    'creneaux', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                c.id,
          'deroule_id',        c.deroule_id,
          'lane_id',           c.lane_id,
          'multi_lane',        c.multi_lane,
          'lane_ids',          c.lane_ids,
          'heure_debut_min',   c.heure_debut_min,
          'heure_fin_min',     c.heure_fin_min,
          'titre',             c.titre,
          'description',       c.description,
          'type',              c.type,
          'couleur',           c.couleur,
          'lieu_text',         c.lieu_text,
          'statut',            c.statut,
          'sort_order',        c.sort_order,
          'alerte_text',       c.alerte_text,
          'alerte_niveau',     c.alerte_niveau,
          'source_creneau_id', c.source_creneau_id,
          'notes',             CASE WHEN v_show_sensitive THEN c.notes ELSE NULL END,
          'member_ids',        COALESCE((
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
          'prenom',     COALESCE(c.prenom, m.prenom),
          'nom',        COALESCE(c.nom, m.nom),
          'specialite', m.specialite,
          'category',   m.category,
          'couleur',    m.couleur,
          'email',      CASE WHEN v_show_sensitive THEN COALESCE(c.email, m.email) ELSE NULL END,
          'telephone',  CASE WHEN v_show_sensitive THEN COALESCE(c.telephone, m.telephone) ELSE NULL END
        ) ORDER BY m.category NULLS FIRST, m.sort_order, m.created_at
      )
      FROM projet_membres m
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE m.project_id = v_project_id
        AND m.parent_membre_id IS NULL
        AND (
          EXISTS (
            SELECT 1
              FROM projet_deroule_creneau_membres cm
              JOIN projet_deroule_creneaux cr ON cr.id = cm.creneau_id
              JOIN projet_deroules d2 ON d2.id = cr.deroule_id
             WHERE cm.membre_id = m.id
               AND d2.project_id = v_project_id
          )
          -- Cadreurs avec lane perso mais sans assignation directe : la vue
          -- Cadreur du share les liste via lanes.membre_id — le membre doit
          -- donc être présent dans le payload (fix « HM manquant »).
          OR EXISTS (
            SELECT 1
              FROM projet_deroule_lanes pl
              JOIN projet_deroules pd ON pd.id = pl.deroule_id
             WHERE pl.membre_id = m.id
               AND pd.project_id = v_project_id
          )
        )
    ), '[]'::jsonb),
    'generated_at', now()
  )
  INTO v_result;

  RETURN v_result;
END;
$share_projet_deroule_fetch$;

REVOKE ALL ON FUNCTION share_projet_deroule_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_deroule_fetch(text, text)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
