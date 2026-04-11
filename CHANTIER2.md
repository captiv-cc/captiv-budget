# Chantier 2 — Robustesse UX

**Objectif :** rendre l'app incassable côté interface utilisateur.
**Date :** avril 2026
**Statut :** ✅ livré

---

## Ce que ce chantier apporte

1. **ErrorBoundary global** — plus jamais de page blanche si une erreur React survient quelque part dans l'app
2. **Système de toasts** (`react-hot-toast`) — notifications élégantes, prêtes à remplacer les `alert()` moches
3. **Page `/unauthorized`** — écran propre quand un utilisateur tente d'accéder à une page interdite

---

## Installation (à faire une seule fois)

Dans le terminal, à la racine de `captiv-budget` :

```bash
npm install
```

Cela installera `react-hot-toast` qui vient d'être ajouté dans `package.json`.

Vérifie ensuite que l'app démarre correctement :

```bash
npm run dev
```

Tu devrais voir l'app tourner sur `http://localhost:5173` comme d'habitude.

---

## Comment tester visuellement chaque livrable

### ✅ Test 1 — Page /unauthorized (le plus simple)

1. Lance `npm run dev`
2. Connecte-toi normalement
3. Dans la barre d'adresse, tape : `http://localhost:5173/unauthorized`

Tu dois voir une carte blanche avec :
- Une icône bouclier ambre
- Le titre **"Accès non autorisé"**
- Ton nom et ton rôle affichés
- Deux boutons : **"Page précédente"** et **"Accueil"**

### ✅ Test 2 — Toasts

Pour tester sans toucher au code, ouvre la console développeur du navigateur (F12) sur n'importe quelle page de l'app et tape :

```js
// Import via le module — à adapter selon ton routing de dev
// Ou plus simple : dans la source, ajoute temporairement un bouton
```

Plus pragmatique : ajoute un bouton de test dans `HomePage.jsx` (à enlever après) :

```jsx
import { notify } from '../lib/notify'

// Dans ton JSX :
<div className="flex gap-2">
  <button onClick={() => notify.success('Sauvegarde OK')} className="btn-primary">Success</button>
  <button onClick={() => notify.error('Erreur réseau')} className="btn-primary">Error</button>
  <button onClick={() => notify.info('Export en cours…')} className="btn-primary">Info</button>
  <button onClick={() => notify.warn('Devis non validé')} className="btn-primary">Warn</button>
</div>
```

Tu dois voir apparaître un toast en **haut à droite** avec :
- **Success** → icône verte, message clair
- **Error** → icône rouge, reste 5 secondes (plus long pour laisser le temps de lire)
- **Info** → icône ℹ️
- **Warn** → fond jaune, icône ⚠️

### ✅ Test 3 — ErrorBoundary (le plus spectaculaire)

Pour le tester, force temporairement un crash dans une page existante.
Par exemple dans `HomePage.jsx`, ajoute cette ligne au tout début du composant :

```jsx
export default function HomePage() {
  throw new Error('Test ErrorBoundary — crash volontaire')
  // ... reste du code
```

Recharge la page. Au lieu d'une page blanche, tu dois voir :
- Une carte blanche centrée
- Icône ⚠️ rouge
- Titre **"Oups, une erreur est survenue"**
- En mode dev, un encart dépliable **"Détails techniques"** qui montre la stack React
- Deux boutons : **"Recharger la page"** et **"Retour à l'accueil"**

**N'oublie pas de retirer le `throw` après le test !**

---

## Utiliser les toasts dans tes développements futurs

### Import

```js
import { notify } from '../lib/notify'
```

### API disponibles

```js
notify.success('Devis enregistré')
notify.error('Impossible de supprimer le client : il a des devis liés')
notify.info('Export PDF en cours…')
notify.warn('Attention : marge négative sur cette ligne')

// Pour les actions async, encore plus pratique :
notify.promise(
  supabase.from('devis').insert(newDevis),
  {
    loading: 'Enregistrement du devis…',
    success: 'Devis créé avec succès',
    error: 'Erreur lors de la création du devis',
  }
)
```

### Où remplacer des `alert()` en priorité

À faire au fil des chantiers suivants (pas bloquant pour aujourd'hui) :

| Fichier | Ce qu'on remplace | Par |
|---|---|---|
| `DevisEditor.jsx` | `alert('Erreur sauvegarde')` | `notify.error('Impossible d'enregistrer le devis')` |
| `BDD.jsx` | `alert('Produit ajouté')` | `notify.success('Produit ajouté à la base')` |
| `Clients.jsx` | `confirm('Supprimer ?')` | Toast avec boutons (voir doc react-hot-toast) |
| `Compta.jsx` | `console.error` silencieux | `notify.error(err.message)` |

**Important :** garder les `alert()` critiques qui nécessitent une confirmation bloquante (suppression définitive par exemple) tant qu'on n'a pas de modal de confirmation. Les toasts ne sont pas bloquants.

---

## Architecture — où se trouve chaque brique

```
src/
├── App.jsx                     ← <ErrorBoundary><AuthProvider><Toaster /></…/>
├── components/
│   ├── ErrorBoundary.jsx       ← 🆕 filet de sécurité global
│   └── Layout.jsx
├── lib/
│   ├── notify.js               ← 🆕 wrapper autour de react-hot-toast
│   └── cotisations.js          ← (inchangé)
└── pages/
    └── Unauthorized.jsx        ← 🆕 page d'accès refusé
```

---

## Ce qui reste à faire (chantier 3)

- Créer le composant `<RequireRole roles={['admin']}>` qui redirige vers `/unauthorized` si l'utilisateur n'a pas le rôle
- Filtrer la sidebar dans `Layout.jsx` selon le rôle (ex: masquer "Compta" pour un coordinateur)
- Appliquer `<RequireRole>` sur les routes sensibles (`/compta`, `/dashboard`, `/parametres`)

La page `/unauthorized` créée dans ce chantier est la destination par défaut du chantier 3.

---

## Vérification des tests

Les 58 tests de `cotisations.js` restent tous verts après ce chantier — aucune régression.

```bash
npm test
```
