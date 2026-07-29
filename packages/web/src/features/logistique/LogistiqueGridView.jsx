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
  fetchProjectSessions,
  fetchSessionsCatalog,
  joinSession,
  updateSession,
} from '../../lib/crew'
import { effectiveCouleur, effectiveLabel } from '../../lib/sessions'
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

export default function LogistiqueGridView({ projectId, membres = [], canEdit = false }) {
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

  // ─── Lignes : membres groupés par catégorie ──────────────────────────────
  // hideEmpty : les personnes sans AUCUNE présence ni donnée logistique sont
  // masquées (toggle) — les groupes vides disparaissent avec.
  const hiddenCount = useMemo(() => {
    if (!hideEmpty) return 0
    return membres.filter((m) => !membreHasData(m.id)).length
  }, [membres, hideEmpty, partsByMembre, logi]) // eslint-disable-line react-hooks/exhaustive-deps

  function membreHasData(membreId) {
    const parts = partsByMembre.get(membreId) || []
    if (parts.some((p) => (p.presence_days || []).length > 0)) return true
    if (logi.repas.some((r) => r.membre_id === membreId)) return true
    if (logi.nuits.some((n) => n.membre_id === membreId)) return true
    if (logi.trajets.some((t) => t.membre_id === membreId)) return true
    return false
  }

  const groups = useMemo(() => {
    const byCat = new Map()
    for (const m of membres) {
      if (hideEmpty && !membreHasData(m.id)) continue
      const cat = m.category || 'Autres'
      const arr = byCat.get(cat) || []
      arr.push(m)
      byCat.set(cat, arr)
    }
    return Array.from(byCat.entries())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membres, hideEmpty, partsByMembre, logi])

  // ─── Actions ─────────────────────────────────────────────────────────────

  async function togglePresence(membre, day) {
    if (!canEdit) return
    const parts = partsByMembre.get(membre.id) || []
    // Retour Hugo : un membre SANS session doit pouvoir être coché — il
    // rejoint la session du projet qui couvre le jour (ou la 1re), et si
    // le projet n'a aucune session, on la crée.
    if (!parts.length) {
      try {
        const covering =
          sessions.find(
            (s) => s.start_date && s.end_date && s.start_date <= day && day <= s.end_date,
          ) || sessions[0]
        if (covering) {
          await joinSession(membre.id, covering.id, { presence_days: [day] })
        } else {
          await createSession(membre.id, { presence_days: [day] })
          notify.success('Première session du projet créée — nomme-la dans l’onglet Équipe')
        }
        await load()
      } catch (err) {
        notify.error('Présence : ' + (err?.message || err))
      }
      return
    }
    // OFF : la participation qui porte déjà ce jour.
    const holder = parts.find((p) => (p.presence_days || []).includes(day))
    let target
    let nextDays
    if (holder) {
      target = holder
      nextDays = (holder.presence_days || []).filter((d) => d !== day)
    } else {
      // ON : enveloppe session couvrante > unique > plus proche par dates.
      target =
        parts.find(
          (p) => p.start_date && p.end_date && p.start_date <= day && day <= p.end_date,
        ) ||
        (parts.length === 1
          ? parts[0]
          : [...parts].sort((a, b) => {
              const dist = (p) => {
                const ds = (p.presence_days || []).length
                  ? p.presence_days
                  : [p.start_date, p.end_date].filter(Boolean)
                if (!ds.length) return Infinity
                return Math.min(
                  ...ds.map((d) => Math.abs(new Date(d) - new Date(day))),
                )
              }
              return dist(a) - dist(b)
            })[0])
      if (!target) return
      nextDays = [...(target.presence_days || []), day].sort()
    }
    // Optimistic
    setParticipations((prev) =>
      prev.map((p) => (p.id === target.id ? { ...p, presence_days: nextDays } : p)),
    )
    try {
      await updateSession(target.id, { presence_days: nextDays })
    } catch (err) {
      notify.error('Présence : ' + (err?.message || err))
      load()
    }
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
        <span className="block text-xs font-semibold truncate max-w-[170px]" style={{ color: 'var(--txt)' }}>
          {membreName(membre)}
        </span>
        {poste && (
          <span className="block text-[10px] truncate max-w-[170px]" style={{ color: 'var(--txt-3)' }}>
            {poste}
          </span>
        )}
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
        return (
          <td
            key={d}
            className="group px-1 py-1 align-top"
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
