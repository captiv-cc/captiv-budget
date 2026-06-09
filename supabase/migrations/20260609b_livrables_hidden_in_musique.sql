-- ============================================================================
-- Migration : MUSIQUES MUS-6.7 — Masquer des livrables dans la chaîne musique
-- Date      : 2026-06-09 (b — MUS-6.7)
-- Contexte  : Dans la vue Attribution du module Musiques (et toute la chaîne
--             musique), on veut pouvoir masquer certains livrables qui n'ont
--             pas vocation à recevoir de musique (ex : livraisons graphiques,
--             stickers, supports print, etc.) pour ne pas polluer le triage.
--
--             Décision Hugo : masquage GLOBAL (admin masque pour tout le
--             monde). Pas de masquage perso par utilisateur — si un livrable
--             est masqué, il l'est pour toute l'équipe.
--
--             Le livrable reste TOUJOURS visible dans le module Livrables
--             natif. Le masquage est spécifique à la perspective musique.
--
--             Si une liaison proposition ↔ livrable masqué existe (lien
--             créé avant le masquage, ou par un admin qui a masqué après),
--             le lien EST PRÉSERVÉ en BDD mais filtré des UI musique. Si
--             le livrable est ré-affiché, les liens redeviennent visibles
--             tels qu'ils étaient.
--
-- Périmètre :
--   ALTER TABLE livrables ADD COLUMN hidden_in_musique BOOLEAN
-- ============================================================================

BEGIN;

ALTER TABLE livrables
  ADD COLUMN IF NOT EXISTS hidden_in_musique BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN livrables.hidden_in_musique IS
  'MUSIQUES MUS-6.7 — Si true, ce livrable n''apparaît pas dans la chaîne '
  'musique (vue Attribution, picker, dashboard widgets). Reste visible dans '
  'le module Livrables natif. Les liens proposition↔livrable existants sont '
  'préservés mais masqués des UI musique. Toggle réservé à canEdit(musiques).';

COMMIT;
