# CHANTIER — Sprint 4 Festival : Import IA de programmations

> Objectif : permettre à l'utilisateur d'importer une programmation festival
> (PDF officiel, image/screenshot, capture collée) et la transformer
> automatiquement en créneaux dans le déroulé du jour, via Claude Vision.

---

## Décisions de cadrage (Hugo, juin 2026)

| Sujet | Décision |
|---|---|
| **Formats source** | PDF + JPG/PNG + capture d'écran collée (Cmd+V) |
| **Archi IA** | Edge Function Supabase → Claude API |
| **Extraction** | Shows artistes (titre + horaires + scène) + auto-création des lanes Scène + détection de la date |
| **Conflits** | Preview avec checkboxes — l'utilisateur valide ce qu'il importe |
| **Périmètre** | 1 import = 1 jour (un déroulé). Si la date détectée n'a pas de déroulé → on le crée. |

---

## Architecture

```
┌──────────────┐      ┌─────────────────────┐      ┌──────────────────┐
│  Client UI   │      │  Edge Function      │      │  Claude API      │
│  (DerouleTab)│      │  import-deroule     │      │  /v1/messages    │
└──────┬───────┘      └──────────┬──────────┘      └────────┬─────────┘
       │ POST (file base64)      │                          │
       ├────────────────────────►│                          │
       │                         │ POST + image/PDF         │
       │                         ├──────────────────────────►
       │                         │                          │
       │                         │ tool_use response        │
       │                         │◄─────────────────────────┤
       │ JSON {date, shows}      │                          │
       │◄────────────────────────┤                          │
       │                         │                          │
       │ User valide preview     │                          │
       │ → createCreneau bulk    │                          │
       └─►Supabase BDD                                      │
```

**Pourquoi Edge Function :**
- Clé Anthropic stockée côté serveur (jamais dans le bundle navigateur)
- Logging par projet possible
- Pré-process possible (split PDF, fallback OCR si vision échoue)

---

## Sprint 4 — Tickets

### FEST-4.1 — Edge Function `import-deroule`

**Fichier** : `supabase/functions/import-deroule/index.ts`

**Entrée (POST JSON) :**
```json
{
  "file_data": "base64-encoded content",
  "file_type": "application/pdf" | "image/png" | "image/jpeg" | ...,
  "file_name": "string (optionnel, pour les logs)"
}
```

**Sortie :**
```json
{
  "success": true,
  "extracted": {
    "date": "2026-07-15" | null,
    "shows": [
      { "titre": "Macklemore", "scene": "Scène Médiator",
        "heure_debut": "21:30", "heure_fin": "22:45" },
      ...
    ]
  },
  "meta": {
    "model": "claude-sonnet-4-6",
    "duration_ms": 4823,
    "input_tokens": 1842,
    "output_tokens": 612
  }
}
```

**Sécurité :**
- JWT obligatoire (Authorization header)
- L'appelant doit être authentifié et membre d'une org
- Pas de check de rôle particulier (l'import est une action standard)

**Mécanique :**
1. Valider mime type (pdf | image)
2. Construire le `content` array pour Claude (image vs document)
3. Appeler `https://api.anthropic.com/v1/messages` avec `tool_use` pour
   garantir la sortie JSON
4. Parse la réponse, extrait le tool_use input
5. Retourne au client avec metrics

**Secret à configurer :**
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy import-deroule
```

---

### FEST-4.2 — Hook client + UI bouton "Importer"

**Fichier** : `src/hooks/useImportDeroule.js`

```js
const { extract, importing, error, result } = useImportDeroule()
await extract(file) // → result = { date, shows }
```

- Encode `File` en base64
- Appelle `supabase.functions.invoke('import-deroule', { body })`
- Gère états loading / error / success
- Toast informatif

**UI — bouton dans la toolbar du DerouleTab** : `📥 Importer programmation`

**Modal `ImportDerouleModal`** :
- Drag & drop zone (file picker)
- Paste handler (Cmd+V capture)
- Preview du fichier uploadé (thumbnail si image)
- Bouton "Analyser avec IA" → spinner pendant l'appel
- Affiche le résultat → délègue à PreviewModal (FEST-4.3)

---

### FEST-4.3 — Preview + import effectif

**Composant `ImportPreviewModal`** :

Une fois la réponse Edge Function reçue, modal de validation :

- **Date détectée** : affichée en haut, modifiable via DayPicker
- **Liste des shows** : table avec checkbox / titre / scène / horaires
- **Conflits** : icône warning sur les shows qui chevauchent un créneau existant
- **Lanes nouvelles** : section "Lanes à créer" listant les scènes pas encore présentes dans le déroulé
- **Bouton "Importer N créneaux"**

**Logique d'import :**
1. Si pas de déroulé pour la date → créer (`createDeroule`)
2. Pour chaque scène nouvelle → créer la lane (`createLane` type='lieu')
3. Bulk insert des créneaux cochés (un par show)
4. Toast vert "N créneaux importés"
5. Switch sur la date importée

---

### FEST-4.4 — Tests E2E + lint + commit

- Test PDF officiel (ex: programmation 1 jour)
- Test image screenshot
- Test paste capture
- Vérifier extraction date + scènes + horaires
- Lint global
- Commit par étape (4.1, 4.2, 4.3 distincts)

---

## Prompt Claude Vision

**System :**
```
Tu es un parseur expert de programmations de festival audiovisuel.
À partir d'une image ou d'un PDF de programmation festival, tu extrais
chaque show en JSON structuré.

Règles :
- Les horaires sont au format HH:MM (24h).
- Si un show se termine après minuit, l'heure de fin reste en HH:MM
  (l'application interprète comme J+1).
- Le titre est le NOM DE L'ARTISTE OU DU GROUPE, pas la catégorie.
- La scène est le NOM exact de la scène (Grande Scène, Scène Plage,
  Scène Médiator, etc.). Si non identifiable, mettre null.
- Si la date du festival est visible (date complète OU "jour 1 / jour 2"
  avec une date associée), la retourner au format YYYY-MM-DD.
- Si plusieurs jours sont visibles, ne retourner QUE le premier jour
  identifié (l'utilisateur importera les autres séparément).
```

**Tool definition :**
```ts
{
  name: 'extract_festival_program',
  description: 'Extrait la programmation d\'un festival depuis une image ou PDF',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: ['string', 'null'], description: 'Date YYYY-MM-DD ou null si non détectable' },
      shows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string', description: 'Nom de l\'artiste / groupe' },
            scene: { type: ['string', 'null'], description: 'Nom de la scène ou null' },
            heure_debut: { type: 'string', description: 'HH:MM 24h' },
            heure_fin: { type: 'string', description: 'HH:MM 24h' },
          },
          required: ['titre', 'heure_debut', 'heure_fin'],
        },
      },
    },
    required: ['date', 'shows'],
  },
}
```

`tool_choice: { type: 'tool', name: 'extract_festival_program' }` → Claude
est **forcé** d'appeler le tool, donc la sortie JSON est garantie au bon format.

---

## Modèle Claude utilisé

**`claude-sonnet-4-6`** — Vision + bon rapport qualité/prix.

| Métrique | Valeur estimée |
|---|---|
| Input tokens (1 PDF 1 page) | ~1500-2500 |
| Output tokens (10 shows) | ~500-800 |
| Coût par import | ~$0.01-0.02 |
| Durée | 3-6s |

Si la vision Sonnet rate des cas spécifiques, fallback possible vers
`claude-opus-4-6` (plus précis mais ~5x plus cher).

---

## Limitations connues / V2

- ✅ Import 1 jour
- ❌ Plusieurs jours en un coup (V2)
- ❌ Détection automatique des cadreurs assignés (V2)
- ❌ OCR fallback si Claude rate (V2)
- ❌ Import incrémental (merge avec existant) — V1 : pas de merge, juste insert

---

## Roadmap globale Festival rappel

| Sprint | Status |
|---|---|
| ✅ Sprint 1 — Foundation | Clos |
| ✅ Sprint 2 — Notes + Liens | Clos |
| ✅ Sprint 3 — Construction rapide | Clos |
| 🔧 Sprint 4 — Import IA | **EN COURS** |
| ⏳ Sprint 5 — Golden hour + couleurs + indispos + vue Scène | À venir |
| ⏳ Sprint 6 — Régie live | À venir |
| ⏳ Sprint 7 — Historique versions | À venir |
