# Chantier 3A — Permissions par outil (prestataires)

Système de permissions granulaire pour différencier les prestataires externes
(monteur, cadreur, assistant réa, réalisateur…) par outil, sans toucher au
niveau de sécurité (aucun accès finance / BDD / compta).

Les rôles internes (`admin`, `charge_prod`, `coordinateur`) **bypassent** toutes
les vérifications de permissions outil : ils voient et modifient tout.

---

## 1. Modèle de données

Quatre nouvelles tables + deux colonnes sur `profiles`.

### `outils_catalogue`
Catalogue de référence des outils du projet. **Une ligne = un outil**.
Ajouter un outil futur (liste matériel, décors, …) = insérer une ligne, aucun
code à modifier côté app.

Seed initial : `projet_info`, `equipe`, `planning`, `callsheet`, `production`,
`livrables`, `materiel`, `decors`.

### `metiers_template`
Templates métier réutilisables (Monteur, Cadreur/Chef op, Assistant réa,
Réalisateur). `org_id NULL` = template système partagé.

### `metier_template_permissions`
Matrice permission × outil pour chaque template.
Clé primaire composite `(template_id, outil_key)`.
Trois booléens : `can_read`, `can_comment`, `can_edit`.

Monotonie garantie côté client : `edit ⊃ comment ⊃ read`.

### `prestataire_outils`
Overrides par utilisateur. Permet d'élargir ou restreindre un template pour un
prestataire précis sans créer un nouveau template.
Les colonnes sont `NULL`able : `NULL` = "hériter du template".

### `profiles` — colonnes ajoutées
- `metier_template_id uuid` → template assigné
- `metier_label text` → libellé métier libre ("Chef op lumière")

---

## 2. Seed des templates système

| Template          | projet_info | equipe | planning | callsheet | production | livrables            | materiel | decors |
|-------------------|-------------|--------|----------|-----------|------------|----------------------|----------|--------|
| Monteur           | read        | —      | —        | —         | —          | **edit**             | —        | —      |
| Cadreur / Chef op | read        | read   | read     | read      | read       | read                 | read     | —      |
| Assistant réa     | read        | read   | read     | **edit**  | read       | read                 | read     | read   |
| Réalisateur       | read        | read   | read     | read      | read       | **edit** + comment\* | read     | read   |

\* Le réalisateur a `read+comment` partout et `edit` sur livrables.

---

## 3. Application de la migration

⚠️ **À faire manuellement dans le Supabase SQL Editor** (pas de migration auto).

### Étape 1 — Sauvegarde
Avant toute chose, dans Supabase → **Database → Backups**, déclencher un
snapshot manuel.

### Étape 2 — Exécution du script
1. Ouvrir `supabase/ch3a_permissions.sql` dans l'éditeur SQL de Supabase
2. Copier/coller l'intégralité du fichier
3. Exécuter — le script est **idempotent** (safe à rejouer)

Le script :
1. Relâche temporairement `profiles_role_check` pour autoriser `prestataire`
2. Migre les rôles legacy (`editor` → `charge_prod`, `viewer` → `coordinateur`)
3. Recrée la contrainte avec les 4 rôles cibles
4. Crée les 4 tables + colonnes `profiles`
5. Active RLS et pose les policies
6. Seed les 8 outils du catalogue
7. Seed les 4 templates système (UUID fixes) et leurs matrices de permissions

### Étape 3 — Vérifications

```sql
-- Outils seedés
select key, label, ordre from outils_catalogue order by ordre;
-- attendu : 8 lignes

-- Templates système
select id, key, label from metiers_template where org_id is null;
-- attendu : 4 lignes (Monteur, Cadreur, Assistant réa, Réalisateur)

-- Matrice Monteur
select outil_key, can_read, can_comment, can_edit
from metier_template_permissions
where template_id = '11111111-1111-1111-1111-111111111111'
order by outil_key;
-- attendu : livrables = read+comment+edit, projet_info = read seul

-- Contrainte profiles.role
select pg_get_constraintdef(oid)
from pg_constraint
where conname = 'profiles_role_check';
-- attendu : CHECK (role in ('admin','charge_prod','coordinateur','prestataire'))
```

---

## 4. Assigner un prestataire

Une fois la migration appliquée, pour chaque prestataire existant :

```sql
-- 1. Basculer en rôle prestataire et assigner un template
update profiles
set role = 'prestataire',
    metier_template_id = '11111111-1111-1111-1111-111111111111', -- Monteur
    metier_label = 'Monteur'
where email = 'monteur@example.com';

-- 2. (optionnel) Override : autoriser ce monteur à commenter l'équipe
insert into prestataire_outils (user_id, outil_key, can_read, can_comment, can_edit)
values (
  (select id from profiles where email = 'monteur@example.com'),
  'equipe',
  true, true, false
)
on conflict (user_id, outil_key) do update
set can_read = excluded.can_read,
    can_comment = excluded.can_comment,
    can_edit = excluded.can_edit;
```

Les overrides sont résolus côté client dans `buildPermissions()`
(`src/lib/permissions.js`) : `NULL` = hériter du template, valeur non-null =
remplace.

---

## 5. Fichiers front modifiés

| Fichier                                   | Rôle                                        |
|-------------------------------------------|---------------------------------------------|
| `src/lib/permissions.js`                  | Moteur pur (constantes + `can` + fusion)    |
| `src/lib/permissions.test.js`             | 44 tests unitaires (Vitest)                 |
| `src/contexts/AuthContext.jsx`            | Charge template + overrides, expose `can`   |
| `src/components/guards/RequireRole.jsx`   | Garde de route par rôle                     |
| `src/components/guards/RequirePermission.jsx` | Garde par outil + action                |
| `src/components/Layout.jsx`               | Masque la section BDD pour prestataires     |
| `src/pages/ProjetLayout.jsx`              | Filtre les onglets projet par outil         |
| `src/App.jsx`                             | Wrap des routes sensibles avec `RequireRole` |

---

## 6. API du moteur

```js
import { can, canSee, ACTIONS, OUTILS } from '@/lib/permissions'

// Via l'AuthContext (recommandé)
const { can, canSee, isPrestataire } = useAuth()
canSee(OUTILS.LIVRABLES)             // bool
can(OUTILS.CALLSHEET, ACTIONS.EDIT)  // bool

// Garde de composant
<RequirePermission outil="livrables" action="edit">
  <BoutonAjoutLivrable />
</RequirePermission>
```

Règles :
- `ctx.role` ∈ `INTERNAL_ROLES` ⇒ `can()` renvoie `true` quel que soit l'outil
- Sinon on regarde `ctx.permissions[outil][can_read|comment|edit]`
- Outil inconnu ou action inconnue ⇒ `false`

---

## 7. Tests

```bash
# Dans captiv-budget/
npx vitest run src/lib/permissions.test.js
# ✓ 44 tests (13 suites) — bypass interne, monotonie, fusion overrides,
#   visibilité, rôles, invariants
```

Total suite projet : **102 tests verts** (58 cotisations + 44 permissions).

---

## 8. Prochain chantier — 3B (RLS côté Supabase)

Le filtrage actuel est **côté client uniquement**. Un prestataire qui bypasse
le front peut encore lire toutes les lignes auxquelles ses RLS autorisent.

Chantier 3B ajoutera :
- Table `project_members` (user_id, project_id) pour limiter la vue d'un
  prestataire aux projets où il est attaché
- Helpers SQL `has_outil_read(outil_key)` / `has_outil_edit(outil_key)` qui
  résolvent template + overrides côté serveur
- RLS sur `livrables`, `callsheet`, `equipe_projet`, `planning`, `production`
  utilisant ces helpers

À faire dans la foulée de 3A une fois les templates validés en usage réel.
