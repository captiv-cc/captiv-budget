-- ════════════════════════════════════════════════════════════════════════════
-- Signature Phase 2 : demandes de signature Universign
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase. Idempotent.
--
-- Une ligne par demande de signature envoyée à Universign. Écrite uniquement
-- par les edge functions devis-sign / universign-webhook (service role).
-- `proof` conserve la réponse transaction complète d'Universign (dossier de
-- preuve : identifiants, horodatages, niveau de signature).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists devis_signatures (
  id              uuid primary key default uuid_generate_v4(),
  devis_id        uuid not null references devis(id) on delete cascade,
  provider        text not null default 'universign',
  transaction_id  text not null,
  signer_name     text not null,
  signer_email    text not null,
  signer_fonction text,
  status          text not null default 'started'
                  check (status in ('started','signed','refused','expired','failed','canceled')),
  signed_pdf_path text,
  proof           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists devis_signatures_devis_idx
  on devis_signatures (devis_id, created_at desc);
create unique index if not exists devis_signatures_tx_idx
  on devis_signatures (transaction_id);

alter table devis_signatures enable row level security;

-- Lecture : membres de l'org (même périmètre que le devis). Pas d'écriture
-- côté client : seules les edge functions (service role) écrivent.
drop policy if exists "devis_signatures_read" on devis_signatures;
create policy "devis_signatures_read" on devis_signatures
  for select
  using (devis_id in (
    select d.id from devis d
    join projects p on d.project_id = p.id
    where p.org_id = get_user_org_id()
  ));

-- Realtime : l'admin voit la signature arriver en direct.
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.devis_signatures; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
