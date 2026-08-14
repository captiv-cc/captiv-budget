-- ════════════════════════════════════════════════════════════════════════════
-- MUS-7 — Colonne « Suivi par » sur les autorisations (répartition RP)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Demande Hugo 14/08 : les RP se répartissent les demandes entre eux — une
-- colonne texte libre indique qui est en charge du suivi de chaque track,
-- côté desk comme côté portail.
--
-- 1. ALTER : projet_musique_autorisations.suivi_par
-- 2. Re-CREATE des deux RPCs du portail (base 20260804b) : suivi_par exposé
--    dans le payload fetch + accepté dans la whitelist d'écriture.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE projet_musique_autorisations
  ADD COLUMN IF NOT EXISTS suivi_par text;

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
              'suivi_par', a.suivi_par,
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
    suivi_par         = CASE WHEN p_patch ? 'suivi_par'
                             THEN NULLIF(p_patch->>'suivi_par', '')
                             ELSE suivi_par END,
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

NOTIFY pgrst, 'reload schema';
