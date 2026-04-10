/**
 * Image placement management for Kitty graphics.
 *
 * Tracks which image IDs are assigned to which screen regions,
 * enabling efficient delta updates.
 */

export type Placement = {
  id: number
  col: number
  row: number
  width: number
  height: number
  /** Pixel dimensions of the source image */
  pw: number
  ph: number
}

// Image ID ranges per region (from architecture doc)
const RANGES = {
  shell: [1, 99],
  left: [100, 199],
  center: [200, 299],
  right: [300, 399],
  overlay: [400, 499],
  composer: [500, 599],
  status: [600, 699],
} as const

export type Region = keyof typeof RANGES

export function manager() {
  const active = new Map<number, Placement>()
  const counters = new Map<Region, number>()

  return {
    /** Allocate a new image ID for a region. */
    alloc(region: Region): number {
      const [min, max] = RANGES[region]
      const current = counters.get(region) ?? min
      const id = current > max ? min : current
      counters.set(region, id + 1)
      return id
    },

    /** Register a placement. */
    set(placement: Placement) {
      active.set(placement.id, placement)
    },

    /** Get a placement by ID. */
    get(id: number): Placement | undefined {
      return active.get(id)
    },

    /** Remove a placement. */
    remove(id: number) {
      active.delete(id)
    },

    /** Clear all placements for a region. */
    region(region: Region): Placement[] {
      const [min, max] = RANGES[region]
      const result: Placement[] = []
      for (const [id, p] of active) {
        if (id >= min && id <= max) result.push(p)
      }
      return result
    },

    /** Clear everything. */
    clear() {
      active.clear()
      counters.clear()
    },

    /** Get all active placements. */
    all(): Placement[] {
      return [...active.values()]
    },
  }
}

export type PlacementManager = ReturnType<typeof manager>
