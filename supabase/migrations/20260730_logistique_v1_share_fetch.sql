-- ════════════════════════════════════════════════════════════════════════════
-- LOGISTIQUE V1 — P4 : partage public enrichi (grille + synthèse + fiches)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Étend share_projet_logistique_v0_fetch (MÊME nom : les liens existants
-- continuent de marcher) avec les données V1 nécessaires à la page publique
-- refondue : vision d'ensemble (grille lecture seule), synthèse festival et
-- fiches par personne.
--
-- Ajouts au payload :
--   - membres          : TOUS les membres du projet (plus seulement ceux des
--                        entries V0) + champs de fusion/tri (contact_id,
--                        parent_membre_id, category, sort_order) + produit devis
--   - participations   : sessions Équipe (presence_days, arrivée/départ,
--                        label + couleur + sort_order de la session)
--   - trajets          : SANS le coût (interne, décision Hugo)
--   - repas / nuits    : grille logistique
--   - hebergements     : + hebergement_membres (chambre, PDJ)
--
-- Base : version 20260513_logistique_v0_share_name_priority.sql.
-- Idempotent (CREATE OR REPLACE). À appliquer via le SQL editor.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION share_projet_logistique_v0_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_projet_logistique_v0_fetch$
DECLARE
  v_project_id uuid;
  v_label      text;
  v_result     jsonb;
BEGIN
  SELECT project_id, label
    INTO v_project_id, v_label
    FROM _project_share_token_resolve(p_token, 'logistique_v0', p_password);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label', v_label
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
    'global', (
      SELECT jsonb_build_object(
        'id',          g.id,
        'project_id',  g.project_id,
        'text',        g.text,
        'created_at',  g.created_at,
        'updated_at',  g.updated_at
      )
      FROM projet_logistique_v0_global g
      WHERE g.project_id = v_project_id
      LIMIT 1
    ),
    'global_documents', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           d.id,
          'global_id',    d.global_id,
          'storage_path', d.storage_path,
          'filename',     d.filename,
          'mime_type',    d.mime_type,
          'size_bytes',   d.size_bytes,
          'created_at',   d.created_at
        ) ORDER BY d.created_at
      )
      FROM projet_logistique_v0_global_documents d
      JOIN projet_logistique_v0_global g ON g.id = d.global_id
      WHERE g.project_id = v_project_id
    ), '[]'::jsonb),
    'entries', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                e.id,
          'project_id',        e.project_id,
          'membre_id',         e.membre_id,
          'transport_text',    e.transport_text,
          'hebergement_text',  e.hebergement_text,
          'repas_text',        e.repas_text,
          'hidden_kinds',      to_jsonb(COALESCE(e.hidden_kinds, '{}'::text[])),
          'created_at',        e.created_at,
          'updated_at',        e.updated_at
        ) ORDER BY COALESCE(c.nom, m.nom, ''), COALESCE(c.prenom, m.prenom, ''), e.created_at
      )
      FROM projet_logistique_v0_entries e
      JOIN projet_membres m ON m.id = e.membre_id
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE e.project_id = v_project_id
    ), '[]'::jsonb),
    'documents', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           d.id,
          'entry_id',     d.entry_id,
          'kind',         d.kind,
          'storage_path', d.storage_path,
          'filename',     d.filename,
          'mime_type',    d.mime_type,
          'size_bytes',   d.size_bytes,
          'created_at',   d.created_at
        ) ORDER BY d.entry_id, d.kind, d.created_at
      )
      FROM projet_logistique_v0_documents d
      JOIN projet_logistique_v0_entries e ON e.id = d.entry_id
      WHERE e.project_id = v_project_id
    ), '[]'::jsonb),
    -- V1 : TOUS les membres (grille + synthèse) — champs de fusion/tri pour
    -- listTechlistRows côté client. Pas d'email/téléphone.
    'membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',               m.id,
          'contact_id',       m.contact_id,
          'parent_membre_id', m.parent_membre_id,
          'category',         m.category,
          'sort_order',       m.sort_order,
          'created_at',       m.created_at,
          'prenom',           COALESCE(c.prenom, m.prenom),
          'nom',              COALESCE(c.nom, m.nom),
          'specialite',       m.specialite,
          'produit',          dl.produit
        ) ORDER BY m.category NULLS FIRST, m.sort_order, m.created_at
      )
      FROM projet_membres m
      LEFT JOIN contacts c ON c.id = m.contact_id
      LEFT JOIN devis_lines dl ON dl.id = m.devis_line_id
      WHERE m.project_id = v_project_id
    ), '[]'::jsonb),
    -- V1 : participations sessions Équipe (présences + arrivées/départs).
    'participations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',             psm.id,
          'session_id',     psm.session_id,
          'membre_id',      psm.membre_id,
          'presence_days',  to_jsonb(COALESCE(psm.presence_days, '{}'::text[])),
          'arrival_date',   psm.arrival_date,
          'arrival_time',   psm.arrival_time,
          'departure_date', psm.departure_date,
          'departure_time', psm.departure_time,
          'label',          s.label,
          'couleur',        s.couleur,
          'sort_order',     s.sort_order,
          'start_date',     s.start_date,
          'end_date',       s.end_date
        )
      )
      FROM projet_session_membres psm
      JOIN projet_sessions s ON s.id = psm.session_id
      WHERE s.project_id = v_project_id
    ), '[]'::jsonb),
    -- V1 : trajets SANS coût (interne).
    'trajets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          t.id,
          'membre_id',   t.membre_id,
          'sens',        t.sens,
          'date_trajet', t.date_trajet,
          'etapes',      t.etapes,
          'notes',       t.notes
        ) ORDER BY t.date_trajet, t.sort_order
      )
      FROM projet_logistique_trajets t
      WHERE t.project_id = v_project_id
    ), '[]'::jsonb),
    'repas', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'membre_id',  r.membre_id,
          'date_repas', r.date_repas,
          'service',    r.service,
          'statut',     r.statut
        )
      )
      FROM projet_logistique_repas r
      WHERE r.project_id = v_project_id
    ), '[]'::jsonb),
    'nuits', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'membre_id',      n.membre_id,
          'date_nuit',      n.date_nuit,
          'hebergement_id', n.hebergement_id
        )
      )
      FROM projet_logistique_nuits n
      WHERE n.project_id = v_project_id
    ), '[]'::jsonb),
    'hebergements', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',      h.id,
          'nom',     h.nom,
          'type',    h.type,
          'adresse', h.adresse,
          'notes',   h.notes
        ) ORDER BY h.sort_order
      )
      FROM projet_logistique_hebergements h
      WHERE h.project_id = v_project_id
    ), '[]'::jsonb),
    'hebergement_membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'hebergement_id', hm.hebergement_id,
          'membre_id',      hm.membre_id,
          'chambre',        hm.chambre,
          'pdj',            hm.pdj
        )
      )
      FROM projet_logistique_hebergement_membres hm
      WHERE hm.project_id = v_project_id
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, 'logistique_v0');

  RETURN v_result;
END;
$share_projet_logistique_v0_fetch$;

REVOKE ALL ON FUNCTION share_projet_logistique_v0_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_logistique_v0_fetch(text, text)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
