-- ════════════════════════════════════════════════════════════════════════════
-- Notifications N3 : cron quotidien → devis-scheduler (relances, expiration)
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter dans le SQL editor Supabase APRÈS avoir déployé devis-scheduler
-- et REMPLACÉ les deux placeholders ci-dessous. Ré-exécutable (le job est
-- recréé à chaque passage).
--
-- <SCHEDULER_SECRET> : secret dédié, à générer puis enregistrer côté fonction :
--   openssl rand -hex 24
--   supabase secrets set SCHEDULER_SECRET=<la même valeur>
-- (portée minimale : ce secret ne permet QUE de déclencher le scheduler)
--
-- Mécanisme : pg_cron déclenche chaque jour à 07:00 UTC (09:00 Paris été,
-- 08:00 hiver) un POST pg_net vers l'edge function.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-création idempotente du job
DO $$
BEGIN
  PERFORM cron.unschedule('devis-scheduler-daily');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job inexistant au premier passage
END $$;

select cron.schedule(
  'devis-scheduler-daily',
  '0 7 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/devis-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SCHEDULER_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Vérifier : select jobname, schedule, active from cron.job;
-- Historique : select * from cron.job_run_details order by start_time desc limit 5;
