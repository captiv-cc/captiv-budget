/**
 * CheckBlockCard — carte d'un bloc de matériel dans la checklist terrain
 * (MAT-10E + MAT-10F + MAT-23E + MAT-13D).
 *
 * Rend un header coloré (titre + progression + ⋯ menu bloc) + une preview
 * horizontale des photos pack (view-only) + la liste des items cliquables
 * + une section "Additifs" pour les items added_during_check + un formulaire
 * d'ajout inline en bas.
 *
 * MAT-13D — En phase='rendu', on simplifie la card :
 *   - Items de base + additifs affichés à plat (les additifs sont actés par
 *     la clôture essais, pas de distinction visuelle en rendu).
 *   - AddItemForm caché : pas de mutation structurelle en rendu.
 *   - Prop `phase` propagée à chaque CheckItemRow pour la lecture post_check_*.
 *
 * MAT-13D-bis — Les contenus essais (pack + problèmes + notes) restent
 * visibles en rendu via les pastilles de la header + les entrées du menu ⋯,
 * mais en mode CONSULTATION READ-ONLY (pas d'ajout/suppression) pour la
 * traçabilité. L'opérateur rendu peut :
 *   - Voir les photos pack (comparer retour vs initial)
 *   - Voir les problèmes essais (photos + comments kind='probleme' combinés)
 *   - Voir les notes essais (kind='note')
 * Le bouton "Signaler retour" reste la seule action éditable (photos retour
 * + comments kind='rendu').
 *
 * Quand tous les items (base + additifs) sont checkés, un bandeau vert est
 * ajouté en haut pour signaler visuellement "bloc validé".
 *
 *   ┌───────────────────────────────────────────┐
 *   │ ✓ BLOC VALIDÉ                             │  ← bandeau si allChecked
 *   │───────────────────────────────────────────│
 *   │ CAM LIVE 1              7/10 validés  ⋯  │  ← header + menu
 *   │───────────────────────────────────────────│
 *   │  [📷 pack preview, hideUploader=true]    │  ← MAT-23E : view-only
 *   │───────────────────────────────────────────│
 *   │  (section dépliée : signal / pack / note) │  ← MAT-23E
 *   │───────────────────────────────────────────│
 *   │ ⬜ Corps caméra · ARRI                    │
 *   │ ✅ Optique · ZEISS                        │  ← items de base
 *   │ ...                                       │
 *   │─── Additifs (ajoutés pendant les essais) ─│
 *   │ ⬜ Bras magique · Ajouté par Camille      │
 *   │───────────────────────────────────────────│
 *   │ + Ajouter un additif                      │  ← AddItemForm
 *   └───────────────────────────────────────────┘
 *
 * MAT-23E — pourquoi un menu ⋯ au niveau bloc ?
 *   - Cohérence avec CheckItemRow (MAT-23D) : un seul paradigme "⋯ → section
 *     dépliée" sur TOUTE la checklist, pas deux patterns différents selon
 *     qu'on est sur une ligne ou sur un header de bloc.
 *   - Les photos kind='pack' restent visibles en tête (preview, hideUploader
 *     pour alléger). L'édition se fait via ⋯ → Photos pack (section avec
 *     uploader complet).
 *   - Les blocs peuvent désormais avoir des signalements (photos+comments
 *     kind='probleme') et des notes (comments kind='note'), utiles pour un
 *     message général qui concerne l'ensemble d'un bloc (ex. "valise
 *     abîmée").
 */

import { useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Check,
  MessageCircle,
  MoreHorizontal,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ActionSheet from '../../../../components/ActionSheet'
import CheckItemRow from './CheckItemRow'
import AddItemForm from './AddItemForm'
import CheckPhotosSection from './CheckPhotosSection'

export default function CheckBlockCard({
  block,
  items,
  progress,
  commentsByItem,
  // MAT-23E : commentaires indexés par block_id. Kinds possibles :
  //   - essais : 'probleme' + 'note'
  //   - rendu  : 'rendu' uniquement (MAT-13D)
  // Séparés localement pour les badges du menu ⋯ et les sections.
  commentsByBlock = null,
  // MAT-10O : index item_id → [loueurs]. Injecté depuis CheckSession pour
  // afficher les pastilles loueurs sur chaque ligne (read-only). Le parent
  // peut passer `null`/`undefined` si aucun tagging n'est activé.
  loueursByItem = null,
  // MAT-19 : liste des loueurs connus de la version, utilisée par AddItemForm
  // pour proposer un loueur à l'additif au moment de l'ajout.
  loueurs = [],
  // MAT-11 : photos par item (pour les lignes) + photos du bloc (pour la
  // section pack en tête). Défauts vides pour rester rétro-compatible.
  photosByItem = null,
  photosByBlock = null,
  userName = null,
  isAdmin = false,
  onToggleItem,
  onAddItem,
  onAddComment,
  onSetRemoved,
  onDeleteAdditif,
  // MAT-11 : callbacks photos (upload/delete/caption). Si null, tout le bloc
  // photos (pack + problème) est masqué → ex. mode read-only legacy.
  onUploadPhoto = null,
  onDeletePhoto = null,
  onUpdatePhotoCaption = null,
  // MAT-13D — phase active, pilote l'UI simplifiée en rendu (voir doc du
  // fichier). La `progress` passée doit déjà être phase-aware (calcul dans
  // le hook via computeProgressByBlock({phase})).
  phase = 'essais',
}) {
  const isRendu = phase === 'rendu'

  const { total = 0, checked = 0, ratio = 0, allChecked = false } = progress || {}
  const pct = Math.round(ratio * 100)

  // Section dépliée (exclusive) — mêmes clés que CheckItemRow pour garder la
  // mémoire musculaire entre les deux niveaux ligne / bloc.
  const [expandedSection, setExpandedSection] = useState(null)
  //   'signal' | 'pack' | 'notes' | null  (pack+notes absents en rendu)
  function toggleSection(key) {
    setExpandedSection((prev) => (prev === key ? null : key))
  }

  // MAT-13D — En rendu, additifs et items de base sont fusionnés (la clôture
  // essais les a entérinés, plus de distinction métier). En essais on garde
  // la séparation pour afficher la section "Additifs" en bas.
  const baseItems = isRendu ? items : items.filter((it) => !it.added_during_check)
  const additifItems = isRendu
    ? []
    : items.filter((it) => it.added_during_check)

  // MAT-11 : activation des photos. Une seule flag suffit (onUploadPhoto
  // présent == on est câblé). Les 2 autres callbacks sont implicitement là
  // aussi si l'appelant respecte l'API du hook.
  const photosEnabled = Boolean(onUploadPhoto)

  // Partition photos bloc par kind — source neutre (MAT-13D-bis).
  const blockPhotos = photosEnabled ? (photosByBlock?.get(block.id) || []) : []
  const blockPhotosByKind = {
    pack: blockPhotos.filter((p) => p.kind === 'pack'),
    probleme: blockPhotos.filter((p) => p.kind === 'probleme'),
    retour: blockPhotos.filter((p) => p.kind === 'retour'),
  }
  // Partition comments bloc par kind.
  const blockComments = commentsByBlock?.get(block.id) || []
  const blockCommentsByKind = {
    probleme: blockComments.filter((c) => c.kind === 'probleme'),
    rendu: blockComments.filter((c) => c.kind === 'rendu'),
    note: blockComments.filter(
      (c) => c.kind !== 'probleme' && c.kind !== 'rendu',
    ),
  }

  // Section "signal" éditable — phase-dépendante.
  const blockPhotosSignal = isRendu
    ? blockPhotosByKind.retour
    : blockPhotosByKind.probleme
  const blockCommentsSignal = isRendu
    ? blockCommentsByKind.rendu
    : blockCommentsByKind.probleme

  // Pack + notes : présents dans les 2 phases (éditables essais, RO rendu).
  const blockPhotosPack = blockPhotosByKind.pack
  const blockCommentsNote = blockCommentsByKind.note

  // Consultation "Problèmes essais" — RENDU UNIQUEMENT (MAT-13D-bis).
  const blockPhotosProblemeEssais = isRendu ? blockPhotosByKind.probleme : []
  const blockCommentsProblemeEssais = isRendu
    ? blockCommentsByKind.probleme
    : []
  const blockProblemeEssaisCount =
    blockPhotosProblemeEssais.length + blockCommentsProblemeEssais.length

  const signalCount = blockCommentsSignal.length + blockPhotosSignal.length

  // Kinds à écrire depuis l'UI (MAT-13D — le hook rendu forcera aussi
  // serveur-side, mais on garde la cohérence client pour la lisibilité).
  const signalCommentKind = isRendu ? 'rendu' : 'probleme'
  const noteCommentKind = isRendu ? 'rendu' : 'note'
  const signalPhotoKind = isRendu ? 'retour' : 'probleme'

  // Menu ⋯ du bloc. En essais : Signaler + Photos pack + Commentaires (tous
  // éditables). En rendu (MAT-13D-bis) : Signaler retour (éditable) + 3
  // entrées consultation RO (Photos pack, Problèmes essais, Notes essais).
  const menuActions = [
    {
      id: 'signal',
      icon: AlertTriangle,
      label: isRendu ? 'Signaler retour' : 'Signaler',
      variant: signalCount > 0 ? 'warning' : 'default',
      badge: signalCount > 0 ? signalCount : null,
      onClick: () => toggleSection('signal'),
    },
    // Photos pack — visible dans les 2 phases. Editable essais, RO rendu.
    (!isRendu && (onUploadPhoto || blockPhotosPack.length > 0)) ||
    (isRendu && blockPhotosPack.length > 0)
      ? {
          id: 'pack',
          icon: Camera,
          label: isRendu ? 'Photos pack (essais)' : 'Photos pack',
          badge: blockPhotosPack.length > 0 ? blockPhotosPack.length : null,
          onClick: () => toggleSection('pack'),
        }
      : null,
    // Problèmes essais — RENDU UNIQUEMENT (consultation RO combinée).
    isRendu && blockProblemeEssaisCount > 0
      ? {
          id: 'probleme-essais',
          icon: AlertTriangle,
          label: 'Problèmes essais',
          badge: blockProblemeEssaisCount,
          onClick: () => toggleSection('probleme-essais'),
        }
      : null,
    // Notes — visibles dans les 2 phases. Editable essais, RO rendu.
    !isRendu || blockCommentsNote.length > 0
      ? {
          id: 'notes',
          icon: MessageCircle,
          label: isRendu ? 'Notes essais' : 'Commentaires',
          badge: blockCommentsNote.length > 0 ? blockCommentsNote.length : null,
          onClick: () => toggleSection('notes'),
        }
      : null,
  ].filter(Boolean)

  // Titre du bottom sheet mobile : label court du bloc (l'utilisateur ne voit
  // pas le ⋯ header pendant que la sheet est ouverte).
  const menuTitle = block.titre || 'Bloc'

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: `1px solid ${allChecked ? 'var(--green)' : 'var(--brd)'}`,
        transition: 'border-color 180ms',
      }}
    >
      {/* Bandeau "bloc validé" — apparaît seulement quand tout est coché ─── */}
      {allChecked && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide"
          style={{
            background: 'var(--green)',
            color: '#0a2e1a',
          }}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
          Bloc validé
        </div>
      )}

      {/* Header : titre + progression + ⋯ menu ───────────────────────────── */}
      <header
        className="flex items-stretch border-b"
        style={{
          background: block.couleur ? `${block.couleur}14` : 'transparent',
          borderColor: 'var(--brd-sub)',
        }}
      >
        <div className="flex-1 min-w-0 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2
              className="text-sm font-semibold uppercase tracking-wide truncate flex items-center gap-2"
              style={{ color: 'var(--txt)' }}
            >
              <span className="truncate">{block.titre || 'Bloc'}</span>
              {/* Pastilles bloc — code couleur identique aux lignes CheckItemRow :
                    • ⚠ violet : retour (rendu uniquement)
                    • ⚠ orange : problèmes essais (essais direct, ou rendu RO)
                    • 📷 bleu  : photos pack
                    • 💬 gris  : notes essais                                */}
              {signalCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: isRendu ? 'var(--purple)' : 'var(--orange)' }}
                  title={
                    isRendu
                      ? `${signalCount} remarque${signalCount > 1 ? 's' : ''} au retour`
                      : `${signalCount} signalement${signalCount > 1 ? 's' : ''} sur ce bloc`
                  }
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {signalCount}
                </span>
              )}
              {/* Problèmes essais — RENDU UNIQUEMENT (rappel pour l'opérateur). */}
              {isRendu && blockProblemeEssaisCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--orange)' }}
                  title={`${blockProblemeEssaisCount} problème${blockProblemeEssaisCount > 1 ? 's' : ''} signalé${blockProblemeEssaisCount > 1 ? 's' : ''} aux essais`}
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {blockProblemeEssaisCount}
                </span>
              )}
              {/* Photos pack — visible dans les 2 phases (consultation en rendu). */}
              {blockPhotosPack.length > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--blue)' }}
                  title={`${blockPhotosPack.length} photo${blockPhotosPack.length > 1 ? 's' : ''} pack`}
                >
                  <Camera className="w-2.5 h-2.5" />
                  {blockPhotosPack.length}
                </span>
              )}
              {/* Notes — visibles dans les 2 phases (consultation en rendu). */}
              {blockCommentsNote.length > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums"
                  style={{ color: 'var(--txt-3)' }}
                  title={`${blockCommentsNote.length} commentaire${blockCommentsNote.length > 1 ? 's' : ''}`}
                >
                  <MessageCircle className="w-2.5 h-2.5" />
                  {blockCommentsNote.length}
                </span>
              )}
            </h2>
            {block.description && (
              <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--txt-3)' }}>
                {block.description}
              </p>
            )}
          </div>

          <div className="shrink-0 flex items-center gap-3">
            <span className="text-xs tabular-nums" style={{ color: 'var(--txt-2)' }}>
              {checked}/{total}
            </span>
            <div
              className="h-1.5 w-16 rounded-full overflow-hidden"
              style={{ background: 'var(--bg)' }}
            >
              <div
                className="h-full"
                style={{
                  width: `${pct}%`,
                  background: allChecked ? 'var(--green)' : 'var(--blue)',
                  transition: 'width 220ms ease-out, background 220ms',
                }}
              />
            </div>
          </div>
        </div>

        {/* Menu ⋯ du bloc ──────────────────────────────────────────────── */}
        {menuActions.length > 0 && (
          <ActionSheet
            title={menuTitle}
            actions={menuActions}
            trigger={({ ref, toggle, open }) => (
              <button
                ref={ref}
                type="button"
                onClick={toggle}
                className="shrink-0 px-3 flex items-center text-xs"
                style={{
                  color: 'var(--txt-3)',
                  background: open ? 'var(--bg-hov)' : 'transparent',
                  borderLeft: '1px solid var(--brd-sub)',
                }}
                aria-label="Plus d'actions sur ce bloc"
                aria-haspopup="menu"
                aria-expanded={open}
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
            )}
          />
        )}
      </header>

      {/* MAT-23E : Preview photos pack (view-only, hideUploader=true) ───────
          Grille des photos pack en tête pour que l'équipe voie le contenu
          de la valise "d'un coup d'œil". L'ajout se fait via ⋯ → Photos pack
          (section éditable en essais / consultation RO en rendu). On masque
          la preview si aucune photo pack : évite un grand espace vide.
          MAT-13D-bis : preview conservée en rendu aussi (utile pour comparer
          retour vs initial), mais readOnly (pas d'édition de caption).     */}
      {photosEnabled && blockPhotosPack.length > 0 && (
        <CheckPhotosSection
          photos={blockPhotosPack}
          kind="pack"
          anchor={{ blockId: block.id }}
          userName={userName}
          isAdmin={isAdmin}
          onUpload={onUploadPhoto}
          onDelete={onDeletePhoto}
          onUpdateCaption={onUpdatePhotoCaption}
          compact
          hideUploader
          readOnly={isRendu}
        />
      )}

      {/* Section dépliée — signalements (photos + comments signal) ──── */}
      {expandedSection === 'signal' && (
        <BlockSignalSection
          photos={blockPhotosSignal}
          comments={blockCommentsSignal}
          anchor={{ blockId: block.id }}
          userName={userName}
          isAdmin={isAdmin}
          phase={phase}
          photoKind={signalPhotoKind}
          onAddComment={(body) =>
            onAddComment({ blockId: block.id, kind: signalCommentKind, body })
          }
          onUploadPhoto={onUploadPhoto}
          onDeletePhoto={onDeletePhoto}
          onUpdatePhotoCaption={onUpdatePhotoCaption}
        />
      )}

      {/* Section photos pack — éditable en essais, READ-ONLY en rendu. */}
      {expandedSection === 'pack' && (
        <CheckPhotosSection
          photos={blockPhotosPack}
          kind="pack"
          anchor={{ blockId: block.id }}
          userName={userName}
          isAdmin={isAdmin}
          onUpload={onUploadPhoto}
          onDelete={onDeletePhoto}
          onUpdateCaption={onUpdatePhotoCaption}
          readOnly={isRendu}
          emptyLabel={
            isRendu
              ? 'Aucune photo pack documentée sur ce bloc pendant les essais.'
              : undefined
          }
        />
      )}

      {/* Section problèmes essais — RENDU UNIQUEMENT (consultation RO). */}
      {isRendu && expandedSection === 'probleme-essais' && (
        <BlockEssaisProblemeSection
          photos={blockPhotosProblemeEssais}
          comments={blockCommentsProblemeEssais}
          anchor={{ blockId: block.id }}
          userName={userName}
          isAdmin={isAdmin}
        />
      )}

      {/* Section commentaires notes — éditable en essais, RO en rendu. */}
      {expandedSection === 'notes' && (
        <BlockCommentsThread
          comments={blockCommentsNote}
          onSubmit={(body) =>
            onAddComment({ blockId: block.id, kind: noteCommentKind, body })
          }
          placeholder="Commentaire sur ce bloc…"
          emptyLabel={
            isRendu
              ? 'Aucune note interne posée sur ce bloc pendant les essais.'
              : "Aucun commentaire sur ce bloc. Laisse une note pour l'équipe."
          }
          submitLabel="Envoyer"
          readOnly={isRendu}
        />
      )}

      {/* Items de base ────────────────────────────────────────────────────── */}
      {baseItems.length === 0 && additifItems.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--txt-3)' }}>
          Aucun item dans ce bloc.
        </div>
      ) : (
        <div>
          {baseItems.map((it) => (
            <CheckItemRow
              key={it.id}
              item={it}
              comments={commentsByItem?.get(it.id) || []}
              loueurs={loueursByItem?.get(it.id) || []}
              photos={photosByItem?.get(it.id) || []}
              userName={userName}
              isAdmin={isAdmin}
              phase={phase}
              onToggle={onToggleItem}
              onAddComment={onAddComment}
              onSetRemoved={onSetRemoved}
              onUploadPhoto={onUploadPhoto}
              onDeletePhoto={onDeletePhoto}
              onUpdatePhotoCaption={onUpdatePhotoCaption}
              // onDeleteAdditif volontairement omis : pas de hard-delete sur
              // les items de base (ils doivent rester pour l'audit & le bilan).
            />
          ))}
        </div>
      )}

      {/* Section additifs — essais uniquement (MAT-13D fusionne en rendu) ── */}
      {!isRendu && additifItems.length > 0 && (
        <>
          <div
            className="px-4 py-2 text-xs font-medium uppercase tracking-wide border-t border-b"
            style={{
              color: 'var(--purple)',
              background: 'var(--purple-bg)',
              borderColor: 'var(--purple-brd)',
            }}
          >
            Additifs · ajoutés pendant les essais
          </div>
          <div>
            {additifItems.map((it) => (
              <CheckItemRow
                key={it.id}
                item={it}
                comments={commentsByItem?.get(it.id) || []}
                loueurs={loueursByItem?.get(it.id) || []}
                photos={photosByItem?.get(it.id) || []}
                userName={userName}
                isAdmin={isAdmin}
                phase={phase}
                onToggle={onToggleItem}
                onAddComment={onAddComment}
                onSetRemoved={onSetRemoved}
                onDeleteAdditif={onDeleteAdditif}
                onUploadPhoto={onUploadPhoto}
                onDeletePhoto={onDeletePhoto}
                onUpdatePhotoCaption={onUpdatePhotoCaption}
                showAddedBy
              />
            ))}
          </div>
        </>
      )}

      {/* Formulaire d'ajout d'additif — essais uniquement (pas de mutation
          structurelle en rendu, le hook ne fournit même pas onAddItem) ─── */}
      {!isRendu && onAddItem && (
        <AddItemForm blockId={block.id} onAdd={onAddItem} loueurs={loueurs} />
      )}
    </section>
  )
}

/* ═══ Block signal section ═══════════════════════════════════════════════ */

/**
 * Jumelle côté bloc de SignalSection (CheckItemRow). Combine photos + composer
 * commentaires signal — adapte son wording à la phase (MAT-13D) :
 *   essais → photos kind='probleme' + comments kind='probleme'
 *   rendu  → photos kind='retour'   + comments kind='rendu'
 *
 * Pas de dépendance sur CheckItemRow pour garder le composant bloc autonome
 * (éviter un cycle à l'import).
 */
function BlockSignalSection({
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
    ? "Décrire l'état de ce bloc au retour…"
    : 'Signaler un problème sur ce bloc…'
  const submitLabel = isRendu ? 'Enregistrer' : 'Signaler'
  const emptyLabel = isRendu
    ? photosEnabled
      ? 'Aucune remarque sur ce bloc au retour. Photos + commentaire visibles dans le bon de retour.'
      : 'Aucune remarque sur ce bloc. Elles apparaissent dans le bon de retour.'
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
      <BlockCommentsThread
        comments={comments}
        onSubmit={onAddComment}
        placeholder={placeholder}
        emptyLabel={emptyLabel}
        submitLabel={submitLabel}
      />
    </div>
  )
}

/* ═══ Block essais probleme section (consultation RO en phase rendu) ═══ */

/**
 * Jumelle de EssaisProblemeSection (CheckItemRow) côté bloc. Combine photos
 * kind='probleme' + comments kind='probleme' pour consultation RO depuis
 * la phase rendu (MAT-13D-bis).
 */
function BlockEssaisProblemeSection({
  photos,
  comments,
  anchor,
  userName,
  isAdmin,
}) {
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
        emptyLabel="Aucune photo problème posée sur ce bloc pendant les essais."
      />
      <BlockCommentsThread
        comments={comments}
        readOnly
        emptyLabel="Aucun signalement texte sur ce bloc pendant les essais."
      />
    </div>
  )
}

/* ═══ Block comments thread ═══════════════════════════════════════════════ */

// NB: duplique la logique de CommentsThread dans CheckItemRow. On garde le
// composant local pour éviter un export cyclique (CheckItemRow importe
// déjà CheckBlockCard rien, mais on évite de créer une dépendance inverse).
// Si la forme diverge un jour, on hoistera dans un fichier dédié.
function BlockCommentsThread({
  comments,
  onSubmit,
  placeholder = 'Ajouter un commentaire…',
  emptyLabel = null,
  submitLabel = 'Envoyer',
  // MAT-13D-bis : consultation pure (essais lus depuis rendu).
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
      console.error('[BlockCommentsThread] submit failed', err)
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
