-- ============================================================================
-- Migration : LOGISTIQUE V0 — share RPC fix : priorité contact pour prénom/nom
-- Date      : 2026-05-13
-- Contexte  : Hugo : "le nom d'Ambroise-Marc apparaît avec la faute de frappe
--             d'origine (Mars) — la correction dans la BDD contact n'a pas
--             été propagée."
--
-- Cause : la RPC share_projet_logistique_v0_fetch faisait
--   COALESCE(m.prenom, c.prenom)
-- donc priorité à projet_membres.prenom (override historique) sur contacts.prenom
-- (la BDD à jour). Pattern incohérent avec le reste du code équipe
-- (crew.js#fullNameFromPersona qui fait `c.prenom || members[0].prenom`).
--
-- Fix : inverser le COALESCE en
--   COALESCE(c.prenom, m.prenom)
-- pour les membres avec contact_id rempli (= annuaire) la valeur contact
-- prend la priorité, donc une correction dans la BDD se propage immédiatement.
-- Pour les hors-annuaire (contact_id NULL → c.prenom NULL), on tombe sur
-- m.prenom comme avant.
--
-- Même fix appliqué côté front (lib/logistiqueV0.js#membreFullName +
-- LogistiqueEntryCard#computeInitials) dans le même commit.
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;

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
    -- Dénormalisation des membres pour affichage UI partagée. Priorité au
    -- contact (live, à jour) sur la surcharge projet_membres.prenom/nom.
    'membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         m.id,
          'prenom',     COALESCE(c.prenom, m.prenom),
          'nom',        COALESCE(c.nom, m.nom),
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

NOTIFY pgrst, 'reload schema';

COMMIT;
