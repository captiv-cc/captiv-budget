-- ════════════════════════════════════════════════════════════════════════════
-- FEST-5.4 — Alertes / points d'attention sur créneaux
-- ════════════════════════════════════════════════════════════════════════════
--
-- Permet d'attacher un message d'alerte court à un créneau (typiquement un
-- show artiste). Exemples :
--   - "Show décalé !" (niveau important)
--   - "3 premiers titres seulement" (niveau info)
--   - "Pas d'autorisation côté scène" (niveau important)
--
-- Le rendu visuel sur la timeline affiche un bandeau orangé/bleu sur le bloc
-- pour attirer l'œil avant même d'ouvrir l'inspecteur.
--
-- - alerte_text   : message court, max ~200 chars conseillé pour rester lisible
-- - alerte_niveau : 'info' (bleu, info utile) | 'important' (orange, attention !)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE projet_deroule_creneaux
  ADD COLUMN IF NOT EXISTS alerte_text TEXT,
  ADD COLUMN IF NOT EXISTS alerte_niveau TEXT;

-- Niveau d'alerte (cohérent avec ALERTE_NIVEAUX côté JS lib/deroule.js)
ALTER TABLE projet_deroule_creneaux
  DROP CONSTRAINT IF EXISTS projet_deroule_creneaux_alerte_niveau_check;
ALTER TABLE projet_deroule_creneaux
  ADD CONSTRAINT projet_deroule_creneaux_alerte_niveau_check
  CHECK (alerte_niveau IS NULL OR alerte_niveau IN ('info', 'important'));

-- Invariant : alerte_text et alerte_niveau sont co-renseignés ou co-nullés
-- (pas de niveau sans texte, et un texte sans niveau est ambigu). On
-- accepte les deux NULL (= pas d'alerte).
ALTER TABLE projet_deroule_creneaux
  DROP CONSTRAINT IF EXISTS projet_deroule_creneaux_alerte_pair;
ALTER TABLE projet_deroule_creneaux
  ADD CONSTRAINT projet_deroule_creneaux_alerte_pair
  CHECK (
    (alerte_text IS NULL AND alerte_niveau IS NULL) OR
    (alerte_text IS NOT NULL AND alerte_niveau IS NOT NULL)
  );

COMMENT ON COLUMN projet_deroule_creneaux.alerte_text IS
  'Texte court d''alerte / point d''attention (FEST-5.4). NULL = pas d''alerte. Ex: "Show décalé !", "3 premiers titres seulement".';
COMMENT ON COLUMN projet_deroule_creneaux.alerte_niveau IS
  'Niveau d''alerte (FEST-5.4). NULL si pas d''alerte. info = bleu (info utile), important = orange (attention requise).';
