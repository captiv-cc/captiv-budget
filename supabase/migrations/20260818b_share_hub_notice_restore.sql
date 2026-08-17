-- ════════════════════════════════════════════════════════════════════════════
-- PROJECT SHARE — restaure « Note à l'équipe » sur le hub portail
-- Date      : 2026-08-18
-- ════════════════════════════════════════════════════════════════════════════
--
-- RÉGRESSION : 20260513_project_share_hub_notice.sql avait ajouté la colonne
-- hub_notice ET son exposition dans share_projet_fetch. La migration
-- 20260707a_matos_listes.sql a redéfini cette fonction à partir d'un corps
-- antérieur, sans la clé 'hub_notice' — la note restait donc enregistrée
-- (la modale d'admin la relit bien) mais n'était plus servie au portail,
-- où <HubShareNotice> ne recevait qu'undefined.
--
-- MÊME CAUSE, deux autres pertes constatées en comparant les payloads : les
-- teasers 'deroule' et 'logistique_v0' (compteurs sous les cartes du hub)
-- avaient disparu au passage. Ils sont restaurés ici — d'où les cartes
-- Déroulé et Logistique sans compteur sur le portail.
--
-- Corps repris de 20260707a (dernière définition) + les clés manquantes.
--
-- ⚠️ share_projet_fetch cumule maintenant plusieurs ajouts à préserver dans
-- toute redéfinition future : 'hub_notice', 'password_protected', et les
-- teasers equipe / livrables / materiel (multi-listes, _matos_active_version)
-- / deroule / logistique_v0. Même piège que le payload membres des RPC déroulé
-- (cf. 20260816b) : repartir de la DERNIÈRE définition, jamais d'une plus
-- ancienne.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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
  v_hub_notice        text;
  v_active_version    uuid;
  v_result            jsonb;
BEGIN
  SELECT project_id, enabled_pages, label
    INTO v_project_id, v_enabled, v_label
    FROM _project_share_token_resolve(p_token, NULL, p_password);

  SELECT password_hash IS NOT NULL, hub_notice
    INTO v_password_protected, v_hub_notice
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
      'password_protected', COALESCE(v_password_protected, false),
      'hub_notice',         v_hub_notice
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
GRANT EXECUTE ON FUNCTION share_projet_fetch(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
