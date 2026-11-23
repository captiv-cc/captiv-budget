-- ════════════════════════════════════════════════════════════════════════════
-- EMBAUCHES V1 — suivi des contrats d'intermittence (portage + interne)
-- Date      : 2026-11-23
-- Cadrage   : docs/CHANTIER_EMBAUCHES.md (arbitrages Hugo du 23/11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Remplace l'Excel « SUIVI INTERMITTENCE ». Prépare la saisie Movinmotion,
-- produit le récap client, et révèle la marge réelle de chaque contrat.
--
-- Décisions structurantes portées par ce schéma :
--
--   1. DEUX MODES PAR DOSSIER (`mode`), choisis à la création SANS défaut :
--        · portage      → facturé = (brut + majorations) × (1 + coef_vente)
--        · frais_reels  → facturé = coût réel, coef_vente forcé à 0
--      Le coefficient de 80 % de l'Excel est un TARIF DE VENTE, pas un taux
--      de charges : les relevés Movinmotion donnent 52 % à 65 % selon le
--      statut catégoriel. Confondre les deux masque la marge réelle.
--
--   2. LE COÛT RÉEL VIT DANS SA PROPRE TABLE (`embauche_couts`).
--      La RLS Postgres filtre des LIGNES, pas des COLONNES : isoler le coût
--      dans une table séparée est le seul moyen d'empêcher sa lecture côté
--      serveur. ⚠️ `can_read_outil` accorde un bypass aux rôles internes
--      (charge_prod, coordinateur) : sans cette séparation, ils verraient la
--      marge. La policy exige donc `is_admin()`, sauf en mode frais_reels où
--      le coût EST le montant facturé et n'a rien de confidentiel.
--
--   3. La marge n'est JAMAIS stockée : elle se calcule depuis ce que la base
--      a accepté de servir. Pas de ligne dans `embauche_couts` = pas de
--      marge affichée. Fail-safe par construction.
--
--   4. Défraiements sans marge (décision Hugo) : ils s'ajoutent après le
--      coefficient, à l'identique des deux côtés. Vérifié sur l'Excel :
--      (1080 + 25,35) × 1,8 + 54 + 25 = 2 068,63 €.
--
-- Périmètre : tables + RLS + catalogue + template métier. Les partages
-- (lien client, formulaire intermittent) arrivent en phase 3.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Catalogue d'outils ───────────────────────────────────────────────────
-- Clé unique `embauches` : elle ouvre l'onglet du PROJET. L'onglet global
-- (accueil Desk, tous dossiers) reste gardé par rôle admin côté route.
INSERT INTO outils_catalogue (key, label, description, icon, sort_order)
VALUES (
  'embauches',
  'Embauches',
  'Suivi des contrats d''intermittence : jours, heures, majorations, '
  'frais et récap client. Le coût réel et la marge restent réservés aux admins.',
  'FileSignature',
  94
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Paramètres par organisation ──────────────────────────────────────────
-- Les règles de majoration sont PARAMÉTRABLES, jamais codées en dur : elles
-- varient selon la convention et le poste, et je ne les invente pas.
-- Valeurs par défaut = celles de l'Excel d'Hugo.
CREATE TABLE IF NOT EXISTS embauche_params (
  org_id uuid PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,

  seuil_hs_hebdo NUMERIC(5,2)  NOT NULL DEFAULT 35,    -- heures / semaine
  maj_hs         NUMERIC(6,4)  NOT NULL DEFAULT 0.25,  -- +25 %
  maj_dimanche   NUMERIC(6,4)  NOT NULL DEFAULT 1.00,  -- +100 %
  maj_ferie      NUMERIC(6,4)  NOT NULL DEFAULT 1.00,  -- +100 %
  maj_nuit       NUMERIC(6,4)  NOT NULL DEFAULT 0.25,  -- +25 %

  -- Plage horaire considérée comme travail de nuit (mode horaires).
  nuit_debut TIME NOT NULL DEFAULT '22:00',
  nuit_fin   TIME NOT NULL DEFAULT '06:00',

  -- Estimation du coût employeur tant que Movinmotion n'a pas rendu son
  -- chiffre. 65 % = relevé sur un technicien cadre (cf. cadrage).
  taux_charges_estime NUMERIC(6,4) NOT NULL DEFAULT 0.65,

  coef_vente_defaut NUMERIC(6,4) NOT NULL DEFAULT 0.80,

  -- Frais de dossier Movinmotion : facturé 25 €, dû ~20 €. L'écart fait
  -- partie de la marge.
  frais_dossier_facture_defaut NUMERIC(10,2) NOT NULL DEFAULT 25,
  frais_dossier_cout_defaut    NUMERIC(10,2) NOT NULL DEFAULT 20,

  -- Fériés hors règle française standard (Alsace-Moselle, outre-mer).
  -- Les fériés nationaux sont CALCULÉS côté lib, pas saisis.
  feries_extra TEXT[] NOT NULL DEFAULT '{}'::text[],

  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE embauche_params IS
  'Règles de majoration et tarifs par défaut du module Embauches, par organisation.';

-- ── 3. Dossiers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS embauche_dossiers (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  nom text NOT NULL,

  -- Les deux liens sont OPTIONNELS : on porte pour des boîtes dont le
  -- projet n'existe pas dans le Desk. Un dossier sans client est un suivi
  -- interne (ni récap client, ni lien de partage).
  client_id  uuid REFERENCES clients(id)  ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,

  -- Pas de DEFAULT : le mode est un choix explicite à la création.
  mode text NOT NULL CHECK (mode IN ('portage', 'frais_reels')),

  coef_vente NUMERIC(6,4) NOT NULL DEFAULT 0.80 CHECK (coef_vente >= 0),

  -- Infos nécessaires à la création du projet Movinmotion.
  convention   text,
  type_projet  text,
  numero_objet text,
  resume       text,
  lieu         text,

  -- Facturation client (le module ne génère pas de facture : suivi seul).
  bon_commande text,

  statut text NOT NULL DEFAULT 'en_cours'
         CHECK (statut IN ('brouillon', 'en_cours', 'termine', 'archive')),

  date_debut date,
  date_fin   date,
  notes      text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,

  -- En frais réels, le coefficient n'a pas de sens : on facture le coût.
  CONSTRAINT embauche_dossiers_coef_mode
    CHECK (mode <> 'frais_reels' OR coef_vente = 0)
);

CREATE INDEX IF NOT EXISTS idx_embauche_dossiers_org
  ON embauche_dossiers(org_id, statut);
CREATE INDEX IF NOT EXISTS idx_embauche_dossiers_project
  ON embauche_dossiers(project_id) WHERE project_id IS NOT NULL;

COMMENT ON TABLE embauche_dossiers IS
  'Dossier de suivi d''embauches intermittentes. Autonome, avec lien optionnel vers un projet Desk.';
COMMENT ON COLUMN embauche_dossiers.mode IS
  'portage = coefficient de vente appliqué · frais_reels = facturation au coût réel (coef forcé à 0).';

-- ── 4. Embauches ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS embauches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES embauche_dossiers(id) ON DELETE CASCADE,

  -- Lien annuaire optionnel + snapshot : on embauche des gens qui ne sont
  -- pas (encore) dans la base crew, et le contrat doit garder l'identité
  -- telle qu'elle était au moment de la signature.
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  nom        text NOT NULL DEFAULT '',
  prenom     text,
  email      text,
  telephone  text,

  -- Vocabulaire Movinmotion, repris tel quel pour que le report soit direct.
  poste_france_travail text,
  libelle_poste        text,
  statut_categoriel    text,
  type_oeuvre text CHECK (type_oeuvre IS NULL
                          OR type_oeuvre IN ('fiction', 'flux', 'hors_fiction_flux')),

  taux       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (taux >= 0),
  unite_taux text NOT NULL DEFAULT 'jour_8h'
             CHECK (unite_taux IN ('jour_7h', 'jour_8h',
                                   'semaine_35h', 'semaine_39h', 'heure')),

  -- NULL = on suit le dossier. Renseigné = ce contrat sort de la règle.
  coef_vente NUMERIC(6,4) CHECK (coef_vente IS NULL OR coef_vente >= 0),

  -- Les 3 cases à cocher de l'Excel.
  infos_recues  boolean NOT NULL DEFAULT false,
  contrat_fait  boolean NOT NULL DEFAULT false,
  contrat_signe boolean NOT NULL DEFAULT false,

  -- NULL = valeur par défaut de l'org. Désactivable par ligne.
  frais_dossier_actif   boolean NOT NULL DEFAULT true,
  frais_dossier_facture NUMERIC(10,2),

  remarques  text,
  sort_order integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_embauches_dossier
  ON embauches(dossier_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_embauches_contact
  ON embauches(contact_id) WHERE contact_id IS NOT NULL;

COMMENT ON COLUMN embauches.coef_vente IS
  'Surcharge du coefficient du dossier. NULL = on suit le dossier.';

-- ── 5. Jours travaillés ─────────────────────────────────────────────────────
-- Le configurateur Movinmotion raisonne en heures par jour. On garde ça, et
-- on ajoute le mode horaires (9h → 19h) qui en déduit les heures et la part
-- de nuit. ⚠️ Les heures supplémentaires sont INCLUSES dans `heures`, comme
-- chez Movinmotion : les additionner ferait un double comptage.
CREATE TABLE IF NOT EXISTS embauche_jours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embauche_id uuid NOT NULL REFERENCES embauches(id) ON DELETE CASCADE,

  date_jour date          NOT NULL,
  heures    NUMERIC(6,2)  NOT NULL DEFAULT 8 CHECK (heures >= 0 AND heures <= 24),

  -- Mode horaires (optionnel). Renseignés, ils recalculent heures + nuit.
  heure_debut time,
  heure_fin   time,

  nature text NOT NULL DEFAULT 'normal'
         CHECK (nature IN ('normal', 'dimanche', 'ferie')),

  heures_nuit NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (heures_nuit >= 0),

  UNIQUE (embauche_id, date_jour)
);

CREATE INDEX IF NOT EXISTS idx_embauche_jours_embauche
  ON embauche_jours(embauche_id, date_jour);
CREATE INDEX IF NOT EXISTS idx_embauche_jours_date
  ON embauche_jours(date_jour);

-- ── 6. Heures majorées ──────────────────────────────────────────────────────
-- Deux familles, comme Movinmotion :
--   · 'sup'   : heures supplémentaires, ventilées PAR SEMAINE (125/150/175/200)
--   · 'autre' : autres heures majorées, hors dimanche et fériés (125/130/150/200)
CREATE TABLE IF NOT EXISTS embauche_majorations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embauche_id uuid NOT NULL REFERENCES embauches(id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN ('sup', 'autre')),

  -- Lundi de la semaine concernée. NULL pour les 'autre' (non ventilées).
  semaine date,

  taux   integer      NOT NULL CHECK (taux IN (125, 130, 150, 175, 200)),
  heures NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (heures >= 0),

  CONSTRAINT embauche_majorations_semaine_kind
    CHECK ((kind = 'sup' AND semaine IS NOT NULL)
        OR (kind = 'autre' AND semaine IS NULL))
);

-- UNIQUE avec NULL : COALESCE sinon deux lignes 'autre' identiques passent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_embauche_majorations_uniq
  ON embauche_majorations(embauche_id, kind,
                          COALESCE(semaine, DATE '1970-01-01'), taux);

-- ── 7. Frais professionnels ─────────────────────────────────────────────────
-- Refacturés à l'identique : AUCUNE marge sur les défraiements (décision
-- Hugo). Ils s'ajoutent après le coefficient, des deux côtés du calcul.
CREATE TABLE IF NOT EXISTS embauche_frais (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embauche_id uuid NOT NULL REFERENCES embauches(id) ON DELETE CASCADE,

  type text NOT NULL DEFAULT 'repas'
       CHECK (type IN ('repas', 'defraiement', 'ik',
                       'transport', 'prime', 'autre')),

  libelle text,
  montant NUMERIC(10,2) NOT NULL DEFAULT 0,
  nombre  NUMERIC(8,2)  NOT NULL DEFAULT 1 CHECK (nombre >= 0),

  -- Une prime soumise à cotisations entre dans l'assiette chargée, pas un
  -- défraiement. Change le calcul, d'où le drapeau.
  soumis_cotisations boolean NOT NULL DEFAULT false,

  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_embauche_frais_embauche
  ON embauche_frais(embauche_id, sort_order);

-- ── 8. Coût réel — TABLE CONFIDENTIELLE ─────────────────────────────────────
-- Séparée des `embauches` exprès : voir le point 2 de l'en-tête. Une table
-- distincte est le seul moyen de refuser la lecture CÔTÉ SERVEUR, puisque
-- la RLS ne sait pas filtrer des colonnes.
CREATE TABLE IF NOT EXISTS embauche_couts (
  embauche_id uuid PRIMARY KEY REFERENCES embauches(id) ON DELETE CASCADE,

  -- Coût employeur relevé sur Movinmotion. NULL = pas encore connu, le
  -- front retombe sur l'estimation `brut × (1 + taux_charges_estime)`.
  cout_reel_mm NUMERIC(12,2) CHECK (cout_reel_mm IS NULL OR cout_reel_mm >= 0),

  cout_reel_source text NOT NULL DEFAULT 'estime'
                   CHECK (cout_reel_source IN ('estime', 'movinmotion', 'manuel')),

  -- Ce que Movinmotion nous facture (≈ 20 €), face aux 25 € refacturés.
  frais_dossier_cout NUMERIC(10,2),

  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE embauche_couts IS
  'Coût employeur réel. Lecture réservée aux admins, sauf dossier en mode frais_reels où le coût est le montant facturé.';

-- ── 9. Helpers d'accès ──────────────────────────────────────────────────────
-- SECURITY DEFINER : les policies interrogent embauche_dossiers, elle-même
-- sous RLS — sans ça, récursion infinie.
CREATE OR REPLACE FUNCTION embauche_dossier_readable(d_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM embauche_dossiers d
    WHERE d.id = d_id
      AND d.org_id = get_user_org_id()
      AND (
        is_admin()
        OR (d.project_id IS NOT NULL
            AND can_read_outil(d.project_id, 'embauches'))
      )
  );
$$;

CREATE OR REPLACE FUNCTION embauche_dossier_editable(d_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM embauche_dossiers d
    WHERE d.id = d_id
      AND d.org_id = get_user_org_id()
      AND (
        is_admin()
        OR (d.project_id IS NOT NULL
            AND can_edit_outil(d.project_id, 'embauches'))
      )
  );
$$;

-- Le coût n'est lisible que par un admin, OU quand le dossier facture au
-- réel : dans ce mode le coût EST le montant facturé, rien à cacher.
CREATE OR REPLACE FUNCTION embauche_cout_readable(e_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM embauches e
    JOIN embauche_dossiers d ON d.id = e.dossier_id
    WHERE e.id = e_id
      AND d.org_id = get_user_org_id()
      AND (
        is_admin()
        OR (d.mode = 'frais_reels'
            AND d.project_id IS NOT NULL
            AND can_read_outil(d.project_id, 'embauches'))
      )
  );
$$;

COMMENT ON FUNCTION embauche_cout_readable(uuid) IS
  'Garde-fou marge : admin partout, les autres uniquement en mode frais_reels.';

-- ── 10. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE embauche_params      ENABLE ROW LEVEL SECURITY;
ALTER TABLE embauche_dossiers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE embauches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE embauche_jours       ENABLE ROW LEVEL SECURITY;
ALTER TABLE embauche_majorations ENABLE ROW LEVEL SECURITY;
ALTER TABLE embauche_frais       ENABLE ROW LEVEL SECURITY;
ALTER TABLE embauche_couts       ENABLE ROW LEVEL SECURITY;

-- Params : tout l'org lit (le tableur a besoin des taux), seul l'admin écrit.
DROP POLICY IF EXISTS embauche_params_read  ON embauche_params;
DROP POLICY IF EXISTS embauche_params_write ON embauche_params;
CREATE POLICY embauche_params_read ON embauche_params
  FOR SELECT USING (org_id = get_user_org_id());
CREATE POLICY embauche_params_write ON embauche_params
  FOR ALL
  USING      (org_id = get_user_org_id() AND is_admin())
  WITH CHECK (org_id = get_user_org_id() AND is_admin());

-- Dossiers.
DROP POLICY IF EXISTS embauche_dossiers_read   ON embauche_dossiers;
DROP POLICY IF EXISTS embauche_dossiers_insert ON embauche_dossiers;
DROP POLICY IF EXISTS embauche_dossiers_update ON embauche_dossiers;
DROP POLICY IF EXISTS embauche_dossiers_delete ON embauche_dossiers;

CREATE POLICY embauche_dossiers_read ON embauche_dossiers
  FOR SELECT USING (
    org_id = get_user_org_id()
    AND (
      is_admin()
      OR (project_id IS NOT NULL AND can_read_outil(project_id, 'embauches'))
    )
  );

-- Créer un dossier RATTACHÉ demande le droit d'édition sur le projet ;
-- créer un dossier AUTONOME (sans projet) reste réservé aux admins, sinon
-- n'importe quel prestataire ouvrirait un dossier hors de toute permission.
CREATE POLICY embauche_dossiers_insert ON embauche_dossiers
  FOR INSERT WITH CHECK (
    org_id = get_user_org_id()
    AND (
      is_admin()
      OR (project_id IS NOT NULL AND can_edit_outil(project_id, 'embauches'))
    )
  );

CREATE POLICY embauche_dossiers_update ON embauche_dossiers
  FOR UPDATE
  USING (
    org_id = get_user_org_id()
    AND (
      is_admin()
      OR (project_id IS NOT NULL AND can_edit_outil(project_id, 'embauches'))
    )
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND (
      is_admin()
      OR (project_id IS NOT NULL AND can_edit_outil(project_id, 'embauches'))
    )
  );

-- Suppression d'un dossier : admin seul (cascade sur tout le contenu).
CREATE POLICY embauche_dossiers_delete ON embauche_dossiers
  FOR DELETE USING (org_id = get_user_org_id() AND is_admin());

-- Tables filles : accès hérité du dossier.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['embauches'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read   ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON %I', t, t);

    EXECUTE format(
      'CREATE POLICY %I_read ON %I FOR SELECT USING (embauche_dossier_readable(dossier_id))',
      t, t);
    EXECUTE format(
      'CREATE POLICY %I_insert ON %I FOR INSERT WITH CHECK (embauche_dossier_editable(dossier_id))',
      t, t);
    EXECUTE format(
      'CREATE POLICY %I_update ON %I FOR UPDATE USING (embauche_dossier_editable(dossier_id)) WITH CHECK (embauche_dossier_editable(dossier_id))',
      t, t);
    EXECUTE format(
      'CREATE POLICY %I_delete ON %I FOR DELETE USING (embauche_dossier_editable(dossier_id))',
      t, t);
  END LOOP;
END $$;

-- Petites-filles : accès hérité de l'embauche.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['embauche_jours', 'embauche_majorations', 'embauche_frais'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read   ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON %I', t, t);

    EXECUTE format($f$
      CREATE POLICY %I_read ON %I FOR SELECT USING (
        EXISTS (SELECT 1 FROM embauches e
                WHERE e.id = %I.embauche_id
                  AND embauche_dossier_readable(e.dossier_id)))
    $f$, t, t, t);
    EXECUTE format($f$
      CREATE POLICY %I_insert ON %I FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM embauches e
                WHERE e.id = %I.embauche_id
                  AND embauche_dossier_editable(e.dossier_id)))
    $f$, t, t, t);
    EXECUTE format($f$
      CREATE POLICY %I_update ON %I FOR UPDATE USING (
        EXISTS (SELECT 1 FROM embauches e
                WHERE e.id = %I.embauche_id
                  AND embauche_dossier_editable(e.dossier_id)))
      WITH CHECK (
        EXISTS (SELECT 1 FROM embauches e
                WHERE e.id = %I.embauche_id
                  AND embauche_dossier_editable(e.dossier_id)))
    $f$, t, t, t, t);
    EXECUTE format($f$
      CREATE POLICY %I_delete ON %I FOR DELETE USING (
        EXISTS (SELECT 1 FROM embauches e
                WHERE e.id = %I.embauche_id
                  AND embauche_dossier_editable(e.dossier_id)))
    $f$, t, t, t);
  END LOOP;
END $$;

-- Coûts : lecture gardée par le helper dédié, écriture admin seule.
DROP POLICY IF EXISTS embauche_couts_read  ON embauche_couts;
DROP POLICY IF EXISTS embauche_couts_write ON embauche_couts;

CREATE POLICY embauche_couts_read ON embauche_couts
  FOR SELECT USING (embauche_cout_readable(embauche_id));

CREATE POLICY embauche_couts_write ON embauche_couts
  FOR ALL
  USING (
    is_admin() AND EXISTS (
      SELECT 1 FROM embauches e
      JOIN embauche_dossiers d ON d.id = e.dossier_id
      WHERE e.id = embauche_couts.embauche_id
        AND d.org_id = get_user_org_id())
  )
  WITH CHECK (
    is_admin() AND EXISTS (
      SELECT 1 FROM embauches e
      JOIN embauche_dossiers d ON d.id = e.dossier_id
      WHERE e.id = embauche_couts.embauche_id
        AND d.org_id = get_user_org_id())
  );

-- ── 11. updated_at ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_embauches()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_embauche_dossiers ON embauche_dossiers;
CREATE TRIGGER trg_touch_embauche_dossiers
  BEFORE UPDATE ON embauche_dossiers
  FOR EACH ROW EXECUTE FUNCTION touch_embauches();

DROP TRIGGER IF EXISTS trg_touch_embauches ON embauches;
CREATE TRIGGER trg_touch_embauches
  BEFORE UPDATE ON embauches
  FOR EACH ROW EXECUTE FUNCTION touch_embauches();

DROP TRIGGER IF EXISTS trg_touch_embauche_couts ON embauche_couts;
CREATE TRIGGER trg_touch_embauche_couts
  BEFORE UPDATE ON embauche_couts
  FOR EACH ROW EXECUTE FUNCTION touch_embauches();

DROP TRIGGER IF EXISTS trg_touch_embauche_params ON embauche_params;
CREATE TRIGGER trg_touch_embauche_params
  BEFORE UPDATE ON embauche_params
  FOR EACH ROW EXECUTE FUNCTION touch_embauches();

-- ── 11bis. Ligne de coût créée d'office ─────────────────────────────────────
-- Le front décide d'afficher coût et marge sur la SEULE présence d'une ligne
-- `embauche_couts`. Pour que cette absence signifie « pas le droit » et non
-- « pas encore saisi », la ligne doit exister dès la création de l'embauche.
-- SECURITY DEFINER : un non-admin crée des embauches mais n'a pas le droit
-- d'écrire dans embauche_couts.
CREATE OR REPLACE FUNCTION embauche_seed_cout()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO embauche_couts (embauche_id)
  VALUES (NEW.id)
  ON CONFLICT (embauche_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_embauche_seed_cout ON embauches;
CREATE TRIGGER trg_embauche_seed_cout
  AFTER INSERT ON embauches
  FOR EACH ROW EXECUTE FUNCTION embauche_seed_cout();

-- Rattrapage pour les embauches créées avant ce trigger.
INSERT INTO embauche_couts (embauche_id)
SELECT e.id FROM embauches e
WHERE NOT EXISTS (
  SELECT 1 FROM embauche_couts c WHERE c.embauche_id = e.id
);

-- ── 12. Template métier « Gestion sociale » ─────────────────────────────────
-- Un gestionnaire social externe n'a PAS besoin d'un nouveau rôle : c'est un
-- prestataire porteur de ce template, qui n'ouvre que la clé `embauches`.
-- Il ne verra ni le coût réel ni la marge (hors mode frais_reels).
-- ⚠️ Idempotence : un UNIQUE (org_id, key) ne protège PAS ici, org_id étant
-- NULL (NULL <> NULL en SQL). D'où le WHERE NOT EXISTS plutôt qu'un
-- ON CONFLICT, qui laisserait passer un doublon à chaque réexécution.
INSERT INTO metiers_template (org_id, key, label, description, icon, color, is_system)
SELECT
  NULL,
  'gestion_sociale',
  'Gestion sociale',
  'Saisie et suivi des contrats d''intermittence sur les projets attribués. '
  'N''ouvre aucun accès au coût réel ni à la marge.',
  'FileSignature',
  '#14B8A6',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM metiers_template
  WHERE key = 'gestion_sociale' AND is_system = true AND org_id IS NULL
);

INSERT INTO metier_template_permissions (template_id, outil_key, can_read, can_comment, can_edit)
SELECT t.id, 'embauches', true, true, true
FROM metiers_template t
WHERE t.key = 'gestion_sociale'
  AND t.is_system = true
  AND t.org_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM metier_template_permissions p
    WHERE p.template_id = t.id AND p.outil_key = 'embauches'
  );

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VÉRIFICATIONS POST-MIGRATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Les 7 tables existent :
--      SELECT table_name FROM information_schema.tables
--      WHERE table_name LIKE 'embauche%' ORDER BY 1;
--
-- 2. La RLS est active partout :
--      SELECT relname, relrowsecurity FROM pg_class
--      WHERE relname LIKE 'embauche%' AND relkind = 'r';
--
-- 3. Le garde-fou marge répond bien (en tant que non-admin, doit être false
--    sur un dossier en mode portage) :
--      SELECT embauche_cout_readable('<une embauche>');
--
-- 4. Le template est visible dans Admin → Templates métiers.
-- ════════════════════════════════════════════════════════════════════════════
