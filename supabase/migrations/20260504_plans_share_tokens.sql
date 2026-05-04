-- ============================================================================
-- Migration : PLANS-SHARE-5a/5 — Tokens de partage public plans (read-only)
-- Date      : 2026-05-04
-- Contexte  : 5/5 du chantier Plans. Permet de partager une vue READ-ONLY
--             des plans techniques d'un projet à un destinataire externe
--             (technicien chantier, prestataire, régisseur) via une URL
--             publique unique, sans auth.
--
--             Pattern aligné sur :
--               - matos_share_tokens   (MATOS-SHARE)
--               - equipe_share_tokens  (EQUIPE-P4.2A)
--               - livrable_share_tokens (LIV-24A)
--
-- Spécificités plans :
--
--   1. Scope du partage (vs matos qui partage TOUT le projet) :
--        - 'all'       : tous les plans non archivés du projet, version
--                        courante uniquement (par défaut). Suit l'évolution
--                        du projet (un plan ajouté ensuite apparaît dans
--                        la vue partagée).
--        - 'selection' : sélection manuelle (tableau d'UUIDs). Permet de
--                        partager 2-3 plans précis sans tout exposer.
--
--   2. Versions historiques (toggle show_versions) :
--        - false (défaut) : seul le fichier courant de chaque plan est
--                           accessible. Le destinataire ne voit pas
--                           qu'il y a eu des V1, V2 antérieures.
--        - true            : la liste des versions (V1, V2…) est exposée
--                           dans le payload. Le viewer côté front peut
--                           proposer un dropdown pour switcher.
--
--   3. Storage privé : le bucket `plans` est privé. La RPC retourne les
--      storage_paths (pas les signed URLs — pattern aligné sur MAT-10).
--      Le client anonyme appelle ensuite supabase.storage.createSignedUrl()
--      pour chaque fichier à consulter. Cela nécessite une policy
--      storage.objects autorisant anon à SELECT dans le bucket plans
--      tant qu'au moins un token de share actif existe sur le projet
--      (cf. section 6).
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
--              CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260504_plans_v1.sql (table plans / plan_versions /
--              plan_categories + bucket Storage `plans` + RLS auth).
-- ============================================================================

BEGIN;

-- =====================================================================
-- 1. Table plans_share_tokens
-- =====================================================================
CREATE TABLE IF NOT EXISTS plans_share_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Token secret opaque (~32 chars base64url). Généré côté client via
  -- crypto.getRandomValues. Cf. matos_share_tokens / equipe_share_tokens.
  token            text NOT NULL UNIQUE,

  label            text,

  -- Scope du partage. 'all' = tous les plans non archivés ; 'selection' =
  -- selected_plan_ids fait foi.
  scope            text NOT NULL DEFAULT 'all'
                       CHECK (scope IN ('all', 'selection')),

  -- Liste explicite des plans à partager (mode 'selection'). Ignoré si
  -- scope='all'. Pas de FK array (limitation Postgres) — la RPC valide
  -- l'appartenance au projet à la lecture.
  selected_plan_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

  -- Si true, la RPC expose aussi les versions historiques (V1, V2…) de
  -- chaque plan. Si false, seule la version courante est lisible.
  show_versions    boolean NOT NULL DEFAULT false,

  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Soft revoke pour conserver l'historique de vues.
  revoked_at       timestamptz,

  -- Expiration optionnelle. NULL = lien permanent.
  expires_at       timestamptz,

  -- Bumpé par la RPC fetch (best effort).
  last_accessed_at timestamptz,
  view_count       integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS plans_share_tokens_token_idx
  ON plans_share_tokens(token);
CREATE INDEX IF NOT EXISTS plans_share_tokens_project_idx
  ON plans_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS plans_share_tokens_active_idx
  ON plans_share_tokens(project_id, created_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE plans_share_tokens IS
  'Tokens de partage public plans (PLANS-SHARE). Un token par destinataire / scénario. Accès anonyme via RPC share_plans_fetch SECURITY DEFINER. scope all = tous les plans non archivés ; selection = liste explicite.';
COMMENT ON COLUMN plans_share_tokens.scope IS
  'all = tous les plans non archivés du projet (suit l''évolution) ; selection = uniquement les plans dans selected_plan_ids.';
COMMENT ON COLUMN plans_share_tokens.show_versions IS
  'Si true, la RPC expose aussi les versions historiques (V1, V2…) ; si false, seule la version courante est lisible.';
COMMENT ON COLUMN plans_share_tokens.token IS
  'Secret opaque (~32 chars base64url). Généré côté client via crypto.getRandomValues — jamais en clair côté serveur avant insertion.';


-- =====================================================================
-- 2. RLS — auth seulement (l'accès anon passe par la RPC SECURITY DEFINER)
-- =====================================================================
ALTER TABLE plans_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_share_tokens_org" ON plans_share_tokens;

-- Lecture / écriture scopées au projet via org_id (cohérent avec
-- matos_share_tokens / equipe_share_tokens). Le gating fin (admin /
-- charge_prod / coordinateur) se fait côté front via useProjectPermissions.
CREATE POLICY "plans_share_tokens_org" ON plans_share_tokens
  FOR ALL
  USING (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  );


-- =====================================================================
-- 3. Helper interne — résolution du token
-- =====================================================================
-- Retourne la ligne du token si valide (non révoqué, non expiré). Sinon
-- raise 28000. Pas de logique de "version active" comme matos puisque
-- chaque plan a son propre versioning indépendant.
CREATE OR REPLACE FUNCTION _plans_share_resolve(p_token text)
RETURNS TABLE(
  project_id        uuid,
  scope             text,
  selected_plan_ids uuid[],
  show_versions     boolean,
  label             text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_plans_share_resolve$
DECLARE
  v_token_row record;
BEGIN
  SELECT t.project_id, t.scope, t.selected_plan_ids, t.show_versions, t.label
    INTO v_token_row
    FROM plans_share_tokens t
   WHERE t.token = p_token
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired token'
      USING ERRCODE = '28000';
  END IF;

  RETURN QUERY SELECT
    v_token_row.project_id,
    v_token_row.scope,
    v_token_row.selected_plan_ids,
    v_token_row.show_versions,
    v_token_row.label;
END;
$_plans_share_resolve$;

REVOKE ALL ON FUNCTION _plans_share_resolve(text) FROM PUBLIC;


-- =====================================================================
-- 4. RPC publique — fetch payload plans
-- =====================================================================
-- Retourne le payload structuré pour la page /share/plans/:token :
--   {
--     share:       { label, scope, show_versions },
--     project:     { id, title, ref_projet, cover_url },
--     org:         { branding },
--     categories:  [{ id, key, label, color, sort_order }] — toutes les
--                  cats actives de l'org (pour filtres côté front).
--     plans:       [{ id, category_id, name, description, tags,
--                     storage_path, thumbnail_path, file_type, file_size,
--                     page_count, applicable_dates, current_version,
--                     sort_order, created_at,
--                     versions: [{ id, version_num, storage_path,
--                                  file_type, file_size, page_count,
--                                  comment, created_at }]   ← si
--                                  show_versions=true, sinon [] }]
--                  Filtré par scope (all = is_archived=false ; selection
--                  = id IN selected_plan_ids ET is_archived=false).
--     generated_at: timestamp
--   }
--
-- Storage : la RPC ne génère PAS de signed URLs (pas dispo en RPC dans le
-- pattern Captiv — cf. MAT-10A note ligne 602). Le client anonyme appelle
-- supabase.storage.from('plans').createSignedUrl(path, 600) pour chaque
-- fichier. La policy storage de la section 6 autorise cet appel pour anon.
--
-- Bump view_count + last_accessed_at en best-effort.
CREATE OR REPLACE FUNCTION share_plans_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_plans_fetch$
DECLARE
  v_project_id     uuid;
  v_scope          text;
  v_selected       uuid[];
  v_show_versions  boolean;
  v_label          text;
  v_result         jsonb;
BEGIN
  SELECT project_id, scope, selected_plan_ids, show_versions, label
    INTO v_project_id, v_scope, v_selected, v_show_versions, v_label
    FROM _plans_share_resolve(p_token);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',         v_label,
      'scope',         v_scope,
      'show_versions', v_show_versions
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
    'categories', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         c.id,
          'key',        c.key,
          'label',      c.label,
          'color',      c.color,
          'sort_order', c.sort_order
        ) ORDER BY c.sort_order, c.label
      )
      FROM plan_categories c
      JOIN projects p ON p.org_id = c.org_id
      WHERE p.id = v_project_id
        AND c.is_archived = false
    ), '[]'::jsonb),
    'plans', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                pl.id,
          'category_id',       pl.category_id,
          'name',              pl.name,
          'description',       pl.description,
          'tags',              pl.tags,
          'storage_path',      pl.storage_path,
          'thumbnail_path',    pl.thumbnail_path,
          'file_type',         pl.file_type,
          'file_size',         pl.file_size,
          'page_count',        pl.page_count,
          'applicable_dates',  pl.applicable_dates,
          'current_version',   pl.current_version,
          'sort_order',        pl.sort_order,
          'created_at',        pl.created_at,
          'versions', CASE
            WHEN v_show_versions THEN COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id',           pv.id,
                  'version_num',  pv.version_num,
                  'storage_path', pv.storage_path,
                  'file_type',    pv.file_type,
                  'file_size',    pv.file_size,
                  'page_count',   pv.page_count,
                  'comment',      pv.comment,
                  'created_at',   pv.created_at
                ) ORDER BY pv.version_num DESC
              )
              FROM plan_versions pv
              WHERE pv.plan_id = pl.id
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) ORDER BY pl.sort_order, pl.created_at
      )
      FROM plans pl
      WHERE pl.project_id = v_project_id
        AND pl.is_archived = false
        AND (
          v_scope = 'all'
          OR (v_scope = 'selection' AND pl.id = ANY(v_selected))
        )
    ), '[]'::jsonb),
    'stats', jsonb_build_object(
      'total_plans', (
        SELECT COUNT(*)
          FROM plans pl
         WHERE pl.project_id = v_project_id
           AND pl.is_archived = false
           AND (
             v_scope = 'all'
             OR (v_scope = 'selection' AND pl.id = ANY(v_selected))
           )
      )
    ),
    'generated_at', now()
  ) INTO v_result;

  -- Bump compteur (best effort, on n'échoue jamais ici).
  BEGIN
    UPDATE plans_share_tokens
       SET last_accessed_at = now(),
           view_count       = view_count + 1
     WHERE token = p_token;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_result;
END;
$share_plans_fetch$;

REVOKE ALL ON FUNCTION share_plans_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_plans_fetch(text) TO anon, authenticated;


-- =====================================================================
-- 5. RPC admin — révocation soft
-- =====================================================================
CREATE OR REPLACE FUNCTION revoke_plans_share_token(p_token_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $revoke_plans_share_token$
BEGIN
  UPDATE plans_share_tokens
     SET revoked_at = now()
   WHERE id = p_token_id
     AND project_id IN (
       SELECT id FROM projects WHERE org_id = get_user_org_id()
     );
END;
$revoke_plans_share_token$;

REVOKE ALL ON FUNCTION revoke_plans_share_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_plans_share_token(uuid) TO authenticated;


-- =====================================================================
-- 6. Policy Storage — anon SELECT sur bucket plans si token actif
-- =====================================================================
-- Permet au client anonyme d'appeler supabase.storage.createSignedUrl()
-- pour générer une signed URL temporaire sur les fichiers du bucket plans.
--
-- Sécurité : la policy n'autorise SELECT que si AU MOINS UN token de share
-- actif existe sur le project_id correspondant au path. Les paths sont
-- des UUIDs imbriqués (<project_id>/<plan_id>/<filename>) → impossibles à
-- deviner sans avoir reçu le payload de la RPC. Le client anonyme reçoit
-- uniquement les paths du scope du token via share_plans_fetch.
--
-- Note : on s'appuie sur la convention de path déjà établie par
-- 20260504_plans_v1.sql : (storage.foldername(name))[1] = project_id.

DROP POLICY IF EXISTS "plans_storage_anon_share" ON storage.objects;

CREATE POLICY "plans_storage_anon_share" ON storage.objects
  FOR SELECT
  TO anon
  USING (
    bucket_id = 'plans'
    AND EXISTS (
      SELECT 1
      FROM plans_share_tokens t
      WHERE t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND t.project_id = ((storage.foldername(name))[1])::uuid
    )
  );


NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Tests rapides à passer côté Hugo
-- ============================================================================
-- 1. Créer un token "all" sur un projet :
--    INSERT INTO plans_share_tokens (project_id, token, label, scope)
--    VALUES (
--      '<project_uuid>',
--      'test-plans-token',
--      'Test équipe technique',
--      'all'
--    );
--
--    SELECT share_plans_fetch('test-plans-token');
--    → doit retourner project + org + categories + plans (tous non archivés).
--    → versions = [] partout (show_versions=false par défaut).
--
-- 2. Créer un token "selection" :
--    INSERT INTO plans_share_tokens (
--      project_id, token, scope, selected_plan_ids, show_versions
--    ) VALUES (
--      '<project_uuid>',
--      'test-plans-selection',
--      'selection',
--      ARRAY['<plan_uuid_1>', '<plan_uuid_2>']::uuid[],
--      true
--    );
--
--    SELECT share_plans_fetch('test-plans-selection');
--    → ne retourne QUE les 2 plans de la sélection.
--    → versions: [...] populé pour chacun.
--
-- 3. Token expiré :
--    UPDATE plans_share_tokens SET expires_at = now() - interval '1 hour'
--      WHERE id = '...';
--    SELECT share_plans_fetch(token); → 28000 invalid or expired token.
--
-- 4. Vérifier la policy storage :
--    En tant qu'anon, supabase.storage.from('plans').createSignedUrl(path,600)
--    sur un path d'un projet AYANT un token actif → OK.
--    Sur un path d'un projet SANS token actif → 401/403.
-- ============================================================================
