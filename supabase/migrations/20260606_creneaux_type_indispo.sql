-- ════════════════════════════════════════════════════════════════════════════
-- FEST-5.2 — Type 'indispo' pour créneaux (sommeil/repos cadreurs)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Permet de représenter une plage d'indisponibilité d'un cadreur (sommeil,
-- repos perso, off-shift) comme un créneau type='indispo' dans sa lane
-- (lane.type='personne'). Rendu visuel : hachures gris diagonales 45°.
--
-- Concrètement : on ajoute 'indispo' aux valeurs autorisées par la check
-- constraint sur projet_deroule_creneaux.type.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE projet_deroule_creneaux
  DROP CONSTRAINT IF EXISTS projet_deroule_creneaux_type_check;

ALTER TABLE projet_deroule_creneaux
  ADD CONSTRAINT projet_deroule_creneaux_type_check
  CHECK (type IN (
    'install',
    'repas',
    'prise',
    'pause',
    'transport',
    'brief',
    'live',
    'autre',
    'indispo'  -- FEST-5.2 : sommeil/repos cadreur
  ));

COMMENT ON COLUMN projet_deroule_creneaux.type IS
  'Type sémantique du créneau. Détermine l''icône et la couleur par défaut côté UI. Valeurs : install, repas, prise, pause, transport, brief, live, autre, indispo (sommeil/repos cadreur FEST-5.2).';
