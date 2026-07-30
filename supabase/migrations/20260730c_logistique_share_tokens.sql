-- ════════════════════════════════════════════════════════════════════════════
-- LOGISTIQUE V1 — Tokens de partage dédiés au module (comme le déroulé)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Retour Hugo : le partage de l'onglet Logistique ne doit PAS être un
-- « portail projet simplifié » — il doit avoir ses propres liens, comme les
-- autres onglets (déroulé, équipe, livrables…). Cette migration crée
-- l'infrastructure autonome :
--   1. Table logistique_share_tokens + indexes + RLS org
--   2. Helper interne _logistique_share_resolve(token)
--   3. RPC publique share_logistique_fetch(token) — payload identique à
--      share_projet_logistique_v0_fetch mais résolu depuis la nouvelle table,
--      avec les 3 sections en colonnes (show_overview/show_synthese/
--      show_personnes) appliquées côté serveur
--   4. Policies storage anon étendues : les docs (V0 + V1) deviennent
--      lisibles aussi via un logistique_share_token actif
--
-- La page publique dédiée vit sur /share/logistique/:token — jamais de
-- retour vers le hub portail. Les portails projet multi-pages continuent
-- d'utiliser share_projet_logistique_v0_fetch (les 2 cohabitent, comme
-- share_deroule_fetch / share_projet_deroule_fetch).
--
-- Pattern aligné sur 20260508_deroule_share_tokens.sql. Idempotent.
-- Dépend de : 20260729a (tables V1), 20260729b (docs), 20260512 (V0).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. logistique_share_tokens ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logistique_share_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Token secret opaque (~32 chars base64url), généré côté client.
  token            text NOT NULL UNIQUE,

  -- Libellé interne ("Équipe tournage", "Festival"…). Modale admin seulement.
  label            text,

  -- Sections visibles sur la page publique (appliqué côté serveur) :
  --   show_overview  → grille personnes × jours
  --   show_synthese  → repas/jour, rooming, arrivées & départs
  --   show_personnes → fiches par personne (notes V0 + docs inclus)
  show_overview    boolean NOT NULL DEFAULT true,
  show_synthese    boolean NOT NULL DEFAULT true,
  show_personnes   boolean NOT NULL DEFAULT true,

  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Soft revoke (historique conservé) + expiration optionnelle.
  revoked_at       timestamptz,
  expires_at       timestamptz,

  -- Bumpé par la RPC fetch à chaque hit.
  last_accessed_at timestamptz,
  view_count       integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS logistique_share_tokens_token_idx
  ON logistique_share_tokens(token);
CREATE INDEX IF NOT EXISTS logistique_share_tokens_project_idx
  ON logistique_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS logistique_share_tokens_active_idx
  ON logistique_share_tokens(project_id, created_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE logistique_share_tokens IS
  'Tokens de partage public dédiés à la Logistique & VHR. Un par destinataire. Accès anonyme via RPC share_logistique_fetch SECURITY DEFINER.';


-- ── 2. RLS — org seulement ──────────────────────────────────────────────────
ALTER TABLE logistique_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logistique_share_tokens_org" ON logistique_share_tokens;

CREATE POLICY "logistique_share_tokens_org" ON logistique_share_tokens
  FOR ALL
  USING (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  );


-- ── 3. Helper interne — résolution du token ─────────────────────────────────
CREATE OR REPLACE FUNCTION _logistique_share_resolve(p_token text)
RETURNS TABLE(
  project_id     uuid,
  label          text,
  show_overview  boolean,
  show_synthese  boolean,
  show_personnes boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_logistique_share_resolve$
BEGIN
  RETURN QUERY
    SELECT t.project_id, t.label, t.show_overview, t.show_synthese, t.show_personnes
      FROM logistique_share_tokens t
     WHERE t.token = p_token
       AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '28000';
  END IF;
END;
$_logistique_share_resolve$;

REVOKE ALL ON FUNCTION _logistique_share_resolve(text) FROM PUBLIC;


-- ── 4. RPC publique — fetch du payload logistique dédié ─────────────────────
-- Même payload que share_projet_logistique_v0_fetch (20260730b) : la page
-- publique (LogistiqueShareView) est partagée entre les deux routes.
CREATE OR REPLACE FUNCTION share_logistique_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_logistique_fetch$
DECLARE
  v_project_id uuid;
  v_label      text;
  v_show_overview  boolean;
  v_show_synthese  boolean;
  v_show_personnes boolean;
  v_show_v1        boolean;
  v_result     jsonb;
BEGIN
  SELECT project_id, label, show_overview, show_synthese, show_personnes
    INTO v_project_id, v_label, v_show_overview, v_show_synthese, v_show_personnes
    FROM _logistique_share_resolve(p_token);

  -- Les blocs V1 alimentent la vue d'ensemble ET la synthèse.
  v_show_v1 := v_show_overview OR v_show_synthese;

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label', v_label
    ),
    'config', jsonb_build_object(
      'show_overview',  v_show_overview,
      'show_synthese',  v_show_synthese,
      'show_personnes', v_show_personnes
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
    'entries', CASE WHEN NOT v_show_personnes THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'documents', CASE WHEN NOT v_show_personnes THEN '[]'::jsonb ELSE COALESCE((
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
    ), '[]'::jsonb) END,
    'membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',               m.id,
          'contact_id',       m.contact_id,
          'parent_membre_id', m.parent_membre_id,
          'category',         m.category,
          'sort_order',       m.sort_order,
          'created_at',       m.created_at,
          'prenom',           COALESCE(c.prenom, m.prenom),
          'nom',              COALESCE(c.nom, m.nom),
          'specialite',       m.specialite,
          'produit',          dl.produit
        ) ORDER BY m.category NULLS FIRST, m.sort_order, m.created_at
      )
      FROM projet_membres m
      LEFT JOIN contacts c ON c.id = m.contact_id
      LEFT JOIN devis_lines dl ON dl.id = m.devis_line_id
      WHERE m.project_id = v_project_id
    ), '[]'::jsonb),
    'participations', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',             psm.id,
          'session_id',     psm.session_id,
          'membre_id',      psm.membre_id,
          'presence_days',  to_jsonb(COALESCE(psm.presence_days, '{}'::text[])),
          'arrival_date',   psm.arrival_date,
          'arrival_time',   psm.arrival_time,
          'departure_date', psm.departure_date,
          'departure_time', psm.departure_time,
          'label',          s.label,
          'couleur',        s.couleur,
          'sort_order',     s.sort_order,
          'start_date',     s.start_date,
          'end_date',       s.end_date
        )
      )
      FROM projet_session_membres psm
      JOIN projet_sessions s ON s.id = psm.session_id
      WHERE s.project_id = v_project_id
    ), '[]'::jsonb) END,
    'trajets', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',          t.id,
          'membre_id',   t.membre_id,
          'sens',        t.sens,
          'date_trajet', t.date_trajet,
          'etapes',      t.etapes,
          'notes',       t.notes
        ) ORDER BY t.date_trajet, t.sort_order
      )
      FROM projet_logistique_trajets t
      WHERE t.project_id = v_project_id
    ), '[]'::jsonb) END,
    'repas', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'membre_id',  r.membre_id,
          'date_repas', r.date_repas,
          'service',    r.service,
          'statut',     r.statut
        )
      )
      FROM projet_logistique_repas r
      WHERE r.project_id = v_project_id
    ), '[]'::jsonb) END,
    'nuits', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'membre_id',      n.membre_id,
          'date_nuit',      n.date_nuit,
          'hebergement_id', n.hebergement_id
        )
      )
      FROM projet_logistique_nuits n
      WHERE n.project_id = v_project_id
    ), '[]'::jsonb) END,
    'hebergements', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',      h.id,
          'nom',     h.nom,
          'type',    h.type,
          'adresse', h.adresse,
          'notes',   h.notes
        ) ORDER BY h.sort_order
      )
      FROM projet_logistique_hebergements h
      WHERE h.project_id = v_project_id
    ), '[]'::jsonb) END,
    'hebergement_membres', CASE WHEN NOT v_show_v1 THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'hebergement_id', hm.hebergement_id,
          'membre_id',      hm.membre_id,
          'chambre',        hm.chambre,
          'pdj',            hm.pdj
        )
      )
      FROM projet_logistique_hebergement_membres hm
      WHERE hm.project_id = v_project_id
    ), '[]'::jsonb) END,
    'generated_at', now()
  ) INTO v_result;

  -- Bump compteur de vues (best effort).
  UPDATE logistique_share_tokens
     SET last_accessed_at = now(),
         view_count       = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_logistique_fetch$;

REVOKE ALL ON FUNCTION share_logistique_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_logistique_fetch(text) TO anon, authenticated;


-- ── 5. Storage anon : les liens dédiés ouvrent aussi les docs ───────────────
-- Les policies anon existantes (20260512 V0, 20260729b V1) n'acceptent que
-- project_share_tokens — on les remplace pour accepter EN PLUS un
-- logistique_share_token actif du projet.

-- Docs V1 (trajets / hébergements) — path = <project_id>/<uuid>.<ext>
DROP POLICY IF EXISTS "projet-logistique-docs read anon" ON storage.objects;
CREATE POLICY "projet-logistique-docs read anon"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'projet-logistique-docs'
    AND (
      EXISTS (
        SELECT 1 FROM project_share_tokens t
        WHERE t.project_id = split_part(storage.objects.name, '/', 1)::uuid
          AND t.revoked_at IS NULL
          AND (t.expires_at IS NULL OR t.expires_at > now())
          AND (t.enabled_pages ? 'logistique_v0')
      )
      OR EXISTS (
        SELECT 1 FROM logistique_share_tokens lt
        WHERE lt.project_id = split_part(storage.objects.name, '/', 1)::uuid
          AND lt.revoked_at IS NULL
          AND (lt.expires_at IS NULL OR lt.expires_at > now())
      )
    )
  );

-- Docs V0 (billets / résas des fiches) — path = <entry_id>/…
DROP POLICY IF EXISTS "projet-logistique-v0-docs read anon" ON storage.objects;
CREATE POLICY "projet-logistique-v0-docs read anon"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'projet-logistique-v0-docs'
    AND EXISTS (
      SELECT 1
        FROM projet_logistique_v0_entries e
       WHERE e.id::text = split_part(storage.objects.name, '/', 1)
         AND (
           EXISTS (
             SELECT 1 FROM project_share_tokens t
             WHERE t.project_id = e.project_id
               AND t.revoked_at IS NULL
               AND (t.expires_at IS NULL OR t.expires_at > now())
               AND (t.enabled_pages ? 'logistique_v0')
           )
           OR EXISTS (
             SELECT 1 FROM logistique_share_tokens lt
             WHERE lt.project_id = e.project_id
               AND lt.revoked_at IS NULL
               AND (lt.expires_at IS NULL OR lt.expires_at > now())
           )
         )
    )
  );


-- ── 6. Reload PostgREST ─────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- Vérifications post-deploy :
--
-- 1. SELECT proname FROM pg_proc
--     WHERE proname IN ('share_logistique_fetch','_logistique_share_resolve');
--
-- 2. Smoke test (auth admin) :
--    INSERT INTO logistique_share_tokens (project_id, token, label)
--    VALUES ('<project_id>', 'test-logi-abc', 'Test équipe');
--    SELECT share_logistique_fetch('test-logi-abc');
--    -- doit retourner config + membres + participations + trajets… et
--    -- bumper view_count à 1.
--
-- 3. Sections masquées :
--    UPDATE logistique_share_tokens SET show_personnes = false
--     WHERE token = 'test-logi-abc';
--    SELECT share_logistique_fetch('test-logi-abc')->'entries';  -- '[]'
-- ════════════════════════════════════════════════════════════════════════════
