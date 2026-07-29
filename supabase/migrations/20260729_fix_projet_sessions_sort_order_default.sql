-- ════════════════════════════════════════════════════════════════════════════
-- FIX — création d'une 2e session impossible (bug Hugo 2026-07-29)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Symptôme : « Création session échouée après plusieurs tentatives (race
-- sort_order). duplicate key value violates unique constraint
-- "projet_sessions_project_id_sort_order_key" » dès la 2e session d'un projet.
--
-- Cause : conflit entre le DEFAULT de la colonne et le trigger d'auto-calcul.
--   - 20260505_equipe_sessions_phase_a.sql : sort_order INTEGER NOT NULL
--     DEFAULT 1 ;
--   - 20260506_..._audit_fixes.sql : trigger BEFORE INSERT qui calcule
--     MAX+1 UNIQUEMENT si NEW.sort_order IS NULL OR = 0.
--   Or Postgres applique le DEFAULT AVANT le trigger : un INSERT sans
--   sort_order arrive dans le trigger avec NEW.sort_order = 1 → le trigger
--   ne fait rien → toutes les sessions retombent sur 1 → violation
--   d'unicité systématique dès la 2e (ce n'était PAS une race).
--
-- Fix : DEFAULT 0 = la valeur « auto-assigne » du trigger. Un INSERT sans
-- sort_order déclenche désormais le calcul MAX+1. Le client (crew.js) envoie
-- aussi sort_order: 0 explicitement — les deux voies convergent.
--
-- À appliquer : SQL editor Supabase, une seule fois. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE projet_sessions ALTER COLUMN sort_order SET DEFAULT 0;

-- Vérification (doit afficher 0) :
--   SELECT column_default FROM information_schema.columns
--   WHERE table_name = 'projet_sessions' AND column_name = 'sort_order';
