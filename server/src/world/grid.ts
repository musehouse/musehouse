import type { HouseDef, Point, Room } from "@musehouse/shared";

const WALKABLE = new Set([".", "g", "d", "D"]);

/** Walkability grid derived from the house map and its blocking objects. */
export class Grid {
  readonly width: number;
  readonly depth: number;
  private readonly walkable: boolean[];
  private readonly roomAt: (Room | null)[];

  constructor(private readonly house: HouseDef) {
    this.width = house.width;
    this.depth = house.depth;
    this.walkable = new Array(this.width * this.depth).fill(false);
    this.roomAt = new Array(this.width * this.depth).fill(null);

    for (let z = 0; z < this.depth; z++) {
      for (let x = 0; x < this.width; x++) {
        this.walkable[z * this.width + x] = WALKABLE.has(house.tiles[z][x]);
      }
    }
    for (const obj of house.objects) {
      if (!obj.blocking) continue;
      for (let z = obj.z; z < obj.z + obj.d; z++) {
        for (let x = obj.x; x < obj.x + obj.w; x++) this.walkable[z * this.width + x] = false;
      }
    }
    for (const room of house.rooms) {
      for (let z = room.z; z < room.z + room.d; z++) {
        for (let x = room.x; x < room.x + room.w; x++) this.roomAt[z * this.width + x] = room;
      }
    }
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth;
  }

  isWalkable(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.walkable[z * this.width + x];
  }

  /** Room containing the tile under a (possibly fractional) position. */
  roomOf(p: Point): Room | null {
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    return this.inBounds(x, z) ? this.roomAt[z * this.width + x] : null;
  }

  walkableTilesIn(room: Room): Point[] {
    const out: Point[] = [];
    for (let z = room.z; z < room.z + room.d; z++) {
      for (let x = room.x; x < room.x + room.w; x++) if (this.isWalkable(x, z)) out.push({ x, z });
    }
    return out;
  }

  /**
   * A* over tiles with 8-way movement (no corner cutting).
   * Returns the tiles to visit after `from` (empty if already there), or null if unreachable.
   */
  findPath(from: Point, to: Point): Point[] | null {
    const sx = Math.floor(from.x);
    const sz = Math.floor(from.z);
    if (!this.isWalkable(to.x, to.z)) return null;
    if (sx === to.x && sz === to.z) return [];

    const W = this.width;
    const key = (x: number, z: number) => z * W + x;
    const h = (x: number, z: number) => {
      const dx = Math.abs(x - to.x);
      const dz = Math.abs(z - to.z);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };

    const g = new Map<number, number>([[key(sx, sz), 0]]);
    const came = new Map<number, number>();
    const closed = new Set<number>();
    // Small grids: a simple array-backed open list is plenty.
    const open: { k: number; x: number; z: number; f: number }[] = [{ k: key(sx, sz), x: sx, z: sz, f: h(sx, sz) }];

    while (open.length > 0) {
      let best = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
      const cur = open.splice(best, 1)[0];
      if (closed.has(cur.k)) continue;
      closed.add(cur.k);

      if (cur.x === to.x && cur.z === to.z) {
        const path: Point[] = [];
        let k = cur.k;
        while (k !== key(sx, sz)) {
          path.push({ x: k % W, z: Math.floor(k / W) });
          k = came.get(k)!;
        }
        return path.reverse();
      }

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cur.x + dx;
          const nz = cur.z + dz;
          // The starting tile may be non-walkable (e.g. a muse sitting on a sofa); everything else must be.
          if (!this.isWalkable(nx, nz)) continue;
          if (dx !== 0 && dz !== 0 && (!this.isWalkable(cur.x + dx, cur.z) || !this.isWalkable(cur.x, cur.z + dz))) continue;
          const nk = key(nx, nz);
          if (closed.has(nk)) continue;
          const ng = g.get(cur.k)! + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
          if (ng < (g.get(nk) ?? Infinity)) {
            g.set(nk, ng);
            came.set(nk, cur.k);
            open.push({ k: nk, x: nx, z: nz, f: ng + h(nx, nz) });
          }
        }
      }
    }
    return null;
  }
}
