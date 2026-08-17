-- ════════════════════════════════════════════════════════════════════════════
-- LOGISTIQUE V1 — Libellé des documents (billets, résas)
-- Date      : 2026-08-18
-- ════════════════════════════════════════════════════════════════════════════
--
-- Sur les fiches, les documents s'affichaient sous leur nom de fichier, donc
-- tronqué et illisible (« HM-ALLER-MONTPELLIER_… »). On ajoute un libellé
-- optionnel, saisi côté desk ; l'UI retombe sinon sur un libellé déduit du
-- contexte (« Billet aller », « Réservation ») puis sur le nom de fichier.
--
--   1. colonne `label` sur projet_logistique_docs (+ policy UPDATE, absente
--      jusqu'ici : la table n'acceptait qu'insert / delete) ;
--   2. `label` exposé dans les DEUX RPCs de partage.
--
-- Corps des fonctions repris de 20260730d (dernière définition) — toute
-- future redéfinition doit conserver la clé 'logistique_docs' ET 'label',
-- ainsi que le payload membres complet (cf. leçon 20260816b).
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE projet_logistique_docs
  ADD COLUMN IF NOT EXISTS label TEXT;

COMMENT ON COLUMN projet_logistique_docs.label IS
  'Libellé lisible affiché à la place du nom de fichier (ex. « Billet aller »). NULL = libellé déduit côté UI.';

DROP POLICY IF EXISTS "projet_logistique_docs_update" ON projet_logistique_docs;
CREATE POLICY "projet_logistique_docs_update" ON projet_logistique_docs
  FOR UPDATE USING (can_edit_outil(project_id, 'logistique_v0'))
  WITH CHECK (can_edit_outil(project_id, 'logistique_v0'));


CREATE OR REPLACE FUNCTION share_logistique_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_logistique_fetch$
DECLARE
  v_project_id uuid;
  v_label      text;
  v_show_overview  boolean;
  v_show_synthese  boolean;
  v_show_personnes boolean;
  v_show_v1        boolean;
  v_result     jsonb;
BEGIN
  SELECT project_id, label, show_overview, show_synthese, show_personnes
    INTO v_project_id, v_label, v_show_overview, v_show_synthese, v_show_personnes
    FROM _logistique_share_resolve(p_token);

  -- Les blocs V1 alimentent la vue d'ensemble ET la synthèse.
  v_show_v1 := v_show_overview OR v_show_synthese;

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label', v_label
    ),
    'config', jsonb_build_object(
      'show_overview',  v_show_overview,
      'show_synthese',  v_show_synthese,
      'show_personnes', v_show_personnes
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
    'entries', CASE WHEN NOT v_show_personnes THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'documents', CASE WHEN NOT v_show_personnes THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    -- Docs V1 (billets trajets, résas hébergements) — chips des fiches par
    -- personne : même gate que show_personnes.
    'logistique_docs', CASE WHEN NOT v_show_personnes THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           ld.id,
          'parent_type',  ld.parent_type,
          'parent_id',    ld.parent_id,
          'storage_path', ld.storage_path,
          'filename',     ld.filename,
          'label',        ld.label,
          'mime_type',    ld.mime_type,
          'size_bytes',   ld.size_bytes,
          'created_at',   ld.created_at
        ) ORDER BY ld.created_at
      )
      FROM projet_logistique_docs ld
      WHERE ld.project_id = v_project_id
    ), '[]'::jsonb) END,
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
    'participations', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'trajets', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'repas', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'nuits', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'membre_id',      n.membre_id,
          'date_nuit',      n.date_nuit,
          'hebergement_id', n.hebergement_id
        )
      )
      FROM projet_logistique_nuits n
      WHERE n.project_id = v_project_id
    ), '[]'::jsonb) END,
    'hebergements', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'hebergement_membres', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'generated_at', now()
  ) INTO v_result;

  -- Bump compteur de vues (best effort).
  UPDATE logistique_share_tokens
     SET last_accessed_at = now(),
         view_count       = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_logistique_fetch$;

REVOKE ALL ON FUNCTION share_logistique_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_logistique_fetch(text) TO anon, authenticated;


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
  v_config     jsonb;
  v_show_overview  boolean;
  v_show_synthese  boolean;
  v_show_personnes boolean;
  v_show_v1        boolean;
  v_result     jsonb;
BEGIN
  SELECT project_id, label, page_config
    INTO v_project_id, v_label, v_config
    FROM _project_share_token_resolve(p_token, 'logistique_v0', p_password);

  v_show_overview  := COALESCE((v_config->>'show_overview')::boolean, true);
  v_show_synthese  := COALESCE((v_config->>'show_synthese')::boolean, true);
  v_show_personnes := COALESCE((v_config->>'show_personnes')::boolean, true);
  -- Les blocs V1 alimentent la vue d'ensemble ET la synthèse.
  v_show_v1 := v_show_overview OR v_show_synthese;

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label', v_label
    ),
    'config', jsonb_build_object(
      'show_overview',  v_show_overview,
      'show_synthese',  v_show_synthese,
      'show_personnes', v_show_personnes
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
    'entries', CASE WHEN NOT v_show_personnes THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'documents', CASE WHEN NOT v_show_personnes THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    -- V1 : TOUS les membres (grille + synthèse) — champs de fusion/tri pour
    -- listTechlistRows côté client. Pas d'email/téléphone.
    -- Docs V1 (billets trajets, résas hébergements) — chips des fiches par
    -- personne : même gate que show_personnes.
    'logistique_docs', CASE WHEN NOT v_show_personnes THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           ld.id,
          'parent_type',  ld.parent_type,
          'parent_id',    ld.parent_id,
          'storage_path', ld.storage_path,
          'filename',     ld.filename,
          'label',        ld.label,
          'mime_type',    ld.mime_type,
          'size_bytes',   ld.size_bytes,
          'created_at',   ld.created_at
        ) ORDER BY ld.created_at
      )
      FROM projet_logistique_docs ld
      WHERE ld.project_id = v_project_id
    ), '[]'::jsonb) END,
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
    'participations', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    -- V1 : trajets SANS coût (interne).
    'trajets', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'repas', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'nuits', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'membre_id',      n.membre_id,
          'date_nuit',      n.date_nuit,
          'hebergement_id', n.hebergement_id
        )
      )
      FROM projet_logistique_nuits n
      WHERE n.project_id = v_project_id
    ), '[]'::jsonb) END,
    'hebergements', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'hebergement_membres', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
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
