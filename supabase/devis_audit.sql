-- ════════════════════════════════════════════════════════════════════════════
-- Devis R4 — Historique des changements (journal d'audit)
-- ════════════════════════════════════════════════════════════════════════════
-- À exécuter UNE FOIS dans le SQL editor Supabase.
--
-- Approche : trigger PostgreSQL AFTER INSERT/UPDATE/DELETE sur devis,
-- devis_categories, devis_lines. Capture TOUS les changements de façon
-- atomique (y compris ceux d'autres utilisateurs / autres onglets), avec
-- l'auteur (auth.uid()), un libellé d'entité lisible, et le diff des champs
-- métier modifiés (changes jsonb = { champ: {old, new}, ... }).
--
-- Le rendu humain ("Tarif : 100 → 120 €") est fait côté JS (lib/devisAuditFormat).
-- Le trigger reste générique et ignore les UPDATE sans changement métier
-- (ex : bump updated_at de l'autosave).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Table ────────────────────────────────────────────────────────────────────
create table if not exists devis_audit (
  id           uuid primary key default uuid_generate_v4(),
  devis_id     uuid not null references devis(id) on delete cascade,
  actor_id     uuid references profiles(id) on delete set null,
  actor_name   text,
  op           text not null check (op in ('INSERT','UPDATE','DELETE')),
  entity       text not null check (entity in ('devis','category','line')),
  entity_id    uuid,
  entity_label text,
  changes      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists devis_audit_devis_idx
  on devis_audit (devis_id, created_at desc);

-- 2) Fonction trigger ─────────────────────────────────────────────────────────
create or replace function devis_log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_devis_id   uuid;
  v_entity     text;
  v_entity_id  uuid;
  v_label      text;
  v_changes    jsonb := '{}'::jsonb;
  v_actor      uuid := auth.uid();
  v_actor_name text;
begin
  select full_name into v_actor_name from profiles where id = v_actor;

  -- ── devis (métadonnées + ajustements globaux) ──────────────────────────────
  if tg_table_name = 'devis' then
    v_entity    := 'devis';
    v_devis_id  := coalesce(new.id, old.id);
    v_entity_id := v_devis_id;
    v_label     := coalesce(new.title, old.title);
    if tg_op = 'UPDATE' then
      if new.title is distinct from old.title then
        v_changes := v_changes || jsonb_build_object('title', jsonb_build_object('old', old.title, 'new', new.title)); end if;
      if new.status is distinct from old.status then
        v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status)); end if;
      if new.tva_rate is distinct from old.tva_rate then
        v_changes := v_changes || jsonb_build_object('tva_rate', jsonb_build_object('old', old.tva_rate, 'new', new.tva_rate)); end if;
      if new.acompte_pct is distinct from old.acompte_pct then
        v_changes := v_changes || jsonb_build_object('acompte_pct', jsonb_build_object('old', old.acompte_pct, 'new', new.acompte_pct)); end if;
      if new.marge_globale_pct is distinct from old.marge_globale_pct then
        v_changes := v_changes || jsonb_build_object('marge_globale_pct', jsonb_build_object('old', old.marge_globale_pct, 'new', new.marge_globale_pct)); end if;
      if new.assurance_pct is distinct from old.assurance_pct then
        v_changes := v_changes || jsonb_build_object('assurance_pct', jsonb_build_object('old', old.assurance_pct, 'new', new.assurance_pct)); end if;
      if new.remise_globale_pct is distinct from old.remise_globale_pct then
        v_changes := v_changes || jsonb_build_object('remise_globale_pct', jsonb_build_object('old', old.remise_globale_pct, 'new', new.remise_globale_pct)); end if;
      if new.remise_globale_montant is distinct from old.remise_globale_montant then
        v_changes := v_changes || jsonb_build_object('remise_globale_montant', jsonb_build_object('old', old.remise_globale_montant, 'new', new.remise_globale_montant)); end if;
      if new.notes is distinct from old.notes then
        v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('old', old.notes, 'new', new.notes)); end if;
      if v_changes = '{}'::jsonb then return null; end if;  -- bump updated_at seul → on ignore
    end if;

  -- ── catégories ─────────────────────────────────────────────────────────────
  elsif tg_table_name = 'devis_categories' then
    v_entity    := 'category';
    v_devis_id  := coalesce(new.devis_id, old.devis_id);
    v_entity_id := coalesce(new.id, old.id);
    v_label     := coalesce(new.name, old.name);
    if tg_op = 'UPDATE' then
      if new.name is distinct from old.name then
        v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', old.name, 'new', new.name)); end if;
      if new.dans_marge is distinct from old.dans_marge then
        v_changes := v_changes || jsonb_build_object('dans_marge', jsonb_build_object('old', old.dans_marge, 'new', new.dans_marge)); end if;
      if new.notes is distinct from old.notes then
        v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('old', old.notes, 'new', new.notes)); end if;
      if v_changes = '{}'::jsonb then return null; end if;  -- ex : reorder (sort_order) seul → ignoré
    end if;

  -- ── lignes ─────────────────────────────────────────────────────────────────
  elsif tg_table_name = 'devis_lines' then
    v_entity    := 'line';
    v_devis_id  := coalesce(new.devis_id, old.devis_id);
    v_entity_id := coalesce(new.id, old.id);
    v_label     := coalesce(new.produit, old.produit);
    if tg_op = 'UPDATE' then
      if new.produit is distinct from old.produit then
        v_changes := v_changes || jsonb_build_object('produit', jsonb_build_object('old', old.produit, 'new', new.produit)); end if;
      if new.description is distinct from old.description then
        v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', old.description, 'new', new.description)); end if;
      if new.regime is distinct from old.regime then
        v_changes := v_changes || jsonb_build_object('regime', jsonb_build_object('old', old.regime, 'new', new.regime)); end if;
      if new.use_line is distinct from old.use_line then
        v_changes := v_changes || jsonb_build_object('use_line', jsonb_build_object('old', old.use_line, 'new', new.use_line)); end if;
      if new.nb is distinct from old.nb then
        v_changes := v_changes || jsonb_build_object('nb', jsonb_build_object('old', old.nb, 'new', new.nb)); end if;
      if new.quantite is distinct from old.quantite then
        v_changes := v_changes || jsonb_build_object('quantite', jsonb_build_object('old', old.quantite, 'new', new.quantite)); end if;
      if new.unite is distinct from old.unite then
        v_changes := v_changes || jsonb_build_object('unite', jsonb_build_object('old', old.unite, 'new', new.unite)); end if;
      if new.tarif_ht is distinct from old.tarif_ht then
        v_changes := v_changes || jsonb_build_object('tarif_ht', jsonb_build_object('old', old.tarif_ht, 'new', new.tarif_ht)); end if;
      if new.cout_ht is distinct from old.cout_ht then
        v_changes := v_changes || jsonb_build_object('cout_ht', jsonb_build_object('old', old.cout_ht, 'new', new.cout_ht)); end if;
      if new.remise_pct is distinct from old.remise_pct then
        v_changes := v_changes || jsonb_build_object('remise_pct', jsonb_build_object('old', old.remise_pct, 'new', new.remise_pct)); end if;
      if new.category_id is distinct from old.category_id then
        v_changes := v_changes || jsonb_build_object('category_id', jsonb_build_object('old', old.category_id, 'new', new.category_id)); end if;
      if v_changes = '{}'::jsonb then return null; end if;  -- ex : reorder (sort_order) seul → ignoré
    end if;

  else
    return null;
  end if;

  insert into devis_audit (devis_id, actor_id, actor_name, op, entity, entity_id, entity_label, changes)
  values (v_devis_id, v_actor, v_actor_name, tg_op, v_entity, v_entity_id, v_label, v_changes);

  return null;  -- AFTER trigger : valeur de retour ignorée
end $$;

-- 3) Triggers ─────────────────────────────────────────────────────────────────
drop trigger if exists trg_devis_audit       on devis;
drop trigger if exists trg_devis_cat_audit   on devis_categories;
drop trigger if exists trg_devis_lines_audit on devis_lines;

create trigger trg_devis_audit
  after update on devis
  for each row execute function devis_log_change();

create trigger trg_devis_cat_audit
  after insert or update or delete on devis_categories
  for each row execute function devis_log_change();

create trigger trg_devis_lines_audit
  after insert or update or delete on devis_lines
  for each row execute function devis_log_change();

-- 4) RLS — lecture scopée au même périmètre finance que les devis ─────────────
alter table devis_audit enable row level security;

-- Visibilité = même périmètre que le devis lui-même (org). Quiconque peut
-- ouvrir/éditer le devis voit son historique. (NB : ne PAS restreindre à
-- can_see_project_finance, sinon un collaborateur qui voit le devis mais
-- n'est ni admin ni chargé de prod-membre ne verrait jamais l'historique.)
drop policy if exists "devis_audit_read" on devis_audit;
create policy "devis_audit_read" on devis_audit
  for select
  using (devis_id in (
    select d.id from devis d
    join projects p on d.project_id = p.id
    where p.org_id = get_user_org_id()
  ));
-- Pas de policy INSERT : seul le trigger (security definer) écrit.

-- 5) Realtime — le panneau Historique s'actualise en direct ───────────────────
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.devis_audit; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
