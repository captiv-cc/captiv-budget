# CHANTIER — UI Kit DESK : règles d'usage des popups, modales, tooltips

> Règles à respecter pour TOUS les nouveaux composants UI qui affichent
> du contenu superposé (popover, dropdown, modal, tooltip, confirmation).
> Aucune utilisation de `window.alert / confirm / prompt` natifs.

---

## Vue d'ensemble : 5 catégories

| Catégorie | Usage | Composant DESK |
|---|---|---|
| **Tooltip** | Info contextuelle au survol | `<Tooltip text="…">` |
| **Popover anchored** | Action liée à un élément (clic) | À implémenter selon cas |
| **Dropdown** | Choix dans une liste | `<CustomSelect>` |
| **Modal centré** | Action explicite (lien, propagation) | Modal custom inline |
| **Confirmation** | Validation d'action destructive | `confirm({...})` impératif |

---

## 1. `<Tooltip>` — info au survol

**Fichier** : `src/components/Tooltip.jsx`

```jsx
<Tooltip text="Lier à un créneau" side="top">
  <button>...</button>
</Tooltip>
```

- Survol 300ms avant apparition
- Fade-in 100ms, disparition immédiate
- Style cohérent thème DESK
- Side : `top` (défaut) | `bottom` | `left` | `right`
- Pas d'action cliquable dedans (juste de l'info)
- **Remplace `title="..."` HTML natif**

---

## 2. Popover anchored — action liée à un élément

**Pattern** : popover qui apparait à côté d'un élément cliqué (bouton, bloc),
avec :
- Position calculée auto via `usePopoverPosition({ anchorRect, ... })`
- Flip auto si bord d'écran
- Backdrop : **PAS de backdrop** (l'utilisateur voit le contexte)
- Click outside → ferme
- Esc → ferme
- Fade-in 100-160ms, scale subtile

**Exemples existants** :
- `CreneauInspector` (popover créneau anchored au bloc)
- `DayPicker` (calendrier anchored au bouton date)
- `LinkPopover` dans le RichEditor (URL au survol du bouton lien)
- `QuickCreateMenu` (clic dans trou de lane)

**Mécanique standard** :
```jsx
const { popoverRef, position, ready } = usePopoverPosition({
  anchorRect,
  preferredSide: 'right',
  gap: 12,
  expandedWidth: ..., // pour anticiper grow
})

// click-outside-to-close via useEffect mousedown
```

---

## 3. `<CustomSelect>` — dropdown stylé

**Fichier** : `src/components/CustomSelect.jsx`

```jsx
<CustomSelect
  value={statut}
  options={[{ value: 'planifie', label: 'Planifié' }, ...]}
  onChange={(v) => ...}
  renderTrigger={(label) => <span>{label}</span>}
/>
```

- Click sur trigger → popover sous trigger
- Hover background `--bg-elev`
- Check indicator bleu sur la valeur sélectionnée
- Keyboard nav ↑↓ + Enter + Esc
- minWidth configurable
- **Remplace les `<select>` natifs OS** (ugly en dark mode)

---

## 4. Modal centré — action explicite

**Pattern** : div centrée au-dessus du backdrop semi-opaque (rgba 0,0,0,0.5).
Z-index 60, dialog 500px de large max.

**Exemples existants** :
- `LinkCreneauModal` (création/édition de lien soft)
- `PropagationModal` (propager aux enfants)
- `DerouleShareModal`

**Mécanique standard** :
```jsx
<div
  onClick={onClose} // backdrop ferme
  style={{ position: 'fixed', inset: 0, zIndex: 60,
           background: 'rgba(0,0,0,0.5)',
           display: 'flex', alignItems: 'center',
           justifyContent: 'center', padding: 16 }}
>
  <div onClick={(e) => e.stopPropagation()}
       style={{ width: 'min(480px, 100%)',
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
                borderRadius: 10,
                boxShadow: '0 16px 48px rgba(0,0,0,0.4)' }}>
    {/* Header : titre + bouton X */}
    {/* Body : contenu scrollable */}
    {/* Footer : Annuler + Action principale (primary) */}
  </div>
</div>
```

⚠️ **Pas de backdrop si on est sur top d'un popover anchored** (laisser
visible le créneau qu'on édite). Les modals dans popovers (ex: LinkCreneauModal
ouverte depuis CreneauInspector) gèrent quand même un backdrop noir pour
le focus user.

---

## 5. `confirm({...})` — confirmation impérative

**Fichier** : `src/lib/confirm.js` + `src/components/ConfirmHost.jsx`

```jsx
import { confirm } from '@/lib/confirm'

async function handleDelete() {
  const ok = await confirm({
    title: 'Supprimer ce créneau ?',
    message: 'Cette action est irréversible.',
    confirmLabel: 'Supprimer',
    cancelLabel: 'Annuler',
    danger: true, // bouton rouge
  })
  if (!ok) return
  // … action destructive
}
```

- Backdrop click = cancel
- Esc = cancel
- Enter = confirm
- Focus auto sur le bouton confirm
- Portal pour échapper aux overflow parents
- **REMPLACE `window.confirm()` PARTOUT** — règle absolue

---

## Règles globales

### Couleurs

- **Background popover/modal** : `var(--bg-surf)`
- **Border** : `1px solid var(--brd)`
- **Box-shadow** :
  - Popover anchored : `0 8px 28px rgba(0,0,0,0.18)`
  - Modal centré : `0 16px 48px rgba(0,0,0,0.4)`
  - Tooltip : `0 4px 12px rgba(0,0,0,0.2)`
- **Border-radius** :
  - Popover : 8px
  - Modal : 10px
  - Tooltip : 4px
- **Primary action** : `var(--blue, #3B82F6)` blanc texte
- **Danger** : `#EF4444`, soft hover `rgba(220,38,38,0.1)`

### Z-index

| Niveau | Valeur | Usage |
|---|---|---|
| Popover anchored | 50 | CreneauInspector, DayPicker |
| Popover anchored (mobile sheet) | 40 | Backdrop léger sur mobile |
| Modal centré | 60 | LinkCreneauModal, PropagationModal, ConfirmDialog |
| Tooltip | 1000 | Top de tout |
| QuickCreateMenu | 100 | Au-dessus du popover créneau |

### Animations

- **Fade-in** : 80-160ms `ease-out`, opacity 0 → 1 + translateY -2-4px → 0
- **Hover** : 100ms `ease`, background change subtle
- **Click feedback** : `active: scale(0.98)` si bouton
- **PAS de bouncy / spring** (pro, pas ludique)

### Positionnement auto-flip

Tout popover anchored doit gérer le débordement viewport :
1. Préférer le côté `preferredSide` si la place est suffisante
2. Sinon flip au côté opposé
3. Si aucun côté n'a la place : top ou bottom
4. Clamper aux bornes (padding 8px) en dernier recours

Pour les modals : centrer, ne jamais déborder.

### Interactions clavier

- **Esc** ferme tout popup/modal (sauf si user en cours d'édition d'un input)
- **Enter** valide l'action primary du modal
- **Tab** navigue dans les boutons (focus visible)
- ↑↓ pour les listes (CustomSelect)

### Click outside

- Tous les popovers/modals : click hors du conteneur ferme
- Délai 50ms après mount pour ignorer le mousedown initial
- Le `<select>` natif et les inputs ne ferment PAS le popover parent
  (gérer via `mousedown` check parent contains)

---

## Checklist avant de coder un nouveau popup

- [ ] Catégorie identifiée (tooltip / popover anchored / dropdown / modal /
      confirmation)
- [ ] Composant existant réutilisable ? (Tooltip, CustomSelect, confirm,
      DayPicker) → préférer
- [ ] Backdrop : oui (modal) ou non (popover) ?
- [ ] Click outside + Esc gérés
- [ ] Fade-in animé
- [ ] Position auto-flip si anchored
- [ ] Z-index cohérent avec la grille
- [ ] Couleurs / radius / shadow conformes
- [ ] `aria-label` ou `role="dialog"` pour accessibilité
- [ ] Focus management (auto-focus + Tab cycle)
- [ ] Mobile : bottom sheet ou modal full-screen ?

---

## Migration des `window.confirm` / `window.alert` / `window.prompt`

**Règle** : aucune nouvelle utilisation. Pour les existants :

- `window.confirm(...)` → `await confirm({ title, message, confirmLabel,
  cancelLabel, danger })`
- `window.alert(...)` → `notify.error(...)` ou `notify.info(...)` (toast)
  ou modal info si critique
- `window.prompt(...)` → composant input dédié ou modal custom

**Fichiers contenant encore `window.confirm` à migrer** :
- `src/features/materiel/components/check/CheckPhotosSection.jsx`
- `src/features/planning/PlanningViewActionModal.jsx`

À nettoyer au passage dans les chantiers concernés.
