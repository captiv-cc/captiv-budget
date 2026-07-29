// ════════════════════════════════════════════════════════════════════════════
// LogistiqueGridView — grille centrale personnes × jours (Logistique V1, P1)
// ════════════════════════════════════════════════════════════════════════════
//
// Le remplacement de l'Excel logistique (plan validé Hugo 2026-07-29) :
//   - lignes  : membres du projet, groupés par catégorie crew ;
//   - colonnes : plage CONTINUE de jours, bornée par les présences Équipe,
//     les trajets et les dates d'arrivée/départ ;
//   - cellule : présence (bidirectionnelle avec l'Équipe — même donnée,
//     projet_session_membres.presence_days), repas midi/soir à 4 états
//     (client → production → défrayé → —), coche nuit, aperçu transports ;
//   - pied    : totaux par jour (présents, repas par prise en charge, nuits).
//
// Édition de la présence ICI = écrire dans la participation Équipe (pas de
// copie locale). Règle de ciblage : OFF → la participation qui porte le
// jour ; ON → la participation dont l'enveloppe session couvre le jour,
// sinon l'unique participation du membre, sinon la plus proche par dates.
// Membre sans session → cellule présence désactivée (tooltip explicite).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bus,
  Car,
  Loader2,
  Moon,
  Plane,
  Train,
  TramFront,
  Wand2,
} from 'lucide-react'
import {
  createSession,
  deleteSession,
  fetchProjectSessions,
  fetchSessionsCatalog,
  joinSession,
  listTechlistRows,
  updateSession,
} from '../../lib/crew'
import { extractPeriodes, expandDays, hasAnyRange } from '../../lib/projectPeriodes'
import { effectiveCouleur, effectiveLabel } from '../../lib/sessions'
import PresenceCalendarModal from '../equipe/components/PresenceCalendarModal'
import {
  fetchLogistique,
  initFromEquipe,
  setRepas,
  setNuit,
  deleteNuit,
} from '../../lib/logistique'
import { notify } from '../../lib/notify'
import { confirm } from '../../lib/confirm'

// Cycle de prise en charge des repas au clic.
const REPAS_CYCLE = [null, 'client', 'production', 'defraye']
const REPAS_STYLE = {
  client: { bg: 'rgba(34,197,94,0.18)', color: '#22c55e', label: 'C' },
  production: { bg: 'rgba(59,130,246,0.18)', color: '#3b82f6', label: 'P' },
  defraye: { bg: 'rgba(245,158,11,0.18)', color: '#f59e0b', label: 'D' },
}
const REPAS_TITLES = {
  client: 'Client',
  production: 'Production',
  defraye: 'Défrayé',
}

const MODE_ICONS = {
  train: Train,
  minibus: Bus,
  voiture: Car,
  avion: Plane,
  autre: TramFront,
}

// ─── Helpers dates ─────────────────────────────────────────────────────────

function isoRange(minIso, maxIso) {
  const out = []
  const d = new Date(`${minIso}T12:00:00`)
  const end = new Date(`${maxIso}T12:00:00`)
  while (d <= end && out.length < 60) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return out
}

function dayHeader(iso) {
  const d = new Date(`${iso}T12:00:00`)
  const wd = d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')
  return { wd: wd.charAt(0).toUpperCase() + wd.slice(1), dm: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) }
}

function membreName(m) {
  const prenom = m.contact?.prenom || m.prenom || ''
  const nom = m.contact?.nom || m.nom || ''
  return `${prenom} ${nom}`.trim() || 'Sans nom'
}

function membrePoste(m) {
  return m.devis_line?.produit || m.specialite || m.contact?.specialite || ''
}

export default function LogistiqueGridView({ projectId, project = null, membres = [], canEdit = false }) {
  const [participations, setParticipations] = useState([])
  const [logi, setLogi] = useState({
    hebergements: [],
    hebergementMembres: [],
    trajets: [],
    repas: [],
    nuits: [],
  })
  const [catalog, setCatalog] = useState([]) // sessions globales du projet
  const [loading, setLoading] = useState(true)
  const [initing, setIniting] = useState(false)
  // Retour Hugo : masquer par défaut les personnes sans aucune présence
  // (les lignes mortes mangent la moitié de la grille).
  const [hideEmpty, setHideEmpty] = useState(true)
  // Gestion FINE des sessions (attribuer, renommer, arrivée/retour…) :
  // clic sur le nom → la MÊME PresenceCalendarModal que l'onglet Équipe.
  const [presenceFor, setPresenceFor] = useState(null) // membre ou null
  // Retour Hugo : le geste naturel = cliquer LA CASE. Quand la session
  // cible est ambiguë (2+ sessions, aucune enveloppe couvrante), un
  // popover ancré à la cellule propose le choix — colorié comme l'Équipe.
  const [sessionPick, setSessionPick] = useState(null) // { membreId, day }

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const [parts, cat, l] = await Promise.all([
        fetchProjectSessions(projectId),
        fetchSessionsCatalog(projectId),
        fetchLogistique(projectId),
      ])
      setParticipations(parts)
      setCatalog(cat)
      setLogi(l)
    } catch (err) {
      notify.error('Chargement logistique : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // ─── Index par membre ────────────────────────────────────────────────────
  const partsByMembre = useMemo(() => {
    const map = new Map()
    for (const p of participations) {
      const arr = map.get(p.membre_id) || []
      arr.push(p)
      map.set(p.membre_id, arr)
    }
    return map
  }, [participations])

  const repasMap = useMemo(() => {
    const map = new Map()
    for (const r of logi.repas) map.set(`${r.membre_id}|${r.date_repas}|${r.service}`, r.statut)
    return map
  }, [logi.repas])

  const nuitSet = useMemo(() => {
    const set = new Set()
    for (const n of logi.nuits) set.add(`${n.membre_id}|${n.date_nuit}`)
    return set
  }, [logi.nuits])

  const trajetsByMembreDay = useMemo(() => {
    const map = new Map()
    for (const t of logi.trajets) {
      if (!t.date_trajet) continue
      const key = `${t.membre_id}|${t.date_trajet}`
      const arr = map.get(key) || []
      arr.push(t)
      map.set(key, arr)
    }
    return map
  }, [logi.trajets])

  // ─── Colonnes : plage continue min → max ─────────────────────────────────
  const days = useMemo(() => {
    const all = new Set()
    for (const p of participations) {
      for (const d of p.presence_days || []) all.add(d)
      if (p.arrival_date) all.add(p.arrival_date)
      if (p.departure_date) all.add(p.departure_date)
    }
    for (const t of logi.trajets) if (t.date_trajet) all.add(t.date_trajet)
    if (!all.size) return []
    const sorted = Array.from(all).sort()
    return isoRange(sorted[0], sorted[sorted.length - 1])
  }, [participations, logi.trajets])

  // ─── Sessions du projet (légende + couleurs des croix) ───────────────────
  // Source = catalogue global (montre aussi les sessions sans participant).
  const sessions = useMemo(
    () =>
      catalog.map((s) => ({
        id: s.id,
        label: effectiveLabel(s),
        couleur: effectiveCouleur(s),
        sort_order: s.sort_order,
        start_date: s.start_date,
        end_date: s.end_date,
      })),
    [catalog],
  )

  // ─── Périodes projet + ancre calendrier (mêmes props que l'Équipe) ───────
  const periodes = useMemo(() => extractPeriodes(project?.metadata), [project])
  const anchorDate = useMemo(() => {
    const tournageDays = hasAnyRange(periodes.tournage) ? expandDays(periodes.tournage) : []
    const src = tournageDays[0] || days[0]
    if (!src) return null
    const [y, m, d] = src.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [periodes, days])

  // ─── Templates de sessions pour la modale (même logique que TechListView) ─
  const sessionTemplates = useMemo(() => {
    const map = new Map()
    for (const p of participations) {
      const label = (p.label || '').trim()
      if (!label) continue
      const lieu = (p.lieu_principal_text || '').trim()
      const key = `${label.toLowerCase()}|${lieu.toLowerCase()}`
      if (!map.has(key)) {
        map.set(key, {
          session_id: p.session_id || null,
          label,
          lieu: lieu || null,
          presence_days: Array.isArray(p.presence_days) ? [...p.presence_days] : [],
          arrival_date: p.arrival_date || null,
          departure_date: p.departure_date || null,
          member_count: 0,
          _memberIds: new Set(),
        })
      }
      const entry = map.get(key)
      if (p.membre_id) entry._memberIds.add(p.membre_id)
      entry.member_count = entry._memberIds.size
    }
    return Array.from(map.values()).map(({ _memberIds, ...rest }) => rest)
  }, [participations])

  const templatesForActive = useMemo(() => {
    if (!presenceFor) return sessionTemplates
    const own = partsByMembre.get(presenceFor.id) || []
    const ownKeys = new Set(
      own.map(
        (s) =>
          `${(s.label || '').trim().toLowerCase()}|${(s.lieu_principal_text || '').trim().toLowerCase()}`,
      ),
    )
    return sessionTemplates.map((t) => ({
      ...t,
      member_already_in: ownKeys.has(`${t.label.toLowerCase()}|${(t.lieu || '').toLowerCase()}`),
    }))
  }, [sessionTemplates, presenceFor, partsByMembre])

  const sessionParticipantsCount = useMemo(() => {
    const map = new Map()
    for (const p of participations) {
      if (!p.session_id) continue
      const set = map.get(p.session_id) || new Set()
      if (p.membre_id) set.add(p.membre_id)
      map.set(p.session_id, set)
    }
    return new Map(Array.from(map.entries()).map(([k, v]) => [k, v.size]))
  }, [participations])

  // ─── Lignes : membres groupés par catégorie ──────────────────────────────
  // hideEmpty : les personnes sans AUCUNE présence ni donnée logistique sont
  // masquées (toggle) — les groupes vides disparaissent avec.
  const hiddenCount = useMemo(() => {
    if (!hideEmpty) return 0
    return listTechlistRows(membres).filter((m) => !membreHasData(m.id)).length
  }, [membres, hideEmpty, partsByMembre, logi]) // eslint-disable-line react-hooks/exhaustive-deps

  function membreHasData(membreId) {
    const parts = partsByMembre.get(membreId) || []
    if (parts.some((p) => (p.presence_days || []).length > 0)) return true
    if (logi.repas.some((r) => r.membre_id === membreId)) return true
    if (logi.nuits.some((n) => n.membre_id === membreId)) return true
    if (logi.trajets.some((t) => t.membre_id === membreId)) return true
    return false
  }

  // MÊME modèle de lignes que la Crew list (retour Hugo) :
  //   - fusion des personnes : rows PRINCIPALES uniquement, les postes
  //     rattachés (parent_membre_id) apparaissent en badge « +N » ;
  //   - ordre des catégories : celui configuré dans l'Équipe (localStorage
  //     equipe.categoryOrder.<projectId>, hydraté depuis
  //     projects.metadata.equipe.category_order).
  const techRows = useMemo(() => listTechlistRows(membres), [membres])

  const categoryOrder = useMemo(() => {
    try {
      const raw = localStorage.getItem(`equipe.categoryOrder.${projectId || 'noproj'}`)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch {
      /* ignore */
    }
    const metaOrder = project?.metadata?.equipe?.category_order
    return Array.isArray(metaOrder) ? metaOrder : []
  }, [projectId, project])

  const groups = useMemo(() => {
    const byCat = new Map()
    for (const m of techRows) {
      if (hideEmpty && !membreHasData(m.id)) continue
      const cat = m.category || 'À trier'
      const arr = byCat.get(cat) || []
      arr.push(m)
      byCat.set(cat, arr)
    }
    const entries = Array.from(byCat.entries())
    const orderIdx = (cat) => {
      if (cat === 'À trier') return -1 // comme l'Équipe : "À trier" en tête
      const i = categoryOrder.indexOf(cat)
      return i === -1 ? categoryOrder.length : i
    }
    entries.sort((a, b) => orderIdx(a[0]) - orderIdx(b[0]) || a[0].localeCompare(b[0], 'fr'))
    return entries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techRows, hideEmpty, partsByMembre, logi, categoryOrder])

  // ─── Actions ─────────────────────────────────────────────────────────────

  /**
   * Pose une présence (membre, jour) SUR une session précise :
   * - participation existante sur cette session → ajoute le jour ;
   * - sinon → joinSession (le membre rejoint la session globale).
   */
  async function addPresenceToSession(membre, day, sessionId) {
    setSessionPick(null)
    const parts = partsByMembre.get(membre.id) || []
    const part = parts.find((p) => p.session_id === sessionId)
    try {
      if (part) {
        const nextDays = [...(part.presence_days || []), day].sort()
        setParticipations((prev) =>
          prev.map((p) => (p.id === part.id ? { ...p, presence_days: nextDays } : p)),
        )
        await updateSession(part.id, { presence_days: nextDays })
      } else {
        await joinSession(membre.id, sessionId, { presence_days: [day] })
        await load()
      }
    } catch (err) {
      notify.error('Présence : ' + (err?.message || err))
      load()
    }
  }

  async function togglePresence(membre, day) {
    if (!canEdit) return
    const parts = partsByMembre.get(membre.id) || []

    // OFF : la participation qui porte déjà ce jour.
    const holder = parts.find((p) => (p.presence_days || []).includes(day))
    if (holder) {
      const nextDays = (holder.presence_days || []).filter((d) => d !== day)
      setParticipations((prev) =>
        prev.map((p) => (p.id === holder.id ? { ...p, presence_days: nextDays } : p)),
      )
      try {
        await updateSession(holder.id, { presence_days: nextDays })
      } catch (err) {
        notify.error('Présence : ' + (err?.message || err))
        load()
      }
      return
    }

    // ON — résolution de la session cible :
    //   1. exactement UNE session du projet couvre le jour (enveloppe) → direct
    //   2. le projet n'a qu'UNE session → direct
    //   3. aucune session au projet → on crée la première
    //   4. ambigu (2+ sessions, 0 ou 2+ enveloppes couvrantes) → popover de
    //      choix ancré à la cellule (retour Hugo : tout se joue sur la case)
    const covering = sessions.filter(
      (s) => s.start_date && s.end_date && s.start_date <= day && day <= s.end_date,
    )
    if (covering.length === 1) {
      await addPresenceToSession(membre, day, covering[0].id)
      return
    }
    if (sessions.length === 1) {
      await addPresenceToSession(membre, day, sessions[0].id)
      return
    }
    if (sessions.length === 0) {
      try {
        await createSession(membre.id, { presence_days: [day] })
        notify.success('Première session du projet créée — nomme-la dans l’onglet Équipe')
        await load()
      } catch (err) {
        notify.error('Présence : ' + (err?.message || err))
      }
      return
    }
    setSessionPick({ membreId: membre.id, day })
  }

  async function cycleRepas(membreId, day, service) {
    if (!canEdit) return
    const key = `${membreId}|${day}|${service}`
    const current = repasMap.get(key) || null
    const next = REPAS_CYCLE[(REPAS_CYCLE.indexOf(current) + 1) % REPAS_CYCLE.length]
    // Optimistic
    setLogi((prev) => {
      const repas = prev.repas.filter(
        (r) => !(r.membre_id === membreId && r.date_repas === day && r.service === service),
      )
      if (next) repas.push({ membre_id: membreId, date_repas: day, service, statut: next })
      return { ...prev, repas }
    })
    try {
      await setRepas({ projectId, membreId, date: day, service, statut: next })
    } catch (err) {
      notify.error('Repas : ' + (err?.message || err))
      load()
    }
  }

  async function toggleNuit(membreId, day) {
    if (!canEdit) return
    const has = nuitSet.has(`${membreId}|${day}`)
    setLogi((prev) => ({
      ...prev,
      nuits: has
        ? prev.nuits.filter((n) => !(n.membre_id === membreId && n.date_nuit === day))
        : [...prev.nuits, { membre_id: membreId, date_nuit: day, hebergement_id: null }],
    }))
    try {
      if (has) await deleteNuit({ membreId, date: day })
      else await setNuit({ projectId, membreId, date: day })
    } catch (err) {
      notify.error('Nuit : ' + (err?.message || err))
      load()
    }
  }

  async function handleInit() {
    const ok = await confirm({
      title: 'Pré-remplir repas & nuits ?',
      message:
        'Pour chaque jour de présence déjà coché : repas midi + soir « Client », et une nuit par jour sauf le dernier du séjour de chacun. N’écrase RIEN : les repas/nuits déjà posés sont conservés, et les présences Équipe ne sont pas touchées.',
      confirmLabel: 'Pré-remplir',
    })
    if (!ok) return
    setIniting(true)
    try {
      const { repas, nuits } = await initFromEquipe(projectId, participations)
      notify.success(`${repas} repas et ${nuits} nuits posés depuis les présences`)
      await load()
    } catch (err) {
      notify.error('Initialisation : ' + (err?.message || err))
    } finally {
      setIniting(false)
    }
  }

  // ─── Totaux par jour ─────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const byDay = new Map()
    for (const d of days) {
      byDay.set(d, {
        presents: 0,
        midi: { client: 0, production: 0, defraye: 0 },
        soir: { client: 0, production: 0, defraye: 0 },
        nuits: 0,
      })
    }
    for (const p of participations) {
      for (const d of p.presence_days || []) {
        const t = byDay.get(d)
        if (t) t.presents += 1
      }
    }
    for (const r of logi.repas) {
      const t = byDay.get(r.date_repas)
      if (t && t[r.service]) t[r.service][r.statut] += 1
    }
    for (const n of logi.nuits) {
      const t = byDay.get(n.date_nuit)
      if (t) t.nuits += 1
    }
    return byDay
  }, [days, participations, logi.repas, logi.nuits])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--blue)' }} />
      </div>
    )
  }

  if (!days.length) {
    return (
      <div
        className="rounded-xl p-8 text-center m-4"
        style={{ background: 'var(--bg-surf)', border: '1px dashed var(--brd)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
          Aucune présence planifiée.
        </p>
        <p className="text-xs mt-1.5" style={{ color: 'var(--txt-3)' }}>
          Configure les sessions et jours de présence dans l&apos;onglet Équipe — la
          grille logistique se construit dessus.
        </p>
      </div>
    )
  }

  return (
    <div className="px-4 pb-6">
      {/* Barre outils : sessions + légende + pré-remplissage */}
      <div className="flex items-center gap-3 flex-wrap py-3">
        {sessions.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap text-[10px]" style={{ color: 'var(--txt-3)' }}>
            <span className="font-bold uppercase tracking-wider" style={{ letterSpacing: '0.08em' }}>
              Sessions :
            </span>
            {sessions.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1" style={{ color: 'var(--txt-2)' }}>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: `#${s.couleur.replace('#', '')}` }}
                />
                {s.label}
              </span>
            ))}
          </div>
        )}
        <Legend />
        <button
          type="button"
          onClick={() => setHideEmpty((v) => !v)}
          className="text-[10px] font-semibold px-2 py-1 rounded-md"
          style={{
            background: hideEmpty ? 'var(--blue-bg)' : 'var(--bg-elev)',
            color: hideEmpty ? 'var(--blue)' : 'var(--txt-3)',
            border: `1px solid ${hideEmpty ? 'var(--blue)' : 'var(--brd)'}`,
          }}
          title="Masquer/afficher les personnes sans présence ni donnée logistique"
        >
          {hideEmpty
            ? `${hiddenCount} masqué${hiddenCount > 1 ? 's' : ''} · tout afficher`
            : 'Masquer sans présence'}
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={handleInit}
            disabled={initing}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md ml-auto"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            title="Pose repas Client midi+soir et nuits sur les jours de présence — n'écrase rien, ne touche pas à l'Équipe"
          >
            {initing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wand2 className="w-3.5 h-3.5" />
            )}
            Pré-remplir repas &amp; nuits
          </button>
        )}
      </div>

      <div
        className="overflow-x-auto rounded-xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th
                className="sticky left-0 z-10 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-3)',
                  letterSpacing: '0.08em',
                  minWidth: '180px',
                  borderBottom: '1px solid var(--brd)',
                  borderRight: '1px solid var(--brd)',
                }}
              >
                Personne
              </th>
              {days.map((d, di) => {
                const h = dayHeader(d)
                return (
                  <th
                    key={d}
                    className="px-1 py-1.5 text-center"
                    style={{
                      minWidth: '86px',
                      background: di % 2 ? 'var(--bg-hov, var(--bg-elev))' : 'var(--bg-elev)',
                      borderBottom: '1px solid var(--brd)',
                      borderRight: '1px solid var(--brd-sub)',
                    }}
                  >
                    <span className="block text-[10px] font-bold uppercase" style={{ color: 'var(--txt-2)' }}>
                      {h.wd}
                    </span>
                    <span className="block text-[10px]" style={{ color: 'var(--txt-3)' }}>
                      {h.dm}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map(([cat, catMembres]) => (
              <GroupRows
                key={cat}
                cat={cat}
                membres={catMembres}
                days={days}
                canEdit={canEdit}
                partsByMembre={partsByMembre}
                repasMap={repasMap}
                nuitSet={nuitSet}
                trajetsByMembreDay={trajetsByMembreDay}
                onTogglePresence={togglePresence}
                onCycleRepas={cycleRepas}
                onToggleNuit={toggleNuit}
                onOpenPresence={canEdit ? setPresenceFor : null}
                sessionsList={sessions}
                sessionPick={sessionPick}
                onPickSession={addPresenceToSession}
                onClosePick={() => setSessionPick(null)}
              />
            ))}
          </tbody>
          <tfoot>
            <TotalRow label="Présents" days={days} value={(t) => t.presents || ''} />
            <TotalRow
              label="Repas midi"
              days={days}
              value={(t) => sumRepas(t.midi) || ''}
              title={(t) => repasBreakdown(t.midi)}
            />
            <TotalRow
              label="Repas soir"
              days={days}
              value={(t) => sumRepas(t.soir) || ''}
              title={(t) => repasBreakdown(t.soir)}
            />
            <TotalRow label="Nuits" days={days} value={(t) => t.nuits || ''} totalsMap={null} />
          </tfoot>
        </table>
      </div>

      {/* Gestion complète des sessions/présences — MÊME modale que l'onglet
          Équipe (sélecteur de session, rejoindre/créer, renommer, arrivée/
          retour). Ouverte au clic sur le nom d'une personne. */}
      {presenceFor && (
        <PresenceCalendarModal
          open={Boolean(presenceFor)}
          onClose={() => {
            setPresenceFor(null)
            load()
          }}
          personaName={membreName(presenceFor)}
          persona={presenceFor.persona || null}
          // Périodes Prépa/Tournage du projet + ancrage du calendrier sur
          // l'événement (pas le mois courant) — mêmes props que l'Équipe.
          periodes={periodes}
          anchorDate={anchorDate}
          sessions={partsByMembre.get(presenceFor.id) || []}
          projectSessionTemplates={templatesForActive}
          sessionParticipantsCount={sessionParticipantsCount}
          onCreateSession={async (payload) => {
            const s = await createSession(presenceFor.id, payload)
            await load()
            return s
          }}
          onJoinSession={async (sessionId, payload) => {
            const s = await joinSession(presenceFor.id, sessionId, payload)
            await load()
            return s
          }}
          onUpdateSessionMeta={async (participationId, fields) => {
            const s = await updateSession(participationId, fields)
            await load()
            return s
          }}
          onRemoveSession={async (participationId) => {
            await deleteSession(participationId)
            await load()
          }}
          onSave={async (fields, sessionId) => {
            if (!sessionId) return undefined
            const s = await updateSession(sessionId, fields)
            await load()
            return s
          }}
        />
      )}
    </div>
  )

  // tfoot rows factorisées (closure sur totals)
  function TotalRow({ label, days: ds, value, title }) {
    return (
      <tr>
        <td
          className="sticky left-0 z-10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            background: 'var(--bg-elev)',
            color: 'var(--txt-3)',
            letterSpacing: '0.08em',
            borderTop: '1px solid var(--brd)',
            borderRight: '1px solid var(--brd)',
          }}
        >
          {label}
        </td>
        {ds.map((d, di) => {
          const t = totals.get(d)
          return (
            <td
              key={d}
              className="px-1 py-1.5 text-center font-bold tabular-nums"
              style={{
                color: 'var(--txt)',
                borderTop: '1px solid var(--brd)',
                borderRight: '1px solid var(--brd-sub)',
                background: di % 2 ? 'rgba(127,127,127,0.045)' : 'transparent',
              }}
              title={title && t ? title(t) : undefined}
            >
              {t ? value(t) : ''}
            </td>
          )
        })}
      </tr>
    )
  }
}

function sumRepas(s) {
  return s.client + s.production + s.defraye
}
function repasBreakdown(s) {
  return `Client ${s.client} · Production ${s.production} · Défrayé ${s.defraye}`
}

// ─── Groupe de lignes (catégorie) ──────────────────────────────────────────

function GroupRows({
  cat,
  membres,
  days,
  canEdit,
  partsByMembre,
  repasMap,
  nuitSet,
  trajetsByMembreDay,
  onTogglePresence,
  onCycleRepas,
  onToggleNuit,
  onOpenPresence,
  sessionsList,
  sessionPick,
  onPickSession,
  onClosePick,
}) {
  return (
    <>
      <tr>
        <td
          colSpan={days.length + 1}
          className="sticky left-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
          style={{
            background: 'var(--bg)',
            color: 'var(--txt-3)',
            letterSpacing: '0.08em',
            borderBottom: '1px solid var(--brd-sub)',
          }}
        >
          {cat}
        </td>
      </tr>
      {membres.map((m) => (
        <MembreRow
          key={m.id}
          membre={m}
          days={days}
          canEdit={canEdit}
          parts={partsByMembre.get(m.id) || []}
          repasMap={repasMap}
          nuitSet={nuitSet}
          trajetsByMembreDay={trajetsByMembreDay}
          onTogglePresence={onTogglePresence}
          onCycleRepas={onCycleRepas}
          onToggleNuit={onToggleNuit}
          onOpenPresence={onOpenPresence}
          sessionsList={sessionsList}
          sessionPick={sessionPick}
          onPickSession={onPickSession}
          onClosePick={onClosePick}
        />
      ))}
    </>
  )
}

function MembreRow({
  membre,
  days,
  canEdit,
  parts,
  repasMap,
  nuitSet,
  trajetsByMembreDay,
  onTogglePresence,
  onCycleRepas,
  onToggleNuit,
  onOpenPresence,
  sessionsList = [],
  sessionPick = null,
  onPickSession,
  onClosePick,
}) {
  const presenceDays = new Set(parts.flatMap((p) => p.presence_days || []))
  // Couleur/label de session par jour — même palette déterministe que
  // l'onglet Équipe (couleur custom OU paletteAt(sort_order) si NULL).
  const colorByDay = new Map()
  const sessionLabelByDay = new Map()
  for (const p of parts) {
    const hex = `#${effectiveCouleur({ couleur: p.couleur, sort_order: p.sort_order }).replace('#', '')}`
    for (const d of p.presence_days || []) {
      colorByDay.set(d, hex)
      sessionLabelByDay.set(d, effectiveLabel({ label: p.label }))
    }
  }
  const hasSession = parts.length > 0
  const poste = membrePoste(membre)

  return (
    <tr>
      <td
        className="sticky left-0 z-10 px-3 py-1"
        style={{
          background: 'var(--bg-surf)',
          borderBottom: '1px solid var(--brd-sub)',
          borderRight: '1px solid var(--brd)',
        }}
      >
        <button
          type="button"
          disabled={!onOpenPresence}
          onClick={() => onOpenPresence?.(membre)}
          className="block text-left w-full group/name"
          style={{ cursor: onOpenPresence ? 'pointer' : 'default' }}
          title={
            onOpenPresence
              ? 'Gérer les sessions et présences (même modale que l’onglet Équipe)'
              : undefined
          }
        >
          <span className="flex items-center gap-1.5">
            <span
              className="text-xs font-semibold truncate max-w-[150px] group-hover/name:underline"
              style={{ color: 'var(--txt)', textUnderlineOffset: '2px' }}
            >
              {membreName(membre)}
            </span>
            {/* Personne fusionnée : postes rattachés (comme la Crew list) */}
            {membre.attached?.length > 0 && (
              <span
                className="text-[9px] font-bold px-1 py-0.5 rounded-full shrink-0"
                style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
                title={`Postes rattachés : ${membre.attached.map(membrePoste).filter(Boolean).join(', ') || membre.attached.length}`}
              >
                +{membre.attached.length}
              </span>
            )}
          </span>
          {poste && (
            <span className="block text-[10px] truncate max-w-[170px]" style={{ color: 'var(--txt-3)' }}>
              {poste}
            </span>
          )}
        </button>
      </td>
      {days.map((d, di) => {
        const present = presenceDays.has(d)
        const trajets = trajetsByMembreDay.get(`${membre.id}|${d}`) || []
        // Désencombrement (retour Hugo) : sur un jour absent SANS aucune
        // donnée logistique, les chips M/S/nuit n'apparaissent qu'au survol
        // de la cellule — la grille vide reste lisible.
        const hasLogi =
          Boolean(repasMap.get(`${membre.id}|${d}|midi`)) ||
          Boolean(repasMap.get(`${membre.id}|${d}|soir`)) ||
          nuitSet.has(`${membre.id}|${d}`) ||
          trajets.length > 0
        // Règle radicale (retour Hugo) : une chip n'est visible que si elle
        // porte une valeur — le survol révèle les contrôles partout.
        const showChips = hasLogi
        const isPicking =
          sessionPick && sessionPick.membreId === membre.id && sessionPick.day === d
        return (
          <td
            key={d}
            className="group px-1 py-1 align-top relative"
            style={{
              borderBottom: '1px solid var(--brd-sub)',
              borderRight: '1px solid var(--brd-sub)',
              // Zébrage 1 colonne sur 2 pour le repérage vertical ; la
              // teinte de présence (couleur session) prime.
              background: present
                ? `${(colorByDay.get(d) || '#22c55e')}0d`
                : di % 2
                  ? 'rgba(127,127,127,0.045)'
                  : 'transparent',
            }}
          >
            <div className="flex flex-col gap-0.5 items-stretch">
              {/* Ligne 1 : présence + transports */}
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => onTogglePresence(membre, d)}
                  title={
                    present
                      ? `Présent · ${sessionLabelByDay.get(d) || 'session'} (cliquer pour retirer — modifie l’Équipe)`
                      : hasSession
                        ? 'Absent (cliquer pour marquer présent — modifie l’Équipe)'
                        : 'Absent — cliquer pour marquer présent (rejoint une session du projet)'
                  }
                  className="w-4 h-4 rounded-sm shrink-0 flex items-center justify-center text-[9px] font-bold transition-all"
                  style={{
                    background: present ? colorByDay.get(d) || 'var(--green, #22c55e)' : 'transparent',
                    border: `1.5px solid ${present ? 'transparent' : 'var(--brd)'}`,
                    color: '#fff',
                    cursor: canEdit ? 'pointer' : 'default',
                  }}
                >
                  {present ? 'X' : ''}
                </button>
                <span className="flex items-center gap-0.5 min-w-0 overflow-hidden">
                  {trajets.map((t) => (
                    <TrajetChip key={t.id} trajet={t} />
                  ))}
                </span>
              </div>

              {/* Popover de choix de session — la case reste LE point
                  d'entrée, on choisit juste la session quand c'est ambigu. */}
              {isPicking && (
                <>
                  <div className="fixed inset-0 z-40" onClick={onClosePick} aria-hidden />
                  <div
                    className="absolute z-50 top-6 left-0 min-w-[170px] rounded-lg py-1"
                    style={{
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--brd)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    }}
                  >
                    <p
                      className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
                    >
                      Présent · quelle session ?
                    </p>
                    {sessionsList.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onPickSession?.(membre, d, s.id)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-all"
                        style={{ color: 'var(--txt)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: `#${s.couleur.replace('#', '')}` }}
                        />
                        {s.label}
                      </button>
                    ))}
                    {onOpenPresence && (
                      <button
                        type="button"
                        onClick={() => {
                          onClosePick?.()
                          onOpenPresence(membre)
                        }}
                        className="w-full px-2.5 py-1.5 text-[11px] text-left"
                        style={{ color: 'var(--blue)', borderTop: '1px solid var(--brd-sub)' }}
                      >
                        Gérer les présences…
                      </button>
                    )}
                  </div>
                </>
              )}
              {/* Ligne 2 : repas M/S + nuit — masquée (révélée au survol)
                  quand le jour est vide, pour aérer la grille. */}
              <div
                className={`flex items-center gap-0.5 ${
                  showChips ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'
                }`}
              >
                <RepasChip
                  service="midi"
                  statut={repasMap.get(`${membre.id}|${d}|midi`) || null}
                  canEdit={canEdit}
                  onClick={() => onCycleRepas(membre.id, d, 'midi')}
                />
                <RepasChip
                  service="soir"
                  statut={repasMap.get(`${membre.id}|${d}|soir`) || null}
                  canEdit={canEdit}
                  onClick={() => onCycleRepas(membre.id, d, 'soir')}
                />
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => onToggleNuit(membre.id, d)}
                  title={
                    nuitSet.has(`${membre.id}|${d}`)
                      ? 'Nuit sur place (cliquer pour retirer)'
                      : 'Pas de nuit (cliquer pour ajouter)'
                  }
                  className="w-4 h-4 rounded-sm shrink-0 flex items-center justify-center transition-all ml-auto"
                  style={{
                    background: nuitSet.has(`${membre.id}|${d}`)
                      ? 'rgba(167,139,250,0.22)'
                      : 'transparent',
                    border: nuitSet.has(`${membre.id}|${d}`)
                      ? '1px solid rgba(167,139,250,0.5)'
                      : '1px dashed var(--brd-sub)',
                    cursor: canEdit ? 'pointer' : 'default',
                  }}
                >
                  <Moon
                    className="w-2.5 h-2.5"
                    style={{
                      color: nuitSet.has(`${membre.id}|${d}`) ? '#a78bfa' : 'var(--txt-3)',
                      opacity: nuitSet.has(`${membre.id}|${d}`) ? 1 : 0.35,
                    }}
                  />
                </button>
              </div>
            </div>
          </td>
        )
      })}
    </tr>
  )
}

// ─── Chips ─────────────────────────────────────────────────────────────────

function RepasChip({ service, statut, canEdit, onClick }) {
  const style = statut ? REPAS_STYLE[statut] : null
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onClick}
      title={`Repas ${service === 'midi' ? 'midi' : 'soir'} : ${statut ? REPAS_TITLES[statut] : '—'}${canEdit ? ' (cliquer pour changer)' : ''}`}
      className="h-4 min-w-[18px] px-0.5 rounded-sm text-[9px] font-bold flex items-center justify-center gap-0.5 transition-all"
      style={{
        background: style ? style.bg : 'transparent',
        color: style ? style.color : 'var(--txt-3)',
        border: style ? `1px solid ${style.color}44` : '1px dashed var(--brd-sub)',
        cursor: canEdit ? 'pointer' : 'default',
        opacity: style ? 1 : 0.45,
      }}
    >
      {service === 'midi' ? 'M' : 'S'}
      {style ? `·${style.label}` : ''}
    </button>
  )
}

function TrajetChip({ trajet }) {
  const etapes = Array.isArray(trajet.etapes) ? trajet.etapes : []
  const first = etapes[0] || {}
  const Icon = MODE_ICONS[first.mode] || TramFront
  const arrow = trajet.sens === 'retour' ? '←' : '→'
  const summary = etapes
    .map((e) => `${e.mode || '?'}${e.heure ? ` ${e.heure}` : ''}${e.depart || e.arrivee ? ` ${e.depart || ''}→${e.arrivee || ''}` : ''}${e.note ? ` (${e.note})` : ''}`)
    .join('  +  ')
  return (
    <span
      className="inline-flex items-center gap-0.5 h-4 px-1 rounded-sm text-[9px] font-semibold shrink-0"
      style={{
        background: 'rgba(59,130,246,0.14)',
        color: '#60a5fa',
        border: '1px solid rgba(59,130,246,0.35)',
      }}
      title={`${trajet.sens === 'retour' ? 'Retour' : trajet.sens === 'aller' ? 'Aller' : 'Trajet'}${summary ? ' : ' + summary : ''}${trajet.notes ? ' — ' + trajet.notes : ''}`}
    >
      {arrow}
      <Icon className="w-2.5 h-2.5" />
      {first.heure || ''}
    </span>
  )
}

// ─── Légende ───────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex items-center gap-2 flex-wrap text-[10px]" style={{ color: 'var(--txt-3)' }}>
      <span className="font-bold uppercase tracking-wider" style={{ letterSpacing: '0.08em' }}>
        Repas :
      </span>
      {Object.entries(REPAS_TITLES).map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ background: REPAS_STYLE[k].bg, border: `1px solid ${REPAS_STYLE[k].color}` }}
          />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1 ml-2">
        <Moon className="w-3 h-3" style={{ color: '#a78bfa' }} />
        Nuit
      </span>
      <span className="ml-2">M/S = midi/soir · clic = cycle · présence = donnée Équipe</span>
    </div>
  )
}
