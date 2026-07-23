-- ============================================================================
-- Migration : MATOS-LISTES — plusieurs listes matériel par projet
-- Date      : 2026-07-07
-- Contexte  : Réintroduit le niveau « liste » (décision Hugo) : un projet
--             porte N listes (« Scène A », « Scène B », …), chacune avec son
--             fil de versions. Une liste peut être rattachée à un lot de
--             devis (badge informatif). Backfill : chaque projet ayant déjà
--             des versions reçoit une « Liste principale » qui les adopte.
--
--   matos_listes (project_id) ─< matos_versions (matos_liste_id)
--
-- matos_versions.project_id est CONSERVÉ (dénormalisé, = projet de la liste) :
-- les RLS existantes des tables enfants et les bundles RPC restent valides.
-- L'unicité des numéros passe de (project_id, numero) à (matos_liste_id,
-- numero) : chaque liste a ses V1/V2/V3. La notion « version active du
-- projet » devient « version active de la liste » ; les partages en mode
-- 'active' suivent leur liste (les tokens existants → liste principale).
--
-- Idempotent.
-- ============================================================================

BEGIN;

-- ── 1. Table matos_listes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matos_listes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  titre         text NOT NULL DEFAULT 'Liste principale',
  -- Rattachement OPTIONNEL à un lot de devis (badge informatif, v1).
  devis_lot_id  uuid REFERENCES devis_lots(id) ON DELETE SET NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  archived      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS matos_listes_project_idx ON matos_listes(project_id);

COMMENT ON TABLE matos_listes IS
  'Listes matériel d''un projet (Scène A, Scène B, …). Chaque liste porte son propre fil de versions (matos_versions.matos_liste_id).';

ALTER TABLE matos_listes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_listes_scoped_read"  ON matos_listes;
DROP POLICY IF EXISTS "matos_listes_scoped_write" ON matos_listes;

CREATE POLICY "matos_listes_scoped_read" ON matos_listes
  FOR SELECT USING (can_read_outil(project_id, 'materiel'));

CREATE POLICY "matos_listes_scoped_write" ON matos_listes
  FOR ALL
  USING (can_edit_outil(project_id, 'materiel'))
  WITH CHECK (can_edit_outil(project_id, 'materiel'));

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE matos_listes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

-- ── 2. matos_versions.matos_liste_id + backfill « Liste principale » ────────
ALTER TABLE matos_versions
  ADD COLUMN IF NOT EXISTS matos_liste_id uuid REFERENCES matos_listes(id) ON DELETE CASCADE;

INSERT INTO matos_listes (project_id, titre, sort_order)
SELECT DISTINCT v.project_id, 'Liste principale', 0
FROM matos_versions v
WHERE v.matos_liste_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM matos_listes l WHERE l.project_id = v.project_id);

UPDATE matos_versions v
SET matos_liste_id = l.id
FROM matos_listes l
WHERE l.project_id = v.project_id
  AND v.matos_liste_id IS NULL;

ALTER TABLE matos_versions ALTER COLUMN matos_liste_id SET NOT NULL;

-- ── 3. Unicité des numéros PAR LISTE (chaque liste a ses V1/V2/V3) ─────────
DO $$
DECLARE v_name text;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'matos_versions'::regclass
    AND contype = 'u'
    AND conkey = (
      SELECT array_agg(attnum ORDER BY attnum)
      FROM pg_attribute
      WHERE attrelid = 'matos_versions'::regclass
        AND attname IN ('project_id', 'numero')
    );
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE matos_versions DROP CONSTRAINT %I', v_name);
  END IF;
END$$;

DO $$
BEGIN
  ALTER TABLE matos_versions
    ADD CONSTRAINT matos_versions_liste_numero_unique UNIQUE (matos_liste_id, numero);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END$$;

CREATE INDEX IF NOT EXISTS matos_versions_liste_idx
  ON matos_versions(matos_liste_id);
CREATE INDEX IF NOT EXISTS matos_versions_liste_active_idx
  ON matos_versions(matos_liste_id) WHERE is_active = true AND archived_at IS NULL;

-- ── 4. Partage web : le mode 'active' suit une LISTE ────────────────────────
ALTER TABLE matos_share_tokens
  ADD COLUMN IF NOT EXISTS matos_liste_id uuid REFERENCES matos_listes(id) ON DELETE SET NULL;

COMMENT ON COLUMN matos_share_tokens.matos_liste_id IS
  'Mode ''active'' (version_id NULL) : liste suivie. NULL = liste principale du projet.';

-- Tokens 'active' existants → liste principale (comportement inchangé).
UPDATE matos_share_tokens t
SET matos_liste_id = (
  SELECT l.id FROM matos_listes l
  WHERE l.project_id = t.project_id
  ORDER BY l.archived ASC, l.sort_order ASC, l.created_at ASC
  LIMIT 1
)
WHERE t.version_id IS NULL AND t.matos_liste_id IS NULL;

-- ── 5. Helpers de résolution ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _matos_liste_principale(p_project uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $_matos_liste_principale$
  SELECT id FROM matos_listes
   WHERE project_id = p_project
   ORDER BY archived ASC, sort_order ASC, created_at ASC
   LIMIT 1
$_matos_liste_principale$;

REVOKE ALL ON FUNCTION _matos_liste_principale(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION _matos_active_version(p_project uuid, p_liste uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $_matos_active_version$
DECLARE
  v_liste uuid;
  v_id    uuid;
BEGIN
  v_liste := COALESCE(p_liste, _matos_liste_principale(p_project));
  IF v_liste IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_id
    FROM matos_versions
   WHERE matos_liste_id = v_liste AND is_active = true
   LIMIT 1;
  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM matos_versions
     WHERE matos_liste_id = v_liste
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;
  RETURN v_id;
END;
$_matos_active_version$;

REVOKE ALL ON FUNCTION _matos_active_version(uuid, uuid) FROM PUBLIC;

-- ── 6. _matos_share_resolve : suit la liste du token ────────────────────────
CREATE OR REPLACE FUNCTION _matos_share_resolve(p_token text)
RETURNS TABLE(
  project_id          uuid,
  version_id_resolved uuid,
  config              jsonb,
  label               text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_matos_share_resolve$
DECLARE
  v_token_row record;
  v_resolved  uuid;
BEGIN
  SELECT t.project_id, t.version_id, t.matos_liste_id, t.config, t.label
    INTO v_token_row
    FROM matos_share_tokens t
   WHERE t.token = p_token
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired token'
      USING ERRCODE = '28000';
  END IF;

  -- Mode snapshot : version figée. Mode active : suit la liste du token
  -- (fallback liste principale du projet).
  IF v_token_row.version_id IS NOT NULL THEN
    v_resolved := v_token_row.version_id;
  ELSE
    v_resolved := _matos_active_version(v_token_row.project_id, v_token_row.matos_liste_id);
  END IF;

  RETURN QUERY SELECT
    v_token_row.project_id,
    v_resolved,
    v_token_row.config,
    v_token_row.label;
END;
$_matos_share_resolve$;

REVOKE ALL ON FUNCTION _matos_share_resolve(text) FROM PUBLIC;

-- ── 7. Fonctions du portail projet (résolution via liste principale) ────────
CREATE OR REPLACE FUNCTION share_projet_materiel_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_projet_materiel_fetch$
DECLARE
  v_project_id    uuid;
  v_config        jsonb;
  v_version_id    uuid;
  v_show_loueurs  boolean;
  v_show_qte      boolean;
  v_show_remark   boolean;
  v_show_flags    boolean;
  v_show_check    boolean;
  v_result        jsonb;
BEGIN
  -- Résolution token + check mdp + check page activée.
  SELECT project_id, page_config
    INTO v_project_id, v_config
    FROM _project_share_token_resolve(p_token, 'materiel', p_password);

  -- Mode version : NULL = active courante, sinon snapshot figé.
  v_version_id := NULLIF(v_config->>'version_id', '')::uuid;
  -- Multi-listes : le mode 'active' suit la version active de la liste
  -- PRINCIPALE du projet (helper _matos_active_version).
  IF v_version_id IS NULL THEN
    v_version_id := _matos_active_version(v_project_id, NULL);
  END IF;

  -- Lecture des toggles avec fallback (cohérent DEFAULT_SHARE_CONFIG).
  v_show_loueurs := COALESCE((v_config->>'show_loueurs')::boolean,    true);
  v_show_qte     := COALESCE((v_config->>'show_quantites')::boolean,  true);
  v_show_remark  := COALESCE((v_config->>'show_remarques')::boolean,  false);
  v_show_flags   := COALESCE((v_config->>'show_flags')::boolean,      false);
  v_show_check   := COALESCE((v_config->>'show_checklist')::boolean,  false);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',  NULL,  -- pas de label par sous-page (porté par token global)
      'config', v_config
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
    'version', (
      SELECT jsonb_build_object(
        'id',        v.id,
        'numero',    v.numero,
        'label',     v.label,
        'is_active', v.is_active,
        'mode',      CASE
          WHEN NULLIF(v_config->>'version_id', '') IS NULL
            THEN 'active'
          ELSE 'snapshot'
        END
      )
      FROM matos_versions v WHERE v.id = v_version_id
    ),
    'versions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',        v.id,
          'numero',    v.numero,
          'label',     v.label,
          'is_active', v.is_active
        ) ORDER BY v.numero, v.created_at
      )
      FROM matos_versions v
      WHERE v.matos_liste_id = (
        SELECT mv.matos_liste_id FROM matos_versions mv WHERE mv.id = v_version_id
      )
    ), '[]'::jsonb),
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         b.id,
          'titre',      b.titre,
          'couleur',    b.couleur,
          'affichage',  b.affichage,
          'sort_order', b.sort_order
        ) ORDER BY b.sort_order, b.created_at
      )
      FROM matos_blocks b
      WHERE b.version_id = v_version_id
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          i.id,
          'block_id',    i.block_id,
          'label',       i.label,
          'designation', i.designation,
          'quantite',    CASE WHEN v_show_qte    THEN i.quantite  ELSE NULL END,
          'flag',        CASE WHEN v_show_flags  THEN i.flag      ELSE NULL END,
          'remarques',   CASE WHEN v_show_remark THEN i.remarques ELSE NULL END,
          'pre_check_at',  CASE WHEN v_show_check THEN i.pre_check_at  ELSE NULL END,
          'post_check_at', CASE WHEN v_show_check THEN i.post_check_at ELSE NULL END,
          'prod_check_at', CASE WHEN v_show_check THEN i.prod_check_at ELSE NULL END,
          'sort_order',  i.sort_order,
          -- Loueurs : numero_reference JAMAIS exposé.
          'loueurs', CASE
            WHEN v_show_loueurs THEN COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id',         f.id,
                  'nom',        f.nom,
                  'sort_order', mil.sort_order
                ) ORDER BY mil.sort_order, f.nom
              )
              FROM matos_item_loueurs mil
              LEFT JOIN fournisseurs f ON f.id = mil.loueur_id
              WHERE mil.item_id = i.id
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) ORDER BY i.sort_order, i.created_at
      )
      FROM matos_items i
      JOIN matos_blocks b ON b.id = i.block_id
      WHERE b.version_id = v_version_id
    ), '[]'::jsonb),
    -- Photos : pas implémenté en V1 (signed URLs storage à traiter en V2).
    'photos', '[]'::jsonb,
    'stats', jsonb_build_object(
      'total_items',  (
        SELECT COUNT(*)
          FROM matos_items i
          JOIN matos_blocks b ON b.id = i.block_id
         WHERE b.version_id = v_version_id
      ),
      'total_blocks', (
        SELECT COUNT(*) FROM matos_blocks WHERE version_id = v_version_id
      )
    ),
    'generated_at', now()
  ) INTO v_result;

  PERFORM _project_share_bump(p_token, 'materiel');

  RETURN v_result;
END;
$share_projet_materiel_fetch$;

REVOKE ALL ON FUNCTION share_projet_materiel_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_materiel_fetch(text, text)
  TO anon, authenticated;


CREATE OR REPLACE FUNCTION share_projet_fetch(
  p_token text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_projet_fetch$
DECLARE
  v_project_id        uuid;
  v_enabled           jsonb;
  v_label             text;
  v_password_protected boolean;
  v_active_version    uuid;
  v_result            jsonb;
BEGIN
  SELECT project_id, enabled_pages, label
    INTO v_project_id, v_enabled, v_label
    FROM _project_share_token_resolve(p_token, NULL, p_password);

  SELECT password_hash IS NOT NULL
    INTO v_password_protected
    FROM project_share_tokens
   WHERE token = p_token;

  -- Pour le teaser matériel : on prend la version active courante du projet
  -- (le hub n'est pas un snapshot — il s'aligne sur "ce qui existe maintenant").
  -- Si le token utilisera plus tard un snapshot pour la sous-page matériel,
  -- le teaser pourrait diverger. C'est OK : le teaser donne juste un ordre
  -- de grandeur (counts), pas une donnée stricte.
  -- Multi-listes : le teaser compte la version active de la liste principale.
  IF v_enabled ? 'materiel' THEN
    v_active_version := _matos_active_version(v_project_id, NULL);
  END IF;

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',              v_label,
      'enabled_pages',      v_enabled,
      'password_protected', COALESCE(v_password_protected, false)
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
      'materiel', CASE
        WHEN v_enabled ? 'materiel' AND v_active_version IS NOT NULL THEN (
          SELECT jsonb_build_object(
            'items',  (
              SELECT COUNT(*)
                FROM matos_items i
                JOIN matos_blocks b ON b.id = i.block_id
               WHERE b.version_id = v_active_version
            ),
            'blocks', (
              SELECT COUNT(*) FROM matos_blocks WHERE version_id = v_active_version
            )
          )
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
GRANT EXECUTE ON FUNCTION share_projet_fetch(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
