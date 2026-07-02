-- ════════════════════════════════════════════════════════════════════════════
-- Envoi client Phase 1 : dates de statut, snapshot PDF, tracking de vues
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase. Idempotent.
--
-- 1. Colonnes de cycle de vie sur devis (sent_at, accepted_at, refused_at)
--    + référence du PDF figé à l'envoi (snapshot immuable montré au client).
-- 2. Trigger : horodate automatiquement les transitions de statut, quelle que
--    soit l'origine du changement (éditeur, page des lots, page publique).
-- 3. Table devis_public_events : vues / téléchargements / acceptations du lien
--    public. Écrite UNIQUEMENT par l'edge function devis-public (service role).
-- 4. Bucket privé devis-snapshots : le client y accède via URL signée générée
--    par l'edge function ; les membres de l'org y accèdent authentifiés.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Colonnes ─────────────────────────────────────────────────────────────────
alter table devis add column if not exists sent_at           timestamptz;
alter table devis add column if not exists accepted_at       timestamptz;
alter table devis add column if not exists refused_at        timestamptz;
alter table devis add column if not exists pdf_snapshot_path text;
alter table devis add column if not exists pdf_snapshot_hash text;
alter table devis add column if not exists pdf_snapshot_at   timestamptz;

-- 2) Horodatage des transitions de statut ─────────────────────────────────────
create or replace function devis_stamp_status_dates()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'envoye' then
      new.sent_at := coalesce(new.sent_at, now());  -- premier envoi seulement
    elsif new.status = 'accepte' then
      new.accepted_at := now();
    elsif new.status = 'refuse' then
      new.refused_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_devis_status_dates on devis;
create trigger trg_devis_status_dates
  before update on devis
  for each row execute function devis_stamp_status_dates();

-- 3) Événements du lien public ────────────────────────────────────────────────
create table if not exists devis_public_events (
  id         uuid primary key default uuid_generate_v4(),
  devis_id   uuid not null references devis(id) on delete cascade,
  type       text not null check (type in ('view','download','accept','refuse')),
  user_agent text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists devis_public_events_devis_idx
  on devis_public_events (devis_id, created_at desc);

alter table devis_public_events enable row level security;

-- Lecture : membres de l'org (même périmètre que le devis).
-- Aucune policy INSERT : seule l'edge function (service role) écrit.
drop policy if exists "devis_public_events_read" on devis_public_events;
create policy "devis_public_events_read" on devis_public_events
  for select
  using (devis_id in (
    select d.id from devis d
    join projects p on d.project_id = p.id
    where p.org_id = get_user_org_id()
  ));

-- Realtime : l'admin voit les vues/acceptations arriver en direct.
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.devis_public_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 4) Storage : bucket privé des snapshots PDF ─────────────────────────────────
insert into storage.buckets (id, name, public)
values ('devis-snapshots', 'devis-snapshots', false)
on conflict (id) do nothing;

-- Convention de path : devis-snapshots/<devis_id>/<filename>.pdf

-- Upload par les membres de l'org qui voient le devis (génération côté admin)
drop policy if exists "devis-snapshots insert org" on storage.objects;
create policy "devis-snapshots insert org"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'devis-snapshots'
    and exists (
      select 1 from devis d
      join projects p on d.project_id = p.id
      where d.id::text = (storage.foldername(name))[1]
        and p.org_id = get_user_org_id()
    )
  );

-- Lecture authentifiée (preview admin). Le client public passe par une URL
-- signée générée par l'edge function (service role), pas par cette policy.
drop policy if exists "devis-snapshots read org" on storage.objects;
create policy "devis-snapshots read org"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'devis-snapshots'
    and exists (
      select 1 from devis d
      join projects p on d.project_id = p.id
      where d.id::text = (storage.foldername(name))[1]
        and p.org_id = get_user_org_id()
    )
  );
