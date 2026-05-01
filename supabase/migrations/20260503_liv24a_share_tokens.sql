-- ============================================================================
-- Migration : LIV-24A — Tokens de partage public livrables
-- Date      : 2026-05-03
-- Contexte  : Permet d'exposer une vue READ-ONLY simplifiée de l'état des
--             livrables d'un projet à un client externe via une URL publique
--             (token), sans authentification ni accès au backoffice.
--
--             Pattern aligné sur MAT-10 (matos_check_tokens) : token opaque
--             généré côté client, RLS classique pour les users auth (admin),
--             RPC SECURITY DEFINER pour l'accès anonyme via le token.
--
--             Plusieurs tokens par projet (un par destinataire / scénario).
--             Chaque token porte une `config` jsonb qui décide quoi montrer :
--               - calendar_level   : 'hidden' | 'milestones' | 'phases'
--               - show_periodes    : afficher le bandeau périodes projet
--               - show_envoi_prevu : afficher les dates prévisionnelles
--               - show_feedback    : afficher le feedback client texte
--
--             Le payload renvoyé par `share_livrables_fetch` est filtré
--             côté serveur (impossible de remonter aux étapes / monteur /
--             notes internes via une jointure côté client).
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
--              CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260424_liv1_livrables_schema.sql (livrables, blocks,
--              versions, etapes), 20260416_planning_pl1.sql (event_types),
--              20260502_liv_version_date_envoi_prevu.sql (date_envoi_prevu).
-- ============================================================================

BEGIN;

-- ── 1. livrable_share_tokens ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS livrable_share_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope du partage : un projet entier (avec tous ses livrables non
  -- supprimés, ses blocs, ses versions). On scope au projet plutôt qu'au
  -- livrable individuel parce que le client veut typiquement voir l'ensemble.
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Token secret opaque (~32 chars base64url). Généré côté client via
  -- crypto.getRandomValues. Cf. MAT-10 pour le même pattern.
  token            text NOT NULL UNIQUE,

  -- Libellé interne ("Client Renault", "Équipe brand", "Relecture interne").
  -- Affiché dans la modale de gestion. Peut être null si l'utilisateur n'en
  -- saisit pas — un fallback "Lien #abc123" est utilisé côté UI.
  label            text,

  -- Configuration de ce qui est visible côté client. Par défaut on est
  -- conservateur : pas de calendrier, pas de feedback. L'admin coche
  -- explicitement ce qu'il veut partager.
  --
  -- Shape attendu (validé applicativement, pas de CHECK pour rester souple) :
  --   {
  --     "calendar_level":   "hidden" | "milestones" | "phases",
  --     "show_periodes":    boolean,
  --     "show_envoi_prevu": boolean,
  --     "show_feedback":    boolean
  --   }
  config           jsonb NOT NULL DEFAULT jsonb_build_object(
                     'calendar_level',   'hidden',
                     'show_periodes',    true,
                     'show_envoi_prevu', true,
                     'show_feedback',    true
                   ),

  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Soft revoke : la ligne est conservée pour l'historique (qui a créé
  -- quoi, combien de vues, dernière vue). RPC fetch renvoie 401 si revoked.
  revoked_at       timestamptz,

  -- Expiration optionnelle. NULL = lien permanent (à utiliser avec
  -- parcimonie, on encourage l'admin à dater).
  expires_at       timestamptz,

  -- Mis à jour par la RPC fetch (en SECURITY DEFINER) à chaque hit. Permet
  -- d'afficher "Vu 12× · dernière vue il y a 2j" dans la modale d'admin.
  last_accessed_at timestamptz,
  view_count       integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS livrable_share_tokens_token_idx
  ON livrable_share_tokens(token);
CREATE INDEX IF NOT EXISTS livrable_share_tokens_project_idx
  ON livrable_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS livrable_share_tokens_active_idx
  ON livrable_share_tokens(project_id, created_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE livrable_share_tokens IS
  'Tokens de partage public livrables (LIV-24). Un par destinataire / scénario. Accès anonyme via RPC share_livrables_fetch SECURITY DEFINER. Pattern aligné sur matos_check_tokens.';
COMMENT ON COLUMN livrable_share_tokens.config IS
  'Toggles côté client. calendar_level: hidden|milestones|phases. show_periodes/show_envoi_prevu/show_feedback: booleans.';
COMMENT ON COLUMN livrable_share_tokens.token IS
  'Secret opaque (~32 chars base64url). Généré côté client via crypto.getRandomValues — jamais en clair côté serveur avant insertion.';


-- ── 2. RLS — admin/auth seulement (l'accès anon passe par RPC) ──────────────
-- Lecture / écriture scopées via can_read_outil / can_edit_outil sur
-- l'outil 'livrables' (cohérent avec les autres tables livrables).
ALTER TABLE livrable_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "livrable_share_tokens_scoped_read"  ON livrable_share_tokens;
DROP POLICY IF EXISTS "livrable_share_tokens_scoped_write" ON livrable_share_tokens;

CREATE POLICY "livrable_share_tokens_scoped_read" ON livrable_share_tokens
  FOR SELECT
  USING (can_read_outil(project_id, 'livrables'));

CREATE POLICY "livrable_share_tokens_scoped_write" ON livrable_share_tokens
  FOR ALL
  USING      (can_edit_outil(project_id, 'livrables'))
  WITH CHECK (can_edit_outil(project_id, 'livrables'));


-- ── 3. RPC interne — résolution du token ────────────────────────────────────
-- Renvoie (project_id, config) si le token est valide (non révoqué et non
-- expiré), sinon raise. Marquée internal (underscore) — appelée seulement
-- par share_livrables_fetch.
CREATE OR REPLACE FUNCTION _share_token_resolve(p_token text)
RETURNS TABLE(project_id uuid, config jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_share_token_resolve$
BEGIN
  RETURN QUERY
    SELECT t.project_id, t.config
      FROM livrable_share_tokens t
     WHERE t.token = p_token
       AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '28000';
  END IF;
END;
$_share_token_resolve$;

REVOKE ALL ON FUNCTION _share_token_resolve(text) FROM PUBLIC;


-- ── 4. RPC publique — fetch global du payload de partage ────────────────────
-- Un seul round-trip pour la page client. Tout est filtré côté serveur :
-- pas d'étapes (sauf si calendar_level='phases'), pas d'assignee, pas de
-- notes internes, pas de projet_dav, pas de feedback (sauf si show_feedback).
--
-- Sécurité : la RPC bypasse les RLS (SECURITY DEFINER) — le token fait office
-- d'authentification. Toutes les sous-requêtes sont strictement scopées au
-- project_id résolu, impossible de remonter à un autre projet.
CREATE OR REPLACE FUNCTION share_livrables_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_livrables_fetch$
DECLARE
  v_project_id      uuid;
  v_config          jsonb;
  v_calendar_level  text;
  v_show_periodes   boolean;
  v_show_envoi      boolean;
  v_show_feedback   boolean;
  v_result          jsonb;
BEGIN
  -- Résout token → project_id + config (raise si invalide/expiré).
  SELECT project_id, config
    INTO v_project_id, v_config
    FROM _share_token_resolve(p_token);

  -- Lit les toggles avec fallback (config peut être incomplet si shape
  -- évolue dans le futur).
  v_calendar_level := COALESCE(v_config->>'calendar_level', 'hidden');
  v_show_periodes  := COALESCE((v_config->>'show_periodes')::boolean,    true);
  v_show_envoi     := COALESCE((v_config->>'show_envoi_prevu')::boolean, true);
  v_show_feedback  := COALESCE((v_config->>'show_feedback')::boolean,    true);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',  (SELECT label  FROM livrable_share_tokens WHERE token = p_token),
      'config', v_config
    ),
    'project', (
      SELECT jsonb_build_object(
        'id',         p.id,
        'title',      p.title,
        'ref_projet', p.ref_projet,
        'cover_url',  p.cover_url,
        -- Périodes uniquement si autorisé. On filtre les autres clés de
        -- metadata pour ne pas leaker des champs internes.
        'periodes', CASE
          WHEN v_show_periodes THEN COALESCE(p.metadata->'periodes', 'null'::jsonb)
          ELSE 'null'::jsonb
        END
      )
      FROM projects p WHERE p.id = v_project_id
    ),
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         b.id,
          'nom',        b.nom,
          'prefixe',    b.prefixe,
          'couleur',    b.couleur,
          'sort_order', b.sort_order
        ) ORDER BY b.sort_order, b.created_at
      )
      FROM livrable_blocks b
      WHERE b.project_id = v_project_id
        AND b.deleted_at IS NULL
    ), '[]'::jsonb),
    'livrables', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          -- Champs publics. Délibérément exclus :
          --   assignee_profile_id, assignee_external (qui fait quoi)
          --   notes (notes internes monteur)
          --   projet_dav (référence DaVinci Resolve)
          --   updated_by (qui a modifié quoi)
          --   devis_lot_id (lien commercial interne)
          'id',             l.id,
          'block_id',       l.block_id,
          'numero',         l.numero,
          'nom',            l.nom,
          'format',         l.format,
          'duree',          l.duree,
          'version_label',  l.version_label,
          'statut',         l.statut,
          'date_livraison', l.date_livraison,
          'lien_frame',     l.lien_frame,
          'lien_drive',     l.lien_drive,
          'sort_order',     l.sort_order
        ) ORDER BY l.sort_order, l.created_at
      )
      FROM livrables l
      WHERE l.project_id = v_project_id
        AND l.deleted_at IS NULL
    ), '[]'::jsonb),
    'versions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                v.id,
          'livrable_id',       v.livrable_id,
          'numero_label',      v.numero_label,
          'date_envoi',        v.date_envoi,
          -- Date prévisionnelle : visible seulement si autorisé.
          'date_envoi_prevu',  CASE WHEN v_show_envoi THEN v.date_envoi_prevu ELSE NULL END,
          'lien_frame',        v.lien_frame,
          'statut_validation', v.statut_validation,
          -- Feedback client : visible seulement si autorisé.
          'feedback_client',   CASE WHEN v_show_feedback THEN v.feedback_client ELSE NULL END,
          'sort_order',        v.sort_order,
          'created_at',        v.created_at
        ) ORDER BY v.livrable_id, v.sort_order, v.created_at
      )
      FROM livrable_versions v
      JOIN livrables l ON l.id = v.livrable_id
      WHERE l.project_id = v_project_id
        AND l.deleted_at IS NULL
    ), '[]'::jsonb),
    -- Étapes uniquement si calendar_level='phases'. Ne contient que les
    -- champs nécessaires au rendu du mini-Gantt (kind, dates, event_type
    -- pour la couleur). Pas de notes, pas d'assignee.
    'etapes', CASE
      WHEN v_calendar_level = 'phases' THEN COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',            e.id,
            'livrable_id',   e.livrable_id,
            'nom',           e.nom,
            'kind',          e.kind,
            'date_debut',    e.date_debut,
            'date_fin',      e.date_fin,
            'event_type_id', ev.event_type_id,
            'sort_order',    e.sort_order
          ) ORDER BY e.date_debut, e.sort_order
        )
        FROM livrable_etapes e
        JOIN livrables l ON l.id = e.livrable_id
        LEFT JOIN events ev ON ev.id = e.event_id
        WHERE l.project_id = v_project_id
          AND l.deleted_at IS NULL
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    -- Event types nécessaires aux couleurs des phases (uniquement si
    -- calendar_level='phases', sinon inutile).
    'event_types', CASE
      WHEN v_calendar_level = 'phases' THEN COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',       et.id,
            'slug',     et.slug,
            'label',    et.label,
            'color',    et.color,
            'category', et.category
          )
        )
        FROM event_types et
        WHERE et.id IN (
          SELECT DISTINCT ev.event_type_id
            FROM livrable_etapes le
            JOIN events ev ON ev.id = le.event_id
            JOIN livrables l ON l.id = le.livrable_id
           WHERE l.project_id = v_project_id
             AND l.deleted_at IS NULL
             AND ev.event_type_id IS NOT NULL
        )
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    'generated_at', now()
  )
  INTO v_result;

  -- Bump compteur de vues (best effort, on n'échoue pas l'appel si busy).
  UPDATE livrable_share_tokens
     SET last_accessed_at = now(),
         view_count       = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_livrables_fetch$;

-- L'accès anonyme passe par GRANT à anon (Supabase rôle public non-auth).
-- authenticated y a aussi accès — ça permet à l'admin de previewer le lien
-- depuis sa session sans logout.
REVOKE ALL ON FUNCTION share_livrables_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_livrables_fetch(text) TO anon, authenticated;


-- ── 5. RPC admin — révocation soft d'un token ───────────────────────────────
-- Sucre syntaxique : un UPDATE direct fonctionne aussi (RLS-scoped) mais
-- cette fonction rend l'intention explicite et garantit l'idempotence.
CREATE OR REPLACE FUNCTION revoke_livrable_share_token(p_token_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $revoke_livrable_share_token$
BEGIN
  UPDATE livrable_share_tokens
     SET revoked_at = COALESCE(revoked_at, now())
   WHERE id = p_token_id;
END;
$revoke_livrable_share_token$;


-- ── 6. Reload PostgREST pour exposer les nouvelles RPC ──────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Notes post-migration
-- ============================================================================
-- 1. Activer Realtime sur `livrable_share_tokens` (Dashboard ou migration
--    dédiée) si on veut que le dashboard admin voie en temps réel le
--    bump de view_count quand un client ouvre le lien :
--      ALTER PUBLICATION supabase_realtime ADD TABLE livrable_share_tokens;
--    Ce n'est PAS critique — un refetch sur ouverture de la modale suffit
--    en v1.
--
-- 2. La page publique sera à l'URL /share/livrables/:token (LIV-24C),
--    cohérent avec /check/:token (MAT-10) et /rendu/:token (MAT-13).
--
-- 3. Si on veut plus tard partager un seul livrable (au lieu du projet
--    entier), ajouter un champ optionnel `livrable_ids uuid[]` à la table
--    et filtrer dans share_livrables_fetch. Pour l'instant on partage
--    toujours le projet entier (config produit validée par Hugo).
-- ============================================================================
