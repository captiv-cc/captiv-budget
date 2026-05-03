-- ============================================================================
-- Migration : EQUIPE-P4.2A — Tokens de partage public de la techlist
-- Date      : 2026-05-02
-- Contexte  : Permet d'exposer une vue READ-ONLY de la tech list d'un projet à
--             un destinataire externe (régisseur, prod, client) via une URL
--             publique (token), sans authentification ni accès au backoffice.
--
--             Pattern aligné sur LIV-24A (livrable_share_tokens) et MAT-10
--             (matos_check_tokens) : token opaque généré côté client, RLS
--             org-scopée pour les users auth (admin/charge_prod/coordinateur),
--             RPC SECURITY DEFINER pour l'accès anonyme via le token.
--
--             Plusieurs tokens par projet (un par destinataire / scénario).
--             Chaque token porte un `scope` : 'all' (tous les lots) ou un
--             `lot_id` précis (filtrage strict, ad-hoc masquées). C'est le
--             dropdown de la modale qui pousse cette valeur.
--
--             show_sensitive contrôle l'exposition des coordonnées (téléphone
--             / email) côté page publique. Default true (décision Hugo).
--
-- Idempotent : CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
--              CREATE OR REPLACE FUNCTION.
-- Dépend de  : 20260502_equipe_p1_techlist_schema.sql (projet_membres,
--              colonnes techlist), 20260413_devis_lots.sql (lots).
-- ============================================================================

BEGIN;

-- ── 1. equipe_share_tokens ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipe_share_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope du partage : un projet entier (la techlist filtrée selon scope/lot_id).
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Token secret opaque (~32 chars base64url). Généré côté client via
  -- crypto.getRandomValues. Cf. LIV-24A pour le même pattern.
  token            text NOT NULL UNIQUE,

  -- Libellé interne ("Régisseur Paul", "Prod Renault", "Lien équipe brand").
  -- Affiché dans la modale de gestion. Peut être null — un fallback
  -- "Lien #abc123" est utilisé côté UI.
  label            text,

  -- Périmètre : 'all' = tous les lots ; 'lot' = un lot précis (lot_id requis).
  -- En filtrage 'lot', les attributions ad-hoc (pas de devis_line_id) sont
  -- masquées (cohérent avec Option A retenue côté front pour le LotFilter).
  scope            text NOT NULL DEFAULT 'all'
                     CHECK (scope IN ('all', 'lot')),
  -- FK vers devis_lots ajoutée APRÈS le CREATE TABLE (cf. ALTER TABLE plus
  -- bas) pour permettre le re-run idempotent : si la table existe déjà avec
  -- une mauvaise contrainte, on la drop+re-add. Ici on déclare juste la
  -- colonne sans contrainte inline.
  lot_id           uuid,

  -- Toggle d'affichage des coordonnées (tel + email) sur la page publique.
  -- Default true (décision Hugo P4 : coordonnées visibles par défaut).
  show_sensitive   boolean NOT NULL DEFAULT true,

  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Soft revoke : la ligne est conservée pour l'historique (qui a créé quoi,
  -- combien de vues, dernière vue). RPC fetch raise si revoked.
  revoked_at       timestamptz,

  -- Expiration optionnelle. NULL = lien permanent (à utiliser avec parcimonie,
  -- on encourage l'admin à dater).
  expires_at       timestamptz,

  -- Mis à jour par la RPC fetch (en SECURITY DEFINER) à chaque hit.
  last_accessed_at timestamptz,
  view_count       integer NOT NULL DEFAULT 0,

  -- Cohérence : si scope='lot', lot_id doit être renseigné ; si scope='all',
  -- lot_id doit être null. Évite les états incohérents en BDD.
  CONSTRAINT equipe_share_scope_lot_check CHECK (
    (scope = 'all' AND lot_id IS NULL) OR
    (scope = 'lot' AND lot_id IS NOT NULL)
  )
);

-- FK vers devis_lots ajoutée séparément (idempotent : DROP + ADD).
-- Initialement la migration référençait `lots(id)` qui n'existe pas dans
-- ce schéma — la table est `devis_lots`.
ALTER TABLE equipe_share_tokens
  DROP CONSTRAINT IF EXISTS equipe_share_tokens_lot_id_fkey;
ALTER TABLE equipe_share_tokens
  ADD CONSTRAINT equipe_share_tokens_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES devis_lots(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS equipe_share_tokens_token_idx
  ON equipe_share_tokens(token);
CREATE INDEX IF NOT EXISTS equipe_share_tokens_project_idx
  ON equipe_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS equipe_share_tokens_active_idx
  ON equipe_share_tokens(project_id, created_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE equipe_share_tokens IS
  'Tokens de partage public techlist (EQUIPE-P4.2). Un par destinataire / scénario. Accès anonyme via RPC share_equipe_fetch SECURITY DEFINER.';
COMMENT ON COLUMN equipe_share_tokens.scope IS
  'all = tous lots, lot = un seul lot (lot_id requis). Filtrage strict côté RPC : en mode lot, les attributions ad-hoc sont masquées.';
COMMENT ON COLUMN equipe_share_tokens.show_sensitive IS
  'Si true, expose tel + email + adresse via la RPC publique. Default true (décision produit P4).';
COMMENT ON COLUMN equipe_share_tokens.token IS
  'Secret opaque (~32 chars base64url). Généré côté client via crypto.getRandomValues — jamais en clair côté serveur avant insertion.';


-- ── 2. RLS — admin/auth seulement (l'accès anon passe par RPC) ──────────────
-- Lecture / écriture scopées au projet via org_id (cohérent avec le reste
-- des tables équipe). Le détail des rôles autorisés à créer un share est
-- géré côté front via canSeeCrew (admin / charge_prod / coordinateur).
ALTER TABLE equipe_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipe_share_tokens_org" ON equipe_share_tokens;

CREATE POLICY "equipe_share_tokens_org" ON equipe_share_tokens
  FOR ALL
  USING (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id())
  );


-- ── 3. RPC interne — résolution du token ────────────────────────────────────
-- Renvoie (project_id, scope, lot_id, show_sensitive) si le token est valide
-- (non révoqué et non expiré), sinon raise.
CREATE OR REPLACE FUNCTION _equipe_share_resolve(p_token text)
RETURNS TABLE(
  project_id     uuid,
  scope          text,
  lot_id         uuid,
  show_sensitive boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $_equipe_share_resolve$
BEGIN
  RETURN QUERY
    SELECT t.project_id, t.scope, t.lot_id, t.show_sensitive
      FROM equipe_share_tokens t
     WHERE t.token = p_token
       AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired token' USING ERRCODE = '28000';
  END IF;
END;
$_equipe_share_resolve$;

REVOKE ALL ON FUNCTION _equipe_share_resolve(text) FROM PUBLIC;


-- ── 4. RPC publique — fetch du payload de partage techlist ──────────────────
-- Un seul round-trip pour la page publique. Tout est filtré côté serveur :
-- pas de champs financiers (cout_estime, budget_convenu, tarif_jour),
-- pas de movinmotion_statut, pas de notes internes.
-- show_sensitive contrôle l'exposition tel/email.
--
-- Sécurité : la RPC bypasse les RLS (SECURITY DEFINER) — le token fait office
-- d'authentification. Toutes les sous-requêtes sont strictement scopées au
-- project_id résolu, impossible de remonter à un autre projet.
CREATE OR REPLACE FUNCTION share_equipe_fetch(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $share_equipe_fetch$
DECLARE
  v_project_id     uuid;
  v_scope          text;
  v_lot_id         uuid;
  v_show_sensitive boolean;
  v_result         jsonb;
BEGIN
  -- Résout token → contexte (raise si invalide/expiré).
  SELECT project_id, scope, lot_id, show_sensitive
    INTO v_project_id, v_scope, v_lot_id, v_show_sensitive
    FROM _equipe_share_resolve(p_token);

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'label',          (SELECT label FROM equipe_share_tokens WHERE token = p_token),
      'scope',          v_scope,
      'lot_id',         v_lot_id,
      'show_sensitive', v_show_sensitive
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
    -- Org propriétaire du projet (branding-only). Pattern aligné sur
    -- share_livrables_fetch (cf. MT-PRE-1.A). Table = `organisations`
    -- (orthographe FR). Champs filtrés : pas d'infos légales (siret etc.).
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
    -- Lots (pour les badges et le bandeau). On expose tous les lots du
    -- projet (avec ref_devis_id pour permettre côté front de mapper
    -- devis_id → lotId comme dans la techlist).
    'lots', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           l.id,
          'title',        l.title,
          'sort_order',   l.sort_order,
          -- Devis "de référence" du lot : la version acceptée la plus récente,
          -- sinon la version la plus haute. Pattern aligné sur pickRefDevis()
          -- côté front (cf. src/lib/lots.js).
          'ref_devis_id', (
            SELECT d.id
              FROM devis d
             WHERE d.lot_id = l.id
             ORDER BY (d.status = 'accepte') DESC, d.version_number DESC
             LIMIT 1
          )
        ) ORDER BY l.sort_order, l.created_at
      )
      FROM devis_lots l
      WHERE l.project_id = v_project_id
        AND l.archived = false
    ), '[]'::jsonb),
    -- Membres : projet_membres principales (parent_membre_id IS NULL),
    -- enrichies des champs persona-level + contact (filtré).
    -- Filtrage par scope :
    --   scope='all' → toutes les rows
    --   scope='lot' → uniquement les rows dont devis_line.devis_id correspond
    --                 au devis de référence du lot ; les ad-hoc sont masquées
    --                 (Option A strict).
    'membres', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                m.id,
          'category',          m.category,
          'sort_order',        m.sort_order,
          'specialite',        m.specialite,
          'regime',            m.regime,
          'movinmotion_statut',m.movinmotion_statut,
          -- Persona-level
          'secteur',           m.secteur,
          'hebergement',       m.hebergement,
          'chauffeur',         m.chauffeur,
          'presence_days',     m.presence_days,
          'couleur',           m.couleur,
          'arrival_date',      m.arrival_date,
          'arrival_time',      m.arrival_time,
          'departure_date',    m.departure_date,
          'departure_time',    m.departure_time,
          'logistique_notes',  m.logistique_notes,
          -- Identité
          'prenom',            m.prenom,
          'nom',               m.nom,
          -- Coordonnées : exposées seulement si show_sensitive
          'email',             CASE WHEN v_show_sensitive THEN m.email ELSE NULL END,
          'telephone',         CASE WHEN v_show_sensitive THEN m.telephone ELSE NULL END,
          -- Devis line (pour résoudre lot inline + poste affiché)
          'devis_line_id',     m.devis_line_id,
          'devis_line', CASE
            WHEN m.devis_line_id IS NOT NULL THEN (
              SELECT jsonb_build_object(
                'id',       dl.id,
                'devis_id', dl.devis_id,
                'produit',  dl.produit,
                'regime',   dl.regime
              )
              FROM devis_lines dl WHERE dl.id = m.devis_line_id
            )
            ELSE NULL
          END,
          -- Contact (annuaire) : régime alimentaire / taille T-shirt utiles
          -- au régisseur ; spécialité fallback. Coordonnées si autorisé.
          'contact', CASE
            WHEN m.contact_id IS NOT NULL THEN (
              SELECT jsonb_build_object(
                'id',                c.id,
                'specialite',        c.specialite,
                'regime_alimentaire',c.regime_alimentaire,
                'taille_tshirt',     c.taille_tshirt,
                'email',     CASE WHEN v_show_sensitive THEN c.email ELSE NULL END,
                'telephone', CASE WHEN v_show_sensitive THEN c.telephone ELSE NULL END,
                'ville',     CASE WHEN v_show_sensitive THEN c.ville     ELSE NULL END
              )
              FROM contacts c WHERE c.id = m.contact_id
            )
            ELSE NULL
          END
        ) ORDER BY
          (m.category IS NOT NULL) ASC, -- À trier (NULL) en premier
          m.category NULLS FIRST,
          m.sort_order,
          m.created_at
      )
      FROM projet_membres m
      WHERE m.project_id = v_project_id
        AND m.parent_membre_id IS NULL
        AND (
          v_scope = 'all'
          OR (
            v_scope = 'lot'
            AND m.devis_line_id IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM devis_lines dl
                JOIN devis d ON d.id = dl.devis_id
               WHERE dl.id = m.devis_line_id
                 AND d.lot_id = v_lot_id
            )
          )
        )
    ), '[]'::jsonb),
    'generated_at', now()
  )
  INTO v_result;

  -- Bump compteur de vues (best effort).
  UPDATE equipe_share_tokens
     SET last_accessed_at = now(),
         view_count       = view_count + 1
   WHERE token = p_token;

  RETURN v_result;
END;
$share_equipe_fetch$;

REVOKE ALL ON FUNCTION share_equipe_fetch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_equipe_fetch(text) TO anon, authenticated;


-- ── 5. RPC admin — révocation soft d'un token ───────────────────────────────
CREATE OR REPLACE FUNCTION revoke_equipe_share_token(p_token_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $revoke_equipe_share_token$
BEGIN
  UPDATE equipe_share_tokens
     SET revoked_at = COALESCE(revoked_at, now())
   WHERE id = p_token_id;
END;
$revoke_equipe_share_token$;


-- ── 6. Reload PostgREST pour exposer les nouvelles RPC ──────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Notes post-migration
-- ============================================================================
-- 1. La page publique sera à l'URL /share/equipe/:token (P4.2D), cohérent
--    avec /share/livrables/:token (LIV-24C), /check/:token (MAT-10) et
--    /rendu/:token (MAT-13).
--
-- 2. Champs financiers volontairement EXCLUS de la RPC publique :
--      - budget_convenu, cout_estime, tarif_jour
--      - vente / coût des devis_lines
--    Le partage techlist est strictement opérationnel (logistique + coords),
--    pas commercial.
--
-- 3. Filtrage scope='lot' : strict (ad-hoc masquées). C'est ce qui est cohérent
--    avec le LotFilter Option A côté front (P3).
--
-- 4. show_sensitive=true par défaut (Hugo). Si on veut un mode "anonymisé"
--    plus tard, basculer le default à false et exposer un toggle dans la
--    modale de création.
-- ============================================================================
