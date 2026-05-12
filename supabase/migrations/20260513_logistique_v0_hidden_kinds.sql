-- ============================================================================
-- Migration : LOGISTIQUE V0 — hidden_kinds + update share RPC
-- Date      : 2026-05-13
-- Contexte  : Hugo veut pouvoir masquer un sous-bloc (ex : Repas) sur une
--             entrée logistique quand il n'est pas pertinent. Ex : un membre
--             externe qui gère ses propres repas → on cache le sous-bloc.
--
-- Approche : nouvel attribut TEXT[] `hidden_kinds` sur projet_logistique_v0_entries.
-- Stocke les kinds masqués ('transport', 'hebergement', 'repas'). Default {}.
--
-- Effet :
--   1. ADD COLUMN hidden_kinds TEXT[] NOT NULL DEFAULT '{}'
--   2. Mise à jour share_projet_logistique_v0_fetch pour inclure hidden_kinds
--      dans le payload entries (le client filtre côté UI).
--
-- Idempotent : ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;


-- ── 1. Nouvelle colonne hidden_kinds ───────────────────────────────────────
ALTER TABLE projet_logistique_v0_entries
  ADD COLUMN IF NOT EXISTS hidden_kinds TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN projet_logistique_v0_entries.hidden_kinds IS
  'Liste des sous-blocs masqués pour cette entrée. Valeurs : transport, hebergement, repas. Default {} (tous visibles). Cf. LOGV0-10.';


-- ── 2. Update share_projet_logistique_v0_fetch — ajout hidden_kinds ───────
-- Re-create la RPC pour inclure le nouveau champ dans les entries. Le reste
-- du payload est identique (project / org / documents / membres / generated_at).
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
        ) ORDER BY COALESCE(m.nom, c.nom, ''), COALESCE(m.prenom, c.prenom, ''), e.created_at
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
    'membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         m.id,
          'prenom',     COALESCE(m.prenom, c.prenom),
          'nom',        COALESCE(m.nom, c.nom),
          'specialite', m.specialite
        )
      )
      FROM projet_membres m
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE m.project_id = v_project_id
        AND m.id IN (
          SELECT e.membre_id
            FROM projet_logistique_v0_entries e
           WHERE e.project_id = v_project_id
        )
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


-- ── 3. Reload PostgREST ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
