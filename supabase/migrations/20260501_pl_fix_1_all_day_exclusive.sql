-- ════════════════════════════════════════════════════════════════════════════
-- PL-FIX-1 : Normalise les events all_day en convention exclusive UTC.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Avant ce fix, EventEditorModal stockait les events all_day avec
-- `ends_at = jour saisi 23:59 local`, ce qui était incohérent avec :
--   - L'export iCal (`buildICS`)
--   - La sync miroir des étapes livrables (`livrablesPlanningSync`)
--   - Les calendriers tiers (Google, Apple, Outlook)
--
-- La convention canonique iCal RFC 5545 / DTEND pour all-day est :
--   ends_at = minuit UTC du JOUR SUIVANT le dernier jour inclus.
--
-- Cette migration normalise les events `all_day = true` qui ne sont pas déjà
-- à minuit UTC : on prend la DATE du `ends_at` en UTC et on ajoute 1 jour.
-- Les events déjà à minuit UTC sont conservés tels quels (idempotence).
--
-- Exemples :
--   ends_at "2026-04-15T21:59:00Z" (= 23:59 Paris été)
--     → "2026-04-16T00:00:00Z" (lendemain UTC)
--   ends_at "2026-04-16T00:00:00Z" (déjà exclusive)
--     → INCHANGÉ
--
-- Idempotent : peut être réexécutée sans dommage.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE events
SET ends_at = (
  -- Date UTC du jour de fin courant + 1 jour, à minuit UTC.
  date_trunc('day', ends_at AT TIME ZONE 'UTC') + INTERVAL '1 day'
) AT TIME ZONE 'UTC'
WHERE all_day = true
  AND ends_at <> (
    date_trunc('day', ends_at AT TIME ZONE 'UTC') + INTERVAL '1 day'
  ) AT TIME ZONE 'UTC'
  AND ends_at <> (
    date_trunc('day', ends_at AT TIME ZONE 'UTC')
  ) AT TIME ZONE 'UTC' ;

-- Symétriquement, on s'assure que `starts_at` des all_day est aligné à
-- minuit UTC (il l'est déjà côté sync étapes, mais peut ne pas l'être pour
-- les events saisis en local). On ne change que la part heure, pas la date
-- du jour de début.
UPDATE events
SET starts_at = date_trunc('day', starts_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
WHERE all_day = true
  AND starts_at <> date_trunc('day', starts_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' ;
