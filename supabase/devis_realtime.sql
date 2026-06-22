-- ════════════════════════════════════════════════════════════════════════════
-- Devis R2 — Activer Realtime (postgres_changes) sur les tables devis
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase.
--
-- 1) Ajoute devis / devis_categories / devis_lines à la publication realtime
--    (sans ça, le hook useDevis ne reçoit aucun event collaboratif).
-- 2) REPLICA IDENTITY FULL sur les tables filtrées par devis_id : nécessaire
--    pour que les events UPDATE/DELETE filtrés (`devis_id=eq.X`) soient bien
--    émis — par défaut l'ancienne ligne ne contient que la PK, donc le filtre
--    sur devis_id ne matcherait pas et les suppressions seraient perdues.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Publication realtime (idempotent : ignore si déjà ajoutée)
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.devis; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.devis_categories; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.devis_lines; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 2) Replica identity FULL (pour les filtres sur UPDATE/DELETE)
ALTER TABLE public.devis_categories REPLICA IDENTITY FULL;
ALTER TABLE public.devis_lines REPLICA IDENTITY FULL;
-- devis est filtré par sa PK (id=eq.X) → REPLICA IDENTITY par défaut suffit.
