-- ════════════════════════════════════════════════════════════════════════════
-- LIV-V-PREV : `date_envoi_prevu` sur livrable_versions
-- ════════════════════════════════════════════════════════════════════════════
--
-- Permet de planifier les jalons d'envoi (V1, V2, ...) AVANT l'envoi réel.
--   - `date_envoi`        = date où l'envoi a été fait (déjà existante)
--   - `date_envoi_prevu`  = date prévisionnelle (NOUVELLE colonne)
--
-- L'utilisateur saisit `date_envoi_prevu` à la création de la version dans
-- le drawer Versions. Visualisé dans la Pipeline (marqueur enveloppe avec
-- label "V1") et le PDF Vue ensemble (cellule orange + label « Envoi V1 »).
--
-- L'envoi réel reste tracé via `date_envoi` au moment où le client reçoit
-- effectivement la version.
--
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE livrable_versions
  ADD COLUMN IF NOT EXISTS date_envoi_prevu DATE;

COMMENT ON COLUMN livrable_versions.date_envoi_prevu IS
  'Date prévisionnelle d''envoi de la version. Différente de date_envoi qui '
  'est posée au moment de l''envoi réel. Utilisée pour les marqueurs '
  'planning/Gantt/PDF.';

-- Index utile pour les requêtes de Pipeline/PDF qui scannent les versions
-- par date d'envoi prévue dans une fenêtre temporelle.
CREATE INDEX IF NOT EXISTS livrable_versions_date_envoi_prevu_idx
  ON livrable_versions(date_envoi_prevu)
  WHERE date_envoi_prevu IS NOT NULL;

-- Reload PostgREST schema cache (Supabase tip).
NOTIFY pgrst, 'reload schema';
