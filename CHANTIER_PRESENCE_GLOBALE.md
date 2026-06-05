# CHANTIER — Présence globale (avatars + soft-lock sur tous les onglets)

> Déployer la couche de collaboration temps réel (avatars "qui est sur la
> page" + soft-lock per-row "qui édite quoi") sur **TOUS les onglets
> projet** pour que l'équipe sache toujours qui fait quoi et où.

---

## 🎯 Objectif

Aujourd'hui, seuls **2 onglets sur 14** ont la couche présence (Équipe,
Matériel). On veut **généraliser** sur tous les onglets projet pour que :

- L'utilisateur voit en permanence qui d'autre est sur le même projet
- L'utilisateur sait sur QUEL onglet précis chaque collègue est
- En cours d'édition (formulaire, ligne, créneau, etc.), un soft-lock
  visuel évite les écrasements involontaires
- Les ouvertures fantôme d'onglets (Cmd+Click malheureux) sont tracées

---

## 🏗️ Architecture cible

### 1. Hook générique `useProjectPresence(outilKey, options?)`

Factoriser `useEquipePresence` / `useMaterielPresence` en un seul hook
configurable :

```js
const { othersOnPage, othersEditingByRow, setMyEditingRowId } =
  useProjectPresence('devis', { projectId, rowKey: 'devis_id' })
```

API identique à l'existant. Implémentation interne :

- Channel `${outilKey}-presence:${projectId}`
- Payload générique avec `editing_row_id` optionnel
- Dédoublonnage tab_key inchangé

**Migration** :
- `useEquipePresence` et `useMaterielPresence` deviennent des wrappers
  minces sur `useProjectPresence`
- Pas de breaking change sur les composants existants

### 2. Composant `<ProjectPresenceBadge>` (header standard)

Wrapper sur `<PresenceAvatars>` + auto-call de `useProjectPresence` :

```jsx
<ProjectPresenceBadge outilKey="devis" projectId={projectId} />
```

À placer dans le header de chaque onglet (à côté du titre / breadcrumbs).

### 3. Vue cross-projet : "Qui est où"

Bonus pratique : un mini-widget dans le header global qui montre, pour
chaque admin connecté à DESK, sur quel projet ET quel onglet il est.

Channel global : `desk-presence` (pas scopé projet).

Payload : `{ user_id, full_name, project_id, project_titre, outil_key,
ts }`.

Utile pour :
- Réa qui ouvre 3 projets en parallèle → voir où sont les autres
- Avant d'appeler un collègue, vérifier qu'il n'est pas en train de
  bosser sur l'autre dossier

---

## 📋 Sprints

### Sprint PRES-1 — Refactor hook générique (1j)
- Création `src/hooks/useProjectPresence.js` (extraction du commun)
- `useEquipePresence` et `useMaterielPresence` deviennent wrappers
- Composant `<ProjectPresenceBadge outilKey projectId />`
- Tests : 2 onglets Équipe ouverts, présences attendues
- **À faire idéalement AVANT le déploiement Sprint 2 Déroulé** pour que
  Déroulé hérite directement du hook générique

### Sprint PRES-2 — Déploiement sur tous les onglets (2j)
Ajouter `<ProjectPresenceBadge>` + `useProjectPresence` sur les 12
onglets restants :

| Onglet | outilKey | rowKey (si applicable) | Priorité |
|---|---|---|---|
| Devis | `devis` | `ligne_id` | 🔴 critique (co-édition fréquente) |
| Déroulé | `deroule` | `creneau_id` | 🔴 critique (Sprint 2 Festival) |
| Logistique | `logistique` | `membre_id` ? | 🟡 important |
| Plans (de tournage) | `plans` | `plan_id` | 🟡 important |
| Planning (calendrier projet) | `planning` | `event_id` ? | 🟡 important |
| Production | `production` | `task_id` ? | 🟢 utile |
| Livrables | `livrables` | `livrable_id` | 🟢 utile |
| Factures | `factures` | `facture_id` | 🟢 utile |
| Budget réel | `budget_reel` | `ligne_id` | 🟢 utile |
| Dashboard projet | `dashboard` | (pas de row) | 🔵 avatars seulement |
| Projet (cover) | `projet` | (pas de row) | 🔵 avatars seulement |
| Access (permissions) | `access` | `user_id` | 🔵 avatars seulement |

Note : `outilKey` doit correspondre à la clé déjà utilisée pour les
permissions (`can_read_outil` / `can_edit_outil`) → cohérence des deux
systèmes.

### Sprint PRES-3 — Vue cross-projet "Qui est où" (1-2j)
- Hook `useDeskPresence()` (channel global)
- Widget header global avec dropdown listant qui est sur quel projet/outil
- Avatars cliquables → navigation directe vers le même projet/onglet
- (Bonus) Animation "ping" quand quelqu'un arrive ou part

### Sprint PRES-4 — Cohérence visuelle finale (0.5j)
- Vérif placement de `<ProjectPresenceBadge>` sur les 14 onglets (même
  position : top-right du header par convention)
- Tests E2E rapides : 3 onglets ouverts, voir les 3 avatars sur chaque
- Lint + revue UI

---

## 🔗 Dépendances avec autres chantiers

- **Sprint 2 Festival Déroulé** : juste après PRES-1, Déroulé bénéficie
  du hook générique pour son soft-lock sur les créneaux
- **CHANTIER_NOTES_DOCS** : `outilKey='notes'` réutilise le même hook
- **CHANTIER_MOBILE_PWA** : pas de couplage direct, mais sur mobile la
  rangée d'avatars doit être responsive (collapsible derrière une icône
  "people" qui ouvre un sheet bottom)

---

## ⚠️ Considérations techniques

### Coût Supabase Realtime

Chaque admin connecté ouvre 1 channel par projet × par outil visité. Si
un admin a 5 projets en favoris ouverts sur 14 onglets = 70 channels
simultanés. Vérifier les **limites du plan Supabase** avant déploiement
PRES-2 :

- Plan Pro : 500 concurrent connections
- Channels comptent comme connexions séparées
- Si soucis : channel unique par projet, scopage par event interne

**Mitigation possible** : un seul channel par projet avec un type
d'event interne `outil_key` au lieu de N channels.

### Soft-lock : politique de résolution

Si Sophie et Hugo ouvrent la même row en même temps (race condition de
quelques ms), les deux verront un soft-lock l'un sur l'autre. Politique
proposée :

- Soft-lock = avertissement visuel uniquement (pas de blocage hard)
- Le dernier qui save écrase, mais on affiche un toast "Cette ligne a
  été modifiée par X il y a Xs"
- Pour les fichiers critiques (notes Tiptap) : Y.js gère le merge donc
  pas de conflit → soft-lock devient cosmétique

### RGPD / présence

La présence affiche `full_name` + `email`. C'est OK entre admins du même
projet (ils se connaissent) mais à ne PAS exposer côté share publique.

---

## 📅 Timing prévisionnel

**Recommandation** : insérer **PRES-1 juste avant Sprint 2 Déroulé**
pour que Déroulé hérite directement du hook générique. PRES-2 / PRES-3
peuvent suivre quand on a du temps.

Estimation totale : **4-5 jours** (PRES-1 à PRES-4).

Trade-off : on peut aussi simplement appeler `useEquipePresence`
renommé/copié sur chaque onglet sans refactor → +0j de prep mais dette
technique (3 hooks dupliqués deviennent 14).
