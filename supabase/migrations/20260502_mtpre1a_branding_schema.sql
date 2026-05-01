-- =====================================================================
-- MT-PRE-1.A — Branding dynamique : enrichissement du schéma
-- =====================================================================
--
-- Cette migration prépare le terrain pour le branding dynamique
-- multi-org sans toucher au code applicatif. Elle :
--
--   1. Renomme `organisations.name` en `legal_name` (raison sociale).
--   2. Ajoute 13 nouveaux champs à `organisations` (display_name,
--      tagline, infos légales, logos clair/sombre, signature,
--      couleur, visibilité PDF, message page partage, website).
--   3. Supprime `organisations.logo_url` au profit de
--      `logo_url_clair` + `logo_url_sombre`.
--   4. Crée une nouvelle table `app_settings` (catégorie C — globale)
--      pour les paramètres du produit lui-même (paramétrable en vue
--      d'un rebrand futur "CAPTIV DESK" → autre nom).
--   5. Backfill toutes les valeurs Captiv actuelles, pour que rien
--      ne change visuellement après application.
--
-- Idempotent : safe à rejouer.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. RENOMMAGE name → legal_name + ajout nouveaux champs sur organisations
-- =====================================================================

-- 1.1 — Renommage `name` → `legal_name` (sécurisé : on garde la valeur,
-- on ne fait que changer le nom de la colonne).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organisations'
      AND column_name = 'name'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE organisations RENAME COLUMN name TO legal_name;
  END IF;
END $$;

-- 1.2 — Ajout des 13 nouveaux champs

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS display_name        TEXT,
  ADD COLUMN IF NOT EXISTS tagline             TEXT,
  ADD COLUMN IF NOT EXISTS forme_juridique     TEXT,
  ADD COLUMN IF NOT EXISTS capital_social      TEXT,
  ADD COLUMN IF NOT EXISTS code_ape            TEXT,
  ADD COLUMN IF NOT EXISTS ville_rcs           TEXT,
  ADD COLUMN IF NOT EXISTS website_url         TEXT,
  ADD COLUMN IF NOT EXISTS logo_url_clair      TEXT,
  ADD COLUMN IF NOT EXISTS logo_url_sombre     TEXT,
  ADD COLUMN IF NOT EXISTS signature_url       TEXT,
  ADD COLUMN IF NOT EXISTS brand_color         TEXT DEFAULT '#3b82f6',
  ADD COLUMN IF NOT EXISTS pdf_field_visibility JSONB DEFAULT
    '{"legal_name":true,"forme_juridique":true,"capital_social":true,"siret":true,"code_ape":true,"tva_number":true,"ville_rcs":true,"siren":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS share_intro_text    TEXT;

COMMENT ON COLUMN organisations.display_name IS
  'MT-PRE-1.A : Nom commercial court affiché dans l''UI et les PDFs (≠ raison sociale légale).';
COMMENT ON COLUMN organisations.legal_name IS
  'MT-PRE-1.A : Raison sociale légale complète (ex: CAPTIV SARL OMNI Films). Anciennement organisations.name.';
COMMENT ON COLUMN organisations.tagline IS
  'MT-PRE-1.A : Slogan court (ex: Production audiovisuelle). Affiché en footer PDF et page partage client.';
COMMENT ON COLUMN organisations.pdf_field_visibility IS
  'MT-PRE-1.A : JSON des toggles visibilité de chaque champ légal dans le footer PDF. Clés : legal_name, forme_juridique, capital_social, siret, code_ape, tva_number, ville_rcs, siren.';
COMMENT ON COLUMN organisations.brand_color IS
  'MT-PRE-1.A : Couleur de marque hex (ex: #3b82f6) utilisée comme accent UI et headers PDF.';
COMMENT ON COLUMN organisations.logo_url_clair IS
  'MT-PRE-1.A : URL du logo destiné aux fonds clairs (UI lightmode, PDFs blancs).';
COMMENT ON COLUMN organisations.logo_url_sombre IS
  'MT-PRE-1.A : URL du logo destiné aux fonds sombres (UI darkmode, hero immersif).';

-- 1.3 — Backfill pour Captiv (l'unique org actuelle)
-- Valeurs reprises du formulaire actuel + screenshots Hugo.

UPDATE organisations
SET
  display_name        = COALESCE(display_name, 'Captiv'),
  tagline             = COALESCE(tagline, 'Production audiovisuelle'),
  forme_juridique     = COALESCE(forme_juridique, 'SARL'),
  capital_social      = COALESCE(capital_social, '800 €'),
  code_ape            = COALESCE(code_ape, '5911A'),
  ville_rcs           = COALESCE(ville_rcs, 'Montpellier'),
  website_url         = COALESCE(website_url, 'https://captiv.cc')
WHERE legal_name ILIKE '%CAPTIV%' OR legal_name ILIKE '%omni films%';

-- 1.4 — Migration logo_url existant vers logo_url_clair (best-effort)
-- Si une org avait un logo_url, on le bascule vers logo_url_clair par
-- défaut (le logo actuel est typiquement utilisé sur fond clair).

UPDATE organisations
SET logo_url_clair = logo_url
WHERE logo_url IS NOT NULL
  AND logo_url_clair IS NULL;

-- 1.5 — Suppression de l'ancienne colonne logo_url
ALTER TABLE organisations DROP COLUMN IF EXISTS logo_url;

-- =====================================================================
-- 2. NOUVELLE TABLE app_settings (catégorie C — globale, partagée)
-- =====================================================================
--
-- Une seule ligne, gérée hors-app par toi (ETL / SQL admin). Stocke
-- les paramètres du produit lui-même, indépendants des organisations.
-- Pattern catégorie C de MT_RULES.md : RLS open en SELECT, pas de
-- WRITE policy (édition réservée au super_admin futur, ou en SQL).

CREATE TABLE IF NOT EXISTS app_settings (
  -- Singleton : on contraint à une seule ligne via key = 'global'
  key         TEXT PRIMARY KEY DEFAULT 'global'
              CHECK (key = 'global'),

  -- Identité produit (paramétrable pour anticiper un rebrand)
  product_name           TEXT NOT NULL,
  product_tagline        TEXT,
  product_url            TEXT,
  product_support_email  TEXT,

  -- Métadonnées
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE app_settings IS
  'MT-PRE-1.A : Paramètres globaux du produit (catégorie C — globale). Une seule ligne forcée par CHECK. Permet de rebrand le SaaS sans modifier le code.';

-- 2.1 — Seed des valeurs Captiv actuelles
INSERT INTO app_settings (key, product_name, product_tagline, product_url, product_support_email)
VALUES (
  'global',
  'CAPTIV DESK',
  'La gestion de projets simplifiée',
  'https://desk.captiv.cc',
  'contact@captiv.cc'
)
ON CONFLICT (key) DO NOTHING;

-- 2.2 — RLS pour app_settings
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Lecture libre (donnée d'affichage produit)
DROP POLICY IF EXISTS "app_settings_read" ON app_settings;
CREATE POLICY "app_settings_read" ON app_settings
  FOR SELECT
  USING (true);

-- Écriture : aucune via l'app pour l'instant.
-- Édition manuelle via SQL Editor en attendant la console super_admin
-- (Phase 1). À ce moment-là, on ajoutera une policy
-- USING (is_super_admin()).

-- =====================================================================
-- 3. WHITELIST DE L'AUDIT STATIQUE
-- =====================================================================
-- app_settings est une table catégorie C avec une policy "using true"
-- volontaire. Il faut l'ajouter à la whitelist du script
-- supabase/mt0_4_static_audit.sql §6 BILAN pour que le verdict global
-- reste PASS. Cette mise à jour est faite dans le fichier source
-- (commit séparé) pour ne pas mélanger DB et code de monitoring.

COMMIT;

-- =====================================================================
-- VÉRIFICATIONS POST-MIGRATION (à lancer dans le SQL Editor)
-- =====================================================================
-- 1. Les nouveaux champs sont présents :
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name='organisations'
--      AND column_name IN ('display_name','legal_name','tagline','forme_juridique',
--                          'capital_social','code_ape','ville_rcs','website_url',
--                          'logo_url_clair','logo_url_sombre','signature_url',
--                          'brand_color','pdf_field_visibility','share_intro_text');
--    -- Doit renvoyer 14 lignes
--
-- 2. L'ancienne colonne `name` a disparu, `logo_url` aussi :
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name='organisations'
--      AND column_name IN ('name','logo_url');
--    -- Doit renvoyer 0 ligne
--
-- 3. Captiv a bien été backfillée :
--    SELECT display_name, legal_name, tagline, forme_juridique,
--           capital_social, code_ape, ville_rcs, website_url, brand_color
--    FROM organisations LIMIT 5;
--    -- Doit afficher Captiv / CAPTIV SARL OMNI Films / SARL / 800 € / etc.
--
-- 4. La table app_settings existe avec la ligne unique :
--    SELECT * FROM app_settings;
--    -- 1 ligne : product_name='CAPTIV DESK', tagline='La gestion de projets simplifiée'
--
-- 5. Le verdict de mt0_4_static_audit.sql §6 BILAN reste PASS
--    (après mise à jour de la whitelist en commit séparé).
--
-- =====================================================================
