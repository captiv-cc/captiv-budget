// ════════════════════════════════════════════════════════════════════════════
// MaterielListesGrid — hall d'entrée multi-listes de l'outil Matériel
// ════════════════════════════════════════════════════════════════════════════
//
// MATOS-LISTES : quand le projet a PLUSIEURS listes (« Scène A », « Scène B »),
// on atterrit sur cette grille de cartes (même pattern que les plans
// éditables). Une seule liste → la grille est sautée, l'outil s'ouvre
// directement (le bouton « ‹ Listes » de MaterielListeBar y ramène).
//
// Exporte aussi :
//   - MaterielListeBar : « ‹ Listes | Titre ⌄ | badge lot » au-dessus du
//     header de l'outil (switch de liste sans repasser par la grille).
//   - useDevisLots : lots de devis du projet (badge informatif, v1).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  Copy,
  Edit3,
  MoreHorizontal,
  Package,
  Plus,
  RotateCcw,
  Trash2,
  Users,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { confirm, prompt } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'
import {
  fetchListTemplates,
  saveListTemplate,
  deleteListTemplate,
} from '../../../lib/materiel'

/** Lots de devis du projet (pour le badge + le rattachement d'une liste). */
export function useDevisLots(projectId) {
  const [lots, setLots] = useState([])
  useEffect(() => {
    if (!projectId) return undefined
    let alive = true
    supabase
      .from('devis_lots')
      .select('id, title, archived')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (alive) setLots((data || []).filter((l) => !l.archived))
      })
    return () => {
      alive = false
    }
  }, [projectId])
  return lots
}

function LotBadge({ liste, lots }) {
  const lot = lots.find((l) => l.id === liste.devis_lot_id)
  if (lot) {
    return (
      <span
        className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
        style={{ background: 'var(--purple-bg, rgba(139,92,246,0.15))', color: 'var(--purple, #a78bfa)' }}
        title="Rattachée au lot de devis"
      >
        Lot · {lot.title}
      </span>
    )
  }
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: 'var(--bg)', color: 'var(--txt-3)', border: '1px solid var(--brd)' }}
    >
      Globale
    </span>
  )
}

/* ─── Modale créer / renommer une liste ──────────────────────────────────── */

function ListeFormModal({ liste = null, lots, templates = [], onTemplatesChanged, onClose, onSubmit }) {
  const [titre, setTitre] = useState(liste?.titre || '')
  const [lotId, setLotId] = useState(liste?.devis_lot_id || '')
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)
  const isCreate = !liste

  async function submit(e) {
    e.preventDefault()
    if (!titre.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit({
        titre: titre.trim(),
        devisLotId: lotId || null,
        template: templates.find((t) => t.id === templateId) || null,
      })
      onClose()
    } catch (err) {
      notify.error('Enregistrement impossible : ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  async function removeTemplate() {
    const tpl = templates.find((t) => t.id === templateId)
    if (!tpl) return
    const ok = await confirm({
      title: `Supprimer le modèle « ${tpl.titre} » ?`,
      message: 'Le modèle sera supprimé pour toute l’organisation. Les listes déjà créées ne bougent pas.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteListTemplate(tpl.id)
      setTemplateId('')
      onTemplatesChanged?.()
      notify.success('Modèle supprimé')
    } catch (err) {
      notify.error('Suppression impossible : ' + (err?.message || err))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-xl p-5"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
      >
        <h2 className="text-base font-bold mb-3" style={{ color: 'var(--txt)' }}>
          {liste ? 'Modifier la liste' : 'Nouvelle liste'}
        </h2>
        <label className="block mb-3">
          <span className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
            Nom de la liste
          </span>
          <input
            type="text"
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            autoFocus
            placeholder="Scène A"
            className="w-full text-sm px-2.5 py-2 rounded-md outline-none"
            style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
          />
        </label>
        <label className="block mb-3">
          <span className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
            Lot de devis (optionnel)
          </span>
          <select
            value={lotId}
            onChange={(e) => setLotId(e.target.value)}
            className="w-full text-sm px-2.5 py-2 rounded-md outline-none"
            style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
          >
            <option value="">— Globale (aucun lot) —</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
        {isCreate && templates.length > 0 && (
          <label className="block mb-4">
            <span className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
              Partir d’un modèle (optionnel)
            </span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full text-sm px-2.5 py-2 rounded-md outline-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
            >
              <option value="">— Liste vierge —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.titre} ({(t.data?.blocks || []).reduce((n, b) => n + (b.items?.length || 0), 0)} items)
                </option>
              ))}
            </select>
            {templateId && (
              <button
                type="button"
                onClick={removeTemplate}
                className="mt-1 text-[11px] font-semibold"
                style={{ color: 'var(--red, #ff4757)' }}
              >
                Supprimer ce modèle
              </button>
            )}
          </label>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="text-xs font-semibold px-3 py-1.5 rounded-md" style={{ color: 'var(--txt-3)' }}>
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy || !titre.trim()}
            className="text-xs font-semibold px-3.5 py-1.5 rounded-md"
            style={{ background: 'var(--blue)', color: '#fff', opacity: busy || !titre.trim() ? 0.6 : 1 }}
          >
            {liste ? 'Enregistrer' : 'Créer la liste'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ─── Carte d'une liste ──────────────────────────────────────────────────── */

function ListeCard({ liste, lots, stats, canEdit, onOpen, onRename, onSaveTemplate, onDuplicate, onArchive, onRestore, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2"
      style={{
        background: 'var(--bg-elev)',
        border: liste.archived ? '1px dashed var(--brd)' : '1px solid var(--brd)',
        opacity: liste.archived ? 0.7 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-bold truncate" style={{ color: 'var(--txt)' }}>
          {liste.titre}
        </h3>
        {canEdit && (
          <div className="relative shrink-0">
            <button type="button" onClick={() => setMenuOpen((v) => !v)} className="p-1 rounded-md" style={{ color: 'var(--txt-3)' }}>
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute right-0 top-full mt-1 z-50 min-w-[170px] rounded-lg py-1"
                  style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
                >
                  {[
                    { label: 'Renommer / lot…', icon: Edit3, onClick: onRename },
                    { label: 'Dupliquer la liste', icon: Copy, onClick: onDuplicate },
                    { label: 'Enregistrer comme modèle', icon: Package, onClick: onSaveTemplate },
                    liste.archived
                      ? { label: 'Restaurer', icon: RotateCcw, onClick: onRestore }
                      : { label: 'Archiver', icon: Archive, onClick: onArchive },
                    liste.archived && { label: 'Supprimer définitivement', icon: Trash2, onClick: onDelete, danger: true },
                  ]
                    .filter(Boolean)
                    .map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          setMenuOpen(false)
                          item.onClick()
                        }}
                        className="w-full flex items-center gap-2 text-left text-xs font-semibold px-3 py-2"
                        style={{ color: item.danger ? 'var(--red, #ff4757)' : 'var(--txt-2)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hov)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <item.icon className="w-3.5 h-3.5" />
                        {item.label}
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div>
        <LotBadge liste={liste} lots={lots} />
      </div>
      <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
        {stats.activeNumero ? `V${stats.activeNumero} en cours · ` : ''}
        {stats.count} version{stats.count > 1 ? 's' : ''}
        {liste.archived ? ' · archivée' : ''}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-auto w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-2.5 py-2 rounded-md"
        style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hov)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg)' }}
      >
        <ArrowRight className="w-3.5 h-3.5" />
        Ouvrir
      </button>
    </div>
  )
}

/* ─── Grille (hall d'entrée) ─────────────────────────────────────────────── */

export default function MaterielListesGrid({
  projectId,
  orgId,
  listes,
  allVersions,
  canEdit,
  onOpen,
  onCreate,
  onUpdate,
  onDuplicate,
  onDelete,
  onRecapProjet = null,
}) {
  const lots = useDevisLots(projectId)
  const [formListe, setFormListe] = useState(null) // null fermé | 'new' | liste
  const [showArchived, setShowArchived] = useState(false)

  // Modèles de listes (org) — pour « Nouvelle liste depuis un modèle ».
  const [templates, setTemplates] = useState([])
  const reloadTemplates = () => {
    if (orgId) fetchListTemplates(orgId).then(setTemplates).catch(() => {})
  }
  useEffect(reloadTemplates, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const statsOf = (liste) => {
    const ofListe = allVersions.filter((v) => v.matos_liste_id === liste.id)
    const active = ofListe.find((v) => v.is_active && !v.archived_at)
    return {
      count: ofListe.length,
      activeNumero: active?.numero || null,
      activeVersionId: active?.id || null,
    }
  }

  async function saveAsTemplate(liste) {
    const { activeVersionId } = statsOf(liste)
    if (!activeVersionId) {
      notify.error('Cette liste n’a pas de version active à enregistrer')
      return
    }
    const titre = await prompt({
      title: 'Enregistrer comme modèle',
      message: 'La structure (blocs + items) sera réutilisable dans tous les projets de l’organisation. Loueurs et checklists ne sont pas copiés.',
      placeholder: 'Kit captation 3 cams',
      initialValue: liste.titre,
      confirmLabel: 'Enregistrer',
    })
    if (!titre?.trim()) return
    try {
      await saveListTemplate({ orgId, titre, versionId: activeVersionId })
      reloadTemplates()
      notify.success('Modèle enregistré')
    } catch (err) {
      notify.error('Enregistrement impossible : ' + (err?.message || err))
    }
  }

  const visibles = listes.filter((l) => showArchived || !l.archived)
  const archivedCount = listes.filter((l) => l.archived).length

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      <header className="flex items-start gap-3 mb-5 flex-wrap">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--blue-bg)' }}>
          <Package className="w-5 h-5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold leading-tight" style={{ color: 'var(--txt)' }}>
            Matériel
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {listes.filter((l) => !l.archived).length} liste
            {listes.filter((l) => !l.archived).length > 1 ? 's' : ''}
            {archivedCount > 0 && ` · ${archivedCount} archivée${archivedCount > 1 ? 's' : ''}`}
          </p>
        </div>
        {onRecapProjet && (
          <button
            type="button"
            onClick={onRecapProjet}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md shrink-0"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
            title="Récap loueurs toutes listes confondues"
          >
            <Users className="w-3.5 h-3.5" />
            Récap loueurs — projet
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setFormListe('new')}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md shrink-0"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            <Plus className="w-3.5 h-3.5" />
            Nouvelle liste
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibles.map((liste) => (
          <ListeCard
            key={liste.id}
            liste={liste}
            lots={lots}
            stats={statsOf(liste)}
            canEdit={canEdit}
            onOpen={() => onOpen(liste)}
            onRename={() => setFormListe(liste)}
            onSaveTemplate={() => saveAsTemplate(liste)}
            onDuplicate={async () => {
              try {
                await onDuplicate(liste)
                notify.success('Liste dupliquée')
              } catch (err) {
                notify.error('Duplication impossible : ' + (err?.message || err))
              }
            }}
            onArchive={() => onUpdate(liste.id, { archived: true })}
            onRestore={() => onUpdate(liste.id, { archived: false })}
            onDelete={async () => {
              const ok = await confirm({
                title: `Supprimer « ${liste.titre} » ?`,
                message:
                  'Suppression DÉFINITIVE : toutes les versions, blocs, items, checklists et documents de cette liste seront perdus.',
                confirmLabel: 'Supprimer',
                danger: true,
              })
              if (ok) {
                try {
                  await onDelete(liste.id)
                  notify.success('Liste supprimée')
                } catch (err) {
                  notify.error('Suppression impossible : ' + (err?.message || err))
                }
              }
            }}
          />
        ))}
      </div>

      {archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="mt-4 text-[11px] font-semibold"
          style={{ color: 'var(--txt-3)' }}
        >
          {showArchived ? 'Masquer les archivées' : `Afficher les archivées (${archivedCount})`}
        </button>
      )}

      {formListe && (
        <ListeFormModal
          liste={formListe === 'new' ? null : formListe}
          lots={lots}
          templates={templates}
          onTemplatesChanged={reloadTemplates}
          onClose={() => setFormListe(null)}
          onSubmit={async ({ titre, devisLotId, template }) => {
            if (formListe === 'new') {
              await onCreate({ titre, devisLotId, template })
            } else {
              await onUpdate(formListe.id, { titre, devis_lot_id: devisLotId })
            }
          }}
        />
      )}
    </div>
  )
}

/* ─── Barre de liste (au-dessus du header de l'outil) ────────────────────── */

export function MaterielListeBar({ projectId, listes, activeListe, onSwitch, onBackToGrid }) {
  const lots = useDevisLots(projectId)
  const [open, setOpen] = useState(false)
  const nonArchived = listes.filter((l) => !l.archived)
  const ref = useRef(null)

  if (!activeListe) return null

  return (
    <div className="flex items-center gap-2 px-4 sm:px-6 pt-3">
      <button
        type="button"
        onClick={onBackToGrid}
        className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md"
        style={{ color: 'var(--txt-3)' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--txt)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--txt-3)' }}
        title="Toutes les listes du projet"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Listes
      </button>

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-bold px-2.5 py-1 rounded-md"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
        >
          {activeListe.titre}
          {nonArchived.length > 1 && <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />}
        </button>
        {open && nonArchived.length > 1 && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="absolute left-0 top-full mt-1 z-50 min-w-[200px] rounded-lg py-1"
              style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
            >
              {nonArchived.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    if (l.id !== activeListe.id) onSwitch(l.id)
                  }}
                  className="w-full flex items-center gap-2 text-left text-xs font-semibold px-3 py-2"
                  style={{ color: l.id === activeListe.id ? 'var(--blue)' : 'var(--txt-2)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hov)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {l.titre}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <LotBadge liste={activeListe} lots={lots} />
    </div>
  )
}
