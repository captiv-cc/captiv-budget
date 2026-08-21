-- ════════════════════════════════════════════════════════════════════════════
-- CONTENUS V1 — partage : tokens + RPC publiques (lecture et écriture)
-- Date      : 2026-08-21
-- ════════════════════════════════════════════════════════════════════════════
--
-- Deux liens sur le même module (cadrage validé Hugo) :
--   - photographes : lecture seule, sans mot de passe, pour suivre l'état
--     de validation de leurs médias ;
--   - équipe du festival : écriture complète (créer, modifier, statuer,
--     commenter, supprimer) derrière un mot de passe partagé, chaque action
--     signée du prénom saisi côté portail.
--
-- Le flag can_edit porte la différence. Un token de lecture qui appellerait
-- une RPC d'écriture est rejeté (42501), même avec le bon mot de passe.
--
-- Aucun compte n'est créé : c'est la traçabilité (created_by_name /
-- updated_by_name / author_name) qui remplace les rôles. Le mot de passe
-- étant partagé entre plusieurs personnes, le lien est révocable et
-- expirable, et la suppression reste douce (deleted_at).
--
-- Patterns repris : musique_autor_share_tokens (tokens + écriture anonyme
-- whitelistée) et _project_share_token_resolve (gate mot de passe bcrypt).
--
-- Dépend de 20260821a et 20260821b. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Tokens ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contenus_share_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token            text NOT NULL UNIQUE,
  label            text,
  -- false = lien photographes (lecture) ; true = lien équipe (écriture).
  can_edit         boolean NOT NULL DEFAULT false,
  -- bcrypt, jamais le mot de passe en clair. NULL = lien ouvert.
  password_hash    text,
  password_hint    text,
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  expires_at       timestamptz,
  last_accessed_at timestamptz,
  view_count       integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS contenus_share_tokens_token_idx
  ON contenus_share_tokens(token);
CREATE INDEX IF NOT EXISTS contenus_share_tokens_project_idx
  ON contenus_share_tokens(project_id);

COMMENT ON TABLE contenus_share_tokens IS
  'Liens publics du module Contenus. can_edit=false : suivi photographes. can_edit=true : équipe festival, mot de passe requis.';

ALTER TABLE contenus_share_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contenus_share_tokens_org" ON contenus_share_tokens;
CREATE POLICY "contenus_share_tokens_org" ON contenus_share_tokens
  FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

-- Pose / retire le mot de passe (le front n'a jamais accès au hash).
CREATE OR REPLACE FUNCTION set_contenus_share_password(p_token_id uuid, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $set_contenus_share_password$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM contenus_share_tokens t
     WHERE t.id = p_token_id
       AND t.project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  ) THEN
    RAISE EXCEPTION 'token introuvable' USING ERRCODE = '42501';
  END IF;

  UPDATE contenus_share_tokens
     SET password_hash = CASE
           WHEN p_password IS NULL OR length(p_password) = 0 THEN NULL
           ELSE crypt(p_password, gen_salt('bf'))
         END
   WHERE id = p_token_id;
END;
$set_contenus_share_password$;

REVOKE ALL ON FUNCTION set_contenus_share_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_contenus_share_password(uuid, text) TO authenticated;

-- ── 2. Résolution du token (+ gate mot de passe, + exigence d'écriture) ─────
CREATE OR REPLACE FUNCTION _contenus_share_resolve(
  p_token       text,
  p_password    text DEFAULT NULL,
  p_need_edit   boolean DEFAULT false
)
RETURNS TABLE(project_id uuid, can_edit boolean, label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $_contenus_share_resolve$
DECLARE
  v_project_id    uuid;
  v_can_edit      boolean;
  v_label         text;
  v_password_hash text;
  v_password_hint text;
BEGIN
  SELECT t.project_id, t.can_edit, t.label, t.password_hash, t.password_hint
    INTO v_project_id, v_can_edit, v_label, v_password_hash, v_password_hint
    FROM contenus_share_tokens t
   WHERE t.token = p_token
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now());

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '28000';
  END IF;

  IF v_password_hash IS NOT NULL THEN
    IF p_password IS NULL OR length(p_password) = 0 THEN
      RAISE EXCEPTION 'password required'
        USING ERRCODE = '28P01', HINT = COALESCE(v_password_hint, '');
    END IF;
    IF crypt(p_password, v_password_hash) <> v_password_hash THEN
      RAISE EXCEPTION 'invalid password'
        USING ERRCODE = '28P01', HINT = COALESCE(v_password_hint, '');
    END IF;
  END IF;

  -- Un lien de suivi ne devient jamais un lien d'édition, mot de passe ou pas.
  IF p_need_edit AND NOT v_can_edit THEN
    RAISE EXCEPTION 'lien en lecture seule' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_project_id, v_can_edit, v_label;
END;
$_contenus_share_resolve$;

REVOKE ALL ON FUNCTION _contenus_share_resolve(text, text, boolean) FROM PUBLIC;

-- ── 3. Lecture ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION share_contenus_fetch(p_token text, p_password text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_contenus_fetch$
DECLARE
  v_project_id uuid;
  v_can_edit   boolean;
  v_label      text;
  v_result     jsonb;
BEGIN
  SELECT r.project_id, r.can_edit, r.label
    INTO v_project_id, v_can_edit, v_label
    FROM _contenus_share_resolve(p_token, p_password, false) r;

  SELECT jsonb_build_object(
    'share', jsonb_build_object('label', v_label, 'can_edit', v_can_edit),
    'project', (
      SELECT jsonb_build_object(
        'id', p.id, 'title', p.title, 'ref_projet', p.ref_projet, 'cover_url', p.cover_url
      )
      FROM projects p WHERE p.id = v_project_id
    ),
    'org', (
      SELECT jsonb_build_object(
        'id', o.id, 'display_name', o.display_name, 'legal_name', o.legal_name,
        'tagline', o.tagline, 'logo_url_clair', o.logo_url_clair,
        'logo_url_sombre', o.logo_url_sombre, 'logo_banner_url', o.logo_banner_url,
        'brand_color', o.brand_color, 'website_url', o.website_url
      )
      FROM projects p
      LEFT JOIN organisations o ON o.id = p.org_id
      WHERE p.id = v_project_id
    ),
    -- Même shape que listContenus côté desk : le front partage le tableau.
    'contenus', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id, 'project_id', c.project_id, 'type', c.type,
          'artiste_id', c.artiste_id, 'artiste_text', c.artiste_text,
          'espace', c.espace, 'date_contenu', c.date_contenu,
          'photographe', c.photographe, 'drive_url', c.drive_url,
          'suivi_par', c.suivi_par, 'statut', c.statut, 'decide_at', c.decide_at,
          'created_at', c.created_at, 'updated_at', c.updated_at,
          'created_by_name', c.created_by_name, 'updated_by_name', c.updated_by_name,
          'artiste', CASE WHEN a.id IS NULL THEN NULL ELSE
            jsonb_build_object('id', a.id, 'nom', a.nom, 'jour', a.jour) END
        ) ORDER BY c.date_contenu DESC NULLS LAST, c.created_at DESC
      )
      FROM projet_contenus c
      LEFT JOIN projet_artistes a ON a.id = c.artiste_id
      WHERE c.project_id = v_project_id AND c.deleted_at IS NULL
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', e.id, 'contenu_id', e.contenu_id, 'kind', e.kind,
          'body', e.body, 'author_name', e.author_name, 'created_at', e.created_at
        ) ORDER BY e.created_at
      )
      FROM projet_contenu_events e
      WHERE e.project_id = v_project_id
    ), '[]'::jsonb),
    'refs', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', r.id, 'kind', r.kind, 'valeur', r.valeur)
        ORDER BY r.sort_order, r.valeur
      )
      FROM projet_contenu_refs r
      WHERE r.project_id = v_project_id
    ), '[]'::jsonb),
    -- Jours du projet : le portail étiquette « Jour 2 · vendredi 21 août »
    -- comme le desk, sans avoir accès aux déroulés.
    'jours', COALESCE((
      SELECT jsonb_agg(DISTINCT d.date_jour ORDER BY d.date_jour)
      FROM projet_deroules d
      WHERE d.project_id = v_project_id AND d.date_jour IS NOT NULL
    ), '[]'::jsonb),
    'artistes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nom', a.nom) ORDER BY a.nom)
      FROM projet_artistes a
      WHERE a.project_id = v_project_id
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_result;

  UPDATE contenus_share_tokens
     SET view_count = view_count + 1, last_accessed_at = now()
   WHERE token = p_token;

  RETURN v_result;
END;
$share_contenus_fetch$;

REVOKE ALL ON FUNCTION share_contenus_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_contenus_fetch(text, text) TO anon, authenticated;

-- ── 4. Création ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION share_contenus_create(
  p_token       text,
  p_password    text,
  p_payload     jsonb,
  p_author_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_contenus_create$
DECLARE
  v_project_id uuid;
  v_id         uuid;
BEGIN
  SELECT r.project_id INTO v_project_id
    FROM _contenus_share_resolve(p_token, p_password, true) r;

  -- Whitelist stricte : le portail ne choisit ni le projet, ni les
  -- horodatages, ni l'auteur enregistré.
  INSERT INTO projet_contenus (
    project_id, type, artiste_id, artiste_text, espace, date_contenu,
    photographe, drive_url, suivi_par, statut, created_by_name, updated_by_name
  ) VALUES (
    v_project_id,
    COALESCE(NULLIF(p_payload->>'type', ''), 'photo'),
    NULLIF(p_payload->>'artiste_id', '')::uuid,
    NULLIF(p_payload->>'artiste_text', ''),
    NULLIF(p_payload->>'espace', ''),
    NULLIF(p_payload->>'date_contenu', '')::date,
    NULLIF(p_payload->>'photographe', ''),
    NULLIF(p_payload->>'drive_url', ''),
    NULLIF(p_payload->>'suivi_par', ''),
    COALESCE(NULLIF(p_payload->>'statut', ''), 'en_attente'),
    p_author_name,
    p_author_name
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$share_contenus_create$;

REVOKE ALL ON FUNCTION share_contenus_create(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_contenus_create(text, text, jsonb, text)
  TO anon, authenticated;

-- ── 5. Mise à jour ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION share_contenus_update(
  p_token       text,
  p_password    text,
  p_contenu_id  uuid,
  p_patch       jsonb,
  p_author_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_contenus_update$
DECLARE
  v_project_id uuid;
  v_old_statut text;
  v_new_statut text;
BEGIN
  SELECT r.project_id INTO v_project_id
    FROM _contenus_share_resolve(p_token, p_password, true) r;

  SELECT statut INTO v_old_statut
    FROM projet_contenus
   WHERE id = p_contenu_id AND project_id = v_project_id AND deleted_at IS NULL;

  IF v_old_statut IS NULL THEN
    RAISE EXCEPTION 'contenu introuvable' USING ERRCODE = '42501';
  END IF;

  -- COALESCE sur la clé présente : un champ absent du patch n'est jamais
  -- écrasé, un champ présent à null est bien vidé.
  UPDATE projet_contenus SET
    type         = CASE WHEN p_patch ? 'type'         THEN COALESCE(NULLIF(p_patch->>'type', ''), type) ELSE type END,
    artiste_id   = CASE WHEN p_patch ? 'artiste_id'   THEN NULLIF(p_patch->>'artiste_id', '')::uuid ELSE artiste_id END,
    artiste_text = CASE WHEN p_patch ? 'artiste_text' THEN NULLIF(p_patch->>'artiste_text', '') ELSE artiste_text END,
    espace       = CASE WHEN p_patch ? 'espace'       THEN NULLIF(p_patch->>'espace', '') ELSE espace END,
    date_contenu = CASE WHEN p_patch ? 'date_contenu' THEN NULLIF(p_patch->>'date_contenu', '')::date ELSE date_contenu END,
    photographe  = CASE WHEN p_patch ? 'photographe'  THEN NULLIF(p_patch->>'photographe', '') ELSE photographe END,
    drive_url    = CASE WHEN p_patch ? 'drive_url'    THEN NULLIF(p_patch->>'drive_url', '') ELSE drive_url END,
    suivi_par    = CASE WHEN p_patch ? 'suivi_par'    THEN NULLIF(p_patch->>'suivi_par', '') ELSE suivi_par END,
    statut       = CASE WHEN p_patch ? 'statut'       THEN COALESCE(NULLIF(p_patch->>'statut', ''), statut) ELSE statut END,
    updated_by_name = COALESCE(p_author_name, updated_by_name)
  WHERE id = p_contenu_id AND project_id = v_project_id;

  SELECT statut INTO v_new_statut FROM projet_contenus WHERE id = p_contenu_id;

  IF v_new_statut IS DISTINCT FROM v_old_statut THEN
    INSERT INTO projet_contenu_events (project_id, contenu_id, kind, body, author_name)
    VALUES (v_project_id, p_contenu_id, 'statut', v_new_statut, p_author_name);
  END IF;
END;
$share_contenus_update$;

REVOKE ALL ON FUNCTION share_contenus_update(text, text, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_contenus_update(text, text, uuid, jsonb, text)
  TO anon, authenticated;

-- ── 6. Suppression (douce) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION share_contenus_delete(
  p_token      text,
  p_password   text,
  p_contenu_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_contenus_delete$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT r.project_id INTO v_project_id
    FROM _contenus_share_resolve(p_token, p_password, true) r;

  UPDATE projet_contenus
     SET deleted_at = now()
   WHERE id = p_contenu_id AND project_id = v_project_id;
END;
$share_contenus_delete$;

REVOKE ALL ON FUNCTION share_contenus_delete(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_contenus_delete(text, text, uuid) TO anon, authenticated;

-- ── 7. Commentaire ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION share_contenus_comment(
  p_token       text,
  p_password    text,
  p_contenu_id  uuid,
  p_body        text,
  p_author_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_contenus_comment$
DECLARE
  v_project_id uuid;
  v_id         uuid;
BEGIN
  SELECT r.project_id INTO v_project_id
    FROM _contenus_share_resolve(p_token, p_password, true) r;

  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM projet_contenus
     WHERE id = p_contenu_id AND project_id = v_project_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'contenu introuvable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO projet_contenu_events (project_id, contenu_id, kind, body, author_name)
  VALUES (v_project_id, p_contenu_id, 'comment', trim(p_body), p_author_name)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$share_contenus_comment$;

REVOKE ALL ON FUNCTION share_contenus_comment(text, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_contenus_comment(text, text, uuid, text, text)
  TO anon, authenticated;

-- ── 8. Ajout d'une valeur de liste depuis le portail ────────────────────────
CREATE OR REPLACE FUNCTION share_contenus_add_ref(
  p_token    text,
  p_password text,
  p_kind     text,
  p_valeur   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $share_contenus_add_ref$
DECLARE
  v_project_id uuid;
  v_id         uuid;
BEGIN
  SELECT r.project_id INTO v_project_id
    FROM _contenus_share_resolve(p_token, p_password, true) r;

  IF p_kind NOT IN ('espace', 'photographe', 'suivi') THEN
    RAISE EXCEPTION 'liste inconnue' USING ERRCODE = '22023';
  END IF;
  IF p_valeur IS NULL OR length(trim(p_valeur)) = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO projet_contenu_refs (project_id, kind, valeur)
  VALUES (v_project_id, p_kind, trim(p_valeur))
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$share_contenus_add_ref$;

REVOKE ALL ON FUNCTION share_contenus_add_ref(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_contenus_add_ref(text, text, text, text)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS
-- ============================================================================
-- 1. Lien lecture : la page s'affiche, aucune écriture n'est possible.
-- 2. Lien écriture sans mot de passe → 28P01 ; avec le bon → tout passe.
-- 3. Appeler share_contenus_update avec le token de lecture → 42501, même
--    en fournissant le mot de passe de l'autre lien.
-- 4. Révoquer un lien coupe l'accès immédiatement (28000).
-- ============================================================================
