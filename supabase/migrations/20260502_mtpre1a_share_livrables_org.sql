-- ============================================================================
-- Migration : MT-PRE-1.A — Branding org dans share_livrables_fetch (D.4)
-- Date      : 2026-05-02
-- Contexte  : Étend la RPC `share_livrables_fetch` (LIV-24A) pour exposer
--             un objet `org` contenant les champs de branding nécessaires à
--             la page de partage publique : logos, nom commercial, tagline,
--             couleur d'accent, intro share, etc.
--
--             Pourquoi : sans cette extension, la page /share/livrables/:token
--             reste brandée Captiv même quand l'org propriétaire est OMNI FILMS
--             (ou n'importe quelle autre société utilisant l'outil en
--             multi-tenant — cf. CHANTIER_MULTI_TENANT.md).
--
--             Champs exposés (volontairement filtrés pour ne pas leaker
--             d'infos légales sensibles type SIRET / capital social) :
--               - display_name      → nom commercial à afficher
--               - legal_name        → fallback si display_name vide
--               - tagline           → "Production audiovisuelle" etc.
--               - logo_url_clair    → version pour fond clair (lightmode)
--               - logo_url_sombre   → version pour fond sombre (darkmode)
--               - logo_banner_url   → variante horizontale lockup
--               - brand_color       → couleur d'accent (hex)
--               - share_intro_text  → texte custom de la page de partage
--               - website_url       → optionnel, pour signature footer PDF
--
--             EXCLU : siret, siren, capital_social, code_ape, ville_rcs,
--             forme_juridique, signature_url, pdf_field_visibility,
--             pdf_devis_*_text, addresse_*. Ces champs sont internes
--             (mentions légales devis/factures) et pas pertinents pour
--             un client externe regardant des livrables vidéo.
--
-- Sécurité : la RPC reste SECURITY DEFINER, les données org sont jointes
--            via projects.org_id → orgs.id en strict scoping. Pas de
--            modification de permissions.
--
-- Idempotent : CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260503_liv24a_share_tokens.sql (RPC existante),
--              20260502_mtpre1a_branding_schema.sql (champs orgs).
-- ============================================================================

BEGIN;

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
    -- MT-PRE-1.A : org propriétaire du projet, branding-only (pas d'infos
    -- légales). NULL si l'org est introuvable ou si project.org_id est NULL
    -- (legacy — projets pré-multi-tenant). Le front fallback alors sur les
    -- valeurs Captiv historiques.
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
        'share_intro_text',  o.share_intro_text,
        'website_url',       o.website_url
      )
      FROM projects p
      JOIN organisations o ON o.id = p.org_id
      WHERE p.id = v_project_id
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
    -- LIV-9 : event_type_id est porté DIRECTEMENT par livrable_etapes
    -- (pas par l'event miroir) — pas de jointure events nécessaire.
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
            'event_type_id', e.event_type_id,
            'sort_order',    e.sort_order
          ) ORDER BY e.date_debut, e.sort_order
        )
        FROM livrable_etapes e
        JOIN livrables l ON l.id = e.livrable_id
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
          SELECT DISTINCT le.event_type_id
            FROM livrable_etapes le
            JOIN livrables l ON l.id = le.livrable_id
           WHERE l.project_id = v_project_id
             AND l.deleted_at IS NULL
             AND le.event_type_id IS NOT NULL
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

REVOKE ALL ON FUNCTION share_livrables_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_livrables_fetch(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Notes post-migration
-- ============================================================================
-- 1. Aucune permission RLS à toucher : la RPC est SECURITY DEFINER, l'accès
--    aux orgs passe via la jointure projects → orgs en strict scope sur
--    project_id résolu par le token.
--
-- 2. Si une org n'a aucun logo / display_name configuré, la RPC retourne
--    quand même l'objet (avec champs NULL). Le front fallback gracieusement
--    sur le legal_name puis sur le branding Captiv historique.
--
-- 3. Pour ajouter un nouveau champ branding plus tard (ex: logo de favicon,
--    color secondaire), juste l'ajouter au jsonb_build_object 'org' ci-dessus
--    et au composant ShareHeader. Pas de breaking change : les anciens
--    clients ignorent les champs inconnus.
-- ============================================================================
