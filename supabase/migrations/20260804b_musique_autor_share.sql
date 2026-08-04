-- ════════════════════════════════════════════════════════════════════════════
-- MUS-7 A3 — Portail RP : tokens + RPCs publiques (lecture + écriture limitée)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Les chargés de comm / RP du festival opèrent le suivi des autorisations
-- SANS compte, via un lien token (décision Hugo 04/08). Pattern
-- logistique_share_tokens pour les tokens ; pattern
-- share_deroule_set_creneau_statut pour l'écriture anonyme contrôlée.
--
-- Périmètre :
--   1. Table musique_autor_share_tokens + RLS org
--   2. _musique_autor_share_resolve(token)
--   3. share_musique_autor_fetch(token)   — payload complet (links enrichis
--      + autorisations + events). AUCUNE donnée sensible : ni notes ★ ni
--      tags ni commentaires internes des propositions.
--   4. share_musique_autor_update(token, link_id, patch, author_name)
--      — écriture whitelistée (statut, durée, contact, doc signé, master,
--        utilisé) + timestamps + journal
--   5. share_musique_autor_comment(token, link_id, body, author_name)
--
-- Dépend de : 20260804a_musique_autorisations.sql. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tokens ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS musique_autor_share_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token            text NOT NULL UNIQUE,
  label            text,
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  expires_at       timestamptz,
  last_accessed_at timestamptz,
  view_count       integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS musique_autor_share_tokens_token_idx
  ON musique_autor_share_tokens(token);
CREATE INDEX IF NOT EXISTS musique_autor_share_tokens_project_idx
  ON musique_autor_share_tokens(project_id);

COMMENT ON TABLE musique_autor_share_tokens IS
  'Tokens du portail RP autorisations musiques (MUS-7 A3). Lecture + écriture limitée sans compte.';

ALTER TABLE musique_autor_share_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "musique_autor_share_tokens_org" ON musique_autor_share_tokens;
CREATE POLICY "musique_autor_share_tokens_org" ON musique_autor_share_tokens
  FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

-- ── 2. Résolution du token ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _musique_autor_share_resolve(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_musique_autor_share_resolve$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT t.project_id INTO v_project_id
    FROM musique_autor_share_tokens t
   WHERE t.token = p_token
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now());
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '28000';
  END IF;
  RETURN v_project_id;
END;
$_musique_autor_share_resolve$;

REVOKE ALL ON FUNCTION _musique_autor_share_resolve(text) FROM PUBLIC;

-- ── 3. Fetch payload ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION share_musique_autor_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_musique_autor_fetch$
DECLARE
  v_project_id uuid;
  v_result     jsonb;
BEGIN
  v_project_id := _musique_autor_share_resolve(p_token);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label', (SELECT label FROM musique_autor_share_tokens WHERE token = p_token)
    ),
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
    -- Un objet par couple track × média — même shape que listAutorisationRows
    -- côté desk (le front partage le composant tableau).
    'links', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           l.id,
          'livrable_id',  l.livrable_id,
          'statut_local', l.statut_local,
          'livrable', jsonb_build_object(
            'id', li.id, 'nom', li.nom, 'sort_order', li.sort_order,
            'block', jsonb_build_object('id', b.id, 'sort_order', b.sort_order)
          ),
          'proposition', jsonb_build_object(
            'id', pr.id, 'titre', pr.titre, 'artiste_text', pr.artiste_text,
            'preview_url', pr.preview_url, 'lien_youtube', pr.lien_youtube,
            'duration_ms', pr.duration_ms,
            'artiste', CASE WHEN ar.id IS NULL THEN NULL ELSE
              jsonb_build_object('id', ar.id, 'nom', ar.nom, 'jour', ar.jour)
            END
          ),
          'autorisation', CASE WHEN a.id IS NULL THEN NULL ELSE
            jsonb_build_object(
              'id', a.id, 'statut', a.statut, 'envoyee_at', a.envoyee_at,
              'decidee_at', a.decidee_at, 'duree_utilisation', a.duree_utilisation,
              'contact_label', a.contact_label, 'doc_signe', a.doc_signe,
              'master_url', a.master_url, 'utilise', a.utilise,
              'updated_at', a.updated_at, 'updated_by_name', a.updated_by_name
            )
          END
        )
      )
      FROM projet_musique_livrable_link l
      JOIN livrables li            ON li.id = l.livrable_id
      JOIN livrable_blocks b       ON b.id = li.block_id
      JOIN projet_musique_propositions pr ON pr.id = l.proposition_id
      LEFT JOIN projet_artistes ar ON ar.id = pr.artiste_id
      LEFT JOIN projet_musique_autorisations a ON a.link_id = l.id
      WHERE li.project_id = v_project_id
        AND li.deleted_at IS NULL
    ), '[]'::jsonb),
    -- Fil complet du projet (commentaires + journal). Auteur = full_name
    -- interne OU author_name saisi côté portail.
    'events', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', e.id, 'autorisation_id', e.autorisation_id, 'kind', e.kind,
          'body', e.body, 'created_at', e.created_at,
          'author_name', COALESCE(pf.full_name, e.author_name)
        ) ORDER BY e.created_at
      )
      FROM projet_musique_autorisation_events e
      LEFT JOIN profiles pf ON pf.id = e.author_id
      WHERE e.project_id = v_project_id
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_result;

  UPDATE musique_autor_share_tokens
     SET last_accessed_at = now(), view_count = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_musique_autor_fetch$;

REVOKE ALL ON FUNCTION share_musique_autor_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_musique_autor_fetch(text) TO anon, authenticated;

-- ── 4. Écriture whitelistée ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION share_musique_autor_update(
  p_token text,
  p_link_id uuid,
  p_patch jsonb,
  p_author_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_musique_autor_update$
DECLARE
  v_project_id uuid;
  v_autor      projet_musique_autorisations%ROWTYPE;
  v_statut     text;
  v_result     jsonb;
BEGIN
  v_project_id := _musique_autor_share_resolve(p_token);

  -- Le link doit appartenir au projet du token.
  PERFORM 1
    FROM projet_musique_livrable_link l
    JOIN livrables li ON li.id = l.livrable_id
   WHERE l.id = p_link_id AND li.project_id = v_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link not in project' USING ERRCODE = '28000';
  END IF;

  -- Get-or-create la row.
  INSERT INTO projet_musique_autorisations (project_id, link_id)
  VALUES (v_project_id, p_link_id)
  ON CONFLICT (link_id) DO NOTHING;
  SELECT * INTO v_autor FROM projet_musique_autorisations WHERE link_id = p_link_id;

  -- Whitelist stricte des champs éditables par les RP.
  IF p_patch ? 'statut' THEN
    v_statut := p_patch->>'statut';
    IF v_statut NOT IN ('a_lancer', 'envoyee', 'accordee', 'refusee') THEN
      RAISE EXCEPTION 'invalid statut';
    END IF;
    IF v_statut <> v_autor.statut THEN
      UPDATE projet_musique_autorisations SET
        statut     = v_statut,
        envoyee_at = CASE
          WHEN v_statut = 'envoyee' THEN COALESCE(envoyee_at, now())
          WHEN v_statut = 'a_lancer' THEN NULL
          ELSE envoyee_at END,
        decidee_at = CASE
          WHEN v_statut IN ('accordee', 'refusee') THEN now()
          WHEN v_statut = 'a_lancer' THEN NULL
          ELSE decidee_at END
      WHERE id = v_autor.id;
      INSERT INTO projet_musique_autorisation_events
        (project_id, autorisation_id, kind, body, author_name)
      VALUES (v_project_id, v_autor.id, 'statut', v_statut, p_author_name);
    END IF;
  END IF;

  UPDATE projet_musique_autorisations SET
    duree_utilisation = CASE WHEN p_patch ? 'duree_utilisation'
                             THEN NULLIF(p_patch->>'duree_utilisation', '')
                             ELSE duree_utilisation END,
    contact_label     = CASE WHEN p_patch ? 'contact_label'
                             THEN NULLIF(p_patch->>'contact_label', '')
                             ELSE contact_label END,
    master_url        = CASE WHEN p_patch ? 'master_url'
                             THEN NULLIF(p_patch->>'master_url', '')
                             ELSE master_url END,
    doc_signe         = CASE WHEN p_patch ? 'doc_signe'
                             THEN COALESCE((p_patch->>'doc_signe')::boolean, false)
                             ELSE doc_signe END,
    utilise           = CASE WHEN p_patch ? 'utilise'
                             THEN COALESCE((p_patch->>'utilise')::boolean, false)
                             ELSE utilise END,
    updated_at        = now(),
    updated_by        = NULL,
    updated_by_name   = COALESCE(p_author_name, updated_by_name)
  WHERE id = v_autor.id;

  SELECT to_jsonb(a.*) INTO v_result
    FROM projet_musique_autorisations a
   WHERE a.id = v_autor.id;
  RETURN v_result;
END;
$share_musique_autor_update$;

REVOKE ALL ON FUNCTION share_musique_autor_update(text, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_musique_autor_update(text, uuid, jsonb, text)
  TO anon, authenticated;

-- ── 5. Commentaire RP ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION share_musique_autor_comment(
  p_token text,
  p_link_id uuid,
  p_body text,
  p_author_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_musique_autor_comment$
DECLARE
  v_project_id uuid;
  v_autor_id   uuid;
  v_event      jsonb;
BEGIN
  v_project_id := _musique_autor_share_resolve(p_token);
  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'body required';
  END IF;
  IF length(p_body) > 2000 THEN
    RAISE EXCEPTION 'body too long';
  END IF;

  PERFORM 1
    FROM projet_musique_livrable_link l
    JOIN livrables li ON li.id = l.livrable_id
   WHERE l.id = p_link_id AND li.project_id = v_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link not in project' USING ERRCODE = '28000';
  END IF;

  INSERT INTO projet_musique_autorisations (project_id, link_id)
  VALUES (v_project_id, p_link_id)
  ON CONFLICT (link_id) DO NOTHING;
  SELECT id INTO v_autor_id FROM projet_musique_autorisations WHERE link_id = p_link_id;

  INSERT INTO projet_musique_autorisation_events
    (project_id, autorisation_id, kind, body, author_name)
  VALUES (v_project_id, v_autor_id, 'comment', trim(p_body), p_author_name)
  RETURNING to_jsonb(projet_musique_autorisation_events.*) INTO v_event;

  RETURN v_event;
END;
$share_musique_autor_comment$;

REVOKE ALL ON FUNCTION share_musique_autor_comment(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_musique_autor_comment(text, uuid, text, text)
  TO anon, authenticated;

-- ── 6. Reload PostgREST ─────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Vérifications post-deploy :
--   INSERT INTO musique_autor_share_tokens (project_id, token, label)
--   VALUES ('<project_id>', 'test-autor-abc', 'RP test');
--   SELECT share_musique_autor_fetch('test-autor-abc');           -- payload
--   SELECT share_musique_autor_update('test-autor-abc', '<link>',
--     '{"statut":"envoyee","contact_label":"label@x.com"}', 'Marie');
--   SELECT share_musique_autor_comment('test-autor-abc', '<link>',
--     'Demande envoyée ce matin', 'Marie');
