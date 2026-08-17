-- ============================================================================
-- Migration : PROJ-INFO-EDIT — le droit outil 'projet_info' ouvre l'édition
--             de la fiche projet
-- Date      : 2026-08-17
-- Contexte  : l'onglet Accès permet déjà de donner « Fiche projet » en
--             ÉDITION à un prestataire, mais le bouton Modifier restait
--             réservé à admin/charge_prod côté UI, et la policy UPDATE de
--             projects (ch4c_projects_delete_admin.sql) refusait de toute
--             façon l'écriture. Le droit était donc sans effet.
--
--             On aligne projects sur le pattern can_edit_outil déjà utilisé
--             partout ailleurs (devis, budget, planning, livrables…) :
--               * admin                : inchangé
--               * charge_prod attaché  : inchangé
--               * coordinateur attaché : NOUVEAU (bypass interne du helper)
--               * prestataire attaché  : NOUVEAU si son métier/override
--                                        porte can_edit sur 'projet_info'
--
--             DELETE et INSERT ne bougent pas (admin / admin+charge_prod).
--
--             Garde-fou colonnes : les champs administratifs et de pilotage
--             (client, statut, archivage, réf projet, bon de commande, date
--             devis, note de prod, org) restent l'apanage d'admin /
--             charge_prod. La RLS Postgres ne sait pas restreindre par
--             colonne → un trigger BEFORE UPDATE restaure silencieusement
--             ces valeurs pour les autres profils. L'UI leur masque déjà
--             ces champs et renvoie les valeurs existantes ; le trigger
--             garantit qu'un appel API direct ne peut pas les toucher.
--
-- Idempotent : DROP puis CREATE. Safe à rejouer.
-- ============================================================================

BEGIN;

-- ── 1. Policy UPDATE : + can_edit_outil('projet_info') ─────────────────────
DROP POLICY IF EXISTS "projects_scoped_update" ON projects;

CREATE POLICY "projects_scoped_update" ON projects
  FOR UPDATE
  USING (
    org_id = get_user_org_id()
    AND (
      is_admin()
      OR (current_user_role() = 'charge_prod' AND is_project_member(id))
      OR can_edit_outil(id, 'projet_info')
    )
  )
  WITH CHECK (
    org_id = get_user_org_id()
    AND (
      is_admin()
      OR current_user_role() = 'charge_prod'
      OR can_edit_outil(id, 'projet_info')
    )
  );

-- ── 2. Garde-fou colonnes administratives ──────────────────────────────────
CREATE OR REPLACE FUNCTION projects_guard_admin_cols()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Contexte service_role / migration / job SQL : auth.uid() est NULL, on
  -- ne bride rien (aucune edge function n'écrit sur projects aujourd'hui,
  -- mais on ne veut pas piéger un futur back-office).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF is_admin() OR current_user_role() = 'charge_prod' THEN
    RETURN NEW;
  END IF;

  -- Tout le reste (coordinateur, prestataire avec droit 'projet_info')
  -- édite l'identité / le planning / les specs, jamais l'administratif.
  NEW.org_id       := OLD.org_id;
  NEW.client_id    := OLD.client_id;
  NEW.status       := OLD.status;
  NEW.archived_at  := OLD.archived_at;
  NEW.ref_projet   := OLD.ref_projet;
  NEW.bon_commande := OLD.bon_commande;
  NEW.date_devis   := OLD.date_devis;
  NEW.note_prod    := OLD.note_prod;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION projects_guard_admin_cols() IS
  'PROJ-INFO-EDIT : fige les colonnes administratives de projects pour les profils qui éditent la fiche via le droit outil projet_info (coordinateur, prestataire). Admin et charge_prod passent au travers.';

DROP TRIGGER IF EXISTS projects_guard_admin_cols_trg ON projects;
CREATE TRIGGER projects_guard_admin_cols_trg
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION projects_guard_admin_cols();

COMMIT;

-- ============================================================================
-- VÉRIFICATIONS
-- ============================================================================
-- 1. Donner « Fiche projet » en édition à un prestataire depuis l'onglet
--    Accès → il voit le bouton Modifier sur la fiche projet et peut
--    enregistrer identité / périodes / specs.
-- 2. Le même prestataire ne voit ni le bandeau admin (réf, BC, date devis,
--    gestion des accès) ni la note de prod, et un UPDATE direct sur
--    ref_projet / client_id / status reste sans effet.
-- 3. Retirer le droit → le bouton Modifier disparaît, l'UPDATE est refusé
--    par la RLS.
-- ============================================================================
