-- ============================================================================
-- Migration : PROJECT SHARE — hub_notice ("Note à l'équipe" sur le hub portail)
-- Date      : 2026-05-13
-- Contexte  : Hugo veut afficher une note libre en haut du hub portail
--             /share/projet/:token pour donner des consignes générales au
--             destinataire (dress code, story restrictions, etc.). Texte
--             markdown léger.
--
-- Décisions :
--   - Granularité PAR TOKEN (chaque lien peut avoir sa note distincte)
--   - Édité dans la modale de partage (à côté du password)
--   - Markdown léger côté front (gras, italique, listes, liens, retours
--     à la ligne) — rendu par un mini-parser maison, pas de dépendance
--
-- Effet :
--   1. ALTER TABLE project_share_tokens ADD COLUMN hub_notice TEXT
--   2. Update RPC share_projet_fetch : retourne share.hub_notice à côté
--      de share.label et share.enabled_pages
--
-- Idempotent : ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- ============================================================================

BEGIN;


-- ── 1. Colonne hub_notice ──────────────────────────────────────────────────
ALTER TABLE project_share_tokens
  ADD COLUMN IF NOT EXISTS hub_notice TEXT;

COMMENT ON COLUMN project_share_tokens.hub_notice IS
  'Note libre (markdown léger) affichée en haut du hub portail /share/projet/:token. Ex : dress code, consignes story, contacts urgents. NULL = pas de note affichée.';


-- ── 2. Update RPC share_projet_fetch ───────────────────────────────────────
-- On ajoute share.hub_notice au payload. Reste strictement identique au
-- 20260513_logistique_v0_share_fetch (qui avait déjà la dernière version
-- de la fonction avec le teaser logistique_v0).
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
  v_notice     text;
  v_result     jsonb;
BEGIN
  SELECT project_id, enabled_pages, label
    INTO v_project_id, v_enabled, v_label
    FROM _project_share_token_resolve(p_token, NULL, p_password);

  -- Récupère la note du hub directement (pas exposée par le helper resolve).
  SELECT hub_notice INTO v_notice
    FROM project_share_tokens
   WHERE token = p_token;

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label', v_label,
      'enabled_pages', v_enabled,
      'hub_notice', v_notice
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
      END,
      'logistique_v0', CASE
        WHEN v_enabled ? 'logistique_v0' THEN (
          SELECT jsonb_build_object(
            'personnes', COUNT(DISTINCT e.id),
            'documents', (
              SELECT COUNT(*)
                FROM projet_logistique_v0_documents d
                JOIN projet_logistique_v0_entries e2 ON e2.id = d.entry_id
               WHERE e2.project_id = v_project_id
            )
          )
          FROM projet_logistique_v0_entries e
          WHERE e.project_id = v_project_id
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


NOTIFY pgrst, 'reload schema';

COMMIT;
