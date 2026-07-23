// ════════════════════════════════════════════════════════════════════════════
// matosExcel — export .xlsx d'une liste + parsing des fichiers d'import
// ════════════════════════════════════════════════════════════════════════════
//
// MAT-OUTILS. SheetJS (`xlsx`) en lazy import : ~400 Ko gzip, chargé
// uniquement à l'export/import. L'export écrit une feuille « Matériel »
// à plat (une ligne par item, bloc répété → filtres Excel naturels).
// ════════════════════════════════════════════════════════════════════════════

function slug(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'liste'
}

/** Export .xlsx de la liste ouverte (déclenche le téléchargement). */
export async function exportListeExcel({
  projectTitle,
  listeTitre,
  versionNumero,
  blocks = [],
  itemsByBlock,
  loueursByItem,
  loueursById,
}) {
  const XLSX = await import('xlsx')
  const rows = []
  for (const b of blocks) {
    for (const it of itemsByBlock?.get(b.id) || []) {
      const loueurs = (loueursByItem?.get(it.id) || [])
        .map((il) => loueursById?.get(il.loueur_id)?.nom)
        .filter(Boolean)
        .join(', ')
      rows.push({
        Bloc: b.titre || '',
        Label: it.label || '',
        Désignation: it.designation || '',
        Qté: it.quantite ?? 1,
        Loueurs: loueurs,
        Remarques: it.remarques || '',
        Flag: it.flag || 'ok',
      })
    }
  }
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 20 },
    { wch: 16 },
    { wch: 42 },
    { wch: 6 },
    { wch: 24 },
    { wch: 32 },
    { wch: 10 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Matériel')
  XLSX.writeFile(
    wb,
    `${slug(projectTitle)}_${slug(listeTitre)}_V${versionNumero || 1}_materiel.xlsx`,
  )
  return rows.length
}

/**
 * Parse un fichier d'import (.xlsx, .xls, .csv) → { headers, rows } (1re
 * feuille ; rows = tableaux de cellules, lignes vides filtrées).
 */
export async function parseImportFile(file) {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf)
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { headers: [], rows: [] }
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
  const headers = (raw[0] || []).map((h) => String(h ?? '').trim())
  const rows = raw
    .slice(1)
    .filter((r) => r.some((c) => String(c ?? '').trim()))
  return { headers, rows }
}

/** Devine la colonne source pour un champ (par nom d'en-tête). */
export function guessColumn(headers, keywords) {
  const norm = (s) =>
    String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const idx = headers.findIndex((h) => keywords.some((k) => norm(h).includes(k)))
  return idx >= 0 ? String(idx) : ''
}
