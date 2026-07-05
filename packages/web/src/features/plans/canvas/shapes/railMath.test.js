import { describe, it, expect } from 'vitest'
import {
  sampleRail,
  pointAtT,
  nearestT,
  railSvgPath,
  diagonalsIntersection,
} from './railMath'

describe('sampleRail', () => {
  it('retourne tel quel en dessous de 2 points', () => {
    expect(sampleRail([], false)).toEqual([])
    expect(sampleRail([{ x: 1, y: 2 }], true)).toEqual([{ x: 1, y: 2 }])
  })

  it('polyligne (spline off) : copie des points, sans mutation', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const out = sampleRail(pts, false)
    expect(out).toEqual(pts)
    expect(out).not.toBe(pts)
  })

  it('spline à 2 points : reste une droite', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    expect(sampleRail(pts, true)).toEqual(pts)
  })

  it('spline à 3+ points : densifie et passe par les extrémités', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 0 },
    ]
    const out = sampleRail(pts, true)
    expect(out.length).toBeGreaterThan(pts.length)
    expect(out[0]).toEqual(pts[0])
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1])
  })

  it('spline Catmull-Rom : passe par les points de contrôle intermédiaires', () => {
    const mid = { x: 50, y: 40 }
    const out = sampleRail([{ x: 0, y: 0 }, mid, { x: 100, y: 0 }], true)
    const dMin = Math.min(...out.map((p) => Math.hypot(p.x - mid.x, p.y - mid.y)))
    expect(dMin).toBeLessThan(0.001)
  })
})

describe('pointAtT', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]

  it('t=0 et t=1 : extrémités', () => {
    expect(pointAtT(line, 0)).toMatchObject({ x: 0, y: 0 })
    expect(pointAtT(line, 1)).toMatchObject({ x: 100, y: 0 })
  })

  it('t=0.5 : milieu (paramétrage par longueur d’arc)', () => {
    const p = pointAtT(line, 0.5)
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(0)
    expect(p.angle).toBeCloseTo(0)
  })

  it('longueur d’arc : t=0.5 sur segments inégaux tombe au milieu du chemin', () => {
    // 0→100 puis 100→400 : longueur totale 400, milieu à x=200 (sur le 2e segment).
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 400, y: 0 },
    ]
    expect(pointAtT(pts, 0.5).x).toBeCloseTo(200)
  })

  it('t hors bornes : clampé', () => {
    expect(pointAtT(line, -1)).toMatchObject({ x: 0, y: 0 })
    expect(pointAtT(line, 2)).toMatchObject({ x: 100, y: 0 })
  })

  it('angle : tangente du segment courant', () => {
    const vertical = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]
    expect(pointAtT(vertical, 0.5).angle).toBeCloseTo(Math.PI / 2)
  })

  it('chemin vide ou point unique : valeurs sûres', () => {
    expect(pointAtT([], 0.5)).toEqual({ x: 0, y: 0, angle: 0 })
    expect(pointAtT([{ x: 3, y: 4 }], 0.5)).toEqual({ x: 3, y: 4, angle: 0 })
  })
})

describe('nearestT', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]

  it('projection au milieu', () => {
    expect(nearestT(line, { x: 50, y: 30 })).toBeCloseTo(0.5)
  })

  it('au-delà des extrémités : clampé à 0 / 1', () => {
    expect(nearestT(line, { x: -50, y: 10 })).toBe(0)
    expect(nearestT(line, { x: 150, y: 10 })).toBe(1)
  })

  it('multi-segments : choisit le segment le plus proche', () => {
    // L renversé : le point (95, 20) est plus proche du 2e segment (d=5 vs 20).
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]
    // t attendu : (100 + 20) / 200 = 0.6
    expect(nearestT(pts, { x: 95, y: 20 })).toBeCloseTo(0.6)
  })

  it('aller-retour avec pointAtT : cohérent', () => {
    const pts = sampleRail(
      [
        { x: 0, y: 0 },
        { x: 60, y: 80 },
        { x: 120, y: 0 },
      ],
      true,
    )
    const p = pointAtT(pts, 0.37)
    expect(nearestT(pts, p)).toBeCloseTo(0.37, 2)
  })
})

describe('railSvgPath', () => {
  it('M puis L, coordonnées arrondies à 1 décimale', () => {
    expect(
      railSvgPath([
        { x: 0, y: 0 },
        { x: 10.456, y: 5 },
      ]),
    ).toBe('M 0.0 0.0 L 10.5 5.0')
  })

  it('chemin vide → chaîne vide', () => {
    expect(railSvgPath([])).toBe('')
  })
})

describe('diagonalsIntersection', () => {
  it('carré : les diagonales se croisent au centre', () => {
    const p = diagonalsIntersection(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    )
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(50)
  })

  it('diagonales parallèles : fallback centroïde', () => {
    // p1-p3 et p2-p4 horizontales parallèles → pas d'intersection.
    const p = diagonalsIntersection(
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    )
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(50)
  })
})
