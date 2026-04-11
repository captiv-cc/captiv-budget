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
--   1. Remplace `profile_own` par 2 policies de lecture + write self uniquement
--      - lecture : tous les profils de la même org (pour l'UI d'attachement)
--      - écriture : uniquement son propre profil (sécurité)
--
-- Impact RGPD : un user voit maintenant les noms/rôles des autres membres de
-- son organisation. Aucune donnée sensible (pas d'email, pas de téléphone).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Drop de l'ancienne policy "all" ────────────────────────────────────────
DROP POLICY IF EXISTS "profile_own" ON profiles;

-- ─── SELECT : lecture des profils de la même organisation ──────────────────
DROP POLICY IF EXISTS "profiles_read_same_org" ON profiles;
CREATE POLICY "profiles_read_same_org" ON profiles
  FOR SELECT
  USING (
    -- Son propre profil toujours lisible
    id = auth.uid()
    OR
    -- Profils de la même org (NULL org → visible uniquement par soi)
    (
      org_id IS NOT NULL
      AND org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    )
  );

-- ─── UPDATE : uniquement son propre profil ─────────────────────────────────
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ─── INSERT : géré par le trigger handle_new_user (security definer) ──────
-- Pas besoin de policy INSERT, le trigger bypass RLS en security definer.

-- ─── DELETE : pas de suppression depuis le client ─────────────────────────
-- On ne crée pas de policy DELETE → personne ne peut supprimer via le client.
-- Les suppressions se font côté admin Supabase ou via cascade auth.users.
