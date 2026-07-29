// ════════════════════════════════════════════════════════════════════════════
// logistiqueSynthese — agrégats de la Synthèse festival (Logistique V1, P3)
// ════════════════════════════════════════════════════════════════════════════
//
// Helpers PURS, partagés entre la vue Synthèse et l'export PDF : une seule
// source de calcul pour repas par jour, chambres par nuit, rooming list et
// planning des arrivées/départs.
// ════════════════════════════════════════════════════════════════════════════

export function membreDisplayName(m) {
  if (!m) return 'Membre supprimé'
  const prenom = m.contact?.prenom || m.prenom || ''
  const nom = m.contact?.nom || m.nom || ''
  return `${prenom} ${nom}`.trim() || 'Sans nom'
}

export function membrePosteLabel(m) {
  if (!m) return ''
  return m.devis_line?.produit || m.specialite || m.contact?.specialite || ''
}

export function frDay(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00`)
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function frDayShort(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00`)
  const s = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const MODE_LABELS = {
  train: 'Train',
  minibus: 'Minibus',
  voiture: 'Voiture',
  avion: 'Avion',
  autre: 'Autre',
}

/** Résumé compact d'un trajet : « Train + Minibus · arrivée 16:00 Festival ». */
export function trajetSummary(trajet) {
  const etapes = Array.isArray(trajet.etapes) ? trajet.etapes : []
  const modes = etapes.map((e) => MODE_LABELS[e.mode] || e.mode).join(' + ')
  const last = etapes[etapes.length - 1] || {}
  const first = etapes[0] || {}
  if (trajet.sens === 'retour') {
    const heure = first.heure || ''
    return [modes, heure && `départ ${heure}${first.depart ? ` ${first.depart}` : ''}`]
      .filter(Boolean)
      .join(' · ')
  }
  const heure = last.heure_arrivee || last.heure || ''
  return [modes, heure && `arrivée ${heure}${last.arrivee ? ` ${last.arrivee}` : ''}`]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Calcule tous les agrégats de la synthèse.
 *
 * @param {Object} args
 * @param {Array} args.techRows      rows principales (listTechlistRows)
 * @param {Array} args.participations shape unifié crew (fetchProjectSessions)
 * @param {Object} args.logi         fetchLogistique (hebergements, repas, nuits, trajets, hebergementMembres)
 */
export function computeSynthese({ techRows = [], participations = [], logi }) {
  const membreById = new Map(techRows.map((m) => [m.id, m]))
  // Les rows rattachées comptent aussi pour le lookup nom (défensif).
  for (const m of techRows) for (const a of m.attached || []) membreById.set(a.id, m)

  // ── Repas par jour / service / prise en charge ─────────────────────────
  const repasMap = new Map() // date -> {midi: {...}, soir: {...}}
  for (const r of logi.repas) {
    let day = repasMap.get(r.date_repas)
    if (!day) {
      day = {
        midi: { client: 0, production: 0, defraye: 0 },
        soir: { client: 0, production: 0, defraye: 0 },
      }
      repasMap.set(r.date_repas, day)
    }
    if (day[r.service]) day[r.service][r.statut] += 1
  }
  const repasParJour = Array.from(repasMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))
  const totauxRepas = {
    midi: { client: 0, production: 0, defraye: 0 },
    soir: { client: 0, production: 0, defraye: 0 },
  }
  for (const j of repasParJour) {
    for (const svc of ['midi', 'soir']) {
      for (const k of ['client', 'production', 'defraye']) {
        totauxRepas[svc][k] += j[svc][k]
      }
    }
  }

  // ── Nuits / chambres par hébergement ───────────────────────────────────
  const hmByKey = new Map(
    logi.hebergementMembres.map((hm) => [`${hm.hebergement_id}|${hm.membre_id}`, hm]),
  )
  const hebs = logi.hebergements.map((h) => {
    const nuitsHeb = logi.nuits.filter((n) => n.hebergement_id === h.id)
    // Par date : personnes + chambres distinctes (si renseignées)
    const parDate = new Map()
    for (const n of nuitsHeb) {
      const e = parDate.get(n.date_nuit) || { pers: 0, chambres: new Set() }
      e.pers += 1
      const hm = hmByKey.get(`${h.id}|${n.membre_id}`)
      if (hm?.chambre) e.chambres.add(hm.chambre)
      parDate.set(n.date_nuit, e)
    }
    const nuitsParDate = Array.from(parDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, e]) => ({ date, pers: e.pers, chambres: e.chambres.size }))
    // Rooming : par personne
    const byMembre = new Map()
    for (const n of nuitsHeb) {
      const arr = byMembre.get(n.membre_id) || []
      arr.push(n.date_nuit)
      byMembre.set(n.membre_id, arr)
    }
    const rooming = Array.from(byMembre.entries())
      .map(([membreId, dates]) => {
        const sorted = [...dates].sort()
        const hm = hmByKey.get(`${h.id}|${membreId}`)
        const last = new Date(`${sorted[sorted.length - 1]}T12:00:00`)
        last.setDate(last.getDate() + 1)
        return {
          membre: membreById.get(membreId) || null,
          membreId,
          chambre: hm?.chambre || '',
          pdj: Boolean(hm?.pdj),
          checkin: sorted[0],
          checkout: last.toISOString().slice(0, 10),
          nuits: sorted.length,
        }
      })
      .sort((a, b) =>
        membreDisplayName(a.membre).localeCompare(membreDisplayName(b.membre), 'fr'),
      )
    return { hebergement: h, nuitsParDate, rooming }
  })
  const nuitsSansHeb = logi.nuits.filter((n) => !n.hebergement_id).length

  // ── Arrivées / départs par jour ─────────────────────────────────────────
  // Priorité au trajet structuré (heure fiable) ; fallback sur l'arrivée /
  // le retour saisis dans la session Équipe.
  const mouvementsMap = new Map() // date -> {arrivees: [], departs: []}
  const push = (date, kind, event) => {
    if (!date) return
    let e = mouvementsMap.get(date)
    if (!e) {
      e = { arrivees: [], departs: [] }
      mouvementsMap.set(date, e)
    }
    e[kind].push(event)
  }
  for (const m of techRows) {
    const trajets = logi.trajets.filter((t) => t.membre_id === m.id)
    const allers = trajets.filter((t) => t.sens === 'aller' && t.date_trajet)
    const retours = trajets.filter((t) => t.sens === 'retour' && t.date_trajet)
    const parts = participations.filter((p) => p.membre_id === m.id)

    if (allers.length) {
      for (const t of allers) {
        const etapes = Array.isArray(t.etapes) ? t.etapes : []
        const last = etapes[etapes.length - 1] || {}
        push(t.date_trajet, 'arrivees', {
          membre: m,
          heure: last.heure_arrivee || last.heure || '',
          detail: trajetSummary(t),
        })
      }
    } else {
      for (const p of parts) {
        if (p.arrival_date) {
          push(p.arrival_date, 'arrivees', {
            membre: m,
            heure: p.arrival_time || '',
            detail: '',
          })
        }
      }
    }
    if (retours.length) {
      for (const t of retours) {
        const etapes = Array.isArray(t.etapes) ? t.etapes : []
        const first = etapes[0] || {}
        push(t.date_trajet, 'departs', {
          membre: m,
          heure: first.heure || '',
          detail: trajetSummary(t),
        })
      }
    } else {
      for (const p of parts) {
        if (p.departure_date) {
          push(p.departure_date, 'departs', {
            membre: m,
            heure: p.departure_time || '',
            detail: '',
          })
        }
      }
    }
  }
  const mouvements = Array.from(mouvementsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, e]) => ({
      date,
      arrivees: e.arrivees.sort((a, b) => (a.heure || '99').localeCompare(b.heure || '99')),
      departs: e.departs.sort((a, b) => (a.heure || '99').localeCompare(b.heure || '99')),
    }))

  return { repasParJour, totauxRepas, hebs, nuitsSansHeb, mouvements }
}
