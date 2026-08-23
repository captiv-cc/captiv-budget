-- ════════════════════════════════════════════════════════════════════════════
-- MUSIQUES — fichier audio de travail par proposition (berceau, phase 1)
-- Date      : 2026-08-24
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pour monter un berceau, il faut le morceau ENTIER. Aucune API ne le fournit
-- en fichier : Spotify et YouTube ne servent qu'un flux chiffré, illisible
-- pour le code (pas de forme d'onde, pas de fondu croisé, pas de découpe).
-- On dépose donc un MP3 de travail par proposition.
--
-- ⚠️ Ce fichier n'est PAS le master. C'est une copie de travail pour
-- maquetter, distincte de master_url (autorisations), qui reste le fichier
-- de qualité livré par le label au monteur. Deux objets, deux moments.
--
-- Le fichier appartient à la PROPOSITION : déposé une fois, il sert dans
-- tous les berceaux et tous les livrables où la musique est attribuée.
--
-- audio_peaks : amplitudes pré-calculées au dépôt (côté client). Redécoder
-- un MP3 à chaque affichage de forme d'onde serait inutilisable ; ce petit
-- tableau d'entiers rend l'affichage instantané.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE projet_musique_propositions
  ADD COLUMN IF NOT EXISTS audio_path        TEXT,
  ADD COLUMN IF NOT EXISTS audio_filename    TEXT,
  ADD COLUMN IF NOT EXISTS audio_mime        TEXT,
  ADD COLUMN IF NOT EXISTS audio_size_bytes  BIGINT,
  -- Durée réelle du fichier, mesurée au décodage : duration_ms vient de
  -- Spotify et peut différer (edit, remaster, live).
  ADD COLUMN IF NOT EXISTS audio_duree_ms    INTEGER,
  ADD COLUMN IF NOT EXISTS audio_peaks       JSONB,
  ADD COLUMN IF NOT EXISTS audio_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audio_uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN projet_musique_propositions.audio_path IS
  'Chemin dans le bucket projet-musique-audio (<project_id>/<uuid>.<ext>). Fichier de TRAVAIL pour le berceau, à ne pas confondre avec le master des autorisations.';
COMMENT ON COLUMN projet_musique_propositions.audio_peaks IS
  'Amplitudes normalisées (0-255) calculées au dépôt, pour dessiner la forme d''onde sans redécoder le fichier.';

CREATE INDEX IF NOT EXISTS idx_musique_propositions_audio
  ON projet_musique_propositions(project_id)
  WHERE audio_path IS NOT NULL;

-- ── Bucket ──────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('projet-musique-audio', 'projet-musique-audio', false)
ON CONFLICT (id) DO NOTHING;

-- Policies : 1er segment du chemin = project_id, gate sur l'outil musiques.
-- Pas d'accès anon : ce sont des fichiers sous droits, ils ne sortent jamais
-- sur un lien public.
DROP POLICY IF EXISTS "projet-musique-audio read authed"   ON storage.objects;
DROP POLICY IF EXISTS "projet-musique-audio insert authed" ON storage.objects;
DROP POLICY IF EXISTS "projet-musique-audio delete authed" ON storage.objects;

CREATE POLICY "projet-musique-audio read authed"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'projet-musique-audio'
    AND can_read_outil(split_part(storage.objects.name, '/', 1)::uuid, 'musiques')
  );

CREATE POLICY "projet-musique-audio insert authed"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'projet-musique-audio'
    AND can_edit_outil(split_part(storage.objects.name, '/', 1)::uuid, 'musiques')
  );

CREATE POLICY "projet-musique-audio delete authed"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'projet-musique-audio'
    AND can_edit_outil(split_part(storage.objects.name, '/', 1)::uuid, 'musiques')
  );

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS
-- ============================================================================
-- 1. Déposer un MP3 sur une proposition renseigne audio_path, audio_duree_ms
--    et audio_peaks ; la forme d'onde s'affiche sans redécoder.
-- 2. Le fichier n'est jamais servi à anon (aucune policy).
-- 3. Purge de fin de projet : supprimer les objets du bucket sous
--    <project_id>/ puis vider les colonnes audio_*.
-- ============================================================================
