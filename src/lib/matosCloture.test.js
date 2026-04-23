/**
 * Tests unitaires — matosCloture.js (MAT-8)
 *
 * Couvre les wrappers Supabase de la clôture des essais :
 *   - uploadBilanArchive      : upload Storage avec path canonique + upsert
 *   - closeCheckEssais        : RPC anon check_action_close_essais
 *   - reopenMatosVersion      : RPC authed reopen_matos_version
 *   - closeEssaisWithArchive  : orchestration upload + close
 *   - previewBilanAsAdmin     : fetch authed → aggregate → build ZIP (pas d'upload)
 *   - closeEssaisAsAdmin      : pipeline complet authed (fetch → build → upload → close)
 *
 * Toutes les dépendances externes (supabase, matosCheckAuthed, matosBilanData,
 * matosBilanPdf) sont mockées. On valide le contrat : arguments passés aux
 * RPC + path Storage + propagation d'erreurs + validation des paramètres.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks (hoisted avant les imports SUT) ────────────────────────────────
// vi.hoisted garantit que ces refs existent avant que vi.mock évalue la
// factory — sans ça le code ne peut pas les référencer sans exploser.
const mockUpload = vi.hoisted(() => vi.fn())
const mockRpc = vi.hoisted(() => vi.fn())

vi.mock('./supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: mockUpload }) },
    rpc: mockRpc,
  },
}))

vi.mock('./matosCheckAuthed', () => ({
  fetchCheckSessionAuthed: vi.fn(),
  closeCheckEssaisAuthed: vi.fn(),
}))

vi.mock('./matosBilanData', () => ({
  aggregateBilanData: vi.fn(),
  bilanZipFilename: vi.fn(),
}))

// matosCloture fait un import dynamique `await import('../features/materiel/matosBilanPdf')`
// pour garder le bundle léger — vitest intercepte les imports dynamiques via
// vi.mock comme les imports statiques.
vi.mock('../features/materiel/matosBilanPdf', () => ({
  buildBilanZip: vi.fn(),
}))

import {
  fetchCheckSessionAuthed,
  closeCheckEssaisAuthed,
} from './matosCheckAuthed'
import { aggregateBilanData, bilanZipFilename } from './matosBilanData'
import { buildBilanZip } from '../features/materiel/matosBilanPdf'
import {
  uploadBilanArchive,
  closeCheckEssais,
  reopenMatosVersion,
  closeEssaisWithArchive,
  previewBilanAsAdmin,
  closeEssaisAsAdmin,
} from './matosCloture'

beforeEach(() => {
  mockUpload.mockReset()
  mockRpc.mockReset()
  fetchCheckSessionAuthed.mockReset()
  closeCheckEssaisAuthed.mockReset()
  aggregateBilanData.mockReset()
  bilanZipFilename.mockReset()
  buildBilanZip.mockReset()
})

// ─── uploadBilanArchive ───────────────────────────────────────────────────

describe('uploadBilanArchive', () => {
  // Stub minimal d'un Blob — le SUT ne lit que .size, il n'appelle pas d'API
  // de conversion. Ça évite d'avoir à polyfiller Blob en environnement node.
  const makeBlob = (size = 1024) => ({ size })

  it('lève si versionId manque', async () => {
    await expect(
      uploadBilanArchive({ versionId: '', blob: makeBlob(), filename: 'f.zip' }),
    ).rejects.toThrow(/versionId requis/)
    await expect(
      uploadBilanArchive({ versionId: null, blob: makeBlob(), filename: 'f.zip' }),
    ).rejects.toThrow(/versionId requis/)
  })

  it('lève si blob manque', async () => {
    await expect(
      uploadBilanArchive({ versionId: 'v1', blob: null, filename: 'f.zip' }),
    ).rejects.toThrow(/blob requis/)
  })

  it('lève si filename manque', async () => {
    await expect(
      uploadBilanArchive({ versionId: 'v1', blob: makeBlob(), filename: '' }),
    ).rejects.toThrow(/filename requis/)
  })

  it('upload au path <versionId>/bilan/<filename> avec upsert + content-type ZIP', async () => {
    mockUpload.mockResolvedValue({ error: null })
    const blob = makeBlob(42)
    const result = await uploadBilanArchive({
      versionId: 'ver-123',
      blob,
      filename: 'bilan.zip',
    })
    expect(mockUpload).toHaveBeenCalledWith('ver-123/bilan/bilan.zip', blob, {
      cacheControl: '3600',
      upsert: true,
      contentType: 'application/zip',
    })
    expect(result).toEqual({
      storagePath: 'ver-123/bilan/bilan.zip',
      sizeBytes: 42,
      mimeType: 'application/zip',
    })
  })

  it("propage l'erreur Storage", async () => {
    const err = new Error('bucket not found')
    mockUpload.mockResolvedValue({ error: err })
    await expect(
      uploadBilanArchive({
        versionId: 'v1',
        blob: makeBlob(),
        filename: 'x.zip',
      }),
    ).rejects.toBe(err)
  })
})

// ─── closeCheckEssais (RPC anon via token) ────────────────────────────────

describe('closeCheckEssais', () => {
  it('lève si token manque', async () => {
    await expect(
      closeCheckEssais({ token: '', userName: 'C', archivePath: 'p' }),
    ).rejects.toThrow(/token requis/)
  })

  it('lève si userName vide ou blanc', async () => {
    await expect(
      closeCheckEssais({ token: 't', userName: '', archivePath: 'p' }),
    ).rejects.toThrow(/userName requis/)
    await expect(
      closeCheckEssais({ token: 't', userName: '   ', archivePath: 'p' }),
    ).rejects.toThrow(/userName requis/)
  })

  it('lève si archivePath manque', async () => {
    await expect(
      closeCheckEssais({ token: 't', userName: 'C', archivePath: '' }),
    ).rejects.toThrow(/archivePath requis/)
  })

  it('appelle RPC check_action_close_essais avec les paramètres mappés + trim userName', async () => {
    mockRpc.mockResolvedValue({ data: { version_id: 'v1' }, error: null })
    const payload = await closeCheckEssais({
      token: 'tok',
      userName: '  Camille  ',
      archivePath: 'v1/bilan/f.zip',
      archiveFilename: 'f.zip',
      archiveSize: 512,
      archiveMime: 'application/zip',
    })
    expect(mockRpc).toHaveBeenCalledWith('check_action_close_essais', {
      p_token: 'tok',
      p_user_name: 'Camille',
      p_archive_path: 'v1/bilan/f.zip',
      p_archive_filename: 'f.zip',
      p_archive_size_bytes: 512,
      p_archive_mime: 'application/zip',
    })
    expect(payload).toEqual({ version_id: 'v1' })
  })

  it('utilise les défauts (bilan.zip, 0, application/zip) quand options omises', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    await closeCheckEssais({
      token: 'tok',
      userName: 'C',
      archivePath: 'p',
    })
    expect(mockRpc).toHaveBeenCalledWith('check_action_close_essais', {
      p_token: 'tok',
      p_user_name: 'C',
      p_archive_path: 'p',
      p_archive_filename: 'bilan.zip',
      p_archive_size_bytes: 0,
      p_archive_mime: 'application/zip',
    })
  })

  it("propage l'erreur RPC", async () => {
    const err = new Error('invalid token')
    mockRpc.mockResolvedValue({ data: null, error: err })
    await expect(
      closeCheckEssais({ token: 't', userName: 'C', archivePath: 'p' }),
    ).rejects.toBe(err)
  })
})

// ─── reopenMatosVersion (RPC authed) ──────────────────────────────────────

describe('reopenMatosVersion', () => {
  it('lève si versionId manque', async () => {
    await expect(reopenMatosVersion('')).rejects.toThrow(/versionId requis/)
    await expect(reopenMatosVersion(null)).rejects.toThrow(/versionId requis/)
  })

  it('appelle RPC reopen_matos_version avec p_version_id', async () => {
    mockRpc.mockResolvedValue({
      data: { version_id: 'v1', reopened: true },
      error: null,
    })
    const result = await reopenMatosVersion('v1')
    expect(mockRpc).toHaveBeenCalledWith('reopen_matos_version', {
      p_version_id: 'v1',
    })
    expect(result).toEqual({ version_id: 'v1', reopened: true })
  })

  it("propage l'erreur RPC (ex. droits insuffisants)", async () => {
    const err = new Error('permission denied')
    mockRpc.mockResolvedValue({ data: null, error: err })
    await expect(reopenMatosVersion('v1')).rejects.toBe(err)
  })
})

// ─── closeEssaisWithArchive — orchestration upload + close ────────────────

describe('closeEssaisWithArchive', () => {
  it("chaîne upload puis closeCheckEssais avec les métadonnées de l'upload", async () => {
    mockUpload.mockResolvedValue({ error: null })
    mockRpc.mockResolvedValue({ data: { version_id: 'v1' }, error: null })
    const blob = { size: 999 }
    const payload = await closeEssaisWithArchive({
      token: 'tok',
      versionId: 'v1',
      userName: 'Camille',
      zipBlob: blob,
      zipFilename: 'bilan-essais-v1.zip',
    })
    // Upload a été fait au bon path avec l'option upsert.
    expect(mockUpload).toHaveBeenCalledWith(
      'v1/bilan/bilan-essais-v1.zip',
      blob,
      expect.objectContaining({
        upsert: true,
        contentType: 'application/zip',
      }),
    )
    // RPC a reçu les meta (path + size) issues de l'upload.
    expect(mockRpc).toHaveBeenCalledWith('check_action_close_essais', {
      p_token: 'tok',
      p_user_name: 'Camille',
      p_archive_path: 'v1/bilan/bilan-essais-v1.zip',
      p_archive_filename: 'bilan-essais-v1.zip',
      p_archive_size_bytes: 999,
      p_archive_mime: 'application/zip',
    })
    expect(payload).toEqual({ version_id: 'v1' })
  })

  it("propage une erreur d'upload sans appeler la RPC", async () => {
    const err = new Error('storage down')
    mockUpload.mockResolvedValue({ error: err })
    await expect(
      closeEssaisWithArchive({
        token: 't',
        versionId: 'v1',
        userName: 'C',
        zipBlob: { size: 1 },
        zipFilename: 'x.zip',
      }),
    ).rejects.toBe(err)
    // Si l'upload a cassé, on n'a surtout pas signalé la clôture côté SQL.
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

// ─── previewBilanAsAdmin — read-only, pas de Storage ni RPC de clôture ────

describe('previewBilanAsAdmin', () => {
  it('lève si versionId manque', async () => {
    await expect(previewBilanAsAdmin({ versionId: '' })).rejects.toThrow(
      /versionId requis/,
    )
  })

  it('fetch session + aggregate + build ZIP sans toucher Storage ni RPC de clôture', async () => {
    fetchCheckSessionAuthed.mockResolvedValue({ fake: 'session' })
    aggregateBilanData.mockReturnValue({
      project: { id: 'p1' },
      version: { id: 'v1', numero: 1 },
    })
    buildBilanZip.mockResolvedValue({
      blob: { size: 100 },
      url: 'blob:xxx',
      filename: 'f.zip',
      isZip: true,
    })

    const result = await previewBilanAsAdmin({
      versionId: 'v1',
      pdfOptions: { org: 'Captiv' },
    })

    expect(fetchCheckSessionAuthed).toHaveBeenCalledWith('v1')
    expect(aggregateBilanData).toHaveBeenCalledWith({ fake: 'session' })
    expect(buildBilanZip).toHaveBeenCalledWith(
      expect.objectContaining({ version: { id: 'v1', numero: 1 } }),
      { org: 'Captiv' },
    )
    // Preview = zéro side-effect serveur : ni Storage, ni RPC de clôture.
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
    expect(closeCheckEssaisAuthed).not.toHaveBeenCalled()
    expect(result.isZip).toBe(true)
  })

  it('lève "Version introuvable" si snapshot.version.id absent', async () => {
    fetchCheckSessionAuthed.mockResolvedValue({})
    aggregateBilanData.mockReturnValue({ version: null })
    await expect(previewBilanAsAdmin({ versionId: 'v1' })).rejects.toThrow(
      /Version introuvable/,
    )
    expect(buildBilanZip).not.toHaveBeenCalled()
  })
})

// ─── closeEssaisAsAdmin — pipeline authed complet ─────────────────────────

describe('closeEssaisAsAdmin', () => {
  it('lève si versionId manque', async () => {
    await expect(
      closeEssaisAsAdmin({ versionId: '', userName: 'C' }),
    ).rejects.toThrow(/versionId requis/)
  })

  it('lève si userName vide ou blanc', async () => {
    await expect(
      closeEssaisAsAdmin({ versionId: 'v1', userName: '   ' }),
    ).rejects.toThrow(/userName requis/)
  })

  it('chaîne fetch → aggregate → build → upload → closeAuthed et retourne {payload, zip}', async () => {
    fetchCheckSessionAuthed.mockResolvedValue({ s: 1 })
    aggregateBilanData.mockReturnValue({
      project: { id: 'p1', ref_projet: 'MTX' },
      version: { id: 'v1', numero: 2 },
    })
    const zip = { blob: { size: 2048 }, filename: 'whatever.zip' }
    buildBilanZip.mockResolvedValue(zip)
    bilanZipFilename.mockReturnValue('MTX_v2_bilan.zip')
    mockUpload.mockResolvedValue({ error: null })
    const closePayload = {
      version_id: 'v1',
      closed_at: '2026-04-23T10:00:00Z',
      closed_by_name: 'Camille',
      bilan_archive_path: 'v1/bilan/MTX_v2_bilan.zip',
      attachment_id: 'att-1',
    }
    closeCheckEssaisAuthed.mockResolvedValue(closePayload)

    const result = await closeEssaisAsAdmin({
      versionId: 'v1',
      userName: 'Camille',
      pdfOptions: { org: 'Captiv' },
    })

    // 1. Fetch session via RPC authed.
    expect(fetchCheckSessionAuthed).toHaveBeenCalledWith('v1')
    // 2. Aggregation du snapshot.
    expect(aggregateBilanData).toHaveBeenCalledWith({ s: 1 })
    // 3. Build ZIP avec pdfOptions forwarded.
    expect(buildBilanZip).toHaveBeenCalledWith(
      expect.objectContaining({ version: { id: 'v1', numero: 2 } }),
      { org: 'Captiv' },
    )
    // 4. Filename dérivé depuis bilanZipFilename (project + version).
    expect(bilanZipFilename).toHaveBeenCalledWith({
      project: { id: 'p1', ref_projet: 'MTX' },
      version: { id: 'v1', numero: 2 },
    })
    // 5. Upload au path <versionId>/bilan/<filename>.
    expect(mockUpload).toHaveBeenCalledWith(
      'v1/bilan/MTX_v2_bilan.zip',
      zip.blob,
      expect.objectContaining({ upsert: true }),
    )
    // 6. Close authed avec meta dérivées de l'upload.
    expect(closeCheckEssaisAuthed).toHaveBeenCalledWith({
      versionId: 'v1',
      archivePath: 'v1/bilan/MTX_v2_bilan.zip',
      archiveFilename: 'MTX_v2_bilan.zip',
      archiveSize: 2048,
      archiveMime: 'application/zip',
    })
    expect(result).toEqual({ payload: closePayload, zip })
  })

  it('lève "Version introuvable" si snapshot.version.id absent (avant tout build)', async () => {
    fetchCheckSessionAuthed.mockResolvedValue({})
    aggregateBilanData.mockReturnValue({ version: null })
    await expect(
      closeEssaisAsAdmin({ versionId: 'v1', userName: 'C' }),
    ).rejects.toThrow(/Version introuvable/)
    // Rien de couteux (build ZIP) ni d'irréversible (upload, RPC close) n'a été
    // tenté — sécurité importante : pas d'archive orpheline dans Storage.
    expect(buildBilanZip).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
    expect(closeCheckEssaisAuthed).not.toHaveBeenCalled()
  })

  it("propage une erreur d'upload sans appeler closeAuthed", async () => {
    fetchCheckSessionAuthed.mockResolvedValue({})
    aggregateBilanData.mockReturnValue({
      project: {},
      version: { id: 'v1', numero: 1 },
    })
    buildBilanZip.mockResolvedValue({ blob: { size: 1 } })
    bilanZipFilename.mockReturnValue('x.zip')
    const err = new Error('storage down')
    mockUpload.mockResolvedValue({ error: err })
    await expect(
      closeEssaisAsAdmin({ versionId: 'v1', userName: 'C' }),
    ).rejects.toBe(err)
    // Si le ZIP n'a pas pu être archivé, on ne marque surtout pas la version
    // clôturée côté SQL.
    expect(closeCheckEssaisAuthed).not.toHaveBeenCalled()
  })
})
