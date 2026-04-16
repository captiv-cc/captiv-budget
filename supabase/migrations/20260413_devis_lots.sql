-- ============================================================================
-- Migration : Introduction des LOTS (contrats commerciaux indépendants par projet)
-- Date      : 2026-04-13
-- Contexte  : Un projet peut contenir plusieurs "lots" de prestation (ex :
--             "Aftermovie", "Social media") facturés séparément, chacun avec
--             son propre cycle de versions de devis.
--             Avant cette migration : 1 projet = 1 devis (en versions successives)
--             Après                  : 1 projet = N lots = N×M versions de devis
-- ============================================================================

BEGIN;

-- ── 1. Table devis_lots ─────────────────────────────────────────────────────
-- Un lot représente une prestation commerciale indépendante. Son statut est
-- DÉRIVÉ côté front à partir des statuts des devis qu'il contient.
CREATE TABLE IF NOT EXISTS devis_lots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  sort_order  INT DEFAULT 0,
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS devis_lots_project_id_idx ON devis_lots(project_id);

-- RLS : aligné sur le pattern des autres tables scoped project
ALTER TABLE devis_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "devis_lots_org" ON devis_lots;
CREATE POLICY "devis_lots_org" ON devis_lots FOR ALL
  USING      (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE org_id = get_user_org_id()));

-- Trigger updated_at
DROP TRIGGER IF EXISTS devis_lots_updated_at ON devis_lots;
CREATE TRIGGER devis_lots_updated_at
  BEFORE UPDATE ON devis_lots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 2. Ajout de lot_id sur devis (nullable temporairement) ──────────────────
ALTER TABLE devis ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES devis_lots(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS devis_lot_id_idx ON devis(lot_id);


-- ── 3. Backfill : créer un lot "Principal" par projet ayant des devis ───────
INSERT INTO devis_lots (project_id, title, sort_order)
  SELECT DISTINCT project_id, 'Principal', 0
  FROM devis
  WHERE project_id NOT IN (SELECT project_id FROM devis_lots);


-- ── 4. Rattacher tous les devis existants à leur lot "Principal" ────────────
UPDATE devis d
  SET lot_id = dl.id
  FROM devis_lots dl
  WHERE dl.project_id = d.project_id
    AND d.lot_id IS NULL;


-- ── 5. lot_id devient obligatoire (tout le monde est rattaché maintenant) ──
ALTER TABLE devis ALTER COLUMN lot_id SET NOT NULL;


-- ── 6. Bascule de la contrainte d'unicité ───────────────────────────────────
-- Avant : UNIQUE(project_id, version_number) → bloque 2 lots dans le même projet
-- Après : UNIQUE(lot_id, version_number)     → chaque lot a ses propres V1/V2/V3
--
-- On fait une découverte dynamique du nom de contrainte (variable selon la
-- manière dont elle a été créée initialement) pour être robuste.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'devis'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%(project_id, version_number)%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE devis DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE devis DROP CONSTRAINT IF EXISTS devis_lot_version_unique;
ALTER TABLE devis ADD CONSTRAINT devis_lot_version_unique UNIQUE (lot_id, version_number);


-- ── 7. Ajout de lot_id sur budget_reel (nullable) ───────────────────────────
-- Pour les entrées classiques, le lot se dérive via la ligne de devis rattachée.
-- Pour les ADDITIFS (is_additif=true, pas de ligne de devis), lot_id est
-- renseigné explicitement à la saisie — contrainte applicative, pas DB.
ALTER TABLE budget_reel
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES devis_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS budget_reel_lot_id_idx ON budget_reel(lot_id);


-- ── 8. Backfill factures.devis_id si NULL (best effort) ─────────────────────
-- Pour les factures existantes qui n'ont pas encore de devis rattaché, on
-- choisit le meilleur candidat : dernier accepté, sinon version la plus haute.
UPDATE factures f
  SET devis_id = (
    SELECT d.id
    FROM devis d
    WHERE d.project_id = f.project_id
    ORDER BY (d.status = 'accepte') DESC, d.version_number DESC
    LIMIT 1
  )
WHERE f.devis_id IS NULL;


-- ── 9. Mise à jour de la vue v_compta_factures (ajout lot_title) ────────────
-- On expose le titre du lot dans la vue compta pour pouvoir l'afficher dans
-- l'onglet Compta global sans jointure côté front.
DROP VIEW IF EXISTS v_compta_factures;
CREATE VIEW v_compta_factures AS
SELECT
  f.id,
  f.project_id,
  p.title                                      AS project_title,
  COALESCE(c.raison_sociale, c.nom_commercial) AS client_name,
  f.devis_id,
  dl.id                                        AS lot_id,
  dl.title                                     AS lot_title,
  f.type,
  f.numero,
  f.qonto_url,
  f.objet,
  f.montant_ht,
  f.tva_pct,
  f.montant_ttc,
  f.statut,
  f.date_emission,
  f.date_envoi,
  f.delai_paiement,
  f.date_echeance,
  f.date_reglement,
  f.notes,
  f.created_at,
  f.updated_at
FROM factures f
LEFT JOIN projects p  ON p.id  = f.project_id
LEFT JOIN clients  c  ON c.id  = p.client_id
LEFT JOIN devis    d  ON d.id  = f.devis_id
LEFT JOIN devis_lots dl ON dl.id = d.lot_id;


-- ── 10. Commentaires pour la doc DB ─────────────────────────────────────────
COMMENT ON TABLE devis_lots IS
  'Lot de prestation d''un projet. Un projet peut avoir plusieurs lots facturés indépendamment (ex: "Aftermovie", "Social media"). Le statut du lot est dérivé côté front depuis les statuts des devis qu''il contient.';

COMMENT ON COLUMN devis_lots.archived IS
  'Lot archivé : n''apparaît plus dans les sélecteurs, mais son contenu (devis, factures) reste accessible en lecture.';

COMMENT ON COLUMN devis.lot_id IS
  'Lot auquel appartient ce devis. Obligatoire. Les versions V1/V2/V3 d''un même contrat partagent le même lot_id.';

COMMENT ON COLUMN budget_reel.lot_id IS
  'Lot de rattachement. Obligatoire pour les additifs (is_additif=true). Pour les entrées liées à une ligne de devis, peut être laissé NULL et dérivé via la jointure.';


COMMIT;
