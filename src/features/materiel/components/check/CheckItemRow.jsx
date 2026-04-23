/**
 * CheckItemRow — ligne d'item cliquable dans la checklist terrain
 * (MAT-10E + MAT-10F + MAT-10G + MAT-10I + MAT-10N + MAT-11 + MAT-23D + MAT-13D).
 *
 * Tap principal sur la ligne = toggle du check courant (pre_check en essais,
 * post_check en rendu). À droite, UN SEUL bouton ⋯ (kebab) qui ouvre un menu
 * contextuel (ActionSheet) dont les entrées s'adaptent à la phase :
 *
 *   En phase='essais' (défaut) :
 *     • Signaler          — commentaire kind='probleme' + photos kind='probleme'
 *     • Photos pack       — photos kind='pack' (items ET blocs, MAT-23 : pas
 *                           réservé aux blocs comme historiquement MAT-11)
 *     • Commentaires      — notes internes (kind='note'), PAS dans bilan loueur
 *     • Retirer / Remettre — soft toggle du retrait du tournage (MAT-10N)
 *     • Supprimer additif  — hard delete, uniquement si added_during_check
 *
 *   En phase='rendu' (MAT-13D + MAT-13D-bis) :
 *     • Signaler retour   — commentaire kind='rendu' + photos kind='retour'
 *       (éditable, section principale de la phase rendu)
 *     • Photos pack       — READ-ONLY, consultation des photos pack posées
 *                           aux essais (utile pour comparer l'état retour
 *                           vs l'état initial du flight case).
 *     • Problèmes essais  — READ-ONLY, consultation combinée des photos
 *                           kind='probleme' + commentaires kind='probleme'
 *                           signalés pendant les essais (contexte pour
 *                           l'opérateur rendu).
 *     • Notes essais      — READ-ONLY, consultation des notes internes
 *                           laissées aux essais (kind='note').
 *     — PAS de Retirer/Remettre (le retrait est figé à la clôture essais)
 *     — PAS de Supprimer additif (les additifs sont actés, non modifiables)
 *
 *   Pastilles pastilles row en rendu (MAT-13D-bis) — 4 micro-indicateurs
 *   de densité différenciés par couleur :
 *     • ⚠ violet : signalements retour (comments kind='rendu' + photos retour)
 *     • ⚠ orange : problèmes essais (comments + photos kind='probleme')
 *     • 📷 bleu  : photos pack essais
 *     • 💬 gris  : notes essais
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │ ✅  Corps caméra · RED KOMODO (x1)    ⋯    ✓ Camille │  ligne
 *   │  ┌─────────────────────────────────────────────────┐ │
 *   │  │  (section dépliée selon l'action tapée)         │ │  section
 *   │  └─────────────────────────────────────────────────┘ │
 *   └───────────────────────────────────────────────────────┘
 *
 * Rationale UX (Hugo, session MAT-23) :
 *   - Trop de boutons empilés à droite devenait illisible sur mobile.
 *   - Le kebab unique libère la ligne et permet d'exprimer les badges
 *     (nombre de problèmes / photos / notes) via les entrées du menu.
 *   - Mobile : le menu se déploie en bottom sheet (tap-cible 56px, dos
 *     plus accessible au pouce). Desktop : popover classique.
 *
 * État "retiré" (MAT-10N) :
 *   ┌───────────────────────────────────────────────────────┐
 *   │ 🚫  ~~Cam PLV100~~ — Non pris par Camille        ⋯   │
 *   │     ↳ "remplacée par PLV80"                           │
 *   └───────────────────────────────────────────────────────┘
 *   (ligne grisée, barrée, check désactivé, icône 🚫 à la place de ✓)
 *
 * Undo snackbar (MAT-10I) : après un toggle réussi, toast "Coché par X —
 * Annuler" pendant 5s, re-toggle en cas de clic.
 */

import { useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Camera,
  Check,
  MessageCircle,
  MoreHorizontal,
  RotateCcw,
  StickyNote,
  Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { confirm, prompt } from '../../../../lib/confirm'
import ActionSheet from '../../../../components/ActionSheet'
import LoueurTagList from './LoueurTagList'
import CheckPhotosSection from './CheckPhotosSection'

export default function CheckItemRow({
  item,
  // Tous les commentaires de l'item (les 2 kinds en essais, 1 kind en rendu).
  // Séparation par kind faite localement pour les badges + sections.
  comments = [],
  loueurs = [],
  // Toutes les photos ancrées à cet item. MAT-23 : les photos kind='pack'
  // peuvent aussi être sur un item. MAT-13D : en rendu on lit kind='retour'.
  photos = [],
  // Identité (pour ownership delete/caption photos + composer commentaires
  // en mode token) et flag admin (peut supprimer toute photo / override
  // ownership).
  userName = null,
  isAdmin = false,
  onToggle,
  // Signature MAT-23 : onAddComment({ itemId, kind, body }). Le kind est
  // dérivé localement via la phase (MAT-13D) : 'probleme'/'note' en essais,
  // 'rendu' en rendu.
  onAddComment,
  onSetRemoved,
  onDeleteAdditif,
  // MAT-11 : callbacks photos. Si null, la section photos est masquée et les
  // entrées Signaler / Photos pack du menu deviennent "view-only" (lecture
  // seule de ce qui existe déjà). Le kind uploadé est forcé serveur-side
  // (hook rendu → 'retour', hook essais → depuis l'UI).
  onUploadPhoto = null,
  onDeletePhoto = null,
  onUpdatePhotoCaption = null,
  showAddedBy = false,
  // MAT-13D — phase active de la checklist. Pilote : quel check_at lire
  // (pre_/post_), quels kinds de comments/photos filtrer (probleme|note|pack
  // vs rendu|retour), et quelles entrées de menu afficher.
  phase = 'essais',
}) {
  const isRendu = phase === 'rendu'

  // Toggle optimiste. Pendant le round-trip RPC on flippe localement — la
  // valeur serveur reprend la main dès que `pending` revient à null.
  const [pending, setPending] = useState(null) // null | 'checking' | 'unchecking'

  // Section dépliée : une seule à la fois (exclusivité pour garder la ligne
  // lisible). Toggle si on re-sélectionne la même entrée du menu.
  // Clés possibles :
  //   'signal'         — section éditable principale (problème en essais,
  //                      retour en rendu)
  //   'pack'           — photos pack (éditable en essais, RO en rendu)
  //   'notes'          — commentaires (éditable en essais, RO en rendu)
  //   'probleme-essais' — RENDU UNIQUEMENT : consultation RO des signalements
  //                      problème faits aux essais (photos + comments combinés)
  const [expandedSection, setExpandedSection] = useState(null)

  // Phase-aware read — en rendu on lit post_check_*, en essais pre_check_*.
  const serverChecked = isRendu
    ? Boolean(item.post_check_at)
    : Boolean(item.pre_check_at)
  const authorName = isRendu
    ? item.post_check_by_name || null
    : item.pre_check_by_name || null

  const isRemoved = Boolean(item.removed_at)
  const isAdditif = Boolean(item.added_during_check)
  const displayChecked =
    pending === 'checking' ? true : pending === 'unchecking' ? false : serverChecked
  const removedBy = item.removed_by_name || null
  const removedReason = item.removed_reason || null

  // Partition unique photos + comments par kind — source de vérité neutre.
  // Les sélecteurs phase-dépendants (Signal/Consultation) dérivent de ces
  // buckets pour éviter de re-filtrer plusieurs fois le même array.
  const photosByKind = {
    pack: photos.filter((p) => p.kind === 'pack'),
    probleme: photos.filter((p) => p.kind === 'probleme'),
    retour: photos.filter((p) => p.kind === 'retour'),
  }
  const commentsByKind = {
    probleme: comments.filter((c) => c.kind === 'probleme'),
    rendu: comments.filter((c) => c.kind === 'rendu'),
    // Default bucket = "note" (historique : certains rows ont kind NULL).
    note: comments.filter(
      (c) => c.kind !== 'probleme' && c.kind !== 'rendu',
    ),
  }

  // Section "signal" (éditable) — adapte son kind à la phase.
  //   essais → kind='probleme'   (photos probleme + comments probleme)
  //   rendu  → kind='retour/rendu' (photos retour  + comments rendu)
  const photosSignal = isRendu
    ? photosByKind.retour
    : photosByKind.probleme
  const commentsSignal = isRendu
    ? commentsByKind.rendu
    : commentsByKind.probleme

  // Pack + notes : présents dans les deux phases, en consultation RO en rendu
  // (ils reflètent l'état posé pendant les essais — non modifiable en rendu
  // pour préserver la traçabilité du bilan loueur).
  const photosPack = photosByKind.pack
  const commentsNote = commentsByKind.note

  // Consultation "Problèmes essais" — RENDU UNIQUEMENT. En essais ces items
  // sont déjà dans la section 'signal' éditable. En rendu, on les expose via
  // une section RO dédiée pour que l'opérateur retour voie l'historique.
  const photosProblemeEssais = isRendu ? photosByKind.probleme : []
  const commentsProblemeEssais = isRendu ? commentsByKind.probleme : []
  const problemeEssaisCount =
    photosProblemeEssais.length + commentsProblemeEssais.length

  // Kinds à écrire depuis l'UI (onAddComment payload côté client — en rendu
  // le hook forcera aussi 'rendu' de son côté mais on garde la cohérence).
  const signalCommentKind = isRendu ? 'rendu' : 'probleme'
  const noteCommentKind = isRendu ? 'rendu' : 'note'
  const signalPhotoKind = isRendu ? 'retour' : 'probleme'

  // Total signalements "phase courante" — à l'œil la priorité pour l'opérateur :
  //   essais : signalements problème (photos + comments kind='probleme')
  //   rendu  : remarques retour (photos kind='retour' + comments kind='rendu')
  const signalCount = commentsSignal.length + photosSignal.length

  async function handleTap() {
    if (pending || isRemoved) return // pas de toggle sur item retiré
    const wasChecked = serverChecked
    setPending(wasChecked ? 'unchecking' : 'checking')
    try {
      await onToggle(item.id)
      showUndoToast({
        action: wasChecked ? 'uncheck' : 'check',
        itemLabel: item.label || item.designation || 'item',
        onUndo: () => onToggle(item.id).catch(() => {}),
      })
    } catch (err) {
      console.error('[CheckItemRow] toggle failed', err)
      toast.error('Impossible d’enregistrer la coche')
    } finally {
      setPending(null)
    }
  }

  // Toggle / fermeture des sections — chaque action du menu bascule sa
  // section. Re-tap = ferme. Tap d'une autre = bascule vers celle-ci.
  function toggleSection(key) {
    setExpandedSection((prev) => (prev === key ? null : key))
  }

  async function handleToggleRemoved() {
    const willBeRemoved = !isRemoved
    const label = item.label || item.designation || 'cet item'
    try {
      let reason = null
      if (willBeRemoved) {
        const answer = await prompt({
          title: `Retirer "${truncate(label, 40)}" du tournage ?`,
          message:
            "L'item reste visible (barré) mais sera exclu de la checklist rendu loueur. Tu peux préciser une raison (facultatif).",
          placeholder: 'ex. remplacée par autre cam, défaut optique',
          confirmLabel: 'Retirer',
          cancelLabel: 'Annuler',
          multiline: true,
        })
        if (answer === null) return
        reason = answer
      }
      await onSetRemoved({ itemId: item.id, removed: willBeRemoved, reason })
      toast.success(willBeRemoved ? 'Item retiré du tournage' : 'Item réactivé')
    } catch (err) {
      console.error('[CheckItemRow] setRemoved failed', err)
      toast.error('Action impossible')
    }
  }

  async function handleDelete() {
    const label = item.label || item.designation || 'cet additif'
    const ok = await confirm({
      title: `Supprimer "${truncate(label, 40)}" ?`,
      message:
        'Cette action est irréversible et effacera l\'additif ainsi que ses commentaires et photos. Pour juste l\'exclure du tournage sans le supprimer, utilise "Retirer du tournage".',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    try {
      await onDeleteAdditif({ itemId: item.id })
      toast.success('Additif supprimé')
    } catch (err) {
      console.error('[CheckItemRow] deleteAdditif failed', err)
      toast.error('Suppression impossible')
    }
  }

  // Construction du menu. On filtre les `null`/`false` pour permettre les
  // entrées conditionnelles. MAT-13D-bis : en rendu, l'entrée "Signaler"
  // reste l'action principale (éditable kind='rendu'/'retour'), mais on
  // ajoute 3 entrées de CONSULTATION read-only pour voir le contexte essais
  //   → Photos pack (pour comparer l'état retour vs initial)
  //   → Problèmes essais (photos + comments kind='probleme' combinés)
  //   → Notes essais (comments kind='note')
  // Le label du "Signaler" change aussi entre phases pour la lisibilité.
  const menuActions = [
    {
      id: 'signal',
      icon: AlertTriangle,
      label: isRendu ? 'Signaler retour' : 'Signaler',
      variant: signalCount > 0 ? 'warning' : 'default',
      badge: signalCount > 0 ? signalCount : null,
      onClick: () => toggleSection('signal'),
    },
    // Photos pack — entrée présente dans les 2 phases. En essais : éditable.
    // En rendu : consultation RO (MAT-13D-bis).
    (!isRendu && (onUploadPhoto || photosPack.length > 0)) ||
    (isRendu && photosPack.length > 0)
      ? {
          id: 'pack',
          icon: Camera,
          label: isRendu ? 'Photos pack (essais)' : 'Photos pack',
          badge: photosPack.length > 0 ? photosPack.length : null,
          onClick: () => toggleSection('pack'),
        }
      : null,
    // Problèmes essais — RENDU UNIQUEMENT, consultation RO combinée
    // photos kind='probleme' + comments kind='probleme'.
    isRendu && problemeEssaisCount > 0
      ? {
          id: 'probleme-essais',
          icon: AlertTriangle,
          label: 'Problèmes essais',
          badge: problemeEssaisCount,
          onClick: () => toggleSection('probleme-essais'),
        }
      : null,
    // Notes — entrée présente dans les 2 phases. En essais : éditable.
    // En rendu : consultation RO, cachée si aucune note (MAT-13D-bis).
    (!isRendu || commentsNote.length > 0)
      ? {
          id: 'notes',
          icon: MessageCircle,
          label: isRendu ? 'Notes essais' : 'Commentaires',
          badge: commentsNote.length > 0 ? commentsNote.length : null,
          onClick: () => toggleSection('notes'),
        }
      : null,
    !isRendu && onSetRemoved ? { id: 'sep-1', type: 'separator' } : null,
    !isRendu && onSetRemoved
      ? {
          id: 'removed',
          icon: isRemoved ? RotateCcw : Ban,
          label: isRemoved ? 'Remettre dans le tournage' : 'Retirer du tournage',
          variant: isRemoved ? 'success' : 'warning',
          onClick: handleToggleRemoved,
        }
      : null,
    !isRendu && onDeleteAdditif && isAdditif
      ? {
          id: 'delete',
          icon: Trash2,
          label: 'Supprimer cet additif',
          variant: 'danger',
          onClick: handleDelete,
        }
      : null,
  ].filter(Boolean)

  const rowBackground = isRemoved
    ? 'var(--orange-bg)'
    : displayChecked
      ? 'var(--green-bg)'
      : 'transparent'

  // Un label court pour le titre du bottom sheet mobile. Garde le contexte
  // (l'user ne voit pas le bouton ⋯ pendant que la sheet est ouverte).
  const menuTitle = (() => {
    const base = item.label || item.designation || 'Item'
    return truncate(base, 40)
  })()

  return (
    <div
      className="border-b last:border-b-0"
      style={{
        borderColor: 'var(--brd-sub)',
        background: rowBackground,
        transition: 'background-color 140ms',
      }}
    >
      {/* Ligne cliquable principale ────────────────────────────────────── */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={handleTap}
          disabled={isRemoved}
          className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-h-[56px]"
          style={{
            opacity: pending ? 0.85 : isRemoved ? 0.55 : 1,
            cursor: isRemoved ? 'default' : 'pointer',
          }}
        >
          {/* Case à cocher ou badge retiré ─────────────────────────────── */}
          {isRemoved ? (
            <span
              className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
              style={{
                background: 'var(--orange-bg)',
                color: 'var(--orange)',
              }}
              aria-label="item retiré du tournage"
            >
              <Ban className="w-4 h-4" strokeWidth={2.5} />
            </span>
          ) : (
            <span
              className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center border"
              style={{
                background: displayChecked ? 'var(--green)' : 'transparent',
                borderColor: displayChecked ? 'var(--green)' : 'var(--brd)',
                color: '#fff',
              }}
            >
              {displayChecked && <Check className="w-4 h-4" strokeWidth={3} />}
            </span>
          )}

          {/* Désignation + label + qte + badge additif ──────────────── */}
          <span className="flex-1 min-w-0">
            <span
              className="block text-sm"
              style={{
                color: 'var(--txt)',
                textDecoration: isRemoved ? 'line-through' : 'none',
                textDecorationColor: 'var(--txt-3)',
              }}
            >
              {item.label && (
                <span className="font-semibold">
                  {item.label}
                  <span className="mx-1.5" style={{ color: 'var(--txt-3)' }}>
                    ·
                  </span>
                </span>
              )}
              <span>
                {item.designation || (
                  <em style={{ color: 'var(--txt-3)' }}>sans désignation</em>
                )}
              </span>
            </span>
            <span className="flex items-center gap-2 mt-0.5 flex-wrap">
              {Number(item.quantite) > 1 && (
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                  x{item.quantite}
                </span>
              )}
              <RemarqueInline text={item.remarques} />
              <LoueurTagList loueurs={loueurs} />
              {/* MAT-13D — En rendu, on masque le badge "Ajouté par X" : les
                  additifs sont fusionnés aux items de base et traités comme
                  du matériel standard (la clôture essais les a entérinés). */}
              {!isRendu && showAddedBy && item.added_by_name && !isRemoved && (
                <span className="text-xs" style={{ color: 'var(--purple)' }}>
                  Ajouté par {item.added_by_name}
                </span>
              )}
              {isRemoved && removedBy && (
                <span className="text-xs" style={{ color: 'var(--orange)' }}>
                  Non pris{removedBy ? ` par ${removedBy}` : ''}
                </span>
              )}
              {isRemoved && removedReason && (
                <span
                  className="text-xs italic"
                  style={{ color: 'var(--txt-3)' }}
                  title={removedReason}
                >
                  « {truncate(removedReason, 40)} »
                </span>
              )}
              {/* Pastilles récap sur la ligne — micro-indicateurs colorés
                  pour repérer de loin les items qui méritent d'ouvrir le
                  menu. Volontairement minimalistes (icône + chiffre, pas
                  de fond ni bordure).

                  Code couleur (uniforme essais ↔ rendu) :
                    • ⚠ violet : signalements RETOUR (rendu uniquement)
                    • ⚠ orange : problèmes essais (essais actif ou rendu RO)
                    • 📷 bleu  : photos pack essais
                    • 💬 gris  : notes essais

                  En essais, le signalCount = problème essais → s'affiche
                  en orange (pas de pastille violette — retour n'existe pas
                  encore). En rendu, le signalCount = retour → violet, et
                  on ajoute une pastille orange séparée si problèmes essais
                  avaient été signalés. */}
              {signalCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: isRendu ? 'var(--purple)' : 'var(--orange)' }}
                  title={
                    isRendu
                      ? `${signalCount} remarque${signalCount > 1 ? 's' : ''} au retour`
                      : `${signalCount} signalement${signalCount > 1 ? 's' : ''}`
                  }
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {signalCount}
                </span>
              )}
              {/* Pastille "problèmes essais" — RENDU UNIQUEMENT. Rappel des
                  signalements déjà documentés côté essais (contexte pour
                  l'opérateur rendu). Couleur orange, identique à la pastille
                  signalement qu'on verrait en phase essais → cohérence. */}
              {isRendu && problemeEssaisCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--orange)' }}
                  title={`${problemeEssaisCount} problème${problemeEssaisCount > 1 ? 's' : ''} signalé${problemeEssaisCount > 1 ? 's' : ''} aux essais`}
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {problemeEssaisCount}
                </span>
              )}
              {/* Photos pack : toujours visibles (doc interne pack, utile en
                  rendu comme en essais). En rendu, le tap sur la pastille
                  (via menu) ouvre la section RO de consultation. */}
              {photosPack.length > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--blue)' }}
                  title={`${photosPack.length} photo${photosPack.length > 1 ? 's' : ''} pack`}
                >
                  <Camera className="w-2.5 h-2.5" />
                  {photosPack.length}
                </span>
              )}
              {/* Notes : visibles dans les 2 phases. En rendu c'est RO. */}
              {commentsNote.length > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--txt-3)' }}
                  title={`${commentsNote.length} commentaire${commentsNote.length > 1 ? 's' : ''}`}
                >
                  <MessageCircle className="w-2.5 h-2.5" />
                  {commentsNote.length}
                </span>
              )}
            </span>
          </span>

          {/* Flag pastille (si posé) ─────────────────────────────────── */}
          {item.flag && !isRemoved && <FlagDot flag={item.flag} />}

          {/* Auteur du check (visible quand coché) ──────────────────── */}
          {displayChecked && !isRemoved && authorName && (
            <span
              className="shrink-0 text-xs px-2 py-1 rounded-md"
              style={{
                background: 'var(--bg-surf)',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd-sub)',
              }}
            >
              ✓ {authorName}
            </span>
          )}
        </button>

        {/* Menu unifié (⋯) — remplace les 3 boutons séparés de MAT-11C ─ */}
        {menuActions.length > 0 && (
          <ActionSheet
            title={menuTitle}
            actions={menuActions}
            trigger={({ ref, toggle, open }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                className="shrink-0 px-3 flex items-center text-xs min-h-[56px]"
                style={{
                  color: 'var(--txt-3)',
                  background: open ? 'var(--bg-hov)' : 'transparent',
                  borderLeft: '1px solid var(--brd-sub)',
                }}
                aria-label="Plus d'actions"
                aria-haspopup="menu"
                aria-expanded={open}
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
            )}
          />
        )}
      </div>

      {/* Section dépliée ─ signalements (photos + comments signal) ───── */}
      {expandedSection === 'signal' && (
        <SignalSection
          photos={photosSignal}
          comments={commentsSignal}
          anchor={{ itemId: item.id }}
          userName={userName}
          isAdmin={isAdmin}
          phase={phase}
          photoKind={signalPhotoKind}
          onAddComment={(body) =>
            onAddComment({ itemId: item.id, kind: signalCommentKind, body })
          }
          onUploadPhoto={onUploadPhoto}
          onDeletePhoto={onDeletePhoto}
          onUpdatePhotoCaption={onUpdatePhotoCaption}
        />
      )}

      {/* Section photos pack — éditable en essais, READ-ONLY en rendu
          (consultation pour traçabilité, MAT-13D-bis). */}
      {expandedSection === 'pack' && (
        <CheckPhotosSection
          photos={photosPack}
          kind="pack"
          anchor={{ itemId: item.id }}
          userName={userName}
          isAdmin={isAdmin}
          onUpload={onUploadPhoto}
          onDelete={onDeletePhoto}
          onUpdateCaption={onUpdatePhotoCaption}
          readOnly={isRendu}
          emptyLabel={
            isRendu
              ? 'Aucune photo pack documentée pendant les essais.'
              : undefined
          }
        />
      )}

      {/* Section problèmes essais — RENDU UNIQUEMENT, consultation RO
          combinée photos + comments kind='probleme' (MAT-13D-bis). */}
      {isRendu && expandedSection === 'probleme-essais' && (
        <EssaisProblemeSection
          photos={photosProblemeEssais}
          comments={commentsProblemeEssais}
          anchor={{ itemId: item.id }}
          userName={userName}
          isAdmin={isAdmin}
        />
      )}

      {/* Section commentaires (notes) — éditable en essais, READ-ONLY en
          rendu (consultation traçabilité). */}
      {expandedSection === 'notes' && (
        <CommentsThread
          comments={commentsNote}
          onSubmit={(body) =>
            onAddComment({ itemId: item.id, kind: noteCommentKind, body })
          }
          placeholder="Ajouter un commentaire…"
          emptyLabel={
            isRendu
              ? 'Aucune note interne posée pendant les essais.'
              : "Aucun commentaire. Laisse une note pour l'équipe."
          }
          submitLabel="Envoyer"
          readOnly={isRendu}
        />
      )}
    </div>
  )
}

/* ═══ Essais probleme section (consultation RO en phase rendu) ══════════ */

/**
 * Section dépliée qui combine photos kind='probleme' + comments kind='probleme'
 * pour consultation depuis la phase rendu (MAT-13D-bis). Read-only : pas
 * d'ajout, pas de suppression, pas d'édition de légende. L'opérateur retour
 * voit quels problèmes avaient été signalés aux essais pour contexte.
 *
 * Invariant : ne doit pas être utilisé en phase essais (les problèmes
 * essais y sont déjà dans la section 'signal' éditable).
 */
function EssaisProblemeSection({ photos, comments, anchor, userName, isAdmin }) {
  return (
    <div
      className="border-t"
      style={{ borderColor: 'var(--brd-sub)', background: 'var(--bg)' }}
    >
      <CheckPhotosSection
        photos={photos}
        kind="probleme"
        anchor={anchor}
        userName={userName}
        isAdmin={isAdmin}
        readOnly
        emptyLabel="Aucune photo problème posée pendant les essais."
      />
      <CommentsThread
        comments={comments}
        readOnly
        emptyLabel="Aucun signalement texte pendant les essais."
      />
    </div>
  )
}

/* ═══ Signal section (photos + comments signalement) ════════════════════ */

/**
 * Section dépliée pour "Signaler" — adapte son wording à la phase (MAT-13D).
 *
 * En essais : photos kind='probleme' + comments kind='probleme', placeholder
 *   "Signaler un problème…", mention explicite du bilan loueur.
 * En rendu  : photos kind='retour' + comments kind='rendu', placeholder
 *   "Décrire l'état au retour…", mention du bon de retour.
 *
 * Les 2 blocs (photos + comments) restent visuellement côte-à-côte : on peut
 * ajouter un commentaire sans photo et inversement.
 */
function SignalSection({
  photos,
  comments,
  anchor,
  userName,
  isAdmin,
  phase = 'essais',
  photoKind = 'probleme',
  onAddComment,
  onUploadPhoto,
  onDeletePhoto,
  onUpdatePhotoCaption,
}) {
  const photosEnabled = Boolean(onUploadPhoto)
  const isRendu = phase === 'rendu'
  const placeholder = isRendu
    ? "Décrire l'état au retour…"
    : 'Signaler un problème…'
  const submitLabel = isRendu ? 'Enregistrer' : 'Signaler'
  const emptyLabel = isRendu
    ? photosEnabled
      ? 'Aucune remarque sur ce retour. Photos + commentaire visibles dans le bon de retour.'
      : 'Aucune remarque sur ce retour. Elles apparaissent dans le bon de retour.'
    : photosEnabled
      ? 'Aucun problème signalé. Photos + commentaire visibles dans le bilan loueur.'
      : 'Aucun problème signalé. Les signalements apparaissent dans le bilan loueur.'
  return (
    <div
      className="border-t"
      style={{ borderColor: 'var(--brd-sub)', background: 'var(--bg)' }}
    >
      {photosEnabled && (
        <CheckPhotosSection
          photos={photos}
          kind={photoKind}
          anchor={anchor}
          userName={userName}
          isAdmin={isAdmin}
          onUpload={onUploadPhoto}
          onDelete={onDeletePhoto}
          onUpdateCaption={onUpdatePhotoCaption}
        />
      )}
      <CommentsThread
        comments={comments}
        onSubmit={onAddComment}
        placeholder={placeholder}
        emptyLabel={emptyLabel}
        submitLabel={submitLabel}
      />
    </div>
  )
}

/* ═══ Thread de commentaires ═══════════════════════════════════════════ */

function CommentsThread({
  comments,
  onSubmit,
  placeholder = 'Ajouter un commentaire…',
  emptyLabel = null,
  submitLabel = 'Envoyer',
  // MAT-13D-bis : mode consultation pure (ex. notes essais lues depuis la
  // phase rendu). Cache le composer, garde la liste lisible.
  readOnly = false,
}) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (readOnly) return
    const trimmed = body.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
      setBody('')
    } catch (err) {
      console.error('[CommentsThread] submit failed', err)
      // Affiche le message serveur si dispo (ex. "function does not exist"
      // quand la migration MAT-23A n'est pas encore appliquée). Aide au
      // diagnostic en prod sans avoir à ouvrir la console.
      const detail = err?.message || err?.details || err?.hint
      toast.error(
        detail
          ? `Commentaire non envoyé — ${detail}`
          : 'Commentaire non envoyé',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="px-4 py-3 space-y-3 border-t"
      style={{
        borderColor: 'var(--brd-sub)',
        background: 'var(--bg)',
      }}
    >
      {comments.length === 0 ? (
        <p className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
          {emptyLabel || 'Aucun commentaire pour le moment.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-medium" style={{ color: 'var(--txt)' }}>
                  {c.author_name}
                </span>
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                  {formatRelativeTime(c.created_at)}
                </span>
              </div>
              <p
                className="mt-0.5 whitespace-pre-wrap"
                style={{ color: 'var(--txt-2)' }}
              >
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form onSubmit={handleSubmit} className="flex items-end gap-2 pt-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="flex-1 px-3 py-2 rounded-md text-sm resize-none"
            style={{
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              color: 'var(--txt)',
            }}
            onKeyDown={(e) => {
              // Entrée envoie, Shift+Entrée insère un saut de ligne (UX Slack).
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
          />
          <button
            type="submit"
            disabled={!body.trim() || submitting}
            className="px-3 py-2 rounded-md text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--acc)', color: '#000' }}
          >
            {submitting ? '…' : submitLabel}
          </button>
        </form>
      )}
    </div>
  )
}

/**
 * Affichage relatif d'une date type "à l'instant", "il y a 5 min", "14:32".
 * Pour garder l'UX terrain lisible sans traîner moment/date-fns.
 */
function formatRelativeTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000)
  if (diffSec < 30) return 'à l’instant'
  if (diffSec < 3600) {
    const m = Math.round(diffSec / 60)
    return `il y a ${m} min`
  }
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/* ═══ Flag pastille ═══════════════════════════════════════════════════ */

function FlagDot({ flag }) {
  const map = {
    ok: { color: 'var(--green)', bg: 'var(--green-bg)' },
    attention: { color: 'var(--orange)', bg: 'var(--orange-bg)' },
    probleme: { color: 'var(--red)', bg: 'var(--red-bg)' },
  }
  const style = map[flag]
  if (!style) return null
  return (
    <span
      className="shrink-0 w-2.5 h-2.5 rounded-full"
      style={{
        background: style.color,
        boxShadow: `0 0 0 3px ${style.bg}`,
      }}
      aria-label={`flag ${flag}`}
    />
  )
}

/* ═══ Undo snackbar (MAT-10I) ═════════════════════════════════════════ */

function showUndoToast({ action, itemLabel, onUndo }) {
  const msg = action === 'check' ? 'Coché' : 'Décoché'
  toast.custom(
    (t) => (
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-lg"
        style={{
          background: '#1f2937',
          color: '#f9fafb',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
        }}
      >
        <span className="text-sm">
          {msg} <span style={{ opacity: 0.6 }}>—</span>{' '}
          <span style={{ opacity: 0.85 }}>{truncate(itemLabel, 30)}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onUndo()
            toast.dismiss(t.id)
          }}
          className="text-xs font-medium px-2 py-1 rounded"
          style={{
            background: 'rgba(255,255,255,0.12)',
            color: '#f9fafb',
          }}
        >
          Annuler
        </button>
      </div>
    ),
    { duration: 5000, position: 'bottom-center' },
  )
}

function truncate(str, max) {
  if (!str) return ''
  return str.length > max ? `${str.slice(0, max - 1)}…` : str
}

/* ═══ Remarque inline ═════════════════════════════════════════════════════ */

function RemarqueInline({ text }) {
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  return (
    <span
      className="inline-flex items-center gap-1 text-xs italic"
      style={{ color: 'var(--txt-3)' }}
      title={trimmed}
    >
      <StickyNote className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-[160px]">{truncate(trimmed, 60)}</span>
    </span>
  )
}
