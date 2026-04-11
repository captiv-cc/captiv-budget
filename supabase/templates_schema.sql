-- ─────────────────────────────────────────────────────────────────────────────
-- TEMPLATES DE DEVIS — CAPTIV BUDGET
-- À exécuter dans Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS devis_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organisations(id) ON DELETE CASCADE,
  name        text NOT NULL,               -- ex: "LIVE JDR", "Film institutionnel"
  description text,                        -- description courte du template
  type_projet text,                        -- type associé (optionnel)
  is_default  boolean DEFAULT false,       -- template proposé par défaut
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS template_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES devis_templates(id) ON DELETE CASCADE NOT NULL,
  name        text NOT NULL,
  sort_order  int DEFAULT 0
);

CREATE TABLE IF NOT EXISTS template_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid REFERENCES devis_templates(id) ON DELETE CASCADE NOT NULL,
  category_id  uuid REFERENCES template_categories(id) ON DELETE CASCADE NOT NULL,
  ref          text,
  produit      text,
  description  text,
  regime       text    DEFAULT 'Prestation facturée',
  use_line     boolean DEFAULT true,
  interne      boolean DEFAULT false,
  cout_egal_vente boolean DEFAULT false,
  dans_marge   boolean DEFAULT true,
  quantite     numeric DEFAULT 1,
  unite        text    DEFAULT 'F',
  tarif_ht     numeric DEFAULT 0,
  cout_ht      numeric DEFAULT 0,
  remise_pct   numeric DEFAULT 0,
  sort_order   int     DEFAULT 0
);

-- ── 2. Colonne template_id dans devis (traçabilité de l'origine) ───────────────
ALTER TABLE devis ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES devis_templates(id) ON DELETE SET NULL;

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE devis_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_lines     ENABLE ROW LEVEL SECURITY;

-- Membres de l'org peuvent tout faire sur leurs templates
CREATE POLICY "org_templates" ON devis_templates
  USING  (org_id = get_user_org_id())
  WITH CHECK (org_id = get_user_org_id());

CREATE POLICY "org_template_categories" ON template_categories
  USING (template_id IN (
    SELECT id FROM devis_templates WHERE org_id = get_user_org_id()
  ));

CREATE POLICY "org_template_lines" ON template_lines
  USING (template_id IN (
    SELECT id FROM devis_templates WHERE org_id = get_user_org_id()
  ));

-- ── 4. Exemple : template "LIVE JDR" ─────────────────────────────────────────
-- (À adapter avec ton org_id réel)
-- INSERT INTO devis_templates (org_id, name, description, type_projet, is_default)
-- VALUES ('<TON_ORG_ID>', 'LIVE JDR', 'Configuration standard pour les lives Jeu de Rôle', 'Captation événement', false);
--
-- Puis récupérer l'id et insérer les template_categories et template_lines.
-- Voir la section TEMPLATES dans l'interface quand elle sera disponible.
