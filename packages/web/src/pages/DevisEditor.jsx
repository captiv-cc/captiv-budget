import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { notify } from '../lib/notify'
import { exportDevisPDF } from '../lib/pdfExport'
import { BLOCS_CANONIQUES, getBlocInfo as _getBlocInfoByName } from '../lib/blocs'
import { EMPTY_LINE } from '../features/devis/constants'
import { useDevis } from '../features/devis/useDevis'
import { useProjectPresence } from '../hooks/useProjectPresence'
import PresenceAvatars from '../components/PresenceAvatars'
import DevisHistoryPanel from '../features/devis/components/DevisHistoryPanel'
import { fetchUnseenCount, markHistorySeen } from '../lib/devisHistorySeen'
import { duplicateDevisVersion } from '../lib/devisDuplicate'
import {
  sendDevisToClient,
  getPublicDevisUrl,
  fetchDevisViewStats,
  fetchDevisSignature,
  getSignedPdfUrl,
  markReminded,
} from '../lib/devisEnvoi'
import StatusSelect from '../features/devis/components/StatusSelect'
import SynthBar from '../features/devis/components/SynthBar'
import AddLineModal from '../features/devis/components/AddLineModal'
import CategoryBlock from '../features/devis/components/CategoryBlock'
import PdfPreviewModal from '../features/materiel/components/PdfPreviewModal'
import {
  Copy,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Save,
  Eye,
  RefreshCw,
  Check,
  Percent,
  BarChart3,
  X,
  Pencil,
  History,
  Send,
  Lock,
  Unlock,
} from 'lucide-react'

// Re-export pour les modules qui importent BLOCS_CANONIQUES depuis DevisEditor
export { BLOCS_CANONIQUES }

// Adaptateur local : reçoit un objet category { name, ... }
function getBlocInfo(cat) {
  const info = _getBlocInfoByName(cat.name)
  return info
}

// Trie les catégories par ordre canonique + assigne les numéros 1-N
function computeSortedCategories(categories) {
  const withInfo = categories.map((cat) => ({ cat, info: getBlocInfo(cat) }))
  withInfo.sort(
    (a, b) => a.info.canonicalIdx - b.info.canonicalIdx || a.cat.sort_order - b.cat.sort_order,
  )
  let num = 1
  return withInfo.map(({ cat, info }) => ({ cat, info, num: info.isCanonical ? num++ : null }))
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function DevisEditor({ embedded = false }) {
  const { id: projectId, devisId } = useParams()
  const navigate = useNavigate()
  const { org, user } = useAuth()

  // ── Données + persistance (hook) ───────────────────────────────────────────
  const D = useDevis({ devisId, projectId, org })
  const {
    devis, project, client, categories, taux, bdd, globalAdj,
    saving, saved, dirty, loading, saveError,
    synth, hasAnyRemise,
    saveNow, updateGlobalAdj, updateDevisField,
    addCategory, addBlocCanonique, renameCategory,
    updateCategoryDansMarge, updateCategoryNotes, deleteCategory,
    insertLine, duplicateLine, deleteLine, updateLine, updateLineBatch, reorderLines,
  } = D

  // ── R3 : présence collaborative (avatars + qui édite quelle ligne) ──────────
  // Channel keyé par devisId (chaque version a sa présence propre).
  const { othersOnPage, othersEditingByRow, setMyEditingRowId } = useProjectPresence({
    projectId: devisId,
    channelSlug: 'devis-presence',
  })

  // ── État purement UI (reste dans le composant) ─────────────────────────────
  const [collapsed, setCollapsed] = useState({})
  const [addLineModal, setAddLineModal] = useState(null) // { catId, defaultRegime } | null
  const [showAnalyse, setShowAnalyse] = useState(false)
  const [showRemise, setShowRemise] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [pdfPreview, setPdfPreview] = useState(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [unseenHistory, setUnseenHistory] = useState(0)

  // ── Workflow statut : verrouillage des devis envoyés / acceptés ────────────
  // Un devis envoyé ou accepté est verrouillé : le lien client affiche le devis
  // en direct, donc on force le réflexe « nouvelle version » plutôt que la
  // modification à chaud d'une version que le client a déjà reçue/validée.
  // Déverrouillage explicite via la modale ; re-verrouillé à chaque changement
  // de devis ou de statut.
  const isSent = devis?.status === 'envoye'
  const isAccepted = devis?.status === 'accepte'
  const [unlockedEdit, setUnlockedEdit] = useState(false)
  const [unlockModal, setUnlockModal] = useState(false)
  useEffect(() => {
    setUnlockedEdit(false)
    setUnlockModal(false)
  }, [devisId, devis?.status])
  const editLocked = (isSent || isAccepted) && !unlockedEdit
  const lastLockNotify = useRef(0)
  const curV = devis?.version_number || 1
  const nextV = curV + 1

  // Bloque toute interaction d'édition dans la zone tableau/synthèse quand le
  // devis est verrouillé. On ne cible que les éléments interactifs (inputs,
  // boutons, cellules focusables, drag) pour laisser vivre scroll et sélection.
  // Les contrôles de lecture (plier/déplier) portent data-lock-allow.
  function guardLocked(e) {
    if (!editLocked) return
    const t = e.target
    if (!t?.closest) return
    if (t.closest('[data-lock-allow]')) return
    if (!t.closest('input, textarea, select, button, [contenteditable="true"], [tabindex], [draggable="true"]'))
      return
    e.preventDefault()
    e.stopPropagation()
    const now = Date.now()
    if (now - lastLockNotify.current > 2500) {
      lastLockNotify.current = now
      notify.warn(`Devis ${isAccepted ? 'accepté' : 'envoyé'} : verrouillé.`)
    }
  }

  // ── Raccourci clavier : Cmd/Ctrl+S = sauvegarder ───────────────────────────
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveNow()
        return
      }
      // Cmd/Ctrl+Entrée → ajouter une ligne au bloc de la cellule active
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const catEl = document.activeElement?.closest?.('[data-cat-id]')
        const catId = catEl?.getAttribute('data-cat-id')
        if (catId) {
          e.preventDefault()
          addLineRef.current(catId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveNow])

  // ── Badge Historique : nb de modifs faites par D'AUTRES et non encore lues.
  // "Lu" = dernière ouverture du panneau, stockée côté serveur (devis_audit_seen)
  // → synchronisé entre appareils ; la pastille s'affiche dès l'arrivée si le
  // devis a été modifié pendant l'absence.
  const showHistoryRef = useRef(false)
  useEffect(() => {
    showHistoryRef.current = showHistory
    if (showHistory && devisId && user?.id) {
      setUnseenHistory(0)
      markHistorySeen(devisId, user.id)
    }
  }, [showHistory, devisId, user?.id])

  // À l'arrivée : compte les entrées non lues (serveur).
  useEffect(() => {
    if (!devisId || !user?.id) return undefined
    let alive = true
    fetchUnseenCount(devisId, user.id).then((n) => {
      if (alive) setUnseenHistory(n)
    })
    return () => {
      alive = false
    }
  }, [devisId, user?.id])

  // Incrément temps réel des modifs des autres tant que le panneau est fermé.
  useEffect(() => {
    if (!devisId) return undefined
    const ch = supabase
      .channel(`devis-audit-badge:${devisId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'devis_audit', filter: `devis_id=eq.${devisId}` },
        (payload) => {
          if (payload.new?.actor_id === user?.id) return // pas mes propres changements
          if (!showHistoryRef.current) setUnseenHistory((n) => n + 1)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [devisId, user?.id])

  // Nettoyage du Blob URL de preview PDF au démontage — évite les fuites
  // mémoire si l'utilisateur ferme l'onglet / change de devis sans fermer
  // la modale manuellement.
  useEffect(() => {
    return () => {
      if (pdfPreview?.revoke) {
        try {
          pdfPreview.revoke()
        } catch {
          /* no-op */
        }
      }
    }
  }, [pdfPreview])

  // (autosave + doSave déplacés dans useDevis)
  // (sauvegarde, autosave, ajustements, handlers catégories → useDevis)

  // ── Prévisualisation PDF ──────────────────────────────────────────────────
  // Génère le PDF en mémoire et ouvre la modale <PdfPreviewModal />. Depuis
  // la modale, l'utilisateur peut télécharger ou fermer. À la fermeture on
  // révoque le Blob URL (cf. closePdfPreview).
  async function openPdfPreview() {
    if (pdfLoading) return
    setPdfLoading(true)
    try {
      const handle = await exportDevisPDF(
        { ...devis, categories, globalAdj },
        project,
        client,
        org,
        taux,
      )
      // Si une préview était déjà ouverte (double-clic, etc.), on révoque.
      if (pdfPreview?.revoke) {
        try {
          pdfPreview.revoke()
        } catch {
          /* no-op */
        }
      }
      setPdfPreview(handle)
    } catch (err) {
      console.error('[DevisEditor] PDF export:', err)
      notify.error('Erreur export PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  function closePdfPreview() {
    if (pdfPreview?.revoke) {
      try {
        pdfPreview.revoke()
      } catch {
        /* no-op */
      }
    }
    setPdfPreview(null)
  }

  // ── Gestion lignes ────────────────────────────────────────────────────────
  // Ouvre la modale régime-first (avec pré-remplissage optionnel)
  function addLine(catId, defaultRegime = null, prefilledProduit = null) {
    const cat = categories.find((c) => c.id === catId)
    const info = cat ? getBlocInfo(cat) : { defaultRegime: 'Frais' }
    const regime = defaultRegime || info.defaultRegime || EMPTY_LINE.regime
    setAddLineModal({ catId, defaultRegime: regime, prefilledProduit })
  }
  // Ref vers la dernière version d'addLine → le listener clavier reste stable.
  const addLineRef = useRef(addLine)
  addLineRef.current = addLine

  // Insère la ligne depuis la modale + ferme la modale
  function confirmAddLine(catId, lineData) {
    insertLine(catId, lineData)
    setAddLineModal(null)
  }

  // ── Dupliquer en nouvelle version ─────────────────────────────────────────
  // Logique partagée (lib/devisDuplicate) : version par LOT, recopie complète
  // (catégories, lignes, membres). Duplique la version PERSISTÉE → on force un
  // save avant si des modifs locales sont en attente.
  const [duplicating, setDuplicating] = useState(false)
  async function dupliquerVersion() {
    if (duplicating) return
    setDuplicating(true)
    try {
      if (dirty) {
        saveNow()
        // Laisse l'autosave/save en cours aboutir (doSave est séquentiel).
        await new Promise((r) => setTimeout(r, 400))
      }
      const newDevis = await duplicateDevisVersion(devisId, { createdBy: user?.id })
      notify.success(`V${newDevis.version_number} créée`)
      navigate(`/projets/${projectId}/devis/${newDevis.id}`)
    } catch (err) {
      console.error('[dupliquerVersion]', err)
      notify.error(`Duplication impossible : ${err.message}`)
    } finally {
      setDuplicating(false)
    }
  }

  // ── Envoi au client (Phase 1) ──────────────────────────────────────────────
  // Fige un PDF de la version courante (snapshot immuable montré au client),
  // passe le devis en "Envoyé" et copie le lien public.
  const [sending, setSending] = useState(false)
  const [sendModal, setSendModal] = useState(false)
  const [sendMessage, setSendMessage] = useState('')
  const [sendValidity, setSendValidity] = useState('30') // jours ; '0' = sans limite

  function envoyerAuClient() {
    if (sending) return
    setSendMessage(devis?.message_client || '')
    setSendModal(true)
  }

  async function confirmSend() {
    if (sending) return
    setSending(true)
    try {
      if (dirty) {
        saveNow()
        await new Promise((r) => setTimeout(r, 400))
      }
      const days = parseInt(sendValidity, 10)
      const validUntil =
        days > 0 ? new Date(Date.now() + days * 24 * 3600 * 1000).toISOString() : null
      const { url } = await sendDevisToClient({
        devis, categories, globalAdj, project, client, org, taux,
        message: sendMessage,
        validUntil,
        totals: { ht: synth?.totalHTFinal ?? null, ttc: synth?.totalTTC ?? null },
        sentBy: user?.id || null,
      })
      setSendModal(false)
      updateDevisField('status', 'envoye') // sync état local (le DB est déjà à jour)
      try {
        await navigator.clipboard.writeText(url)
        notify.success('PDF figé, lien copié dans le presse-papier')
      } catch {
        notify.info(url, { duration: 12000 })
      }
    } catch (err) {
      console.error('[confirmSend]', err)
      notify.error(`Envoi impossible : ${err.message}`)
    } finally {
      setSending(false)
    }
  }

  // Relance : mail pré-rempli depuis la boîte de l'utilisateur + trace en DB.
  function relancerClient() {
    const url = getPublicDevisUrl(devis)
    const subject = encodeURIComponent(
      `Relance devis${devis?.title ? ` « ${devis.title} »` : ''}${project?.title ? ` · ${project.title}` : ''}`,
    )
    const body = encodeURIComponent(
      `Bonjour,\n\nAvez-vous pu prendre connaissance de notre devis ?\nVous pouvez le consulter et l'accepter ici : ${url}\n\nBien cordialement,`,
    )
    markReminded(devisId).then(() => {
      // maj optimiste de la date affichée dans le bandeau
      updateDevisField('last_reminded_at', new Date().toISOString())
    })
    if (client?.email) {
      window.location.href = `mailto:${client.email}?subject=${subject}&body=${body}`
    } else {
      navigator.clipboard.writeText(url)
      notify.info('Pas d’email client renseigné : lien copié, relance tracée')
    }
  }

  // Stats de consultation du lien public (affichées dans le bandeau)
  const [viewStats, setViewStats] = useState(null)
  useEffect(() => {
    if (!devisId || !(isSent || isAccepted)) return undefined
    let alive = true
    fetchDevisViewStats(devisId).then((s) => {
      if (alive) setViewStats(s)
    })
    return () => {
      alive = false
    }
  }, [devisId, isSent, isAccepted])

  // Signature Universign (Phase 2) : signataire affiché dans le bandeau accepté
  const [signatureInfo, setSignatureInfo] = useState(null)
  useEffect(() => {
    if (!devisId || !isAccepted) return undefined
    let alive = true
    fetchDevisSignature(devisId).then((s) => {
      if (alive) setSignatureInfo(s)
    })
    return () => {
      alive = false
    }
  }, [devisId, isAccepted])

  // ── Calcul synthèse global ────────────────────────────────────────────────
  // allLines / hasAnyRemise / synth viennent désormais du hook useDevis.
  // Affiche la colonne Remise si au moins une ligne a une remise, OU si forcée.
  const remiseVisible = showRemise || hasAnyRemise

  if (loading)
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )

  // Map id→nom de bloc pour traduire les changements de catégorie dans l'historique
  const catNameById = new Map(categories.map((c) => [c.id, getBlocInfo(c).label || c.name]))

  // Clic sur une entrée d'historique → déplie le bloc, scroll vers la ligne, flash.
  function jumpToLine(lineId) {
    if (!lineId) return
    const cat = categories.find((c) => c.lines.some((l) => l.id === lineId))
    if (cat && collapsed[cat.id]) setCollapsed((p) => ({ ...p, [cat.id]: false }))
    // Double rAF : laisse React rendre la ligne si le bloc vient d'être déplié.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-line-key="${CSS.escape(String(lineId))}"]`)
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.remove('devis-line-flash')
        // reflow pour pouvoir rejouer l'animation si on re-clique la même ligne
        void el.offsetWidth
        el.classList.add('devis-line-flash')
        setTimeout(() => el.classList.remove('devis-line-flash'), 1800)
      }),
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <header
        className="px-4 shrink-0"
        style={{ background: 'var(--bg-surf)', borderBottom: '1px solid var(--brd)' }}
      >
        <div className="flex items-center justify-between gap-4 py-2">
          {/* Gauche : navigation + titre */}
          <div className="flex items-center gap-2.5 shrink-0">
            {!embedded && (
              <Link to={`/projets/${projectId}`} className="btn-ghost btn-sm">
                <ChevronLeft className="w-4 h-4" />
              </Link>
            )}
            {embedded && (
              <Link
                to={`/projets/${projectId}/devis`}
                className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded transition-all"
                style={{
                  color: 'var(--txt)',
                  background: 'rgba(255,255,255,.07)',
                  border: '1px solid rgba(255,255,255,.12)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.12)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.07)')}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Versions
              </Link>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold shrink-0" style={{ color: 'var(--blue)' }}>
                Devis V{devis?.version_number}
              </span>
              {editingTitle ? (
                <input
                  type="text"
                  autoFocus
                  defaultValue={devis?.title || ''}
                  placeholder="Nom du devis (optionnel)"
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    updateDevisField('title', v || null)
                    setEditingTitle(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditingTitle(false)
                  }}
                  className="text-xs px-1.5 py-0.5 rounded outline-none"
                  style={{
                    background: 'rgba(255,255,255,.06)',
                    border: '1px solid var(--brd)',
                    color: 'var(--txt)',
                    minWidth: '220px',
                  }}
                />
              ) : (
                <button
                  onClick={() => setEditingTitle(true)}
                  title={devis?.title ? 'Renommer le devis' : 'Ajouter un nom au devis'}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded transition-all group"
                  style={{ color: devis?.title ? 'var(--txt-2)' : 'var(--txt-3)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className="text-xs italic truncate max-w-[260px]">
                    {devis?.title || 'Sans nom'}
                  </span>
                  <Pencil className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                </button>
              )}
              <StatusSelect
                status={devis?.status}
                onChange={(v) => {
                  // Passer en "Envoyé" à la main déclenche le vrai flux d'envoi
                  // (snapshot PDF + lien), pas un simple changement d'étiquette.
                  if (v === 'envoye' && devis?.status !== 'envoye') {
                    envoyerAuClient()
                    return
                  }
                  updateDevisField('status', v)
                }}
              />
              {(isSent || isAccepted) &&
                (editLocked ? (
                  <Lock
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: isAccepted ? 'var(--green)' : 'var(--blue)' }}
                    title={`Devis ${isAccepted ? 'accepté' : 'envoyé'} : verrouillé`}
                  />
                ) : (
                  <Unlock
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: 'var(--orange)' }}
                    title="Déverrouillé pour modification"
                  />
                ))}
            </div>
          </div>

          {/* Droite : présence + statut save + boutons ───────────────────── */}
          <div className="flex items-center gap-2 shrink-0">
            <PresenceAvatars othersOnPage={othersOnPage} showLabel={false} />
            <div
              className="flex items-center gap-1.5 text-xs"
              style={{ width: '90px', justifyContent: 'flex-end' }}
            >
              {saving && (
                <>
                  <RefreshCw
                    className="w-3.5 h-3.5 animate-spin"
                    style={{ color: 'var(--txt-3)' }}
                  />
                  <span style={{ color: 'var(--txt-3)' }}>Sauvegarde…</span>
                </>
              )}
              {saved && !saving && (
                <>
                  <Check className="w-3.5 h-3.5" style={{ color: 'var(--green)' }} />
                  <span style={{ color: 'var(--green)' }}>Sauvegardé</span>
                </>
              )}
              {saveError && !saving && (
                <span
                  className="font-medium cursor-pointer"
                  style={{ color: 'var(--red)' }}
                  onClick={() => notify.error(`Erreur sauvegarde : ${saveError}`)}
                >
                  ⚠ Erreur save
                </span>
              )}
              {dirty && !saving && !saved && !saveError && (
                <span className="flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: 'var(--orange)' }}
                  />
                  Non sauvegardé
                </span>
              )}
            </div>
            <button onClick={saveNow} className="btn-secondary btn-sm">
              <Save className="w-3.5 h-3.5" />
              Sauvegarder
            </button>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="btn-secondary btn-sm relative"
              title="Historique des changements"
              style={showHistory ? { color: 'var(--blue)', borderColor: 'var(--blue)' } : undefined}
            >
              <History className="w-3.5 h-3.5" />
              {unseenHistory > 0 && !showHistory && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full text-[9px] font-bold"
                  style={{ background: 'var(--blue)', color: '#fff' }}
                >
                  {unseenHistory > 9 ? '9+' : unseenHistory}
                </span>
              )}
            </button>
            <button onClick={dupliquerVersion} disabled={duplicating} className="btn-secondary btn-sm">
              <Copy className="w-3.5 h-3.5" />
              Dupliquer V{(devis?.version_number || 0) + 1}
            </button>
            <button
              onClick={openPdfPreview}
              disabled={pdfLoading}
              className="btn-secondary btn-sm"
              title="Prévisualiser le devis en PDF"
            >
              {pdfLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              PDF
            </button>
            {devis?.pdf_snapshot_path && (isSent || isAccepted) ? (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(getPublicDevisUrl(devis))
                  notify.success('Lien copié dans le presse-papier')
                }}
                className="btn-primary btn-sm"
                title="Copier le lien de consultation client"
              >
                <Eye className="w-3.5 h-3.5" />
                Lien client
              </button>
            ) : (
              <button
                onClick={envoyerAuClient}
                disabled={sending}
                className="btn-primary btn-sm"
                title="Figer un PDF et générer le lien client"
              >
                {sending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Envoyer au client
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Bandeau workflow statut ──────────────────────────────────────── */}
      {editLocked && (
        <div
          className="flex items-center gap-2 px-4 py-1.5 text-xs shrink-0"
          style={{
            background: isAccepted ? 'rgba(0,200,117,.08)' : 'rgba(59,130,246,.08)',
            borderBottom: `1px solid ${isAccepted ? 'rgba(0,200,117,.25)' : 'rgba(59,130,246,.25)'}`,
            color: 'var(--txt-2)',
          }}
        >
          {isAccepted ? (
            <Lock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--green)' }} />
          ) : (
            <Send className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--blue)' }} />
          )}
          <span>
            <strong style={{ color: isAccepted ? 'var(--green)' : 'var(--blue)' }}>
              {isAccepted ? 'Devis accepté' : 'Devis envoyé'}
              {isAccepted && devis?.accepted_at
                ? ` le ${new Date(devis.accepted_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}.`
                : !isAccepted && devis?.sent_at
                  ? ` le ${new Date(devis.sent_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}.`
                  : '.'}
            </strong>
            {signatureInfo?.status === 'signed' && (
              <>
                {' '}
                Signé par {signatureInfo.signer_name}
                {signatureInfo.signer_fonction ? ` (${signatureInfo.signer_fonction})` : ''}.
              </>
            )}
            {viewStats &&
              (viewStats.views > 0 ? (
                <>
                  {' '}
                  Vu {viewStats.views} fois
                  {viewStats.lastViewAt &&
                    `, dernier le ${new Date(viewStats.lastViewAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${new Date(viewStats.lastViewAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                  .
                </>
              ) : (
                <> Jamais ouvert par le client.</>
              ))}
            {isSent &&
              devis?.valid_until &&
              (new Date(devis.valid_until).getTime() < Date.now() ? (
                <strong style={{ color: 'var(--red)' }}>
                  {' '}
                  Offre expirée le{' '}
                  {new Date(devis.valid_until).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}.
                </strong>
              ) : (
                <>
                  {' '}
                  Valable jusqu&apos;au{' '}
                  {new Date(devis.valid_until).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}.
                </>
              ))}
            {isSent && devis?.last_reminded_at && (
              <>
                {' '}
                Relancé le{' '}
                {new Date(devis.last_reminded_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}.
              </>
            )}
          </span>
          {isSent && (
            <button
              onClick={relancerClient}
              className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
              style={{
                color: 'var(--txt-2)',
                background: 'rgba(255,255,255,.06)',
                border: '1px solid var(--brd)',
              }}
              title={
                client?.email
                  ? `Email pré-rempli vers ${client.email} + relance tracée`
                  : 'Copie le lien + trace la relance (pas d’email client renseigné)'
              }
            >
              Relancer
            </button>
          )}
          {signatureInfo?.signed_pdf_path && (
            <button
              onClick={async () => {
                const url = await getSignedPdfUrl(signatureInfo.signed_pdf_path)
                if (url) window.open(url, '_blank', 'noopener')
                else notify.error('PDF signé indisponible')
              }}
              className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
              style={{
                color: 'var(--green)',
                background: 'rgba(0,200,117,.08)',
                border: '1px solid rgba(0,200,117,.25)',
              }}
            >
              PDF signé
            </button>
          )}
          <button
            onClick={dupliquerVersion}
            className="ml-auto text-xs font-semibold px-2 py-0.5 rounded shrink-0"
            style={{
              color: 'var(--txt)',
              background: 'rgba(255,255,255,.08)',
              border: '1px solid var(--brd)',
            }}
          >
            Créer la V{nextV}
          </button>
          <button
            onClick={() => setUnlockModal(true)}
            className="text-xs px-2 py-0.5 rounded shrink-0"
            style={{ color: 'var(--txt-3)', border: '1px solid transparent' }}
          >
            Modifier la V{curV}…
          </button>
        </div>
      )}
      {(isSent || isAccepted) && !editLocked && (
        <div
          className="flex items-center gap-2 px-4 py-1.5 text-xs shrink-0"
          style={{
            background: 'rgba(255,159,67,.10)',
            borderBottom: '1px solid rgba(255,159,67,.3)',
            color: 'var(--txt-2)',
          }}
        >
          <Unlock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--orange)' }} />
          <span>
            <strong style={{ color: 'var(--orange)' }}>V{curV} déverrouillée.</strong> Le client
            garde le PDF envoyé : renvoyez-le après vos modifications.
          </span>
          <button
            onClick={envoyerAuClient}
            disabled={sending}
            className="ml-auto text-xs font-semibold px-2 py-0.5 rounded shrink-0"
            style={{
              color: 'var(--txt)',
              background: 'rgba(255,255,255,.08)',
              border: '1px solid var(--brd)',
            }}
          >
            Renvoyer au client
          </button>
          <button
            onClick={() => setUnlockedEdit(false)}
            className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
            style={{
              color: 'var(--txt-2)',
              background: 'rgba(255,255,255,.06)',
              border: '1px solid var(--brd)',
            }}
          >
            Reverrouiller
          </button>
        </div>
      )}
      {devis?.status === 'refuse' && (
        <div
          className="flex items-center gap-2 px-4 py-1.5 text-xs shrink-0"
          style={{
            background: 'rgba(239,68,68,.08)',
            borderBottom: '1px solid rgba(239,68,68,.25)',
            color: 'var(--txt-2)',
          }}
        >
          <X className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--red)' }} />
          <span>
            <strong style={{ color: 'var(--red)' }}>
              Devis refusé
              {devis?.refused_at
                ? ` le ${new Date(devis.refused_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
                : ''}
              .
            </strong>
            {devis?.refused_reason && <> Raison : « {devis.refused_reason} »</>}
          </span>
          <button
            onClick={dupliquerVersion}
            className="ml-auto text-xs font-semibold px-2 py-0.5 rounded shrink-0"
            style={{
              color: 'var(--txt)',
              background: 'rgba(255,255,255,.08)',
              border: '1px solid var(--brd)',
            }}
          >
            Créer la V{nextV}
          </button>
        </div>
      )}

      {/* ── Table principale — pleine largeur ────────────────────────────── */}
      <div
        className="flex-1 overflow-auto"
        style={{ paddingBottom: '80px' }}
        onClickCapture={guardLocked}
        onMouseDownCapture={guardLocked}
        onKeyDownCapture={guardLocked}
        onDragStartCapture={guardLocked}
      >
        <table
          className="devis-table w-full border-collapse"
          style={{ minWidth: showAnalyse ? '1310px' : '910px' }}
        >
          <thead className="sticky top-0 z-20">
            <tr>
              {/* Grip — collapse-all intégré */}
              <th className="w-8 text-center">
                {(() => {
                  const allCollapsed =
                    categories.length > 0 && categories.every((c) => collapsed[c.id])
                  return (
                    <button
                      onClick={() =>
                        allCollapsed
                          ? setCollapsed({})
                          : setCollapsed(Object.fromEntries(categories.map((c) => [c.id, true])))
                      }
                      title={allCollapsed ? 'Tout développer' : 'Tout réduire'}
                      data-lock-allow
                      className="flex items-center justify-center rounded transition-all"
                      style={{
                        width: '22px',
                        height: '18px',
                        color: 'var(--txt-2)',
                        background: 'rgba(255,255,255,.06)',
                        border: '1px solid rgba(255,255,255,.10)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,.11)'
                        e.currentTarget.style.color = 'var(--txt)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,.06)'
                        e.currentTarget.style.color = 'var(--txt-2)'
                      }}
                    >
                      {allCollapsed ? (
                        <ChevronRight className="w-2.5 h-2.5" />
                      ) : (
                        <ChevronDown className="w-2.5 h-2.5" />
                      )}
                    </button>
                  )
                })()}
              </th>
              <th className="w-6" title="Activer la ligne">
                ✓
              </th>
              <th className="w-72">Produit / Poste</th>
              <th className="w-56">Description</th>
              <th className="w-24">Cat.</th>
              <th className="w-10">Nb</th>
              <th className="w-20" title="Quantité × unité">
                Qté
              </th>
              <th className="w-24">Tarif HT</th>
              <th className="col-cout w-24" title="Coût d'achat unitaire (vide = égal au tarif)">
                Coût unit.
              </th>
              {remiseVisible && (
                <th className="w-16">
                  <button
                    onClick={() => setShowRemise((p) => !p)}
                    data-lock-allow
                    title={showRemise && !hasAnyRemise ? 'Masquer la colonne remise' : 'Remise'}
                    className="flex items-center gap-1 rounded transition-all"
                    style={{
                      padding: '1px 5px',
                      fontSize: '10px',
                      fontWeight: 600,
                      color: hasAnyRemise ? 'var(--txt-2)' : 'var(--txt-3)',
                      background:
                        showRemise && !hasAnyRemise ? 'rgba(255,255,255,.06)' : 'transparent',
                      border:
                        showRemise && !hasAnyRemise
                          ? '1px solid rgba(255,255,255,.10)'
                          : '1px solid transparent',
                    }}
                  >
                    Remise {showRemise && !hasAnyRemise && <X className="w-2.5 h-2.5 ml-0.5" />}
                  </button>
                </th>
              )}
              {!remiseVisible && (
                <th className="w-5" title="Afficher la colonne remise">
                  <button
                    onClick={() => setShowRemise(true)}
                    data-lock-allow
                    style={{ color: 'var(--txt-3)', opacity: 0.4, padding: '2px' }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.4')}
                    title="Afficher la colonne Remise"
                  >
                    <Percent className="w-2.5 h-2.5" />
                  </button>
                </th>
              )}
              <th className="col-vente w-28">Prix vente HT</th>
              {showAnalyse ? (
                <>
                  <th className="col-dim w-24">Coût réel</th>
                  <th className="col-dim w-32">Marge / %</th>
                  <th className="col-dim w-24">Charges</th>
                  <th className="col-dim w-28">Coût chargé</th>
                </>
              ) : (
                <th className="col-dim w-16">Mg %</th>
              )}
              {/* Actions — toggle Analyse intégré */}
              <th className="w-20 text-right" style={{ paddingRight: '6px' }}>
                <button
                  onClick={() => setShowAnalyse((p) => !p)}
                  data-lock-allow
                  title={showAnalyse ? "Masquer l'analyse" : "Afficher l'analyse"}
                  className="flex items-center gap-1 ml-auto rounded transition-all"
                  style={{
                    padding: '2px 6px',
                    fontSize: '10px',
                    fontWeight: 600,
                    letterSpacing: '.03em',
                    whiteSpace: 'nowrap',
                    ...(showAnalyse
                      ? {
                          color: 'var(--blue)',
                          background: 'rgba(77,159,255,.15)',
                          border: '1px solid rgba(77,159,255,.35)',
                        }
                      : {
                          color: 'var(--txt-2)',
                          background: 'rgba(255,255,255,.06)',
                          border: '1px solid rgba(255,255,255,.10)',
                        }),
                  }}
                  onMouseEnter={(e) => {
                    if (!showAnalyse) {
                      e.currentTarget.style.background = 'rgba(255,255,255,.11)'
                      e.currentTarget.style.color = 'var(--txt)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!showAnalyse) {
                      e.currentTarget.style.background = 'rgba(255,255,255,.06)'
                      e.currentTarget.style.color = 'var(--txt-2)'
                    }
                  }}
                >
                  <BarChart3 className="w-2.5 h-2.5" />
                  <span>Analyse</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {computeSortedCategories(categories).map(({ cat, info, num }) => (
              <CategoryBlock
                key={cat.id}
                cat={cat}
                info={info}
                num={num}
                collapsed={Boolean(collapsed[cat.id])}
                taux={taux}
                bdd={bdd}
                showAnalyse={showAnalyse}
                remiseVisible={remiseVisible}
                onToggle={() => setCollapsed((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
                onRename={(name) => renameCategory(cat.id, name)}
                onDelete={() => deleteCategory(cat.id)}
                onToggleDansMarge={(val) => updateCategoryDansMarge(cat.id, val)}
                onUpdateNotes={(notes) => updateCategoryNotes(cat.id, notes)}
                onAddLine={(defaultRegime, prefilledProduit) =>
                  addLine(cat.id, defaultRegime, prefilledProduit)
                }
                onAddLineDirect={(lineData) => insertLine(cat.id, lineData)}
                onOpenIntermittent={(item) =>
                  setAddLineModal({
                    catId: cat.id,
                    defaultRegime:
                      item.filiere === 'Artiste'
                        ? 'Intermittent Artiste'
                        : 'Intermittent Technicien',
                    prefilledPoste: item.poste,
                    prefilledIsSpec: item.is_specialise || false,
                  })
                }
                onUpdateLine={(lineId, tempId, field, val) =>
                  updateLine(cat.id, lineId, tempId, field, val)
                }
                onUpdateLineBatch={(lineId, tempId, updates) =>
                  updateLineBatch(cat.id, lineId, tempId, updates)
                }
                onDeleteLine={(lineId, tempId) => deleteLine(cat.id, lineId, tempId)}
                onDuplicateLine={(lineId, tempId) => duplicateLine(cat.id, lineId, tempId)}
                onReorderLines={(fromIdx, toIdx) => reorderLines(cat.id, fromIdx, toIdx)}
                othersEditingByRow={othersEditingByRow}
                onEditRow={setMyEditingRowId}
              />
            ))}
          </tbody>
        </table>

        {/* État vide — aucun bloc encore */}
        {categories.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-12 px-4">
            <BarChart3 className="w-8 h-8 mb-3" style={{ color: 'var(--txt-3)', opacity: 0.5 }} />
            <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
              Ce devis est vide
            </p>
            <p className="text-xs mt-1 max-w-xs" style={{ color: 'var(--txt-3)' }}>
              Ajoutez un bloc ci-dessous (Régie, Matériel, Équipe…) pour commencer à
              chiffrer vos lignes.
            </p>
          </div>
        )}

        {/* Ajouter bloc */}
        {(() => {
          const activeKeys = new Set(categories.map((c) => c.name))
          const inactiveBlocs = BLOCS_CANONIQUES.filter((b) => !activeKeys.has(b.key))
          return (
            <div
              className="p-4 flex flex-wrap items-center gap-2"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              <span className="text-xs font-medium" style={{ color: 'var(--txt-3)' }}>
                Ajouter un bloc :
              </span>
              {inactiveBlocs.map((bloc) => (
                <button
                  key={bloc.key}
                  onClick={() => addBlocCanonique(bloc)}
                  className="btn-secondary btn-sm text-xs flex items-center gap-1.5"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: bloc.color }}
                  />
                  + {bloc.label}
                </button>
              ))}
              {inactiveBlocs.length === 0 && (
                <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
                  Tous les blocs sont actifs
                </span>
              )}
              <button
                onClick={() => addCategory('')}
                className="btn-ghost btn-sm text-xs ml-2"
                style={{ color: 'var(--txt-3)' }}
              >
                + Bloc personnalisé…
              </button>
            </div>
          )
        })()}
      </div>

      {/* ── Modale ajout de ligne — régime-first ─────────────────────────── */}
      {addLineModal && (
        <AddLineModal
          catId={addLineModal.catId}
          defaultRegime={addLineModal.defaultRegime}
          prefilledPoste={addLineModal.prefilledPoste || null}
          prefilledIsSpec={addLineModal.prefilledIsSpec || false}
          prefilledProduit={addLineModal.prefilledProduit || null}
          onConfirm={(lineData) => confirmAddLine(addLineModal.catId, lineData)}
          onClose={() => setAddLineModal(null)}
        />
      )}

      {/* ── Bandeau Synthèse — sticky bas pleine largeur ──────────────────── */}
      <div
        onClickCapture={guardLocked}
        onMouseDownCapture={guardLocked}
        onKeyDownCapture={guardLocked}
      >
        <SynthBar
          synth={synth}
          devis={devis}
          globalAdj={globalAdj}
          onUpdateGlobal={updateGlobalAdj}
          onUpdateDevis={updateDevisField}
        />
      </div>

      {/* ── Prévisualisation PDF ─────────────────────────────────────────── */}
      <PdfPreviewModal
        open={Boolean(pdfPreview)}
        onClose={closePdfPreview}
        title={`Devis${devis?.version_number ? ` V${devis.version_number}` : ''}${project?.title ? ` · ${project.title}` : ''}`}
        url={pdfPreview?.url || null}
        filename={pdfPreview?.filename || 'devis.pdf'}
        onDownload={() => pdfPreview?.download?.()}
      />

      {/* ── Modale d'envoi au client (message + validité) ────────────────── */}
      {sendModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,.55)' }}
          onClick={() => setSendModal(false)}
        >
          <div
            className="rounded-xl p-5 mx-4"
            style={{
              width: '460px',
              maxWidth: '100%',
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              boxShadow: '0 16px 48px rgba(0,0,0,.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--txt)' }}>
              Envoyer la V{curV} au client
            </h3>
            <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--txt-3)' }}>
              Un PDF de la V{curV} est figé pour le client et le devis passe en « Envoyé ».
            </p>
            <label className="block mb-3">
              <span
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--txt-3)' }}
              >
                Mot d&apos;accompagnement (optionnel)
              </span>
              <textarea
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                placeholder="Bonjour, voici notre proposition pour…"
                rows={3}
                className="w-full mt-1 px-2.5 py-2 rounded-lg text-xs outline-none resize-none"
                style={{
                  background: 'rgba(255,255,255,.05)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                  lineHeight: 1.5,
                }}
              />
            </label>
            <label className="block mb-4">
              <span
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--txt-3)' }}
              >
                Validité de l&apos;offre
              </span>
              <select
                value={sendValidity}
                onChange={(e) => setSendValidity(e.target.value)}
                className="w-full mt-1 px-2.5 py-2 rounded-lg text-xs outline-none cursor-pointer"
                style={{
                  background: 'rgba(255,255,255,.05)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              >
                <option value="15">15 jours</option>
                <option value="30">30 jours</option>
                <option value="45">45 jours</option>
                <option value="60">60 jours</option>
                <option value="0">Sans limite</option>
              </select>
            </label>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setSendModal(false)} className="btn-ghost btn-sm">
                Annuler
              </button>
              <button onClick={confirmSend} disabled={sending} className="btn-primary btn-sm">
                {sending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Figer et copier le lien
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modale déverrouillage (devis envoyé/accepté) ─────────────────── */}
      {unlockModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,.55)' }}
          onClick={() => setUnlockModal(false)}
        >
          <div
            className="rounded-xl p-5 mx-4"
            style={{
              width: '440px',
              maxWidth: '100%',
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              boxShadow: '0 16px 48px rgba(0,0,0,.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--txt)' }}>
              Modifier la V{curV} {isAccepted ? 'acceptée' : 'envoyée'} ?
            </h3>
            <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--txt-2)' }}>
              {isAccepted
                ? `Le client a accepté la V${curV}. Pour changer le contenu, créez plutôt une V${nextV}.`
                : `Le client a déjà reçu la V${curV}. Pour changer le contenu, créez plutôt une V${nextV}.`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setUnlockModal(false)} className="btn-ghost btn-sm">
                Annuler
              </button>
              <button
                onClick={() => {
                  setUnlockModal(false)
                  setUnlockedEdit(true)
                }}
                className="btn-secondary btn-sm"
                style={{ color: 'var(--orange)' }}
              >
                <Unlock className="w-3.5 h-3.5" />
                Modifier la V{curV}
              </button>
              <button
                onClick={() => {
                  setUnlockModal(false)
                  dupliquerVersion()
                }}
                className="btn-primary btn-sm"
              >
                <Copy className="w-3.5 h-3.5" />
                Créer la V{nextV}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Historique des changements (R4) ──────────────────────────────── */}
      <DevisHistoryPanel
        open={showHistory}
        onClose={() => setShowHistory(false)}
        devisId={devisId}
        catNameById={catNameById}
        onJumpToLine={jumpToLine}
      />
    </div>
  )
}
