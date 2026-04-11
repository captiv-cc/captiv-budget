-- ════════════════════════════════════════════════════════════════════════════
-- CHANTIER 3B.2 — Lecture des profiles same-org
-- ════════════════════════════════════════════════════════════════════════════
--
-- Contexte : le schéma initial a une policy `profile_own` qui limite chaque
-- user à son propre profil. C'est trop restrictif pour l'UI d'accès projet
-- (AccessTab) qui doit afficher les noms des users attachés et proposer une
-- liste de users à attacher.
--
-- Cette migration :
--   1. Remplace `profile_own` par des policies explicites SELECT + UPDATE
--      - SELECT : son propre profil OU profils de la même org
--      - UPDATE : uniquement son propre profil
--   2. Garantit que get_user_org_id() est bien SECURITY DEFINER pour éviter
--      toute récursion RLS lors de l'évaluation de la policy SELECT.
--
-- Impact RGPD : un user voit maintenant les noms/rôles des autres membres de
-- son organisation. Aucune donnée sensible (pas d'email, pas de téléphone).
-- Migration idempotente (DROP IF EXISTS + CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Helper : get_user_org_id (SECURITY DEFINER pour bypass RLS) ───────────
-- Cette fonction existe déjà dans schema.sql, on la redéfinit ici pour
-- s'assurer qu'elle est bien security definer (certains déploiements anciens
-- pourraient l'avoir en sql plain → récursion dans la policy SELECT).
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid()
$$;

-- ─── Drop des anciennes policies ───────────────────────────────────────────
DROP POLICY IF EXISTS "profile_own"             ON profiles;
DROP POLICY IF EXISTS "profiles_read_same_org"  ON profiles;
DROP POLICY IF EXISTS "profiles_update_own"     ON profiles;

-- ─── SELECT : son profil OU même org ───────────────────────────────────────
CREATE POLICY "profiles_read_same_org" ON profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR (
      org_id IS NOT NULL
      AND org_id = get_user_org_id()
    )
  );

-- ─── UPDATE : uniquement son propre profil ─────────────────────────────────
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- INSERT : géré par le trigger handle_new_user (security definer, bypass RLS)
-- DELETE : aucune policy → personne ne peut supprimer via le client
