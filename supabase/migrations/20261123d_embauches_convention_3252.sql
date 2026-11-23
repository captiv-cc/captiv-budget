-- ════════════════════════════════════════════════════════════════════════════
-- EMBAUCHES — la 3252 entre dans le module
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hugo embauche sous deux conventions. Elles n'ont ni les mêmes postes, ni
-- les mêmes salaires, ni les mêmes majorations. Deux changements :
--
--   1. `minimas_etsce` : la grille de la 3252 (IDCC 2717, brochure 3252,
--      « Entreprises techniques au service de la création et de
--      l'événement »), filière audiovisuelle, telle que publiée dans
--      « Grilles de fonctions et salaires - Filière AV 2024 ETSCE ».
--      105 fonctions, avec leur classification, leur catégorie d'emploi,
--      leur salaire mensuel minimum (35 h) et leur taux horaire CDDU.
--
--      Table à part plutôt qu'une colonne sur `minimas_convention` : la
--      grille CCNTA est indexée par type d'œuvre (fiction / flux), celle-ci
--      par filière et classification, et le devis lit déjà la première sans
--      filtre de convention. Les mélanger polluerait sa recherche de postes.
--
--      Le taux horaire CDDU est celui du document (millésimé 2023 dans la
--      source, les salaires mensuels 2024) : c'est le plancher opposable
--      pour un intermittent, donc celui que l'outil compare.
--
--   2. `embauche_params` passe à une ligne PAR CONVENTION : majorations de
--      dimanche, de férié, de nuit, seuil d'heures supplémentaires et plage
--      de nuit diffèrent d'une convention à l'autre. Les valeurs de la 2642
--      restent celles de la ligne existante ; celles de la 3252 sont à
--      renseigner depuis l'écran de réglages (tant qu'aucune ligne n'existe,
--      le calcul applique les valeurs par défaut et l'interface le signale).
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Grille des minima ETSCE / 3252 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS minimas_etsce (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  poste   text NOT NULL,
  filiere text,
  section text,

  -- « Classification AV » du document : 1 à 9, ou HC (hors catégorie).
  classification text,

  -- Un emploi peut relever de la catégorie A, de la B, ou des deux.
  categorie_a boolean NOT NULL DEFAULT false,
  categorie_b boolean NOT NULL DEFAULT false,
  -- Mentions portées dans la colonne catégorie B (« Hors labo »,
  -- « Cf. accords Doublage »).
  note_categorie text,

  salaire_mensuel_35h NUMERIC(10,2),
  -- Plancher du CDDU : c'est lui qui sert aux embauches d'intermittents.
  taux_horaire_cddu   NUMERIC(10,2),

  source text NOT NULL DEFAULT 'Grilles de fonctions et salaires - Filière AV 2024 ETSCE'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_minimas_etsce_poste ON minimas_etsce (poste);
CREATE INDEX IF NOT EXISTS idx_minimas_etsce_filiere ON minimas_etsce (filiere);

COMMENT ON TABLE minimas_etsce IS
  'Grille de fonctions et salaires de la CCN 3252 (ETSCE), filière audiovisuelle. Donnée de référence publique, identique pour toutes les organisations.';

-- Donnée de référence (catégorie C) : lecture ouverte aux comptes connectés,
-- écriture par migration seulement.
ALTER TABLE minimas_etsce ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS minimas_etsce_read ON minimas_etsce;
CREATE POLICY minimas_etsce_read ON minimas_etsce
  FOR SELECT TO authenticated USING (true);

INSERT INTO minimas_etsce
  (poste, filiere, section, classification, categorie_a, categorie_b, note_categorie,
   salaire_mensuel_35h, taux_horaire_cddu)
VALUES
  ('Assistant de tournage', 'Réalisation', 'Image', '2', true, true, NULL, 1851, 15.47),
  ('Cadreur AV', 'Réalisation', 'Image', '6', true, true, NULL, 2535, 23.56),
  ('Opérateur de prises de vues', 'Réalisation', 'Image', '7', true, true, NULL, 2712, 26.8),
  ('Chef opérateur prises de vues AV', 'Réalisation', 'Image', '9', true, true, NULL, 3163, 47.46),
  ('Assistant son', 'Réalisation', 'Son', '2', true, true, NULL, 1851, 16.78),
  ('Opérateur du son', 'Réalisation', 'Son', '3', true, true, NULL, 2007, 23.79),
  ('Chef opérateur du son', 'Réalisation', 'Son', '6', true, true, NULL, 2535, 29.8),
  ('Ingénieur du son', 'Réalisation', 'Son', '7', true, true, NULL, 2712, 34.1),
  ('Créateur d’effets sonores', 'Réalisation', 'Son', '3', true, true, NULL, 2007, 18),
  ('Technicien rénovation son', 'Réalisation', 'Son', '3', true, false, NULL, 2007, NULL),
  ('Assistant de plateau AV', 'Réalisation', 'Plateaux', '2', true, true, NULL, 1851, 14.85),
  ('Accrocheur- Riggers', 'Réalisation', 'Plateaux', '4', true, true, NULL, 2222, 23.57),
  ('Machiniste AV', 'Réalisation', 'Plateaux', '2', true, true, NULL, 1851, 18.05),
  ('Chef Machiniste AV', 'Réalisation', 'Plateaux', '6', true, true, NULL, 2535, 21.73),
  ('Electricien AV', 'Réalisation', 'Plateaux', '2', true, true, NULL, 1851, 18.05),
  ('Electricien pupitreur', 'Réalisation', 'Plateaux', '4', true, true, NULL, 2222, 21.94),
  ('Poursuiteur', 'Réalisation', 'Plateaux', '2', true, true, NULL, 1851, 18.05),
  ('Groupiste Flux AV', 'Réalisation', 'Plateaux', '4', true, true, NULL, 2222, 29.01),
  ('Chef électricien AV', 'Réalisation', 'Plateaux', '6', true, true, NULL, 2535, 21.73),
  ('Chef d’atelier lumière', 'Réalisation', 'Plateaux', '6', true, false, NULL, 2535, NULL),
  ('Chef de plateau AV', 'Réalisation', 'Plateaux', '7', true, true, NULL, 2712, 22.09),
  ('Coiffeur', 'Réalisation', 'Plateaux', '4', true, true, NULL, 2222, 18.8),
  ('Maquilleur', 'Réalisation', 'Plateaux', '4', true, true, NULL, 2222, 18.8),
  ('Chef maquilleur', 'Réalisation', 'Plateaux', '6', true, true, NULL, 2535, 21.1),
  ('Habilleur', 'Réalisation', 'Plateaux', '4', true, true, NULL, 2222, 18.8),
  ('Directeur casting', 'Réalisation', 'Réalisation', '6', true, true, NULL, 2535, 22.53),
  ('1er Assistant de réalisation AV', 'Réalisation', 'Réalisation', '6', true, true, NULL, 2535, 24.8),
  ('Scripte AV', 'Réalisation', 'Réalisation', '7', true, true, NULL, 2712, 25.55),
  ('Réalisateur AV', 'Réalisation', 'Réalisation', 'HC', true, true, NULL, NULL, 47.46),
  ('Agent de maintenance', 'Réalisation', 'Exploitation, régie & maintenance', '2', true, false, NULL, 1851, NULL),
  ('Technicien de maintenance', 'Réalisation', 'Exploitation, régie & maintenance', '4', true, false, NULL, 2222, NULL),
  ('Chef de maintenance', 'Réalisation', 'Exploitation, régie & maintenance', '6', true, false, NULL, 2535, NULL),
  ('Responsable de maintenance', 'Réalisation', 'Exploitation, régie & maintenance', '8', true, false, NULL, 2879, NULL),
  ('Opérateur synthétiseur', 'Réalisation', 'Exploitation, régie & maintenance', '2', true, true, NULL, 1851, 19.35),
  ('Infographiste AV', 'Réalisation', 'Exploitation, régie & maintenance', '3', true, true, NULL, 2007, 22.76),
  ('Infographiste supérieur AV', 'Réalisation', 'Exploitation, régie & maintenance', '5', true, true, NULL, 2420, 23.56),
  ('Chef graphiste AV', 'Réalisation', 'Exploitation, régie & maintenance', '8', true, false, NULL, 2937, NULL),
  ('Truquiste AV', 'Réalisation', 'Exploitation, régie & maintenance', '8', true, true, NULL, 2937, 32.9),
  ('Opérateur « ralenti »', 'Réalisation', 'Exploitation, régie & maintenance', '3', true, true, NULL, 2007, 21.31),
  ('Technicien supérieur serveur video', 'Réalisation', 'Exploitation, régie & maintenance', '5', true, true, NULL, 2420, 33.55),
  ('Assistant d''exploitation AV et/ou numérique', 'Réalisation', 'Exploitation, régie & maintenance', '2', true, true, NULL, 1851, 14.18),
  ('Technicien d’exploitation AV et/ou numérique', 'Réalisation', 'Exploitation, régie & maintenance', '3', true, true, NULL, 2007, 21.31),
  ('Technicien supérieur d’exploitation AV et/ou numérique', 'Réalisation', 'Exploitation, régie & maintenance', '4', true, false, NULL, 2222, NULL),
  ('Chargé d’exploitation AV et/ou numérique', 'Réalisation', 'Exploitation, régie & maintenance', '6', true, false, NULL, 2535, NULL),
  ('Ingénieur de la vision', 'Réalisation', 'Exploitation, régie & maintenance', '7', true, true, NULL, 2712, 31.67),
  ('Chef d''équipement AV', 'Réalisation', 'Exploitation, régie & maintenance', '7', true, true, NULL, 2712, 34.1),
  ('Conducteur de moyens mobiles', 'Réalisation', 'Exploitation, régie & maintenance', '3', true, true, NULL, 2007, 15.26),
  ('Coordinateur d’Antenne', 'Réalisation', 'Exploitation, régie & maintenance', '3', true, false, NULL, 2007, NULL),
  ('Technicien de régie finale', 'Réalisation', 'Exploitation, régie & maintenance', '3', true, false, NULL, 2007, NULL),
  ('Technicien supérieur de régie finale', 'Réalisation', 'Exploitation, régie & maintenance', '4', true, false, NULL, 2222, NULL),
  ('Chef d''antenne', 'Réalisation', 'Exploitation, régie & maintenance', '8', true, false, NULL, 2937, NULL),
  ('Technicien image numérique (DIT)', 'Réalisation', 'Exploitation, régie & maintenance', '6', true, true, NULL, 2535, 24.8),
  ('Opérateur de sauvegarde de données (Data Wrangler)', 'Réalisation', 'Exploitation, régie & maintenance', '3', true, true, NULL, 2007, 17.53),
  ('Data Manager', 'Réalisation', 'Exploitation, régie & maintenance', '3', true, true, NULL, 2007, 18),
  ('Assistant de production AV', 'Réalisation', 'Gestion de production', '2', true, true, NULL, 1851, 17.42),
  ('Chargé de production AV', 'Réalisation', 'Gestion de production', '6', true, true, NULL, 2535, 26.07),
  ('Directeur de production AV', 'Réalisation', 'Gestion de production', '8', true, true, NULL, 2937, 32.61),
  ('Administrateur de production', 'Réalisation', 'Gestion de production', '7', true, false, NULL, 2712, NULL),
  ('Régisseur', 'Réalisation', 'Gestion de production', '6', true, true, NULL, 2535, 21.1),
  ('Aide décors', 'Réalisation', 'Décoration & accessoires', '1', true, true, NULL, 1801, 14.49),
  ('Machiniste décors', 'Réalisation', 'Décoration & accessoires', '2', true, true, NULL, 1851, 17.9),
  ('Serrurier métallier', 'Réalisation', 'Décoration & accessoires', '3', true, true, NULL, 2007, 19.65),
  ('Peintre', 'Réalisation', 'Décoration & accessoires', '2', true, true, NULL, 1851, 17.9),
  ('Menuisier décors', 'Réalisation', 'Décoration & accessoires', '3', true, true, NULL, 2007, 17.39),
  ('Chef constructeur décors', 'Réalisation', 'Décoration & accessoires', '6', true, true, NULL, 2535, 22.45),
  ('1er Assistant décors', 'Réalisation', 'Décoration & accessoires', '5', true, true, NULL, 2420, 22.45),
  ('Chef décorateur', 'Réalisation', 'Décoration & accessoires', '7', true, true, NULL, 2712, 33.04),
  ('Chef d’atelier décors', 'Réalisation', 'Décoration & accessoires', '8', true, false, NULL, 2937, NULL),
  ('Accessoiriste', 'Réalisation', 'Décoration & accessoires', '2', true, true, NULL, 1851, 17.87),
  ('Technicien authoring', 'Post-production, doublage & sous-titrage', NULL, '4', true, false, NULL, 2222, NULL),
  ('Opérateur de PAD / bandes antenne', 'Post-production, doublage & sous-titrage', NULL, '4', true, false, NULL, 2222, NULL),
  ('Opérateur Imageur', 'Post-production, doublage & sous-titrage', NULL, '3', true, false, NULL, 2007, NULL),
  ('Opérateur en restauration numérique', 'Post-production, doublage & sous-titrage', NULL, '3', true, false, NULL, 2007, NULL),
  ('Technicien restauration numérique', 'Post-production, doublage & sous-titrage', NULL, '4', true, false, NULL, 2222, NULL),
  ('Releveur de dialogue', 'Post-production, doublage & sous-titrage', NULL, '2', true, true, NULL, 1851, 15.71),
  ('Repéreur', 'Post-production, doublage & sous-titrage', NULL, '2', true, false, NULL, 1851, NULL),
  ('Détecteur', 'Post-production, doublage & sous-titrage', NULL, '3', true, true, NULL, 2007, 17.11),
  ('Traducteur-adaptateur', 'Post-production, doublage & sous-titrage', NULL, '4', true, false, NULL, 2222, NULL),
  ('Traducteur', 'Post-production, doublage & sous-titrage', NULL, '3', true, false, NULL, 2007, NULL),
  ('Adaptateur', 'Post-production, doublage & sous-titrage', NULL, '3', true, false, NULL, 2007, NULL),
  ('Sous-titreur SME', 'Post-production, doublage & sous-titrage', NULL, '4', true, true, NULL, 2222, 18.8),
  ('Opérateur de repérage / simulation', 'Post-production, doublage & sous-titrage', NULL, '3', true, true, NULL, 2007, 15.87),
  ('Audio-descripteur', 'Post-production, doublage & sous-titrage', NULL, '3', true, true, NULL, 2007, 15.87),
  ('Directeur artistique', 'Post-production, doublage & sous-titrage', NULL, '8', true, true, 'Cf. accords Doublage', 2937, NULL),
  ('Monteur Synchro', 'Post-production, doublage & sous-titrage', NULL, '6', true, true, NULL, 2535, 29.77),
  ('Responsable artistique', 'Post-production, doublage & sous-titrage', NULL, '8', true, false, NULL, 2937, NULL),
  ('Chargé artistique', 'Post-production, doublage & sous-titrage', NULL, '5', true, false, NULL, 2420, NULL),
  ('Assistant artistique', 'Post-production, doublage & sous-titrage', NULL, '2', true, false, NULL, 1851, NULL),
  ('Coordinateur linguistique', 'Post-production, doublage & sous-titrage', NULL, '6', true, false, NULL, 2535, NULL),
  ('Chargé de coordination linguistique', 'Post-production, doublage & sous-titrage', NULL, '5', true, false, NULL, 2420, NULL),
  ('Assistant coordinateur linguistique', 'Post-production, doublage & sous-titrage', NULL, '3', true, false, NULL, 2007, NULL),
  ('Assistant monteur AV', 'Post-production, doublage & sous-titrage', 'Montage', '2', true, true, NULL, 1851, 15.46),
  ('Monteur AV', 'Post-production, doublage & sous-titrage', 'Montage', '4', true, true, NULL, 2222, 22.76),
  ('Chef Monteur AV', 'Post-production, doublage & sous-titrage', 'Montage', '7', true, true, NULL, 2712, 30.44),
  ('Monteur truquiste AV', 'Post-production, doublage & sous-titrage', 'Montage', '8', true, true, NULL, 2937, 34.1),
  ('Opérateur scanner', 'Post-production, doublage & sous-titrage', 'Montage', '3', true, true, 'Hors labo', 2007, 18.8),
  ('Assistant étalonneur', 'Post-production, doublage & sous-titrage', 'Montage', '2', true, true, 'Hors labo', 1851, 15.46),
  ('Etalonneur', 'Post-production, doublage & sous-titrage', 'Montage', '5', true, true, 'Hors labo', 2420, 31.02),
  ('Chef Opérateur-étalonneur', 'Post-production, doublage & sous-titrage', 'Montage', '8', true, true, 'Hors labo', 2937, 32.45),
  ('Bruiteur de complément', 'Post-production, doublage & sous-titrage', 'Montage', '4', true, true, NULL, 2222, 19.85),
  ('Assistant de post production', 'Post-production, doublage & sous-titrage', 'Montage', '2', true, true, NULL, 1851, 17.42),
  ('Chargé de post production', 'Post-production, doublage & sous-titrage', 'Montage', '6', true, true, NULL, 2535, 26.07),
  ('Directeur de Post-production', 'Post-production, doublage & sous-titrage', 'Montage', '8', true, true, NULL, 2937, 30.44),
  ('Gestionnaire des calculs des rendus d’images de synthèse', 'Animation & effets visuels numériques', NULL, '2', true, false, NULL, 1851, NULL),
  ('Superviseur des effets spéciaux', 'Animation & effets visuels numériques', NULL, '7', true, false, NULL, 2712, NULL)
ON CONFLICT (poste) DO UPDATE SET
  filiere             = EXCLUDED.filiere,
  section             = EXCLUDED.section,
  classification      = EXCLUDED.classification,
  categorie_a         = EXCLUDED.categorie_a,
  categorie_b         = EXCLUDED.categorie_b,
  note_categorie      = EXCLUDED.note_categorie,
  salaire_mensuel_35h = EXCLUDED.salaire_mensuel_35h,
  taux_horaire_cddu   = EXCLUDED.taux_horaire_cddu,
  source              = EXCLUDED.source;

-- L'upsert ci-dessus rejoue sans dupliquer : un avenant de salaires se pose
-- en remplaçant les VALUES dans une nouvelle migration.

-- ── 2. Paramètres de majoration par convention ──────────────────────────────
ALTER TABLE embauche_params
  ADD COLUMN IF NOT EXISTS convention text NOT NULL DEFAULT '2642';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'embauche_params'::regclass
      AND contype  = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (org_id)'
  ) THEN
    EXECUTE 'ALTER TABLE embauche_params DROP CONSTRAINT embauche_params_pkey';
    EXECUTE 'ALTER TABLE embauche_params ADD PRIMARY KEY (org_id, convention)';
  END IF;
END $$;

COMMENT ON COLUMN embauche_params.convention IS
  'Convention collective par IDCC (2642, 3252). Une ligne par convention : les majorations et le seuil d''heures supplémentaires ne sont pas les mêmes.';

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS
-- ============================================================================
-- 1. SELECT count(*) FROM minimas_etsce;  → 105
-- 2. SELECT poste, taux_horaire_cddu FROM minimas_etsce WHERE poste = 'Cadreur AV';
--    → 23,56
-- 3. \d embauche_params : la clé primaire porte sur (org_id, convention).
-- 4. Les lignes de paramètres déjà créées sont rattachées à la 2642.
-- ============================================================================
