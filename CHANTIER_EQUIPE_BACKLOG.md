# CHANTIER ÉQUIPE — Backlog post-audit

> **État** : Chantier Sessions Phase A bouclé (2026-05-08).
> Ce doc liste les findings **non fixés** des audits cross-fichier menés
> pendant la finalisation du chantier. À reprendre lors d'une passe cleanup
> dédiée, ou opportunistiquement quand on touche au fichier concerné.

## Légende

- 🟠 **Important** — comportement subtilement faux ou drift à corriger un jour
- 🟡 **Mineur** — polish, perf marginale, code smell
- 🔵 **Drift de shape** — divergence d'API sans impact runtime aujourd'hui
- 🤔 **Suspect** — cas-limite identifié, mérite vérification humaine ou test

---

## 🟠 Important

### `crew.js:joinSession` — ne propage pas `arrival_time` / `departure_time`

Quand un membre rejoint une session existante via `joinSession()`, on hérite
`arrival_date` / `departure_date` depuis la session globale (`session.start_date`
/ `session.end_date`) mais pas les heures. Pas appelé par le front aujourd'hui
(les heures sont saisies après le join dans la modale Présence) — à brancher
proprement quand on aura un flow "rejoindre avec heures".

### `TechListView.jsx` — `localStorage` flash avant hydratation DB

`extraCategories` / `hiddenCategories` / `categoryOrder` lisent `localStorage`
au premier render avant que l'effet d'hydratation DB ne tire. Sur un nouveau
device, ça produit un flash visuel si les catégories DB diffèrent. Fix : ne
pas rendre les sections custom tant que `hydratedFromDbRef.current === projectId`,
ou afficher un loader.

### `TechListView.jsx` — 2 useEffect cleanup catégories quasi-identiques

Lignes ~159-166 (`extraCategories` cleanup) et ~191-198 (`hiddenCategories`
cleanup) font la même chose sur des states différents. Consolidable en un
seul useEffect ou un helper. Code smell, pas de bug.

### `useCrew.js:deleteSession` — non-transactionnel

Si la suppression de la participation réussit mais l'invalidation Realtime
échoue, le state local reste désynchronisé. Idéalement wrap dans une
RPC SECURITY DEFINER `delete_session_participation(p_id)` qui fait tout
côté serveur en une transaction. Faible probabilité, faible impact.

### `PresenceCalendarModal.jsx` — édition concurrente last-write-wins silencieux

Si deux admins éditent le même membre/session simultanément, le 2ᵉ écrase le
1ᵉʳ sans toast. L'effet 1 et 2 (l. 194-219) ont `eslint-disable
react-hooks/exhaustive-deps` et ne re-snapshotent pas si `activeSession`
arrive via Realtime. Solution : comparer le snapshot reçu au snapshot local,
afficher un toast "modifié ailleurs — recharger ?" si divergence. Hors
scope cleanup, demande un système de versioning serveur.

### `PresenceCalendarModal.jsx` — autosave error switch session

Dans `performSave` (l. 268-270), le check `sessionId === activeSessionId`
empêche de restaurer le `pendingPayloadRef` si l'utilisateur a switché de
session avant que l'erreur réseau remonte → la modif sur l'ancienne
session est silencieusement perdue. Soit on skip la restauration (cas
actuel, OK), soit on garde un bucket `pendingBySession`. Réfléchir à
ce qu'on veut.

### `PresenceCalendarModal.jsx` — cleanup unmount stale closure (audit FR3)

`useEffect(() => () => flushPending(), [])` capture `flushPending` du PREMIER
render. Pour le path `updatePersona` (membre persona-level sans session), le
`onSave` capture peut être stale. Le path principal `updateMemberSession`
(Phase A) lit `sessionsRef.current` donc OK. À fixer en stockant
`flushPending` dans un `useRef` mis à jour à chaque render.

### `EquipeTab.jsx` — rollback snapshot trop large (audit FR3)

`updateMembre` / `removeMembre` snapshotent `membres` complet avant l'await.
En cas d'échec, `setMembres(snapshot)` annule aussi les updates concurrents
(realtime ou autre `updateMembre` en parallèle). Devrait reverter uniquement
la row affectée : `setMembres((p) => p.map(m => m.id === id ? snapshotRow : m))`.

### `EquipeShareSession.jsx` — `lot_id` fallback incomplet (audit FR3)

Si `m.devis_line.devis_id` existe mais n'est pas dans `devisIdToLotId`
(mapping incomplet, ex: devis archivé), la branche prend `undefined` et
`m.lot_id` n'est PAS testé. Devrait être :
`(m.devis_line?.devis_id && devisIdToLotId[m.devis_line.devis_id]) || m.lot_id || null`.

### `EquipeTab.jsx:removeMembre` — bypass `useCrew`

Le composant n'utilise pas `useCrew` (architecture spécifique : son propre
`setMembres`). En conséquence les sessions associées au membre supprimé ne
sont pas re-agrégées localement (le CASCADE DB nettoie bien
`projet_session_membres` mais l'event Realtime n'est pas muté). Aujourd'hui
sans impact car EquipeTab ne possède pas la TechList. À nettoyer si on
unifie l'architecture.

---

## 🟡 Mineur

### Drift `PERSONA_LEVEL_FIELDS` — `presence_days` reliquat

Phase 0a → Phase A : `presence_days` est devenu participation-level (sur
`projet_session_membres`) mais il reste dans `PERSONA_LEVEL_FIELDS` côté
front. Pas exploité, mais source de confusion future.

### `legacy_session_id` — colonne reliquat

Sur `projet_session_membres`, après le drop de la table legacy, la colonne
`legacy_session_id` (avec son UNIQUE INDEX) n'est plus utilisée. À drop
quand on est sûrs qu'aucune migration de données ne s'y appuie.

### `cleanup_phantom_sessions_step2.sql` — critères trop relaxés

La 2ᵉ passe a effacé toute session avec `label IS NULL AND lieu IS NULL`,
ce qui est correct pour le seed legacy mais aurait pu prendre une session
en cours de création. Migration passée en prod, irréversible — note pour
ne pas reproduire le pattern.

### `AttributionRow.jsx` — `[...presence_days].sort()` 2× par render

`firstPresenceDay` et `lastPresenceDay` (l. 174-179) refont le sort à
chaque appel. Mémoïsable. Perf marginale.

### `EquipeTab.jsx` — RGPD données sensibles

`regime_alimentaire` / `taille_tshirt` sont retournés sans gating
sensible côté `useCrew`. Pas grave aujourd'hui (admin uniquement) mais
à gater par `canSeeFinance` ou `canSeeSensitive` quand on aura un
mode "sous-traitant".

### `tel:` / `mailto:` — over-encoding du `+` (audit FR3)

Le fix `encodeURIComponent` introduit dans `1bd7753` corrige les espaces
mais transforme `+33` en `%2B33` — la plupart des dialers iOS/Android
décodent bien, mais certains clients VoIP / Outlook handlers traitent
mal `%2B` dans le local-part. Alternative : `encodeURI(tel.replace(/\s/g, ''))`
ou strip espaces sans encoder le `+`.

### Triggers — ordre de feu fragile

Dans `20260507_session_membres_same_project_check.sql`, l'invariant
"`set_project_id_ins` < `same_project_ins`" repose sur l'ordre alphabétique
des noms de trigger dans `pg_trigger`. Un futur renommage casse silencieusement
la garde-fou. Fusionner en un seul trigger ou ajouter un test
d'intégration.

### `crew.js:createSession` retry — message trompeur (audit FR3)

Le retry break sur `e2.code !== '23505'`, mais le `throw` final dit
"race sort_order" même quand l'erreur réelle est RLS / FK / NOT NULL.
Différencier les deux cas dans le throw.

### `pg_tables` filter manquant (audit DBA)

Dans `20260506_drop_legacy_projet_membres_sessions.sql`, le check
`SELECT 1 FROM pg_tables WHERE tablename = '...'` n'a pas
`AND schemaname = 'public'` — faux positif possible si table homonyme
existe ailleurs. Migration passée, sans impact.

---

## 🔵 Drift de shape (sans impact runtime)

Aucun à ce jour : la migration `20260508_share_equipe_complete_sessions_shape.sql`
+ `20260508_share_equipe_fetch_hotfix.sql` ont aligné les deux RPCs share
(`share_equipe_fetch` + `share_projet_equipe_fetch`) sur le shape complet
(avec `notes`, `start_date`, `end_date`, `lieu_principal_id`, et
`contact.prenom/nom`).

---

## 🤔 Suspects à vérifier

### `ORDER BY ps.sort_order, psm.membre_id` (audit DBA)

Dans les RPCs share, le tri secondaire par UUID `membre_id` est
déterministe mais sémantiquement aléatoire (ne suit ni le nom ni l'ordre
admin). Cosmétique. Si on veut un ordre stable pour l'utilisateur, trier
par `psm.id` ou par sous-requête sur `projet_membres.sort_order`.

### Trigger `BEFORE UPDATE OF session_id` (audit DBA)

Dans `20260506_equipe_sessions_phase_a_audit_fixes.sql:81`, le trigger
ne refire que sur UPDATE de `session_id`. Un UPDATE qui force un
`project_id` incohérent (sans toucher session_id) n'est pas réécrit.
Ajouter `OF session_id, project_id` ou rendre inconditionnel pour
verrouiller la garde.

---

## Notes méta

- **Tous les fixes critiques** ont été appliqués dans les commits
  `a7243c9` (fix audit critiques 4/7), `1bd7753` (backlog Important + Mineur),
  `e5b36b2` + `4746153` (drift SQL share + hotfix).
- **Le chantier Sessions Phase A** est officiellement fermé.
- **Prochaine étape** : LOGISTIQUE V1 (cf. `CHANTIER_LOGISTIQUE.md`).
