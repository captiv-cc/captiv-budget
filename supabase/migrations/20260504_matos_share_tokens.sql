-- ============================================================================
-- Migration : MATOS-SHARE-1/5 — Tokens de partage public matériel (read-only)
-- Date      : 2026-05-04
-- Contexte  : Demande Hugo. Permet de partager une vue READ-ONLY de la liste
--             matériel d'un projet à un destinataire externe (client, DOP,
--             régisseur) via une URL publique unique (token), sans auth.
--
--             Pattern aligné sur :
--               - equipe_share_tokens (EQUIPE-P4.2A)
--               - livrable_share_tokens (LIV-24A)
--               - matos_check_tokens (MAT-10) — terrain mode différent,
--                 ne pas confondre. matos_check_tokens permet d'AGIR
--                 (cocher des cases) ; matos_share_tokens est READ-ONLY.
--
-- Spécificités matériel (vs équipe / livrables) :
--
--   1. Versions multiples par projet (matos_versions). Le token peut être :
--        - mode 'active' (token.version_id IS NULL) → suit toujours la
--          version active courante du projet. Utile pour un client qui veut
--          voir le matos "à jour".
--        - mode 'snapshot' (token.version_id renseigné) → fige une version
--          spécifique. Utile pour verrouiller le matos d'un devis signé.
--
--   2. Toggles de visibilité (config jsonb). Tous default = false sauf
--      loueurs et qté (cf. décision Hugo) :
--        show_loueurs    (true)  — colonne Loueur(s)
--        show_quantites  (true)  — colonne Qté
--        show_remarques  (false) — remarques internes (parfois interne)
--        show_flags      (false) — flag ok/attention/probleme
--        show_checklist  (false) — états pré/post/prod (mode tournage)
--        show_photos     (false) — photos d'item (V2 — pas implémenté ici)
--
--   3. numero_reference des matos_item_loueurs : JAMAIS exposé (numéros
--      de série / numéros de contrat sensibles).
--
--   4. Le label des matos_items (mode config caméra "Boîtier : Sony FX6")
--      est inclus tel quel dans le payload pour que le front puisse rendre
--      "label : designation" si présent.
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
--              CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260421_mat_refonte_blocs.sql (matos_versions / blocks /
--              items / item_loueurs).
-- ============================================================================

BEGIN;

-- =====================================================================
-- 1. Table matos_share_tokens
-- =====================================================================
CREATE TABLE IF NOT EXISTS matos_share_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  project_id       uuid NOT NULL REFERENCES projects(id)       ON DELETE CASCADE,

  -- Mode 'snapshot' : version figée au moment de la création du token.
  -- Mode 'active'   : NULL → on suit la version active courante du projet
  --                   au moment de chaque fetch. Le payload renvoyé par la
  --                   RPC inclut la version effective dans tous les cas.
  version_id       uuid REFERENCES matos_versions(id) ON DELETE CASCADE,

  -- Token secret opaque (~32 chars base64url). Généré côté client via
  -- crypto.getRandomValues. Cf. equipe_share_tokens / livrable_share_tokens.
  token            text NOT NULL UNIQUE,

  label            text,

  -- Config d'affichage. Shape libre (jsonb) pour rester souple — les clés
  -- attendues sont normalisées côté lib/matosShare.js avant insertion.
  -- Voir DEFAULT_SHARE_CONFIG dans la lib pour les valeurs par défaut.
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,

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

CREATE UNIQUE INDEX IF NOT EXISTS matos_share_tokens_token_idx
  ON matos_share_tokens(token);
CREATE INDEX IF NOT EXISTS matos_share_tokens_project_idx
  ON matos_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS matos_share_tokens_active_idx
  ON matos_share_tokens(project_id, created_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE matos_share_tokens IS
  'Tokens de partage public matériel (MATOS-SHARE). Un par destinataire / scénario. Accès anonyme via RPC share_matos_fetch SECURITY DEFINER. version_id NULL = mode "active" (suit la version active courante du projet) ; renseigné = snapshot figé.';
COMMENT ON COLUMN matos_share_tokens.version_id IS
  'NULL = mode active (suit la version active courante). Renseigné = snapshot figé sur cette version précise.';
COMMENT ON COLUMN matos_share_tokens.config IS
  'Toggles d''affichage : show_loueurs, show_quantites, show_remarques, show_flags, show_checklist, show_photos. Voir DEFAULT_SHARE_CONFIG dans lib/matosShare.js.';
COMMENT ON COLUMN matos_share_tokens.token IS
  'Secret opaque (~32 chars base64url). Généré côté client via crypto.getRandomValues — jamais en clair côté serveur avant insertion.';


-- =====================================================================
-- 2. RLS — auth seulement (l'accès anon passe par la RPC SECURITY DEFINER)
-- =====================================================================
ALTER TABLE matos_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matos_share_tokens_org" ON matos_share_tokens;

-- Lecture / écriture scopées au projet via org_id (cohérent avec
-- equipe_share_tokens). Le gating fin (admin / charge_prod / coordinateur
-- attaché) se fait côté front via useProjectPermissions.
CREATE POLICY "matos_share_tokens_org" ON matos_share_tokens
  FOR ALL
  USING (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  );


-- =====================================================================
-- 3. Helper interne — résolution du token + version effective
-- =====================================================================
-- Retourne (project_id, version_id_resolved, config, label) si le token
-- est valide (non révoqué, non expiré). Sinon raise 28000.
--
-- Résolution version : si token.version_id IS NULL (mode 'active'), on
-- résout vers matos_versions.is_active=true du projet. Si aucune version
-- active (cas dégénéré), on retombe sur la dernière version créée.
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
  SELECT t.project_id, t.version_id, t.config, t.label
    INTO v_token_row
    FROM matos_share_tokens t
   WHERE t.token = p_token
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired token'
      USING ERRCODE = '28000';
  END IF;

  -- Mode snapshot : version figée
  IF v_token_row.version_id IS NOT NULL THEN
    v_resolved := v_token_row.version_id;
  ELSE
    -- Mode active : résout vers la version active courante (fallback
    -- sur la dernière créée si aucune n'est marquée active).
    SELECT id INTO v_resolved
      FROM matos_versions
     WHERE matos_versions.project_id = v_token_row.project_id
       AND is_active = true
     LIMIT 1;

    IF v_resolved IS NULL THEN
      SELECT id INTO v_resolved
        FROM matos_versions
       WHERE matos_versions.project_id = v_token_row.project_id
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_token_row.project_id,
    v_resolved,
    v_token_row.config,
    v_token_row.label;
END;
$_matos_share_resolve$;

REVOKE ALL ON FUNCTION _matos_share_resolve(text) FROM PUBLIC;


-- =====================================================================
-- 4. RPC publique — fetch payload matériel
-- =====================================================================
-- Retourne le payload structuré pour la page /share/materiel/:token :
--   {
--     share:     { label, config },
--     project:   { id, title, ref_projet, cover_url },
--     org:       { branding },
--     version:   { id, numero, label, is_active, mode: 'active' | 'snapshot' },
--     versions:  [{ id, numero, label, is_active }] — toutes les versions
--                 du projet (contexte, le visiteur voit qu'il existe d'autres
--                 versions ; pas de lien cliquable).
--     blocks:    [{ id, titre, couleur, affichage, sort_order }],
--     items:     [{ id, block_id, label, designation, quantite, flag,
--                   remarques, pre_check_at, post_check_at, prod_check_at,
--                   loueurs: [{ id, nom, sort_order }] }]
--                 (les champs sensibles sont remplacés par NULL si le
--                 toggle correspondant est OFF — cf. config.show_*).
--     stats:     { total_items, total_blocks },
--     generated_at: timestamp
--   }
--
-- numero_reference des loueurs N'EST JAMAIS exposé (sensible).
-- Photos : pas implémenté en V1 — payload.photos = []. À traiter en V2
-- (signed URLs storage).
--
-- Bump view_count + last_accessed_at en best-effort.
CREATE OR REPLACE FUNCTION share_matos_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_matos_fetch$
DECLARE
  v_project_id     uuid;
  v_version_id    uuid;
  v_config        jsonb;
  v_label         text;
  v_show_loueurs  boolean;
  v_show_qte      boolean;
  v_show_remark   boolean;
  v_show_flags    boolean;
  v_show_check    boolean;
  v_result        jsonb;
BEGIN
  SELECT project_id, version_id_resolved, config, label
    INTO v_project_id, v_version_id, v_config, v_label
    FROM _matos_share_resolve(p_token);

  -- Lecture des toggles avec fallback (default true pour qte+loueurs,
  -- false pour le reste — cohérent avec DEFAULT_SHARE_CONFIG côté lib).
  v_show_loueurs := COALESCE((v_config->>'show_loueurs')::boolean,    true);
  v_show_qte     := COALESCE((v_config->>'show_quantites')::boolean,  true);
  v_show_remark  := COALESCE((v_config->>'show_remarques')::boolean,  false);
  v_show_flags   := COALESCE((v_config->>'show_flags')::boolean,      false);
  v_show_check   := COALESCE((v_config->>'show_checklist')::boolean,  false);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',  v_label,
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
        -- mode déduit côté serveur pour info debug + UI
        'mode',      CASE
          WHEN (SELECT t.version_id IS NULL FROM matos_share_tokens t WHERE t.token = p_token)
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
      WHERE v.project_id = v_project_id
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
          -- Loueurs : on n'inclut JAMAIS numero_reference (sensible).
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
    -- On déclare la clé pour stabiliser le contrat front.
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

  -- Bump compteur (best effort, on n'échoue jamais ici).
  BEGIN
    UPDATE matos_share_tokens
       SET last_accessed_at = now(),
           view_count       = view_count + 1
     WHERE token = p_token;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_result;
END;
$share_matos_fetch$;

REVOKE ALL ON FUNCTION share_matos_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_matos_fetch(text) TO anon, authenticated;


-- =====================================================================
-- 5. RPC admin — révocation soft
-- =====================================================================
-- Pas strictement nécessaire (l'UPDATE direct via RLS marche), mais utile
-- pour homogénéiser avec equipe_share_tokens / livrable_share_tokens.
CREATE OR REPLACE FUNCTION revoke_matos_share_token(p_token_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $revoke_matos_share_token$
BEGIN
  UPDATE matos_share_tokens
     SET revoked_at = now()
   WHERE id = p_token_id
     AND project_id IN (
       SELECT id FROM projects WHERE org_id = get_user_org_id()
     );
END;
$revoke_matos_share_token$;

REVOKE ALL ON FUNCTION revoke_matos_share_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_matos_share_token(uuid) TO authenticated;


NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Tests rapides à passer côté Hugo
-- ============================================================================
-- 1. Créer un token "active" sur un projet :
--    INSERT INTO matos_share_tokens (project_id, token, label, config)
--    VALUES (
--      '<project_uuid>',
--      'test-matos-token',
--      'Test client',
--      '{"show_loueurs": true, "show_quantites": true,
--        "show_remarques": false, "show_flags": false,
--        "show_checklist": false, "show_photos": false}'::jsonb
--    );
--
--    SELECT share_matos_fetch('test-matos-token');
--    → doit retourner project + org + version (active) + blocks + items.
--    → Toggle ON : loueurs présents avec nom, qte renseignée.
--    → Toggle OFF : remarques/flag/checklist NULL.
--
-- 2. Créer un token "snapshot" figé sur V1 :
--    INSERT ... version_id = '<v1_uuid>' ...
--    Activer V2 ailleurs ; le token continue de retourner V1.
--
-- 3. Token expiré :
--    UPDATE matos_share_tokens SET expires_at = now() - interval '1 hour'
--      WHERE id = '...';
--    SELECT share_matos_fetch(token);  → 28000 invalid or expired token
-- ============================================================================
