-- ============================================================================
-- Migration : LOGISTIQUE V0 — RPC share fetch + teaser hub
-- Date      : 2026-05-12
-- Contexte  : Expose le contenu de la logistique V0 d'un projet via le portail
--             public /share/projet/:token/logistique_v0. Aligne sur le pattern
--             share_projet_deroule_fetch (voir 20260508_deroule_share_tokens.sql).
--
-- Périmètre :
--   1. RPC publique share_projet_logistique_v0_fetch(token, password)
--      — vérifie le token via _project_share_token_resolve avec required page
--      = 'logistique_v0'
--      — renvoie payload : { share, project, org, entries[], documents[], membres[], generated_at }
--      — entries[] : 1 par membre logé, avec champs texte (transport / hebergement / repas)
--      — documents[] : meta seul (le client génère les signed URLs via la
--                      policy storage anon configurée dans logistique_v0_schema)
--      — membres[] : dénormalisation (prenom, nom, specialite) pour rendu UI
--   2. Update share_projet_fetch : ajoute le teaser 'logistique_v0' (compte
--      personnes + documents) à côté des autres teasers (équipe, déroulé…)
--   3. Pas de table séparée — tout passe par project_share_tokens existant.
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260512_logistique_v0_schema.sql (tables), 20260504_project_share_*
--              (helpers _project_share_token_resolve, _project_share_bump,
--              share_projet_fetch).
-- ============================================================================

BEGIN;


-- ── 1. RPC share_projet_logistique_v0_fetch ────────────────────────────────
-- Fetch le payload complet pour la sous-page Logistique V0 du portail projet.
-- Sécurité : SECURITY DEFINER + token check + password gate via helper commun.
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
  -- Résolution token (raise 28000 si invalide/expiré/page non activée/mdp KO).
  -- Le 2e arg force la vérif que 'logistique_v0' est dans enabled_pages.
  SELECT project_id, label
    INTO v_project_id, v_label
    FROM _project_share_token_resolve(p_token, 'logistique_v0', p_password);

  -- Construction du payload. On dénormalise les membres pour que la page
  -- share puisse afficher nom + prénom + spécialité sans avoir besoin d'un
  -- second fetch.
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
    -- Entries : 1 par membre, avec les 3 textes. Tri par nom du membre.
    'entries', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                e.id,
          'project_id',        e.project_id,
          'membre_id',         e.membre_id,
          'transport_text',    e.transport_text,
          'hebergement_text',  e.hebergement_text,
          'repas_text',        e.repas_text,
          'created_at',        e.created_at,
          'updated_at',        e.updated_at
        ) ORDER BY COALESCE(m.nom, c.nom, ''), COALESCE(m.prenom, c.prenom, ''), e.created_at
      )
      FROM projet_logistique_v0_entries e
      JOIN projet_membres m ON m.id = e.membre_id
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE e.project_id = v_project_id
    ), '[]'::jsonb),
    -- Documents : tous les docs des entries du projet (le client filtre par
    -- entry_id + kind côté UI).
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
    -- Membres : dénormalisation (prenom, nom, specialite) pour les entries.
    -- Pas d'email/telephone : la logistique ne sert pas à contacter la
    -- personne (le destinataire du lien est probablement la personne
    -- elle-même ou un coordinateur qui a déjà ces infos via Équipe).
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

  -- Bump view_count + last_accessed_at pour la stat admin
  PERFORM _project_share_bump(p_token, 'logistique_v0');

  RETURN v_result;
END;
$share_projet_logistique_v0_fetch$;

REVOKE ALL ON FUNCTION share_projet_logistique_v0_fetch(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_projet_logistique_v0_fetch(text, text)
  TO anon, authenticated;


-- ── 2. Update share_projet_fetch — ajout teaser 'logistique_v0' ────────────
-- On re-CREATE OR REPLACE en gardant exactement les mêmes teasers existants
-- (équipe, livrables, déroulé) et en ajoutant logistique_v0 à côté. Format
-- du teaser : { personnes: N, documents: M }.
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
  v_result     jsonb;
BEGIN
  SELECT project_id, enabled_pages, label
    INTO v_project_id, v_enabled, v_label
    FROM _project_share_token_resolve(p_token, NULL, p_password);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label', v_label,
      'enabled_pages', v_enabled
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
      -- Nouveau : compteurs Logistique V0 (personnes loguées + total documents).
      -- Affiché sur la carte "Logistique" du hub ("3 personnes · 5 documents").
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


-- ── 3. Reload PostgREST pour exposer la nouvelle RPC ───────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Tests post-migration :
--
-- 1. RPC exposée :
--      SELECT proname FROM pg_proc
--       WHERE proname = 'share_projet_logistique_v0_fetch';
--
-- 2. Smoke test fetch (avec un project_share_token actif incluant
--    'logistique_v0' dans enabled_pages) :
--      SELECT share_projet_logistique_v0_fetch('<token>', NULL);
--    → doit retourner { share, project, org, entries[], documents[], membres[], generated_at }
--
-- 3. Page non activée → raise 28000 :
--      UPDATE project_share_tokens SET enabled_pages = '["equipe"]'::jsonb
--       WHERE token = '<token>';
--      SELECT share_projet_logistique_v0_fetch('<token>', NULL);
--    → doit raise 28000 'invalid or expired token (or page not enabled)'.
--
-- 4. Hub teaser :
--      UPDATE project_share_tokens SET enabled_pages = '["logistique_v0"]'::jsonb
--       WHERE token = '<token>';
--      SELECT share_projet_fetch('<token>', NULL)->'teasers'->'logistique_v0';
--    → { personnes: N, documents: M }
-- ============================================================================
