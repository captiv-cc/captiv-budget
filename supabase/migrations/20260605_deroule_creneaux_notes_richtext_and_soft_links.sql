-- ============================================================================
-- Migration : DÉROULÉ FESTIVAL Sprint 2 — FEST-2.1
--             Notes Tiptap (rich-text) + soft links inter-créneaux
-- Date      : 2026-06-05
-- Contexte  : on remplace l'éditeur de notes basique (textarea brut) par un
--             éditeur Tiptap avec collab temps réel (Y.js). Le contenu est
--             stocké en JSON ProseMirror (format natif Tiptap/Y.js).
--
--             En parallèle, on introduit les soft-links entre créneaux :
--             un créneau peut référencer un autre créneau comme "source"
--             et synchroniser certains champs (titre / notes / lieu / etc.).
--             Use cases : Q&A répété sur N artistes, sound-check + concert
--             d'un même artiste, etc.
--
-- Périmètre :
--   1. projet_deroule_creneaux.notes : TEXT → JSONB
--      - Conversion : le texte brut existant devient un doc ProseMirror
--        minimal (1 paragraphe contenant 1 text node) pour ne perdre aucun
--        contenu déjà saisi.
--      - NULL / chaîne vide → NULL (rien à convertir).
--   2. projet_deroule_creneaux.notes_ydoc BYTEA NULL
--      - État Y.Doc sérialisé pour reconnexion rapide multi-clients.
--      - Optionnel : si NULL, on initialise un nouveau Y.Doc depuis notes.
--      - Snapshot pris debounced (~3s d'inactivité côté client).
--   3. projet_deroule_creneaux.source_creneau_id UUID NULL
--      - FK self-référente vers projet_deroule_creneaux(id).
--      - ON DELETE SET NULL : si la source est supprimée, on retire le lien
--        sans casser l'enfant (qui conserve ses propres données).
--      - CHECK : id <> source_creneau_id (pas d'auto-référence).
--   4. projet_deroule_creneaux.source_anchor JSONB NULL
--      - Décrit quels champs sont synchronisés depuis la source.
--      - Forme : { "fields": ["titre","notes","lieu_text","duree_min",
--        "cadreurs"] } (sous-ensemble configurable).
--      - NULL si pas de lien (source_creneau_id IS NULL).
--   5. INDEX btree sur source_creneau_id pour requêter les enfants
--      d'une source en O(log n) quand on push une modification.
--
-- Idempotent :
--   - ALTER COLUMN TYPE protégé par DO $$ check du type courant.
--   - ADD COLUMN IF NOT EXISTS pour les 3 colonnes ajoutées.
--   - CREATE INDEX IF NOT EXISTS pour l'index.
--   - DO $$ check pour le CHECK constraint (pas d'option IF NOT EXISTS).
--
-- Rollback :
--   ALTER TABLE projet_deroule_creneaux DROP COLUMN notes_ydoc;
--   ALTER TABLE projet_deroule_creneaux DROP COLUMN source_creneau_id;
--   ALTER TABLE projet_deroule_creneaux DROP COLUMN source_anchor;
--   ALTER TABLE projet_deroule_creneaux DROP CONSTRAINT
--     projet_deroule_creneaux_no_self_source;
--   -- Pour notes : reverse en TEXT en extrayant le texte brut du JSON
--   -- (lossy si formatage riche utilisé).
-- ============================================================================

BEGIN;


-- ── 1. Migration notes TEXT → JSONB ────────────────────────────────────────
-- On enveloppe chaque chaîne non-vide dans un doc ProseMirror minimal pour
-- ne pas perdre les notes déjà saisies par les utilisateurs. Si rien à
-- convertir (déjà JSONB ou colonne absente), on no-op.
DO $migration_notes$
DECLARE
  v_current_type text;
BEGIN
  SELECT data_type INTO v_current_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'projet_deroule_creneaux'
     AND column_name  = 'notes';

  IF v_current_type = 'text' THEN
    ALTER TABLE projet_deroule_creneaux
      ALTER COLUMN notes TYPE jsonb
      USING CASE
        WHEN notes IS NULL OR btrim(notes) = '' THEN NULL
        ELSE jsonb_build_object(
          'type', 'doc',
          'content', jsonb_build_array(
            jsonb_build_object(
              'type', 'paragraph',
              'content', jsonb_build_array(
                jsonb_build_object('type', 'text', 'text', notes)
              )
            )
          )
        )
      END;
    RAISE NOTICE 'projet_deroule_creneaux.notes converti TEXT → JSONB (doc ProseMirror)';
  ELSIF v_current_type = 'jsonb' THEN
    RAISE NOTICE 'projet_deroule_creneaux.notes est déjà JSONB, no-op';
  ELSE
    RAISE EXCEPTION 'Type inattendu pour projet_deroule_creneaux.notes : %', v_current_type;
  END IF;
END
$migration_notes$;


-- ── 2. Colonnes Y.Doc + soft links ─────────────────────────────────────────
ALTER TABLE projet_deroule_creneaux
  ADD COLUMN IF NOT EXISTS notes_ydoc bytea NULL;

ALTER TABLE projet_deroule_creneaux
  ADD COLUMN IF NOT EXISTS source_creneau_id uuid NULL
    REFERENCES projet_deroule_creneaux(id) ON DELETE SET NULL;

ALTER TABLE projet_deroule_creneaux
  ADD COLUMN IF NOT EXISTS source_anchor jsonb NULL;

COMMENT ON COLUMN projet_deroule_creneaux.notes IS
  'Notes riches Tiptap stockées en JSON ProseMirror. Format natif Y.js pour collab temps réel.';
COMMENT ON COLUMN projet_deroule_creneaux.notes_ydoc IS
  'État Y.Doc sérialisé (binaire). Permet la reconnexion rapide multi-clients sans rejouer l''historique broadcast Realtime.';
COMMENT ON COLUMN projet_deroule_creneaux.source_creneau_id IS
  'Soft-link FEST-2 : créneau "source" dont certains champs sont synchronisés vers ce créneau. ON DELETE SET NULL.';
COMMENT ON COLUMN projet_deroule_creneaux.source_anchor IS
  'Décrit quels champs sont synchronisés depuis source_creneau_id. Forme : {"fields": ["titre","notes","lieu_text","duree_min","cadreurs"]}.';


-- ── 3. CHECK : pas d'auto-référence ────────────────────────────────────────
-- On ne peut pas linker un créneau à lui-même (boucle infinie de propagation).
DO $check_no_self$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.projet_deroule_creneaux'::regclass
       AND conname  = 'projet_deroule_creneaux_no_self_source'
  ) THEN
    ALTER TABLE projet_deroule_creneaux
      ADD CONSTRAINT projet_deroule_creneaux_no_self_source
      CHECK (source_creneau_id IS NULL OR source_creneau_id <> id);
    RAISE NOTICE 'CHECK projet_deroule_creneaux_no_self_source ajouté';
  ELSE
    RAISE NOTICE 'CHECK projet_deroule_creneaux_no_self_source déjà présent';
  END IF;
END
$check_no_self$;


-- ── 4. INDEX sur source_creneau_id pour requêter les enfants ──────────────
-- Quand on save une source, on cherche tous les enfants pour proposer la
-- propagation → index essentiel pour rester rapide même avec 1000+ créneaux.
CREATE INDEX IF NOT EXISTS projet_deroule_creneaux_source_creneau_id_idx
  ON projet_deroule_creneaux (source_creneau_id)
  WHERE source_creneau_id IS NOT NULL;


-- ── 5. Reload schéma PostgREST ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
