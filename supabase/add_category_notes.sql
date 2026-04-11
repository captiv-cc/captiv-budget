-- Migration : ajout de la colonne notes sur devis_categories
alter table devis_categories add column if not exists notes text;
