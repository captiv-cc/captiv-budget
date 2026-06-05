// ════════════════════════════════════════════════════════════════════════════
// derouleSoftLinks — Helpers purs pour les liens entre créneaux (FEST-2)
// ════════════════════════════════════════════════════════════════════════════
//
// Un créneau "enfant" peut référencer un créneau "source" via
// `source_creneau_id`, avec un `source_anchor` qui définit quels champs
// sont synchronisés. Quand la source est modifiée, on propose à l'utilisateur
// d'appliquer les changements aux enfants (modal de propagation FEST-2.5).
//
// Use cases :
//   - Q&A en salle de presse répété sur 3 artistes (titre+notes+lieu sync,
//     horaire indépendant)
//   - Sound-check + Concert d'un même artiste (notes+lieu sync, titre et
//     horaire indépendants)
//   - Cérémonie d'ouverture qui doit avoir les mêmes consignes sur 2 scènes
//
// Pas d'effet de bord ici : tout est pur (fonctions sur structures JS).
// L'orchestration (lecture/écriture BDD) reste dans useDeroule / la modale.
// ════════════════════════════════════════════════════════════════════════════

// ─── Champs synchronisables ─────────────────────────────────────────────────
// Liste exhaustive des champs qu'on peut synchroniser entre une source et
// ses enfants. FEST-3.2 C : heure_debut_min ajouté pour permettre aux
// missions cadreur de SUIVRE l'horaire de leur source (ex: tournage qui
// suit un show). Si seulement duree_min est dans anchor, l'enfant garde
// son heure de début et aligne sa durée (cas Q&A répété à 3 horaires
// différents — case original).
export const ANCHOR_FIELDS = [
  'titre',
  'description',
  'type',
  'couleur',
  'lieu_text',
  'notes',
  'heure_debut_min',
  'duree_min',
  'cadreurs',
]

// Labels FR pour l'UI (modal de création de lien + modal de propagation).
// Heure de début + Durée sont distincts ET indépendants : selon le use case
// festival, on peut vouloir que l'enfant suive l'horaire de début mais
// préserve sa durée locale (ex: cadreur qui filme 30 min d'un show qui dure
// 1h45 — si le show est déplacé, le cadreur arrive à la nouvelle heure mais
// filme toujours 30 min).
export const ANCHOR_FIELD_LABELS = {
  titre: 'Titre',
  description: 'Description',
  type: 'Type',
  couleur: 'Couleur',
  lieu_text: 'Lieu',
  notes: 'Notes',
  heure_debut_min: 'Suivre l’heure de début',
  duree_min: 'Suivre la durée',
  cadreurs: 'Cadreurs',
}

// ─── Égalité par champ ──────────────────────────────────────────────────────
// Pour chaque champ, on compare deux créneaux. Les `notes` étant un JSON
// ProseMirror, on compare la sérialisation canonique (stringify trié). Pour
// `cadreurs`, on compare les sets de member_ids.

function arraysEqualAsSet(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  const setA = new Set(a)
  for (const x of b) {
    if (!setA.has(x)) return false
  }
  return true
}

// Sérialisation déterministe d'un JSON quelconque pour comparaison.
// Les notes ProseMirror peuvent avoir des clés dans des ordres différents
// selon l'éditeur → on trie les clés à chaque niveau.
function canonicalJsonStringify(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) {
    return '[' + v.map(canonicalJsonStringify).join(',') + ']'
  }
  const keys = Object.keys(v).sort()
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(v[k]))
      .join(',') +
    '}'
  )
}

function getDureeMin(creneau) {
  if (!creneau) return null
  const start = Number(creneau.heure_debut_min)
  const end = Number(creneau.heure_fin_min)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return end - start
}

// Compare un champ donné entre 2 créneaux. Retourne true si identique.
export function isFieldEqual(field, a, b) {
  if (!a || !b) return false
  switch (field) {
    case 'cadreurs':
      return arraysEqualAsSet(a.member_ids || [], b.member_ids || [])
    case 'duree_min':
      return getDureeMin(a) === getDureeMin(b)
    case 'notes':
      return canonicalJsonStringify(a.notes) === canonicalJsonStringify(b.notes)
    default:
      return (a[field] ?? null) === (b[field] ?? null)
  }
}

// ─── proposeAnchorDefault ──────────────────────────────────────────────────
// Au moment où l'utilisateur crée un lien (child → source), on pré-coche
// l'anchor sur les champs qui sont DÉJÀ identiques entre les 2 créneaux.
// Logique : si c'est déjà pareil, c'est probablement ce qu'on veut sync.
// L'utilisateur peut ensuite ajouter/retirer des champs manuellement.
//
// Retourne { fields: [...] } prêt à stocker en source_anchor.
export function proposeAnchorDefault(child, source) {
  if (!child || !source) return { fields: [] }
  const fields = []
  for (const f of ANCHOR_FIELDS) {
    if (isFieldEqual(f, child, source)) fields.push(f)
  }
  return { fields }
}

// ─── getLinkedChildren ─────────────────────────────────────────────────────
// Retourne tous les créneaux qui ont `sourceId` comme source_creneau_id.
// O(n) — pas indexé côté client, mais N reste petit (centaine de créneaux max
// par déroulé).
export function getLinkedChildren(creneaux, sourceId) {
  if (!Array.isArray(creneaux) || !sourceId) return []
  return creneaux.filter((c) => c && c.source_creneau_id === sourceId)
}

// ─── getSourceCreneau ──────────────────────────────────────────────────────
// Retourne le créneau source du child, ou null s'il n'est pas lié (ou si la
// source a été supprimée → source_creneau_id reste NULL grâce à ON DELETE
// SET NULL).
export function getSourceCreneau(creneaux, child) {
  if (!child || !child.source_creneau_id || !Array.isArray(creneaux)) return null
  return creneaux.find((c) => c && c.id === child.source_creneau_id) || null
}

// ─── isLinkedToSource ──────────────────────────────────────────────────────
// Helper bool : true si ce créneau a une source.
export function isLinkedToSource(creneau) {
  return Boolean(creneau && creneau.source_creneau_id)
}

// ─── isSourceOf ────────────────────────────────────────────────────────────
// Helper bool : true si ce créneau est source d'au moins un autre créneau.
export function isSourceOf(creneaux, creneauId) {
  return getLinkedChildren(creneaux, creneauId).length > 0
}

// ─── applySourceUpdate ─────────────────────────────────────────────────────
// Calcule le patch à appliquer à un enfant pour qu'il reflète la source sur
// les champs cochés dans l'anchor. Retourne un OBJET PATCH (pas un créneau
// complet) — uniquement les champs à updater.
//
// Cas spécial `duree_min` : on n'écrase pas `heure_debut_min` (l'enfant garde
// son horaire), on recalcule juste `heure_fin_min` pour matcher la durée.
//
// Cas spécial `cadreurs` : on retourne un patch `member_ids` (set des
// cadreurs). Le caller devra appliquer ça via setCreneauMembres séparément
// (pas une simple update de colonne).
export function applySourceUpdate(source, child, anchor) {
  if (!source || !child || !anchor) return {}
  const fields = Array.isArray(anchor.fields) ? anchor.fields : []
  const patch = {}
  const hasDureeInAnchor = fields.includes('duree_min')
  const hasDebutInAnchor = fields.includes('heure_debut_min')

  for (const f of fields) {
    switch (f) {
      case 'heure_debut_min': {
        // FEST-3.2 C : l'enfant suit l'horaire de début de la source.
        const newDebut = Number(source.heure_debut_min)
        if (!Number.isNaN(newDebut)) {
          patch.heure_debut_min = newDebut
          // Si duree_min n'est PAS dans anchor → préserve la durée locale
          // de l'enfant en recalculant heure_fin_min.
          if (!hasDureeInAnchor) {
            const childDuree = getDureeMin(child)
            if (childDuree != null) {
              patch.heure_fin_min = newDebut + childDuree
            }
          }
        }
        break
      }
      case 'duree_min': {
        const newDuree = getDureeMin(source)
        // Si heure_debut_min est aussi dans anchor → on utilise le NEW
        // debut (de la source). Sinon → l'ancien debut de l'enfant.
        const baseStart = hasDebutInAnchor
          ? Number(source.heure_debut_min)
          : Number(child.heure_debut_min)
        if (newDuree != null && !Number.isNaN(baseStart)) {
          patch.heure_fin_min = baseStart + newDuree
        }
        break
      }
      case 'cadreurs':
        patch.member_ids = Array.isArray(source.member_ids)
          ? [...source.member_ids]
          : []
        break
      case 'notes':
        patch.notes = source.notes ?? null
        break
      default:
        patch[f] = source[f] ?? null
    }
  }

  return patch
}

// ─── computeDiffForPropagation ────────────────────────────────────────────
// Pour la modale FEST-2.5 : pour chaque enfant, on calcule la diff
// "ce qui changerait" si on appliquait la source actuelle via l'anchor.
//
// Retourne un objet : { [field]: { from, to, changed: boolean } }
// `changed` = true si la valeur cible est différente de la valeur actuelle
// de l'enfant. Permet de pré-cocher seulement les changements réels et
// d'éviter de proposer des updates no-op.
export function computeDiffForPropagation(source, child, anchor) {
  if (!source || !child || !anchor) return {}
  const fields = Array.isArray(anchor.fields) ? anchor.fields : []
  const diff = {}

  for (const f of fields) {
    let from
    let to
    switch (f) {
      case 'duree_min':
        from = getDureeMin(child)
        to = getDureeMin(source)
        break
      case 'heure_debut_min':
        from = Number(child.heure_debut_min)
        to = Number(source.heure_debut_min)
        break
      case 'cadreurs':
        from = Array.isArray(child.member_ids) ? [...child.member_ids] : []
        to = Array.isArray(source.member_ids) ? [...source.member_ids] : []
        break
      default:
        from = child[f] ?? null
        to = source[f] ?? null
    }
    diff[f] = {
      from,
      to,
      changed: !isFieldEqual(f, child, source),
    }
  }

  return diff
}

// ─── countChangedFields ───────────────────────────────────────────────────
// Helper : nombre de champs réellement différents dans un diff (pour
// afficher "3 changements" dans la modal).
export function countChangedFields(diff) {
  if (!diff || typeof diff !== 'object') return 0
  return Object.values(diff).filter((d) => d && d.changed).length
}

// ─── validateLinkTarget ───────────────────────────────────────────────────
// Garde-fou côté client avant d'enregistrer un lien : retourne null si OK,
// sinon un message d'erreur en FR pour l'utilisateur.
//
// Règles :
//   1. childId != sourceId (CHECK BDD le bloquera aussi, mais on veut une
//      erreur amicale côté UI).
//   2. La source ne doit pas elle-même avoir source_creneau_id pointant
//      vers child (cycle direct → propagation infinie).
//   3. (Optionnel V2) Pas de cycle indirect via N créneaux. On NE le check
//      PAS ici car les chaînes multi-niveau ne sont pas exposées en V1 —
//      l'UI n'autorisera pas à lier un créneau qui est déjà source d'un
//      autre.
export function validateLinkTarget(child, source, creneaux = []) {
  if (!child || !source) return 'Créneaux invalides'
  if (child.id === source.id) {
    return 'Un créneau ne peut pas se lier à lui-même'
  }
  if (source.source_creneau_id === child.id) {
    return 'Cycle direct détecté : la source est déjà liée à ce créneau'
  }
  // V1 : refuser si la source EST déjà un enfant (pas de chaîne)
  if (source.source_creneau_id) {
    return "Impossible de lier vers un créneau qui est déjà l'enfant d'un autre"
  }
  // V1 : refuser si le child EST déjà une source pour d'autres (sinon
  // contamination remontante au moment de la propagation)
  if (isSourceOf(creneaux, child.id)) {
    return "Ce créneau est déjà source d'autres créneaux — il ne peut pas devenir lui-même un enfant"
  }
  return null
}
