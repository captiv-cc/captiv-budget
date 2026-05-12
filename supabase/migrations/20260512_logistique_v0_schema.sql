-- ============================================================================
-- Migration : LOGISTIQUE V0 — schéma minimal (entries + documents + RLS + bucket)
-- Date      : 2026-05-12
-- Contexte  : Mini outil provisoire pour qu'Hugo puisse déjà publier les infos
--             logistiques (transport / hébergement / repas) de l'équipe via un
--             lien partagé. Sera remplacé par LOGISTIQUE V1 (calendrier complet,
--             hébergements partagés, transports avec tracking, per diem, etc.)
--             prévu plus tard dans la roadmap chantier.
--
-- Décisions tranchées avec Hugo (2026-05-12) :
--   - Une "entrée" = un couple (projet, membre). L'admin choisit manuellement
--     qui ajouter (parmi les membres du projet) — pas d'auto-import du crew.
--   - 3 sous-blocs textuels libres par entrée : transport / hébergement / repas
--   - Documents : PDF + PNG + JPG, multi-docs par sous-bloc, max 25Mo/fichier
--   - canEdit = admin / charge_prod / coordinateur / prestataire avec edit
--     sur outil 'logistique_v0' (cohérent avec autres outils via can_edit_outil)
--   - Page de partage : sous-page du portail /share/projet/:token (V2 share)
--
-- Naming : tables et bucket préfixés `logistique_v0_` / `projet-logistique-v0-`
-- pour marquer le caractère JETABLE de cette V0. Migration V1 dropera tout et
-- migrera les données vers le nouveau schéma propre.
--
-- Effet :
--   1. INSERT 'logistique_v0' dans outils_catalogue (sort_order = 25, entre
--      équipe (20) et planning (30))
--   2. CREATE 2 tables : projet_logistique_v0_entries + _documents
--   3. Indexes pour lookups fréquents
--   4. RLS scoped via can_read_outil / can_edit_outil('logistique_v0')
--   5. Bucket Storage `projet-logistique-v0-docs` privé + 5 policies (CRUD authed
--      + SELECT anon via project_share_tokens actif avec 'logistique_v0' enabled)
--   6. Trigger BEFORE UPDATE pour updated_at
--
-- Idempotent : Oui (CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING,
--             DROP POLICY IF EXISTS avant CREATE POLICY).
-- Réversible : voir bloc rollback en fin de fichier (commenté).
-- ============================================================================

BEGIN;


-- ── 1. Ajout 'logistique_v0' au catalogue d'outils ─────────────────────────
INSERT INTO outils_catalogue (key, label, description, icon, sort_order)
VALUES (
  'logistique_v0',
  'Logistique',
  'Infos transport / hébergement / repas par membre (V0 provisoire). Texte libre + upload PDF/PNG/JPG. Sera remplacé par Logistique V1 complète.',
  'Truck',
  25
)
ON CONFLICT (key) DO NOTHING;


-- ── 2. projet_logistique_v0_entries — 1 row par couple (projet, membre) ────
-- Une entrée logistique correspond à une personne du projet. L'admin choisit
-- manuellement qui ajouter (depuis le crew du projet). Les 3 champs texte
-- correspondent aux 3 sous-blocs UI : Transport / Hébergement / Repas.
CREATE TABLE IF NOT EXISTS projet_logistique_v0_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- FK vers projet_membres : la personne du crew. CASCADE délibéré : si on
  -- retire un membre du projet, ses infos logistiques disparaissent aussi.
  -- (V1 introduira un mode "Hors crew" pour les invités externes.)
  membre_id UUID NOT NULL REFERENCES projet_membres(id) ON DELETE CASCADE,

  -- Texte libre par sous-bloc. NULL ou '' = sous-bloc vide. Pas de longueur
  -- max stricte (textarea libre côté UI), Postgres TEXT gère tout.
  transport_text   TEXT,
  hebergement_text TEXT,
  repas_text       TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Une seule entrée par couple (projet, membre). L'admin ne peut pas ajouter
  -- deux fois la même personne.
  UNIQUE (project_id, membre_id)
);

COMMENT ON TABLE projet_logistique_v0_entries IS
  'Logistique V0 (provisoire) : 1 entrée par membre du projet. 3 champs texte libre + documents séparés via projet_logistique_v0_documents.';


-- ── 3. projet_logistique_v0_documents — N docs par entry, scopés par sous-bloc
-- Chaque document est rattaché à une entrée ET à un sous-bloc (kind). Permet
-- d'avoir 3 billets de train sur Transport et 1 confirmation hôtel sur
-- Hébergement pour la même personne.
CREATE TABLE IF NOT EXISTS projet_logistique_v0_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  entry_id UUID NOT NULL REFERENCES projet_logistique_v0_entries(id) ON DELETE CASCADE,

  -- Sous-bloc auquel le doc appartient. Détermine sous quel onglet le fichier
  -- apparaît côté UI.
  kind TEXT NOT NULL
    CHECK (kind IN ('transport', 'hebergement', 'repas')),

  -- Path Storage relatif au bucket. Format : `<entry_id>/<doc_uuid>.<ext>`.
  -- Le préfixe entry_id permet aux policies Storage de vérifier l'accès au
  -- projet parent via JOIN.
  storage_path TEXT NOT NULL,

  -- Nom original du fichier (pour download). Le storage_path utilise un UUID
  -- pour éviter les collisions.
  filename TEXT NOT NULL,

  -- Métadonnées techniques (pour preview / affichage taille).
  mime_type  TEXT,
  size_bytes BIGINT,

  -- Qui a uploadé (pour traçabilité — pas utilisé en UI V0).
  uploaded_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE projet_logistique_v0_documents IS
  'Logistique V0 (provisoire) : documents (PDF/PNG/JPG) attachés à une entrée logistique, scopés par sous-bloc (transport/hebergement/repas).';


-- ── 4. Indexes ─────────────────────────────────────────────────────────────
-- "Toutes les entrées d'un projet" — query systématique au load de la tab.
CREATE INDEX IF NOT EXISTS idx_logistique_v0_entries_project
  ON projet_logistique_v0_entries(project_id);

-- "Tous les docs d'une entry" — query au render de chaque card.
CREATE INDEX IF NOT EXISTS idx_logistique_v0_documents_entry_kind
  ON projet_logistique_v0_documents(entry_id, kind, created_at);


-- ── 5. Trigger updated_at sur entries ──────────────────────────────────────
-- Pattern aligné sur projet_deroules : trigger universel set_updated_at()
-- défini dans une migration antérieure.
DROP TRIGGER IF EXISTS trg_logistique_v0_entries_updated_at
  ON projet_logistique_v0_entries;
CREATE TRIGGER trg_logistique_v0_entries_updated_at
  BEFORE UPDATE ON projet_logistique_v0_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 6. RLS — projet_logistique_v0_entries ──────────────────────────────────
-- Pattern aligné sur projet_deroules : read via can_read_outil,
-- write via can_edit_outil, clé outil = 'logistique_v0'.
ALTER TABLE projet_logistique_v0_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_logistique_v0_entries_read"   ON projet_logistique_v0_entries;
DROP POLICY IF EXISTS "projet_logistique_v0_entries_insert" ON projet_logistique_v0_entries;
DROP POLICY IF EXISTS "projet_logistique_v0_entries_update" ON projet_logistique_v0_entries;
DROP POLICY IF EXISTS "projet_logistique_v0_entries_delete" ON projet_logistique_v0_entries;

CREATE POLICY "projet_logistique_v0_entries_read" ON projet_logistique_v0_entries
  FOR SELECT USING (can_read_outil(project_id, 'logistique_v0'));

CREATE POLICY "projet_logistique_v0_entries_insert" ON projet_logistique_v0_entries
  FOR INSERT WITH CHECK (can_edit_outil(project_id, 'logistique_v0'));

CREATE POLICY "projet_logistique_v0_entries_update" ON projet_logistique_v0_entries
  FOR UPDATE
  USING (can_edit_outil(project_id, 'logistique_v0'))
  WITH CHECK (can_edit_outil(project_id, 'logistique_v0'));

CREATE POLICY "projet_logistique_v0_entries_delete" ON projet_logistique_v0_entries
  FOR DELETE USING (can_edit_outil(project_id, 'logistique_v0'));


-- ── 7. RLS — projet_logistique_v0_documents (héritée via entry → project) ──
ALTER TABLE projet_logistique_v0_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projet_logistique_v0_documents_read"   ON projet_logistique_v0_documents;
DROP POLICY IF EXISTS "projet_logistique_v0_documents_insert" ON projet_logistique_v0_documents;
DROP POLICY IF EXISTS "projet_logistique_v0_documents_update" ON projet_logistique_v0_documents;
DROP POLICY IF EXISTS "projet_logistique_v0_documents_delete" ON projet_logistique_v0_documents;

CREATE POLICY "projet_logistique_v0_documents_read" ON projet_logistique_v0_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_entries e
      WHERE e.id = projet_logistique_v0_documents.entry_id
        AND can_read_outil(e.project_id, 'logistique_v0')
    )
  );

CREATE POLICY "projet_logistique_v0_documents_insert" ON projet_logistique_v0_documents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_entries e
      WHERE e.id = projet_logistique_v0_documents.entry_id
        AND can_edit_outil(e.project_id, 'logistique_v0')
    )
  );

CREATE POLICY "projet_logistique_v0_documents_update" ON projet_logistique_v0_documents
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_entries e
      WHERE e.id = projet_logistique_v0_documents.entry_id
        AND can_edit_outil(e.project_id, 'logistique_v0')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_entries e
      WHERE e.id = projet_logistique_v0_documents.entry_id
        AND can_edit_outil(e.project_id, 'logistique_v0')
    )
  );

CREATE POLICY "projet_logistique_v0_documents_delete" ON projet_logistique_v0_documents
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projet_logistique_v0_entries e
      WHERE e.id = projet_logistique_v0_documents.entry_id
        AND can_edit_outil(e.project_id, 'logistique_v0')
    )
  );


-- ── 8. Bucket Storage `projet-logistique-v0-docs` ──────────────────────────
-- Privé : tout accès passe par policies RLS + signed URL côté client.
INSERT INTO storage.buckets (id, name, public)
VALUES ('projet-logistique-v0-docs', 'projet-logistique-v0-docs', false)
ON CONFLICT (id) DO NOTHING;


-- ── 9. Policies Storage sur storage.objects ────────────────────────────────
-- Pattern des paths : "<entry_id>/<doc_uuid>.<ext>"
-- La partie avant le premier "/" est donc l'entry_id (UUID text).

DROP POLICY IF EXISTS "projet-logistique-v0-docs read authed"   ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-v0-docs read anon"     ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-v0-docs insert authed" ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-v0-docs update authed" ON storage.objects;
DROP POLICY IF EXISTS "projet-logistique-v0-docs delete authed" ON storage.objects;

-- ░ SELECT authenticated : can_read_outil sur le projet de l'entry parente.
CREATE POLICY "projet-logistique-v0-docs read authed"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'projet-logistique-v0-docs'
    AND EXISTS (
      SELECT 1 FROM projet_logistique_v0_entries e
      WHERE e.id::text = split_part(storage.objects.name, '/', 1)
        AND can_read_outil(e.project_id, 'logistique_v0')
    )
  );

-- ░ SELECT anon : ouvert tant qu'au moins un project_share_token actif existe
--   pour le projet ET inclut 'logistique_v0' dans enabled_pages. La révocation
--   de tous les tokens (ou retrait de 'logistique_v0' des enabled_pages)
--   coupe immédiatement l'accès aux docs depuis les liens partagés.
--
--   Pattern aligné sur matos-attachments mais via project_share_tokens au
--   lieu de matos_check_tokens.
CREATE POLICY "projet-logistique-v0-docs read anon"
  ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'projet-logistique-v0-docs'
    AND EXISTS (
      SELECT 1
        FROM projet_logistique_v0_entries e
        JOIN project_share_tokens t ON t.project_id = e.project_id
       WHERE e.id::text = split_part(storage.objects.name, '/', 1)
         AND t.revoked_at IS NULL
         AND (t.expires_at IS NULL OR t.expires_at > now())
         AND (t.enabled_pages ? 'logistique_v0')
    )
  );

-- ░ INSERT / UPDATE / DELETE authenticated : can_edit_outil.
CREATE POLICY "projet-logistique-v0-docs insert authed"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'projet-logistique-v0-docs'
    AND EXISTS (
      SELECT 1 FROM projet_logistique_v0_entries e
      WHERE e.id::text = split_part(storage.objects.name, '/', 1)
        AND can_edit_outil(e.project_id, 'logistique_v0')
    )
  );

CREATE POLICY "projet-logistique-v0-docs update authed"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'projet-logistique-v0-docs'
    AND EXISTS (
      SELECT 1 FROM projet_logistique_v0_entries e
      WHERE e.id::text = split_part(storage.objects.name, '/', 1)
        AND can_edit_outil(e.project_id, 'logistique_v0')
    )
  );

CREATE POLICY "projet-logistique-v0-docs delete authed"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'projet-logistique-v0-docs'
    AND EXISTS (
      SELECT 1 FROM projet_logistique_v0_entries e
      WHERE e.id::text = split_part(storage.objects.name, '/', 1)
        AND can_edit_outil(e.project_id, 'logistique_v0')
    )
  );


-- ── 10. Force reload du schéma PostgREST ───────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;


-- ============================================================================
-- Tests rapides post-migration :
--
-- 1. Outil dans le catalogue :
--      SELECT key, label, sort_order FROM outils_catalogue WHERE key = 'logistique_v0';
--
-- 2. Tables créées :
--      \dt projet_logistique_v0_*
--
-- 3. RLS activée :
--      SELECT tablename, rowsecurity FROM pg_tables
--       WHERE tablename LIKE 'projet_logistique_v0%';
--    → rowsecurity doit être 't' (true) sur les 2 tables.
--
-- 4. Bucket Storage :
--      SELECT id, name, public FROM storage.buckets
--       WHERE id = 'projet-logistique-v0-docs';
--    → public = false.
--
-- 5. Policies Storage :
--      SELECT polname FROM pg_policy
--       WHERE polrelid = 'storage.objects'::regclass
--         AND polname LIKE '%logistique-v0%'
--       ORDER BY polname;
--    → 5 policies : read authed, read anon, insert authed, update authed, delete authed.
--
-- 6. INSERT test (à exécuter en tant qu'admin attaché au projet) :
--      INSERT INTO projet_logistique_v0_entries (project_id, membre_id)
--      VALUES ('<project-id>', '<membre-id-du-projet>');
--    → doit passer. Puis :
--      DELETE FROM projet_logistique_v0_entries WHERE id = '<entry-id>';
--    → doit passer.
-- ============================================================================

-- ============================================================================
-- Rollback (à exécuter manuellement si besoin) :
--
-- BEGIN;
--   DROP TABLE IF EXISTS projet_logistique_v0_documents CASCADE;
--   DROP TABLE IF EXISTS projet_logistique_v0_entries CASCADE;
--   DELETE FROM outils_catalogue WHERE key = 'logistique_v0';
--   DELETE FROM storage.buckets WHERE id = 'projet-logistique-v0-docs';
--   -- (Les policies sur storage.objects sont supprimées automatiquement avec le bucket.)
-- COMMIT;
-- ============================================================================
