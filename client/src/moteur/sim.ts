import type { Place } from './nav';

/** Logique de l'essai virtuel, sans rendu : conduite, collisions, circulation, parcours et score. Les valeurs sont celles d'un jeu, pas celles d'un véhicule réel. */
export const LIMIT = 50 / 3.6;

export type VehicleKind = 'berline' | 'suv' | 'pickup' | 'minibus' | 'moto' | 'scooter' | 'motosport' | 'helico' | 'sportive' | 'coupe' | 'luxe' | 'taxi' | 'fourgon';
const kmh = (v: number) => v / 3.6;
/**
 * Véhicules du jeu : vitesse maximale (m/s), accélération, empattement, demi-longueur et rayon de collision ; « board » complète « Monter dans… ».
 * Vitesses de jeu, de 250 à 300 km/h : aucune n'est celle d'un véhicule réel.
 */
export const VEHICLES: Record<VehicleKind, { label: string; board: string; max: number; accel: number; wheelbase: number; half: number; radius: number }> = {
  // La voiture du joueur est la CHANGAN Nevo Q05 : 4,54 m de long, 2,66 m d'empattement.
  berline: { label: 'Nevo Q05', board: 'Monter dans la Nevo Q05', max: kmh(260), accel: 8, wheelbase: 2.66, half: 1.42, radius: 0.97 },
  suv: { label: 'SUV', board: 'Monter dans le SUV', max: kmh(250), accel: 7.5, wheelbase: 2.8, half: 1.45, radius: 1.05 },
  pickup: { label: 'Pick-up', board: 'Monter dans le pick-up', max: kmh(250), accel: 6.5, wheelbase: 3.1, half: 1.7, radius: 1.05 },
  minibus: { label: 'Minibus', board: 'Monter dans le minibus', max: kmh(250), accel: 5.5, wheelbase: 3.2, half: 1.9, radius: 1.15 },
  moto: { label: 'Moto', board: 'Monter sur la moto', max: kmh(280), accel: 10, wheelbase: 1.35, half: 0.55, radius: 0.5 },
  scooter: { label: 'Scooter', board: 'Monter sur le scooter', max: kmh(250), accel: 8.5, wheelbase: 1.3, half: 0.5, radius: 0.5 },
  motosport: { label: 'Moto sportive', board: 'Monter sur la moto sportive', max: kmh(300), accel: 12.5, wheelbase: 1.42, half: 0.58, radius: 0.5 },
  // Modèles du Car Kit de Kenney (CC0) : voitures stylisées, sans marque.
  sportive: { label: 'Sportive', board: 'Monter dans la sportive', max: kmh(300), accel: 11.5, wheelbase: 2.5, half: 1.32, radius: 0.97 },
  coupe: { label: 'Compacte sport', board: 'Monter dans la compacte sport', max: kmh(280), accel: 10, wheelbase: 2.55, half: 1.42, radius: 0.97 },
  luxe: { label: 'SUV de luxe', board: 'Monter dans le SUV de luxe', max: kmh(270), accel: 8.5, wheelbase: 2.9, half: 1.52, radius: 1.05 },
  taxi: { label: 'Taxi', board: 'Monter dans le taxi', max: kmh(250), accel: 7, wheelbase: 2.7, half: 1.42, radius: 0.97 },
  // Hélicoptère léger imaginé pour le jeu : il vole au-dessus des rues et se pose au sol ou sur les toits.
  helico: { label: 'Hélicoptère', board: 'Monter dans l’hélicoptère', max: kmh(250), accel: 9, wheelbase: 3, half: 3.2, radius: 2.4 },
  fourgon: { label: 'Fourgon', board: 'Monter dans le fourgon', max: kmh(250), accel: 6, wheelbase: 3.0, half: 1.6, radius: 1.1 },
};
/** Demi-largeur de chaque véhicule, en mètres : sert aux couloirs de passage de SMART AI. */
export const halfWidth = (k: VehicleKind) => (TWO_WHEELS.has(k) ? 0.45 : k === 'minibus' || k === 'fourgon' || k === 'pickup' ? 1.0 : k === 'helico' ? 1.6 : 0.95);

type Body = { x: number; z: number; heading: number; kind: VehicleKind };
/** Axe d'un véhicule : le segment qui, épaissi de sa demi-largeur, donne sa carrosserie. */
const axisOf = (b: Body): [number, number, number, number] => {
  const s = VEHICLES[b.kind], h = Math.max(0, s.half + s.radius * 0.6 - halfWidth(b.kind));
  const fx = Math.sin(b.heading) * h, fz = Math.cos(b.heading) * h;
  return [b.x - fx, b.z - fz, b.x + fx, b.z + fz];
};
const pointSeg = (px: number, pz: number, [ax, az, bx, bz]: [number, number, number, number]) => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const u = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - dx * u, pz - az - dz * u);
};
/** Écart entre deux carrosseries (m) ; négatif si elles se chevauchent. */
export function bodyGap(a: Body, b: Body) {
  const p = axisOf(a), q = axisOf(b);
  const cross = (ux: number, uz: number, vx: number, vz: number) => ux * vz - uz * vx;
  // Les deux axes se croisent : distance nulle.
  const d1 = cross(p[2] - p[0], p[3] - p[1], q[0] - p[0], q[1] - p[1]), d2 = cross(p[2] - p[0], p[3] - p[1], q[2] - p[0], q[3] - p[1]);
  const d3 = cross(q[2] - q[0], q[3] - q[1], p[0] - q[0], p[1] - q[1]), d4 = cross(q[2] - q[0], q[3] - q[1], p[2] - q[0], p[3] - q[1]);
  const axes = d1 * d2 < 0 && d3 * d4 < 0 ? 0
    : Math.min(pointSeg(p[0], p[1], q), pointSeg(p[2], p[3], q), pointSeg(q[0], q[1], p), pointSeg(q[2], q[3], p));
  return axes - halfWidth(a.kind) - halfWidth(b.kind);
}
/** Braquage maximal des roues à la vitesse v : moins on braque à haute vitesse, mais le véhicule garde au moins 0,85 rad/s de virage. */
export function steerLimit(k: VehicleKind, v: number) {
  const spec = VEHICLES[k];
  const yaw = Math.max(0.85, 55 / Math.max(v, 1));
  return Math.min(0.6 - 0.5 * Math.min(v / 25, 1), Math.atan((yaw * spec.wheelbase) / Math.max(v, 1)));
}
/** Nid-de-poule sur la chaussée : centre et rayon. */
export type Pothole = { x: number; z: number; r: number };
/** Deux-roues : le pilote est assis dessus, il se penche dans les virages. */
export const TWO_WHEELS = new Set<VehicleKind>(['moto', 'scooter', 'motosport']);
export const HERO = 'Honorable';
const WALK = 1.9, RUN = 6.2;

export type Pt = [number, number];
/** lift : montée (1) ou descente (−1) de l'hélicoptère. */
export type Input = { throttle: number; brake: number; steer: number; run?: boolean; jump?: boolean; lift?: number };
export type Mode = 'car' | 'foot';
export type Parked = { x: number; z: number; heading: number; kind: VehicleKind; color: number };
export type Walker = { x: number; z: number; heading: number; speed: number; cruise: number; look: number; targets: Pt[]; edge: number; wait: number; phase: number };
/** Pièce où entre Honorable : intérieur générique, construit loin de la ville par le rendu. */
export type Room = {
  name: string | null; x0: number; z0: number; x1: number; z1: number; solids: Pt[][]; door: Pt; spawn: { x: number; z: number; heading: number };
  /** Bâtiment à étages : hauteur du sol sous Honorable (escaliers compris), et obstacles propres à certaines hauteurs. */
  ground?: (x: number, z: number, y: number) => number;
  levels?: { from: number; to: number; solids: Pt[][] }[];
  /** Ascenseur : paliers devant les portes, hauteur d'étage et nombre de niveaux. */
  lift?: { points: Pt[]; storey: number; floors: number };
  spots?: Spot[];
};
export const floorName = (n: number) => (n <= 0 ? 'rez-de-chaussée' : n === 1 ? '1er étage' : `${n}e étage`);
export type Action = { kind: 'exit' | 'enter-car' | 'enter-room' | 'leave-room' | 'lift' | 'use'; label: string; id?: string } | null;
/** Point d'usage dans une pièce (rayon, caisse) : le rendu en fixe le libellé et traite l'action. */
export type Spot = { x: number; z: number; r: number; id: string; label: string };
export type LightColor = 'green' | 'amber' | 'red';
export type Junction = { x: number; z: number; r: number; axis: number; dirs: number[]; node: number };
export type GraphEdge = { a: number; b: number; p: Pt[]; l: number; r: number; n?: string };
export type Step = { kind: 'ignite' | 'gate' | 'stop' | 'park'; text: string; x: number; z: number; signal?: -1 | 1; junction?: number; heading?: number };
export type Park = { x: number; z: number; heading: number; halfW: number; halfL: number };
export type GameEvent = 'hit' | 'red' | 'speed' | 'signal' | 'gate' | 'green' | 'done' | 'bounds' | 'arrived' | 'reroute' | 'walker' | 'exit' | 'board' | 'room' | 'outside' | 'lift' | 'use' | 'nid';
export type Result = { score: number; stars: number; time: number; hits: number; reds: number; signals: number; signalTotal: number; speeding: number };
export type TrafficCar = {
  x: number; z: number; heading: number; speed: number; cruise: number; color: number; targets: Pt[]; edge: number; kind: VehicleKind;
  /** Klaxonné : temps restant pendant lequel il se range à droite et s'arrête pour laisser passer, et décalage appliqué à sa voie. */
  yieldT?: number; aside?: number;
  /** Bloqué face à la voiture du joueur, elle-même arrêtée : temps d'attente, puis temps de recul restant pour lui laisser la place. */
  facingT?: number; backT?: number;
  /** A reculé pour laisser passer le joueur : reste arrêté tant que la voiture du joueur, toute proche, ne repart pas. */
  gaveWay?: boolean; gaveT?: number;
  /** Reculs supplémentaires faits pour laisser passer le joueur (rue étroite). */
  backs?: number;
  /** Son dernier déplacement a été empêché parce qu'il entrait dans la voiture du joueur. */
  pressed?: boolean;
  /** Arrêté par un véhicule garé depuis ce temps (s) ; dépassement en cours : le véhicule garé et le décalage appliqué. */
  parkedT?: number; passing?: { x: number; z: number; by: number; t: number } | null;
  /** Temps passé face à face avec un autre véhicule de la circulation, chacun arrêté pour l'autre. */
  deadT?: number;
  /** Après le recul en cours : contourner ce véhicule (indice dans la circulation). */
  passAfterBack?: number;
  /** Immobile depuis ce temps (s) : un véhicule figé loin du joueur est replacé ailleurs. */
  stillT?: number;
  /** Point proche, 10 m devant, par lequel il glisse vers le bord ou revient dans sa voie. */
  merge?: Pt;
};

export type World = {
  kind: 'grid' | 'lome';
  start: { x: number; z: number; heading: number };
  /** Départ de la conduite libre, s'il diffère de celui du parcours. */
  freeStart?: { x: number; z: number; heading: number };
  steps: Step[];
  park: Park;
  colliders: Pt[][];
  /** Hauteur de chaque obstacle, dans l'ordre des colliders : l'hélicoptère passe au-dessus ou se pose dessus. */
  colliderHeights?: number[];
  inBounds: (x: number, z: number) => boolean;
  junctions: Junction[];
  nodes: Pt[];
  edges: GraphEdge[];
  /** Lieux proposés à la recherche ; absent, la recherche n'est pas offerte. */
  places?: Place[];
  /** Tracés à dessiner sur la mini-carte, et demi-largeur de la fenêtre affichée autour de la voiture (0 : carte entière). */
  mapLines: Pt[][];
  mapWindow: number;
  streets?: { n: string; p: Pt[] }[];
  boundsMessage: string;
  /** Véhicules garés à des places précises, que l'on peut prendre. */
  parkedExtra?: Parked[];
  /** Endroit dégagé souhaité pour l'aire de l'hélicoptère ; l'aire est placée au plus près. */
  helipad?: Pt;
  /** Zones où aucun véhicule ne peut rouler (eau de la lagune, de la mer) : SMART AI ne les envisage jamais pour contourner. */
  impassable?: Pt[][];
  /** Nids-de-poule imposés ; absents, ils sont placés sur quelques rues. */
  potholes?: Pothole[];
  /** Bâtiments où Honorable peut entrer, avec leur nom s'il est connu. */
  rooms?: { p: Pt[]; n: string | null }[];
};

export function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const axisGroup = (heading: number, axis: number) => (Math.abs(Math.cos(heading - axis)) >= Math.abs(Math.sin(heading - axis)) ? 0 : 1);
const COLORS = [0xecedee, 0x26282c, 0x8d1f1f, 0x70747a, 0xe2b13c, 0x1c346e, 0xd9d6cf];
/** Circulation mêlée : surtout des voitures, des motos-taxis, quelques minibus et pick-up. */
const TRAFFIC_KINDS: VehicleKind[] = ['berline', 'moto', 'taxi', 'suv', 'scooter', 'sportive', 'moto', 'minibus', 'luxe', 'motosport', 'pickup', 'taxi', 'scooter', 'coupe', 'fourgon', 'berline'];
const CELL = 30;

function hashPolys(polys: Pt[][]) {
  const hash = new Map<string, Pt[][]>();
  for (const poly of polys) {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    const x0 = Math.floor((Math.min(...xs) - 1) / CELL), x1 = Math.floor((Math.max(...xs) + 1) / CELL);
    const z0 = Math.floor((Math.min(...zs) - 1) / CELL), z1 = Math.floor((Math.max(...zs) + 1) / CELL);
    for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) {
      const key = `${a},${b}`;
      const list = hash.get(key);
      if (list) list.push(poly); else hash.set(key, [poly]);
    }
  }
  return hash;
}
/** Point du polygone le plus proche, et distance. */
function nearestOn(px: number, pz: number, poly: Pt[]) {
  let best = Infinity, qx = 0, qz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]!, [bx, bz] = poly[i]!;
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
    const x = ax + t * dx, z = az + t * dz;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) { best = d; qx = x; qz = z; }
  }
  return { d: Math.sqrt(best), qx, qz };
}

export function pointInPoly(x: number, z: number, poly: Pt[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!, [xj, zj] = poly[j]!;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

export class GameSim {
  world: World;
  car: { x: number; z: number; heading: number; speed: number; steer: number; accel: number; kind: VehicleKind; color: number; aim: number; y: number; vy: number };
  /** aim : braquage demandé par le joueur, de −1 à 1, pour tourner le volant à l'écran quelle que soit la vitesse. */
  traffic: TrafficCar[] = [];
  mode: Mode = 'car';
  /** Honorable, l'acteur principal : à pied, il monte dans les véhicules et entre dans les bâtiments. */
  hero = { x: 0, z: 0, y: 0, vy: 0, base: 0, heading: 0, speed: 0, run: false, wave: 0, dance: 0 };
  /** Dernier point d'usage activé, lu par le rendu sur l'événement « use ». */
  used: string | null = null;
  private pushing = 0;
  parked: Parked[] = [];
  parkedVersion = 0;
  walkers: Walker[] = [];
  room: Room | null = null;
  /** Personnes qui marchent dans la pièce, fournies par le rendu : Honorable les contourne. */
  roomBodies: { x: number; z: number; y: number }[] = [];
  pendingRoom: { p: Pt[]; n: string | null } | null = null;
  private outside: { x: number; z: number; heading: number } | null = null;
  private roomHash = new Map<string, { p: Pt[]; n: string | null }[]>();
  engineOn = false;
  indicator: -1 | 0 | 1 = 0;
  step = 0;
  free: boolean;
  time = 0;
  hits = 0;
  reds = 0;
  signals = 0;
  speeding = 0;
  parkProgress = 0;
  result: Result | null = null;
  shake = 0;
  forced: { junction: number; group: number } | null = null;
  /** Le feu annoncé vert au joueur le reste le temps de franchir le carrefour. */
  private released: { junction: number; group: number; until: number } | null = null;
  signalTotal: number;
  private events: GameEvent[] = [];
  private accum = 0;
  private hitCooldown = 0;
  private speedCooldown = 0;
  private boundsCooldown = 0;
  private stopTimer = 0;
  private stopNear = false;
  private inBox = -1;
  private signalSeen = false;
  private indicatorTurn = 0;
  private recycle = 0;
  private rand = mulberry(90);
  private brakeHeld = false;
  private reverseArmed = false;
  private hash: Map<string, Pt[][]>;
  private noGo: Map<string, Pt[][]>;
  private heights = new Map<Pt[], number>();
  /** Aire d'atterrissage de l'hélicoptère, si la carte en a reçu une. */
  helipad: { x: number; z: number } | null = null;
  /** Nids-de-poule de la chaussée, dans la voie de circulation : ils secouent et freinent le véhicule qui roule dessus. */
  potholes: Pothole[] = [];
  private bumpCooldown = 0;
  /**
   * Anti-collision de la circulation (SMART AI pour tous les véhicules) : chaque véhicule demande une vitesse maximale sûre.
   * Absent, la circulation garde sa règle simple (s'arrêter derrière ce qui est juste devant).
   */
  safety: { tick(dt: number): void; guard(sim: GameSim, t: TrafficCar, index: number): number; heldByPlayer?(t: TrafficCar): boolean; holder?(t: TrafficCar): string | null } | null = null;
  private outEdges = new Map<number, number[]>();
  private junctionAt = new Map<number, number>();
  private spawnEdges: number[];

  constructor(world: World, free: boolean, trafficCount: number, opts: { color?: number; walkers?: number; parked?: boolean; foot?: boolean } = {}) {
    this.world = world;
    this.free = free;
    const start = (free && world.freeStart) || world.start;
    this.car = { x: start.x, z: start.z, heading: start.heading, speed: 0, steer: 0, accel: 0, kind: 'berline', color: opts.color ?? 0xecedee, aim: 0, y: 0, vy: 0 };
    this.signalTotal = world.steps.filter((s) => s.signal).length;
    const stop = world.steps.find((s) => s.kind === 'stop');
    const junction = stop?.junction !== undefined ? world.junctions[stop.junction] : undefined;
    if (!free && stop && junction) this.forced = { junction: stop.junction!, group: axisGroup(stop.heading ?? 0, junction.axis) };
    this.hash = hashPolys(world.colliders);
    this.noGo = hashPolys(world.impassable ?? []);
    world.colliders.forEach((poly, i) => this.heights.set(poly, world.colliderHeights?.[i] ?? 4));
    this.potholes = world.potholes ?? placePotholes(world);
    for (const room of world.rooms ?? []) {
      const keys = new Set<string>();
      for (const [x, z] of room.p) for (const dx of [-3, 0, 3]) for (const dz of [-3, 0, 3]) keys.add(`${Math.floor((x + dx) / CELL)},${Math.floor((z + dz) / CELL)}`);
      for (const key of keys) { const list = this.roomHash.get(key); if (list) list.push(room); else this.roomHash.set(key, [room]); }
    }
    world.edges.forEach((e, i) => { const l = this.outEdges.get(e.a); if (l) l.push(i); else this.outEdges.set(e.a, [i]); });
    world.junctions.forEach((j, i) => this.junctionAt.set(j.node, i));
    this.spawnEdges = world.edges.map((e, i) => (e.r >= 3 ? i : -1)).filter((i) => i >= 0);
    if (!this.spawnEdges.length) this.spawnEdges = world.edges.map((_, i) => i);
    for (let i = 0; i < trafficCount; i++) {
      const kind = TRAFFIC_KINDS[i % TRAFFIC_KINDS.length]!;
      const car: TrafficCar = { x: 0, z: 0, heading: 0, speed: 0, cruise: (kind === 'minibus' ? 7 : 8) + this.rand() * 3, color: COLORS[i % COLORS.length]!, targets: [], edge: 0, kind };
      this.spawn(car);
      this.traffic.push(car);
    }
    // Véhicules garés par la carte elle-même (motos du parking de l'IAI), puis quelques autres au bord des rues.
    for (const p of world.parkedExtra ?? []) this.parked.push({ ...p });
    if (opts.parked) { this.placeParked(); this.placeHeli(); }
    for (let i = 0; i < (opts.walkers ?? 0); i++) {
      const w: Walker = { x: 0, z: 0, heading: 0, speed: 0, cruise: 1.1 + this.rand() * 0.6, look: i, targets: [], edge: 0, wait: 0, phase: this.rand() * 6 };
      this.spawnWalker(w, true);
      this.walkers.push(w);
    }
    if (opts.foot) this.leaveCar();
  }

  /** Ce que le joueur contrôle : la voiture, ou Honorable à pied. */
  get focus() { return this.mode === 'car' ? this.car : this.hero; }

  /** Action possible à l'endroit où l'on se trouve : descendre, monter, entrer, sortir. */
  get action(): Action {
    if (this.result || !this.free) return null;
    if (this.mode === 'car' && this.car.kind === 'helico') return Math.abs(this.car.speed) < 1 && this.car.y < 0.3 ? { kind: 'exit', label: 'Descendre de l’hélicoptère' } : null;
    if (this.mode === 'car') return Math.abs(this.car.speed) < 1 ? { kind: 'exit', label: TWO_WHEELS.has(this.car.kind) ? `Descendre ${this.car.kind === 'scooter' ? 'du scooter' : 'de la moto'}` : 'Descendre' } : null;
    const h = this.hero;
    if (this.room) {
      const lift = this.room.lift;
      if (lift && lift.points.some(([x, z]) => Math.hypot(h.x - x, h.z - z) < 1.4)) return { kind: 'lift', label: `Ascenseur : ${floorName(this.liftTarget(lift))}` };
      let spot: Spot | null = null, near = Infinity;
      for (const s of this.room.spots ?? []) { const d = Math.hypot(h.x - s.x, h.z - s.z); if (d < s.r && d < near && s.label) { near = d; spot = s; } }
      if (spot) return { kind: 'use', label: spot.label, id: spot.id };
      return h.base < 0.5 && Math.hypot(h.x - this.room.door[0], h.z - this.room.door[1]) < 2.2 ? { kind: 'leave-room', label: 'Sortir' } : null;
    }
    const v = this.nearVehicle();
    if (v) return { kind: 'enter-car', label: VEHICLES[v.kind].board };
    const r = this.nearRoom();
    if (r) return { kind: 'enter-room', label: r.n ? `Entrer : ${r.n}` : 'Entrer dans le bâtiment' };
    return null;
  }

  act() {
    const a = this.action;
    if (!a) return;
    const h = this.hero;
    if (a.kind === 'exit') { this.leaveCar(); this.events.push('exit'); }
    else if (a.kind === 'enter-car') {
      const v = this.nearVehicle();
      if (!v) return;
      const c = this.car;
      if (v.index >= 0) {
        // Le véhicule quitté reste garé là où on le laisse.
        const p = this.parked[v.index]!;
        this.parked[v.index] = { x: c.x, z: c.z, heading: c.heading, kind: c.kind, color: c.color };
        Object.assign(c, { x: p.x, z: p.z, heading: p.heading, kind: p.kind, color: p.color, y: 0, vy: 0 });
        this.parkedVersion++;
      }
      Object.assign(c, { speed: 0, steer: 0, accel: 0 });
      this.mode = 'car';
      this.engineOn = true;
      h.speed = 0;
      this.events.push('board');
    } else if (a.kind === 'lift' && this.room?.lift) {
      // Un étage de plus à chaque appel ; du dernier, retour au rez-de-chaussée.
      h.base = this.liftTarget(this.room.lift) * this.room.lift.storey;
      h.heading += Math.PI;
      this.events.push('lift');
    } else if (a.kind === 'use') {
      this.used = a.id ?? null;
      this.events.push('use');
    } else if (a.kind === 'enter-room') {
      this.pendingRoom = this.nearRoom();
      this.events.push('room');
    } else if (this.outside) {
      Object.assign(h, this.outside, { speed: 0, base: 0 });
      this.room = null;
      this.outside = null;
      this.events.push('outside');
    }
  }

  /** Le rendu a construit la pièce : Honorable y entre, et ressortira là où il était. */
  enterRoom(room: Room) {
    const h = this.hero;
    this.outside = { x: h.x, z: h.z, heading: h.heading + Math.PI };
    this.room = room;
    this.pendingRoom = null;
    Object.assign(h, room.spawn, { speed: 0, base: 0 });
  }

  private liftTarget(lift: { storey: number; floors: number }) { return (Math.round(this.hero.base / lift.storey) + 1) % lift.floors; }

  /** Obstacles de la pièce à la hauteur où se trouve Honorable. */
  private roomSolids(r: Room) {
    const y = this.hero.base + 0.5;
    const extra = r.levels?.filter((l) => y >= l.from && y < l.to).flatMap((l) => l.solids) ?? [];
    return extra.length ? [...r.solids, ...extra] : r.solids;
  }

  wave() { if (this.mode === 'foot') { this.hero.wave = 1.6; this.hero.dance = 0; } }
  /** Danse : chaque appui passe au pas suivant, le troisième arrête ; marcher ou sauter l'interrompt. */
  dance() { if (this.mode === 'foot') this.hero.dance = (this.hero.dance + 1) % 3; }

  private leaveCar() {
    const c = this.car, h = this.hero;
    c.speed = 0;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const spec = VEHICLES[c.kind];
    const gap = TWO_WHEELS.has(c.kind) ? 1 : c.kind === 'helico' ? 2.4 : 1.75;
    // Côté conducteur d'abord, de l'autre côté si un mur l'empêche.
    const sides = [1, -1].map((s) => [c.x + fz * gap * s - fx * spec.half * 0.2, c.z - fx * gap * s - fz * spec.half * 0.2] as Pt);
    const free = sides.find(([x, z]) => !this.blocked(x, z, 0.4)) ?? sides[0]!;
    Object.assign(h, { x: free[0], z: free[1], heading: c.heading, speed: 0, y: 0, vy: 0 });
    this.mode = 'foot';
  }

  /** Un mur ou un obstacle occupe-t-il ce point ? Sert à garder la caméra hors des bâtiments. */
  solidAt(x: number, z: number) {
    if (this.room) { for (const poly of this.roomSolids(this.room)) if (pointInPoly(x, z, poly) || nearestOn(x, z, poly).d < 0.25) return true; return false; }
    for (const poly of this.hash.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) if (pointInPoly(x, z, poly) || nearestOn(x, z, poly).d < 0.25) return true;
    return false;
  }

  /** Un bâtiment masque-t-il ce point à la vue ? Seuls les volumes de 6 m de haut et 2 m de côté au moins comptent : pas les clôtures, abris, poteaux ni arbres. */
  occludes(x: number, z: number) {
    for (const poly of this.hash.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      if ((this.heights.get(poly) ?? 4) < 6 || !pointInPoly(x, z, poly)) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [px, pz] of poly) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); }
      if (x1 - x0 > 2 && z1 - z0 > 2) return true;
    }
    return false;
  }

  /** Terrain praticable : dans les limites, hors des murs et obstacles, hors de l'eau. Sert aux contournements hors chaussée. */
  drivable(x: number, z: number) {
    if (!this.world.inBounds(x, z) || this.solidAt(x, z)) return false;
    for (const poly of this.noGo.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) if (pointInPoly(x, z, poly)) return false;
    return true;
  }

  private blocked(x: number, z: number, radius: number) {
    if (!this.world.inBounds(x, z)) return true;
    for (const poly of this.hash.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) if (pointInPoly(x, z, poly) || nearestOn(x, z, poly).d < radius) return true;
    return false;
  }

  private nearVehicle() {
    const h = this.hero;
    let best: { index: number; kind: VehicleKind } | null = null, bestD = Infinity;
    const test = (x: number, z: number, kind: VehicleKind, index: number) => {
      const d = Math.hypot(h.x - x, h.z - z);
      if (d < VEHICLES[kind].half + 2.2 && d < bestD) { bestD = d; best = { index, kind }; }
    };
    test(this.car.x, this.car.z, this.car.kind, -1);
    this.parked.forEach((p, i) => test(p.x, p.z, p.kind, i));
    return best as { index: number; kind: VehicleKind } | null;
  }

  private nearRoom() {
    const h = this.hero;
    const fx = Math.sin(h.heading), fz = Math.cos(h.heading);
    let best: { p: Pt[]; n: string | null } | null = null, bestD = 1.6;
    for (const room of this.roomHash.get(`${Math.floor(h.x / CELL)},${Math.floor(h.z / CELL)}`) ?? []) {
      const { d, qx, qz } = nearestOn(h.x, h.z, room.p);
      // Il faut faire face au mur pour entrer.
      if (d < bestD && ((qx - h.x) * fx + (qz - h.z) * fz) / (d || 1) > 0.35) { bestD = d; best = room; }
    }
    return best;
  }

  /** Quelques véhicules garés au bord des rues proches du départ, que l'on peut prendre. */
  private placeParked() {
    // Les motos sont toutes dans le parking de l'IAI, à l'intérieur de sa clôture ; les rues gardent les autres véhicules.
    const kinds: VehicleKind[] = (this.world.parkedExtra ?? []).some((p) => TWO_WHEELS.has(p.kind)) ? ['sportive', 'suv', 'luxe', 'coupe', 'pickup', 'taxi', 'minibus', 'berline'] : ['sportive', 'motosport', 'suv', 'luxe', 'scooter', 'pickup', 'coupe', 'minibus', 'moto', 'berline'];
    const c = this.car;
    let placed = 0;
    const order = this.world.edges.map((e, i) => ({ i, d: Math.hypot(e.p[0]![0] - c.x, e.p[0]![1] - c.z) })).filter((o) => o.d > 6 && o.d < 320).sort((a, b) => a.d - b.d);
    for (const { i } of order) {
      if (placed >= kinds.length) break;
      const e = this.world.edges[i]!;
      const [ax, az] = e.p[0]!, [bx, bz] = e.p[1]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 30) continue;
      const kind = kinds[placed]!;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      // Rue étroite (chaussée de 4 m dans le centre de Lomé, voies à 1,8 m de l'axe : les véhicules y débordent sur
      // le bas-côté) : garé sur le bas-côté, au-delà de la place qu'occupe un véhicule qui roule dans sa voie (1 m de
      // demi-largeur) plus 0,4 m. Garé sur la voie, il ne laissait que 3,2 m pour passer : ni la circulation ni
      // SMART AI ne passaient, et toute la rue se bloquait derrière lui. Dans une rue large, il reste le long de la bordure.
      const off = e.r - e.l >= 3 ? Math.max(e.l + 0.4, e.r - (TWO_WHEELS.has(kind) ? 0.6 : 1.2)) : e.l + 1.4 + halfWidth(kind);
      const t = Math.min(len - 12, 14 + this.rand() * 8);
      const x = ax + dx * t - dz * off, z = az + dz * t + dx * off;
      const heading = Math.atan2(dx, dz);
      const half = VEHICLES[kind].half;
      if (this.blocked(x, z, 1) || this.blocked(x + dx * half, z + dz * half, 0.6) || this.blocked(x - dx * half, z - dz * half, 0.6)) continue;
      if (Math.hypot(x - c.x, z - c.z) < 8 || this.parked.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
      if (this.world.junctions.some((j) => Math.hypot(j.x - x, j.z - z) < j.r + 6)) continue;
      this.parked.push({ x, z, heading, kind, color: COLORS[(placed * 3 + 1) % COLORS.length]! });
      placed++;
    }
  }

  get stepInfo(): Step | null { return this.free || this.result ? null : this.world.steps[this.step] ?? null; }
  get liveScore() { return Math.max(0, Math.round(1000 + this.signals * 100 - this.hits * 50 - this.reds * 100 - this.speeding * 10)); }
  drain() { const e = this.events; this.events = []; return e; }
  emitEvent(e: GameEvent) { this.events.push(e); }
  startEngine() { if (this.engineOn) return; this.engineOn = true; if (!this.free && this.step === 0) this.step = 1; }
  setIndicator(side: -1 | 1) { this.indicator = this.indicator === side ? 0 : side; this.indicatorTurn = 0; }
  continueFree() { this.free = true; this.result = null; this.forced = null; }

  lightAt(index: number, heading: number): LightColor {
    const j = this.world.junctions[index]!;
    const group = axisGroup(heading, j.axis);
    if (this.forced?.junction === index) return group === this.forced.group ? 'red' : 'green';
    if (this.released?.junction === index && this.time < this.released.until) return group === this.released.group ? 'green' : 'red';
    const p = (this.time + index * 3.7) % 18;
    const q = group === 0 ? p : (p + 9) % 18;
    return q < 7 ? 'green' : q < 8.5 ? 'amber' : 'red';
  }

  update(dt: number, input: Input) {
    this.accum = Math.min(this.accum + dt, 0.1);
    while (this.accum >= 1 / 60) { this.tick(1 / 60, input); this.accum -= 1 / 60; }
  }

  private tick(dt: number, input: Input) {
    if (!this.result) this.time += dt;
    this.hitCooldown -= dt;
    this.speedCooldown -= dt;
    this.boundsCooldown -= dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.hero.wave = Math.max(0, this.hero.wave - dt);
    if (this.mode === 'car' && this.car.kind === 'helico') {
      const n = Math.max(1, Math.ceil((Math.abs(this.car.speed) * dt) / 0.6));
      for (let i = 0; i < n; i++) this.fly(dt / n, input);
    } else if (this.mode === 'car') {
      // À grande vitesse, plusieurs petits pas : la voiture ne traverse ni mur ni clôture.
      const n = Math.max(1, Math.ceil((Math.abs(this.car.speed) * dt) / 0.4));
      for (let i = 0; i < n; i++) {
        const px = this.car.x, pz = this.car.z;
        this.drive(dt / n, input);
        this.collide(px, pz);
      }
      this.bumps(dt);
      this.rules(dt);
      if (!this.free && !this.result) this.mission(dt);
    } else this.walk(dt, input);
    this.updateTraffic(dt);
    this.updateWalkers(dt);
  }

  private walk(dt: number, input: Input) {
    const h = this.hero;
    const forward = input.throttle - input.brake;
    // Maintenir « avancer » plus de 3 secondes fait courir Honorable.
    this.pushing = forward > 0 ? this.pushing + dt : 0;
    h.run = (!!input.run || this.pushing > 3) && forward > 0;
    if (forward || input.jump || input.steer) h.dance = 0;
    const target = forward > 0 ? forward * (h.run ? RUN : WALK) : forward * 1.4;
    h.speed += (target - h.speed) * Math.min(1, dt * 8);
    if (!forward && Math.abs(h.speed) < 0.03) h.speed = 0;
    h.heading -= input.steer * (h.run ? 2.2 : 2.8) * dt;
    if (input.jump && h.y <= 0 && h.vy <= 0) h.vy = 4.4;
    if (h.y > 0 || h.vy > 0) {
      h.y += h.vy * dt;
      h.vy -= 13 * dt;
      if (h.y <= 0) { h.y = 0; h.vy = 0; }
    }
    const px = h.x, pz = h.z;
    h.x += Math.sin(h.heading) * h.speed * dt;
    h.z += Math.cos(h.heading) * h.speed * dt;
    const shove = (nx: number, nz: number, push: number) => { h.x += nx * push; h.z += nz * push; };
    if (this.room) {
      const r = this.room;
      for (const poly of this.roomSolids(r)) this.pushPoly(h.x, h.z, 0.35, poly, shove);
      for (const b of this.roomBodies) {
        if (Math.abs(b.y - h.base) > 1) continue;
        const dx = h.x - b.x, dz = h.z - b.z, d = Math.hypot(dx, dz);
        if (d < 0.7 && d > 1e-4) shove(dx / d, dz / d, 0.7 - d);
      }
      h.x = Math.max(r.x0 + 0.4, Math.min(r.x1 - 0.4, h.x));
      h.z = Math.max(r.z0 + 0.4, Math.min(r.z1 - 0.4, h.z));
      if (r.ground) {
        // Une marche trop haute arrête Honorable ; sinon il suit le sol, escaliers compris.
        const g = r.ground(h.x, h.z, h.base);
        if (g - h.base > 0.5) { h.x = px; h.z = pz; } else h.base = g;
      }
      return;
    }
    if (!this.world.inBounds(h.x, h.z)) { h.x = px; h.z = pz; }
    this.pushOut(h.x, h.z, 0.35, shove);
    const circle = (x: number, z: number, r: number) => {
      const dx = h.x - x, dz = h.z - z, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) shove(dx / d, dz / d, r - d);
    };
    const body = (x: number, z: number, heading: number, kind: VehicleKind) => {
      const s = VEHICLES[kind], fx = Math.sin(heading), fz = Math.cos(heading);
      circle(x + fx * s.half, z + fz * s.half, s.radius + 0.35);
      circle(x - fx * s.half, z - fz * s.half, s.radius + 0.35);
    };
    for (const b of this.roomBodies) circle(b.x, b.z, 0.7);
    if (this.car.y < 2) body(this.car.x, this.car.z, this.car.heading, this.car.kind);
    for (const p of this.parked) body(p.x, p.z, p.heading, p.kind);
    for (const t of this.traffic) body(t.x, t.z, t.heading, t.kind);
    for (const w of this.walkers) circle(w.x, w.z, 0.7);
  }

  private drive(dt: number, input: Input) {
    const c = this.car;
    const spec = VEHICLES[c.kind];
    const throttle = this.engineOn ? input.throttle : 0;
    const before = c.speed;
    let a = 0;
    // La poussée faiblit près de la vitesse maximale ; la résistance de l'air reste faible pour l'atteindre.
    if (c.speed >= -0.1) a += throttle * spec.accel * (1 - Math.min(1, (Math.max(c.speed, 0) / spec.max) ** 3));
    else a += throttle * 8;
    if (input.brake > 0) {
      if (c.speed > 0.15) a -= input.brake * 9;
      else if (this.engineOn && this.reverseArmed && c.speed > -6) a -= input.brake * 2.8;
      else if (!this.reverseArmed) { a = 0; c.speed = 0; }
    }
    // Le frein immobilise la voiture ; la marche arrière demande de le relâcher, puis d'appuyer de nouveau.
    if (input.brake > 0 && !this.brakeHeld && Math.abs(c.speed) < 0.15) this.reverseArmed = true;
    if (!input.brake) this.reverseArmed = false;
    this.brakeHeld = input.brake > 0;
    a -= c.speed * (c.speed > 14 ? 0.012 : 0.045) + Math.sign(c.speed) * 0.12;
    // Pied au plancher, la poussée compense la résistance de l'air : la vitesse maximale est atteinte.
    if (c.speed > 14) a += throttle * (Math.min(c.speed, spec.max) * 0.012 + 0.12);
    c.speed += a * dt;
    if (Math.abs(c.speed) < 0.05 && !throttle && !input.brake) c.speed = 0;
    if (before > 0 && c.speed < 0 && input.brake > 0 && before > 0.15) c.speed = 0;
    c.accel += ((c.speed - before) / dt - c.accel) * Math.min(1, dt * 6);

    const v = Math.abs(c.speed);
    const max = steerLimit(c.kind, v);
    c.aim += (input.steer - c.aim) * Math.min(1, dt * 7);
    c.steer += (input.steer * max - c.steer) * Math.min(1, dt * 7);
    const turn = (c.speed / spec.wheelbase) * Math.tan(c.steer) * dt;
    c.heading -= turn;
    c.x += Math.sin(c.heading) * c.speed * dt;
    c.z += Math.cos(c.heading) * c.speed * dt;

    if (this.indicator) {
      this.indicatorTurn += Math.abs(turn);
      if (this.indicatorTurn > 1 && Math.abs(c.steer) < 0.05) this.indicator = 0;
    }
  }

  /** Cercle contre polygone : repousse hors du polygone le plus proche, sur une grille pour rester rapide. */
  private pushOut(px: number, pz: number, radius: number, apply: (nx: number, nz: number, push: number) => void) {
    const list = this.hash.get(`${Math.floor(px / CELL)},${Math.floor(pz / CELL)}`);
    if (!list) return;
    for (const poly of list) this.pushPoly(px, pz, radius, poly, apply);
  }

  private pushPoly(px: number, pz: number, radius: number, poly: Pt[], apply: (nx: number, nz: number, push: number) => void) {
    const { d, qx, qz } = nearestOn(px, pz, poly);
    const isInside = pointInPoly(px, pz, poly);
    if (!isInside && d >= radius) return;
    let nx = px - qx, nz = pz - qz;
    if (d > 1e-4) { nx /= d; nz /= d; } else { nx = -Math.sin(this.focus.heading); nz = -Math.cos(this.focus.heading); }
    if (isInside) { nx = -nx; nz = -nz; }
    apply(nx, nz, isInside ? radius + d : radius - d);
  }

  /** Une roue dans un nid-de-poule : secousse, et un peu de vitesse perdue. */
  private bumps(dt: number) {
    this.bumpCooldown -= dt;
    if (this.bumpCooldown > 0) return;
    const c = this.car, spec = VEHICLES[c.kind], w = halfWidth(c.kind) * 0.85;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    for (const p of this.potholes) {
      if (Math.abs(p.x - c.x) > 4 || Math.abs(p.z - c.z) > 4) continue;
      for (const [a, l] of [[spec.wheelbase / 2, w], [spec.wheelbase / 2, -w], [-spec.wheelbase / 2, w], [-spec.wheelbase / 2, -w]] as const) {
        const wx = c.x + fx * a - fz * l, wz = c.z + fz * a + fx * l;
        if (Math.hypot(wx - p.x, wz - p.z) > p.r) continue;
        const v = Math.abs(c.speed);
        this.shake = Math.min(1, Math.max(this.shake, 0.15 + v / 30));
        if (v > 6) c.speed *= 0.88;
        if (v > 3) this.events.push('nid');
        this.bumpCooldown = 0.5;
        return;
      }
    }
  }

  /** Hauteur sur laquelle l'hélicoptère se pose ici : le sol, ou le toit d'un bâtiment qu'il survole. */
  private groundAt(x: number, z: number, below: number) {
    let g = 0;
    for (const poly of this.hash.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const h = this.heights.get(poly) ?? 4;
      if (h <= below + 0.6 && h > g && pointInPoly(x, z, poly)) g = h;
    }
    return g;
  }

  /**
   * Vol de l'hélicoptère : montée et descente, avance et recul, rotation sur place.
   * Il ne bouge à l'horizontale qu'une fois décollé ; il contourne ce qui est plus haut que lui et se pose sur ce qu'il survole.
   */
  private fly(dt: number, input: Input) {
    const c = this.car, spec = VEHICLES.helico;
    const lift = this.engineOn ? Math.max(-1, Math.min(1, input.lift ?? 0)) : -0.6;
    c.vy += (lift * 8 - c.vy) * Math.min(1, dt * 2.5);
    c.y = Math.min(180, c.y + c.vy * dt);
    const ground = this.groundAt(c.x, c.z, c.y);
    if (c.y <= ground) { c.y = ground; c.vy = Math.max(0, c.vy); }
    const airborne = c.y - ground > 0.5;
    const fwd = airborne ? input.throttle - input.brake : 0;
    const before = c.speed;
    const target = fwd > 0 ? fwd * spec.max : fwd * 14;
    c.speed += (target - c.speed) * Math.min(1, dt * (fwd ? 0.45 : 0.7));
    if (!airborne) c.speed *= Math.max(0, 1 - dt * 5);
    c.accel += ((c.speed - before) / dt - c.accel) * Math.min(1, dt * 4);
    c.aim += (input.steer - c.aim) * Math.min(1, dt * 5);
    c.steer = c.aim * 0.35;
    if (this.engineOn) c.heading -= c.aim * (airborne ? 1.25 : 0.7) * dt;
    const px = c.x, pz = c.z;
    c.x += Math.sin(c.heading) * c.speed * dt;
    c.z += Math.cos(c.heading) * c.speed * dt;
    if (!this.world.inBounds(c.x, c.z)) {
      c.x = px; c.z = pz; c.speed *= 0.5;
      if (this.boundsCooldown <= 0) { this.boundsCooldown = 5; this.events.push('bounds'); }
    }
    // Seul ce qui dépasse l'hélicoptère l'arrête, rotor compris.
    for (const poly of this.hash.get(`${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`) ?? []) {
      if ((this.heights.get(poly) ?? 4) <= c.y + 0.3) continue;
      this.pushPoly(c.x, c.z, spec.radius, poly, (nx, nz, push) => this.impact(nx, nz, push));
    }
  }

  /** Aire d'atterrissage dégagée près du départ, à l'écart des rues et des bâtiments ; l'hélicoptère y attend. */
  private placeHeli() {
    const c = this.car;
    const [hx, hz] = this.world.helipad ?? [c.x, c.z];
    const clear = (x: number, z: number) => {
      if (!this.world.inBounds(x, z)) return false;
      for (let k = 0; k < 9; k++) {
        const a = (k / 8) * Math.PI * 2, r = k ? 7 : 0;
        if (this.blocked(x + Math.cos(a) * r, z + Math.sin(a) * r, 0.5)) return false;
      }
      for (const e of this.world.edges) for (let i = 1; i < e.p.length; i++) {
        const [ax, az] = e.p[i - 1]!, [bx, bz] = e.p[i]!;
        const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - ax - t * dx, z - az - t * dz) < Math.max(Math.abs(e.l), Math.abs(e.r)) + 5) return false;
      }
      return !this.parked.some((p) => Math.hypot(p.x - x, p.z - z) < 9);
    };
    for (let r = this.world.helipad ? 0 : 18; r < 260; r += 6) for (let k = 0; k < (r ? 24 : 1); k++) {
      const a = (k / 24) * Math.PI * 2, x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      if (!clear(x, z)) continue;
      this.parked.push({ x, z, heading: c.heading, kind: 'helico', color: 0xd8322a });
      this.helipad = { x, z };
      return;
    }
  }

  private collide(px: number, pz: number) {
    const c = this.car;
    const spec = VEHICLES[c.kind];
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    if (!this.world.inBounds(c.x, c.z)) {
      c.x = px; c.z = pz; c.speed *= 0.5;
      if (this.boundsCooldown <= 0) { this.boundsCooldown = 5; this.events.push('bounds'); }
    }
    const hit = (nx: number, nz: number, push: number) => this.impact(nx, nz, push);
    this.pushOut(c.x + fx * spec.half, c.z + fz * spec.half, spec.radius, hit);
    this.pushOut(c.x - fx * spec.half, c.z - fz * spec.half, spec.radius, hit);
    const against = (x: number, z: number, r: number, event: GameEvent = 'hit') => {
      for (const s of [1, -1]) {
        const dx = c.x + fx * spec.half * s - x, dz = c.z + fz * spec.half * s - z;
        const d = Math.hypot(dx, dz);
        if (d < r && d > 1e-4) this.impact(dx / d, dz / d, r - d, event);
      }
    };
    for (const t of this.traffic) against(t.x, t.z, spec.radius + VEHICLES[t.kind].radius + 0.2);
    for (const p of this.parked) {
      const s = VEHICLES[p.kind], px2 = Math.sin(p.heading) * s.half, pz2 = Math.cos(p.heading) * s.half;
      against(p.x + px2, p.z + pz2, spec.radius + s.radius);
      against(p.x - px2, p.z - pz2, spec.radius + s.radius);
    }
    for (const w of this.walkers) against(w.x, w.z, spec.radius + 0.35, 'walker');
  }

  private impact(nx: number, nz: number, push: number, event: GameEvent = 'hit') {
    const c = this.car;
    c.x += nx * push;
    c.z += nz * push;
    const into = (Math.sin(c.heading) * nx + Math.cos(c.heading) * nz) * c.speed;
    if (into >= 0) return;
    if (-into > 2 && this.hitCooldown <= 0) {
      this.hitCooldown = 1.2;
      this.hits++;
      this.shake = Math.min(1, -into / 10);
      this.events.push(event);
    }
    c.speed *= -into > 2 ? -0.25 : 0.7;
  }

  private rules(dt: number) {
    const c = this.car;
    // Conduite libre : pas de limitation de vitesse ; le parcours guidé garde ses 50 km/h.
    if (!this.free && c.speed > LIMIT + 5 / 3.6) {
      this.speeding += dt;
      if (this.speedCooldown <= 0) { this.speedCooldown = 6; this.events.push('speed'); }
    }
    let box = -1;
    this.world.junctions.forEach((j, i) => { if (Math.hypot(c.x - j.x, c.z - j.z) < j.r) box = i; });
    if (box >= 0 && box !== this.inBox && Math.abs(c.speed) > 1.5 && this.lightAt(box, c.heading) === 'red') {
      this.reds++;
      this.events.push('red');
    }
    this.inBox = box;
  }

  private mission(dt: number) {
    const s = this.world.steps[this.step];
    if (!s) return;
    const c = this.car;
    if (s.signal && this.indicator === s.signal) this.signalSeen = true;
    if (s.kind === 'gate' && Math.hypot(c.x - s.x, c.z - s.z) < 10) {
      if (s.signal && this.signalSeen) { this.signals++; this.events.push('signal'); } else this.events.push('gate');
      this.next();
    } else if (s.kind === 'stop') {
      const j = this.world.junctions[s.junction ?? -1];
      if (!j) { this.next(); return; }
      const d = Math.hypot(c.x - j.x, c.z - j.z);
      if (d < 55) this.stopNear = true;
      if (d < 55 && d > j.r && Math.abs(c.speed) < 0.4) this.stopTimer += dt;
      if (this.stopTimer > 2) {
        if (this.forced) this.released = { junction: this.forced.junction, group: this.forced.group, until: this.time + 15 };
        this.forced = null;
        this.events.push('green');
        this.next();
        return;
      }
      // Feu grillé ou détour : le parcours reprend sans bloquer le joueur.
      if (d < j.r || (this.stopNear && d > 80)) { this.forced = null; this.next(); }
    } else if (s.kind === 'park') {
      const { park } = this.world;
      const dx = c.x - park.x, dz = c.z - park.z;
      const fx = Math.sin(park.heading), fz = Math.cos(park.heading);
      const fits = Math.abs(dx * fx + dz * fz) < park.halfL && Math.abs(dx * fz - dz * fx) < park.halfW && Math.abs(Math.cos(c.heading - park.heading)) > 0.82;
      this.parkProgress = fits && Math.abs(c.speed) < 0.3 ? Math.min(1, this.parkProgress + dt / 2) : 0;
      if (this.parkProgress >= 1) this.finish();
    }
  }

  private next() { this.step++; this.signalSeen = false; this.stopNear = false; }

  private finish() {
    const timeBonus = Math.max(0, Math.round(200 - Math.max(0, this.time - 75) * 2));
    const score = this.liveScore + timeBonus;
    const top = 1000 + this.signalTotal * 50;
    this.result = { score, stars: score >= top ? 3 : score >= top - 300 ? 2 : 1, time: this.time, hits: this.hits, reds: this.reds, signals: this.signals, signalTotal: this.signalTotal, speeding: this.speeding };
    this.events.push('done');
  }

  /** Décale le tracé d'une rue vers la voie de droite ; à la fin de l'arête, le prochain carrefour choisit la suite. */
  private follow(car: TrafficCar, index: number) {
    const e = this.world.edges[index]!;
    car.edge = index;
    // Un dépassement en cours s'achève avec la rue : dans la suivante, le véhicule reprend sa voie.
    if (car.passing) { car.aside = (car.aside ?? 0) - car.passing.by; car.passing = null; }
    car.parkedT = 0;
    car.targets = e.p.slice(1).map((q, i) => {
      const prev = e.p[i]!;
      const len = Math.hypot(q[0] - prev[0], q[1] - prev[1]) || 1;
      const dx = (q[0] - prev[0]) / len, dz = (q[1] - prev[1]) / len;
      return [q[0] - dz * e.l, q[1] + dx * e.l] as Pt;
    });
    // Point d'entrée dans la voie, 6 m après le carrefour : sans lui, le véhicule visait directement le bout de la rue,
    // parfois à 70 m, et roulait en biais au milieu de la chaussée tout du long. Vu dans les rues étroites de Lomé :
    // il barrait la route à la voiture d'en face, et les deux restaient bloquées.
    const [a0, a1] = [e.p[0]!, e.p[1]!], first = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
    if (first > 15 && e.l > 0) {
      const dx = (a1[0] - a0[0]) / first, dz = (a1[1] - a0[1]) / first;
      car.targets.unshift([a0[0] + dx * 6 - dz * e.l, a0[1] + dz * 6 + dx * e.l]);
    }
    // Rangé sur le côté quand il change de rue : il le reste dans la nouvelle.
    if (car.aside) { const a = car.aside; car.aside = 0; this.shiftLane(car, Math.min(a, this.asideRoom(car)), false); }
  }

  /** Décale les points de la voie restants vers le bord droit (positif) ou les ramène (négatif), en passant par un point « ahead » m devant. */
  private shiftLane(car: TrafficCar, by: number, glide = true, ahead = 10) {
    if (Math.abs(by) < 0.05) return;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    let px = car.x, pz = car.z;
    car.targets = car.targets.map((q) => {
      const len = Math.hypot(q[0] - px, q[1] - pz) || 1;
      const dx = (q[0] - px) / len, dz = (q[1] - pz) / len;
      px = q[0]; pz = q[1];
      return [q[0] - dz * by, q[1] + dx * by] as Pt;
    });
    car.aside = (car.aside ?? 0) + by;
    // Les points d'une rue droite sont parfois à des centaines de mètres : sans ce point proche, le véhicule ne glisserait presque pas.
    if (glide) {
      car.merge = [car.x + fx * ahead - fz * by, car.z + fz * ahead + fx * by];
      car.targets.unshift(car.merge);
    }
  }

  /**
   * Place pour se ranger à droite : jusqu'au bord de la chaussée, et jusqu'à 1,2 m sur le bas-côté s'il est praticable
   * (ni mur, ni eau) sur les 15 m qui suivent.
   */
  private asideRoom(car: TrafficCar) {
    const e = this.world.edges[car.edge];
    if (!e) return 0;
    const hw = halfWidth(car.kind);
    const onRoad = Math.max(0, e.r - e.l - hw - 0.25);
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    // Bord droit du sens de marche : même côté que le décalage de la voie.
    const sx = -fz, sz = fx;
    const shoulderOk = (extra: number) => [0, 5, 10, 15].every((d) => this.drivable(car.x + fx * d + sx * (onRoad + extra + hw), car.z + fz * d + sz * (onRoad + extra + hw)));
    return onRoad + (shoulderOk(1.2) ? 1.2 : shoulderOk(0.6) ? 0.6 : 0);
  }

  /**
   * Coup de klaxon du joueur : les véhicules de la circulation devant lui, dans son sens, à moins de 40 m,
   * se rangent à droite et s'arrêtent le temps qu'il passe (8 s au plus), puis reprennent leur voie.
   * Renvoie le nombre de véhicules qui se rangent.
   */
  honk() {
    if (this.mode !== 'car' || this.room || this.car.y > 2) return 0;
    const c = this.car, fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let n = 0;
    for (const t of this.traffic) {
      const dx = t.x - c.x, dz = t.z - c.z;
      const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      // Devant, dans la même voie ou la voisine, et dans le même sens (pas ceux qui arrivent en face).
      if (ahead < 2 || ahead > 40 || side > 4.5 || Math.cos(wrap(t.heading - c.heading)) < 0.5) continue;
      if (!t.yieldT || t.yieldT <= 0) this.shiftLane(t, this.asideRoom(t) - (t.aside ?? 0));
      t.yieldT = 8;
      n++;
    }
    return n;
  }

  private spawn(car: TrafficCar) {
    const c = this.focus;
    for (let tries = 0; tries < 40; tries++) {
      const index = this.spawnEdges[Math.floor(this.rand() * this.spawnEdges.length)]!;
      const e = this.world.edges[index]!;
      const [x, z] = e.p[0]!, q = e.p[1]!;
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < 45 || d > 330) continue;
      const len = Math.hypot(q[0] - x, q[1] - z) || 1;
      const sx = x - ((q[1] - z) / len) * e.l, sz = z + ((q[0] - x) / len) * e.l;
      // Jamais sur un autre véhicule : deux voitures nées au même endroit resteraient bloquées nez à nez.
      const taken = (ox: number, oz: number) => Math.hypot(ox - sx, oz - sz) < 9;
      if (this.traffic.some((o) => o !== car && taken(o.x, o.z)) || this.parked.some((p) => taken(p.x, p.z)) || taken(this.car.x, this.car.z)) continue;
      car.x = sx;
      car.z = sz;
      car.heading = Math.atan2(q[0] - x, q[1] - z);
      car.speed = 0;
      this.follow(car, index);
      return;
    }
    // Aucune place libre : le véhicule attend hors de vue ; il sera replacé à la prochaine vérification.
    Object.assign(car, { x: c.x + 5000, z: c.z + 5000, speed: 0, targets: [] });
  }

  private updateTraffic(dt: number) {
    const c = this.focus;
    this.recycle -= dt;
    const recycle = this.recycle <= 0;
    if (recycle) this.recycle = 1;
    this.safety?.tick(dt);
    for (const [index, t] of this.traffic.entries()) {
      // Les voitures trop loin reviennent près du joueur : la rue reste vivante avec peu de véhicules.
      if (recycle && Math.hypot(t.x - c.x, t.z - c.z) > 380) { this.spawn(t); continue; }
      // En attente de place, hors de vue : il ne roule pas.
      if (Math.abs(t.x - c.x) > 4000) continue;
      // Figé depuis plus de 25 s (embouteillage sans issue), loin du joueur ou derrière lui : replacé ailleurs,
      // pour que la ville reste fluide. Jamais sous les yeux du joueur.
      t.stillT = Math.abs(t.speed) < 0.2 ? (t.stillT ?? 0) + dt : 0;
      if (recycle && t.stillT > 25) {
        const dx = t.x - c.x, dz = t.z - c.z;
        if (Math.hypot(dx, dz) > 60 || dx * Math.sin(c.heading) + dz * Math.cos(c.heading) < -10) { t.stillT = 0; this.spawn(t); continue; }
      }
      const target = t.targets[0];
      if (!target) {
        const e = this.world.edges[t.edge]!;
        const out = this.outEdges.get(e.b) ?? [];
        const options = out.filter((i) => this.world.edges[i]!.b !== e.a);
        const list = options.length ? options : out;
        if (!list.length) { this.spawn(t); continue; }
        this.follow(t, list[Math.floor(this.rand() * list.length)]!);
        continue;
      }
      const dist = Math.hypot(target[0] - t.x, target[1] - t.z);
      let want = t.cruise;
      if (t.targets.length === 1) {
        const index = this.junctionAt.get(this.world.edges[t.edge]!.b);
        if (index !== undefined) {
          const j = this.world.junctions[index]!;
          const toCentre = Math.hypot(j.x - t.x, j.z - t.z);
          if (toCentre > j.r && toCentre < j.r + 22 && this.lightAt(index, t.heading) !== 'green') want = Math.min(want, Math.max(0, (toCentre - j.r - 2) * 0.6));
        }
        if (dist < 14) want = Math.min(want, 6.5);
      }
      const fx = Math.sin(t.heading), fz = Math.cos(t.heading);
      const blockedBy = (x: number, z: number) => {
        const dx = x - t.x, dz = z - t.z;
        const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
        return ahead > 0 && ahead < 11 && side < 2.1 ? ahead : Infinity;
      };
      // L'hélicoptère en vol ne bloque pas la circulation.
      let gap = this.car.y > 2 ? Infinity : blockedBy(this.car.x, this.car.z);
      if (this.mode === 'foot' && !this.room) gap = Math.min(gap, blockedBy(this.hero.x, this.hero.z));
      for (const o of this.traffic) if (o !== t) gap = Math.min(gap, blockedBy(o.x, o.z));
      for (const w of this.walkers) gap = Math.min(gap, blockedBy(w.x, w.z));
      for (const p of this.parked) gap = Math.min(gap, blockedBy(p.x, p.z));
      // Avec l'anti-collision SMART AI, elle seule décide : elle voit tout ce que voit la règle simple, et règle les priorités.
      if (this.safety) want = Math.min(want, this.safety.guard(this, t, index));
      else if (gap < 11) want = Math.min(want, Math.max(0, (gap - 5) * 1.2));
      // Véhicule garé sur la voie : après 3 s d'arrêt derrière lui, dépassement par la gauche si la voie d'en face est libre,
      // puis retour dans sa voie une fois dépassé. Sans cela, la file restait bloquée derrière lui pour toujours.
      // La voiture du joueur arrêtée devant, dans le même sens, se dépasse de la même façon (face à face, c'est le recul ci-dessous).
      const holder = this.safety?.holder?.(t) ?? null;
      const playerStill = holder === 'joueur' && Math.abs(this.car.speed) < 0.3 && Math.cos(wrap(this.car.heading - t.heading)) >= 0.5;
      t.parkedT = (holder?.startsWith('gare-') || playerStill) && t.speed < 0.3 ? (t.parkedT ?? 0) + dt : 0;
      if (!t.passing && !t.yieldT && t.parkedT > (playerStill ? 5 : 3)) {
        const p = playerStill ? this.car : this.parked[Number(holder!.slice(5))];
        if (p) this.startPass(t, p);
      }
      // Deux véhicules de la circulation face à face, chacun arrêté pour l'autre (rue étroite, dépassement croisé) :
      // vu dans Lomé, une moto et un fourgon s'attendaient sans fin. Au bout de 4 s, celui de plus grand indice
      // contourne l'autre s'il a la place, sinon il recule un peu pour lui laisser passer.
      const otherIndex = holder?.startsWith('vehicule-') ? Number(holder.slice(9)) : -1;
      const other = otherIndex >= 0 ? this.traffic[otherIndex] : undefined;
      const mutual = !!other && t.speed < 0.3 && Math.abs(other.speed) < 0.3 && this.safety?.holder?.(other) === `vehicule-${index}`
        && Math.cos(wrap(other.heading - t.heading)) < -0.3;
      t.deadT = mutual ? (t.deadT ?? 0) + dt : 0;
      if (mutual && t.deadT > 4 && index > otherIndex && !t.passing && !t.backT) {
        // Trop près pour braquer autour de lui : d'abord reculer de 3 m, puis contourner.
        if (bodyGap(t, other!) > 2.5) this.startPass(t, other!);
        if (!t.passing) { t.backT = 3; t.passAfterBack = otherIndex; }
        t.deadT = 0;
      }
      if (t.passing) {
        const P = t.passing;
        P.t += dt;
        const along = (P.x - t.x) * fx + (P.z - t.z) * fz;
        if (along < -(VEHICLES[t.kind].half + 6) || P.t > 25) { this.shiftLane(t, -P.by); t.passing = null; }
      }
      // Klaxonné : il se range (au pas le temps de se décaler), s'arrête, et repart une fois dépassé par le joueur.
      if (t.yieldT !== undefined && t.yieldT > 0) {
        t.yieldT -= dt;
        const dx = this.car.x - t.x, dz = this.car.z - t.z;
        const passed = this.mode !== 'car' || dx * fx + dz * fz > 7;
        if (passed || t.yieldT <= 0) { t.yieldT = 0; this.shiftLane(t, -(t.aside ?? 0)); }
        else {
          // Au pas jusqu'au point de rangement, puis arrêt.
          want = Math.min(want, t.merge && t.targets[0] === t.merge ? 2.5 : 0);
        }
      }
      // Face à face avec la voiture du joueur, arrêtée elle aussi : chacun attend l'autre, sans fin. Au bout de 6 s,
      // le véhicule recule au pas (3 s au plus, 3 m environ) si la place derrière lui est libre, comme un conducteur qui laisse passer.
      // Jamais dans une file : derrière la voiture du joueur, dans le même sens, on attend simplement qu'elle reparte.
      // Bloqué par le joueur : son anti-collision le dit, ou il vient de buter contre la voiture du joueur
      // (dans un virage, l'anti-collision peut ne pas la voir sur sa trajectoire ; seule la carrosserie l'arrête).
      const held = t.speed < 0.3 && Math.abs(this.car.speed) < 0.3 && this.mode === 'car' && Math.cos(wrap(this.car.heading - t.heading)) < 0.5
        && (!!t.pressed || (this.safety?.heldByPlayer?.(t) ?? blockedBy(this.car.x, this.car.z) < 11));
      t.facingT = held ? (t.facingT ?? 0) + dt : 0;
      if (t.facingT > 6 && !t.backT) { t.backT = 3; t.facingT = 0; }
      if (t.backT) {
        t.backT = Math.max(0, t.backT - dt);
        if (t.backT > 0 && this.clearBehind(t)) {
          const before = { x: t.x, z: t.z, heading: t.heading };
          t.speed = -1;
          t.x += Math.sin(t.heading) * t.speed * dt;
          t.z += Math.cos(t.heading) * t.speed * dt;
          if (!this.intoPlayer(before, t)) continue;
          Object.assign(t, before);
        }
        t.backT = 0;
        t.speed = 0;
        if (t.passAfterBack !== undefined) {
          const o = this.traffic[t.passAfterBack];
          t.passAfterBack = undefined;
          if (o) this.startPass(t, o);
          continue;
        }
        t.gaveWay = true;
        continue;
      }
      // Place laissée : on ne revient pas se coller au joueur tant qu'il n'a pas bougé (sinon, aller-retour sans fin).
      // Si le joueur ne repart toujours pas au bout de 8 s, il est traité comme un véhicule garé : on le contourne.
      if (t.gaveWay) {
        t.gaveT = (t.gaveT ?? 0) + dt;
        // Le joueur qui avance vers lui ne lève pas la place laissée : vu dans Lomé, SMART AI avançait de 2 m, le véhicule
        // se croyait libre, revenait, et le face-à-face recommençait toutes les 11 s pendant deux minutes.
        // On repart quand le joueur est passé à notre hauteur ou s'est éloigné ; tant qu'il roule, on l'attend.
        const pdx = this.car.x - t.x, pdz = this.car.z - t.z;
        const passedBy = pdx * fx + pdz * fz < 0, away = Math.hypot(pdx, pdz) > 20;
        if (passedBy || away) { t.gaveWay = false; t.gaveT = 0; t.backs = 0; }
        else {
          if (Math.abs(this.car.speed) > 0.5) t.gaveT = 0;
          // Toujours sur le chemin du joueur, arrêté devant nous : dans une rue étroite, 3 m ne suffisent pas toujours.
          // On recule encore, 3 fois au plus, si la place derrière est libre. Vu dans Lomé : chacun attendait l'autre,
          // puis SMART AI faisait demi-tour.
          if (t.gaveT > 4 && (t.backs ?? 0) < 3 && Math.abs(this.car.speed) < 0.5 && this.safety?.heldByPlayer?.(t) && this.clearBehind(t)) {
            t.backs = (t.backs ?? 0) + 1; t.backT = 3; t.gaveWay = false; t.gaveT = 0;
            continue;
          }
          if (t.gaveT > 8 && !t.passing) this.startPass(t, this.car);
          if (t.passing) { t.gaveWay = false; t.gaveT = 0; }
          else { t.speed = 0; t.facingT = 0; continue; }
        }
      }
      // Pour ralentir, la consigne est suivie exactement (8 m/s² au plus) : une réponse proportionnelle ne la rattrapait
      // jamais, et le véhicule glissait jusqu'à 20 cm de l'obstacle au lieu de s'arrêter 3 m avant.
      if (want < t.speed) t.speed = Math.max(want, t.speed - 8 * dt);
      else t.speed += Math.min(2.5, (want - t.speed) * 2) * dt;
      const aim = Math.atan2(target[0] - t.x, target[1] - t.z);
      const before = { x: t.x, z: t.z, heading: t.heading };
      t.heading += Math.max(-1.8 * dt, Math.min(1.8 * dt, wrap(aim - t.heading))) * Math.min(1, t.speed / 2);
      t.x += Math.sin(t.heading) * t.speed * dt;
      t.z += Math.cos(t.heading) * t.speed * dt;
      t.pressed = this.intoPlayer(before, t);
      // De même entre véhicules de la circulation : vu dans Lomé, un SUV qui tournait à gauche ne voyait une moto arrêtée
      // qu'à 2 m ; une fois les carrosseries au contact, son anti-collision ne la voyait plus et il repartait à travers elle.
      if (t.pressed || this.intoTraffic(before, t)) { Object.assign(t, before); t.speed = 0; }
      // Le point de rangement est atteint au plus près, pour que le véhicule soit vraiment sur le côté.
      if (dist < (target === t.merge ? 0.6 : 2.5)) t.targets.shift();
    }
  }

  /**
   * Contourner le véhicule « p » qui bloque (garé, ou voiture du joueur arrêtée) : par la gauche ou par la droite,
   * du côté qui demande le moindre décalage pour garder 0,5 m entre les carrosseries ; seulement si tout le passage
   * est praticable (ni mur, ni eau) et si personne n'arrive en face dans le couloir visé sur 40 m de plus.
   */
  private startPass(t: TrafficCar, p: { x: number; z: number; heading: number; kind: VehicleKind }) {
    const fx = Math.sin(t.heading), fz = Math.cos(t.heading), sx = -fz, sz = fx;
    const hwT = halfWidth(t.kind), sP = VEHICLES[p.kind];
    const latP = (p.x - t.x) * sx + (p.z - t.z) * sz;
    const skew = Math.abs(Math.sin(p.heading - t.heading));
    const lenP = sP.half + sP.radius * 0.6 + skew * sP.half;
    // Emprise latérale de « p » vue par ce véhicule, plus la sienne et 0,8 m de marge (l'anti-collision en exige 0,3). Positif : vers la droite.
    const need = Math.abs(Math.cos(p.heading - t.heading)) * halfWidth(p.kind) + skew * sP.half + hwT + 0.8;
    const reach = (p.x - t.x) * fx + (p.z - t.z) * fz + lenP + 10;
    const others: { x: number; z: number; heading: number }[] = this.traffic.filter((o) => o !== t && o !== p);
    if (this.mode === 'car' && this.car.y < 2 && this.car !== p) others.push(this.car);
    const feasible = (by: number) => {
      if (Math.abs(by) < 0.2 || Math.abs(by) > 4.5) return false;
      for (let d = 2; d <= reach; d += 1.5) for (const l of [by - hwT, by, by + hwT]) {
        if (!this.drivable(t.x + fx * d + sx * l, t.z + fz * d + sz * l)) return false;
      }
      return !others.some((o) => {
        const dx = o.x - t.x, dz = o.z - t.z, a = dx * fx + dz * fz, l = dx * sx + dz * sz;
        return a > -3 && a < reach + 40 && Math.abs(l - by) < 3 && Math.cos(wrap(o.heading - t.heading)) < 0.3;
      });
    };
    const options = [Math.min(0, latP - need), Math.max(0, latP + need)].filter(feasible).sort((a, b) => Math.abs(a) - Math.abs(b));
    const by = options[0];
    if (by === undefined) return;
    // Le décalage doit être fini avant l'arrière de « p » : arrêté à 3 m derrière lui, un décalage étalé sur 10 m
    // laissait le véhicule à moitié dans sa voie au niveau de « p », et son anti-collision le figeait là, en travers.
    const rearGap = (p.x - t.x) * fx + (p.z - t.z) * fz - sP.half - VEHICLES[t.kind].half;
    this.shiftLane(t, by, true, Math.max(4, Math.min(10, rearGap + 1)));
    t.passing = { x: p.x, z: p.z, by, t: 0 };
  }

  /**
   * Ce déplacement d'un véhicule de la circulation le fait-il entrer dans la voiture du joueur ? Les deux carrosseries
   * sont des segments épaissis : la collision n'était vérifiée qu'au centre du véhicule, et son avant ou son arrière
   * entrait dans la voiture du joueur. Un déplacement qui éloigne reste permis, pour qu'un véhicule déjà au contact puisse se dégager.
   */
  private intoPlayer(before: { x: number; z: number; heading: number }, t: TrafficCar) {
    const c = this.car;
    if (this.mode !== 'car' || c.y > 2 || Math.abs(t.x - c.x) > 9 || Math.abs(t.z - c.z) > 9) return false;
    const now = bodyGap(t, c);
    return now < 0.15 && now < bodyGap({ ...t, ...before }, c) - 1e-4;
  }

  /** Ce déplacement d'un véhicule de la circulation le fait-il entrer dans un autre ? (même règle que pour la voiture du joueur) */
  private intoTraffic(before: { x: number; z: number; heading: number }, t: TrafficCar) {
    for (const o of this.traffic) {
      if (o === t || Math.abs(o.x - t.x) > 9 || Math.abs(o.z - t.z) > 9) continue;
      const now = bodyGap(t, o);
      if (now < 0.15 && now < bodyGap({ ...t, ...before }, o) - 1e-4) return true;
    }
    return false;
  }

  /** Derrière ce véhicule, sur 3 m au-delà de son arrière : ni mur, ni véhicule, ni piéton, ni la voiture du joueur. */
  private clearBehind(t: TrafficCar) {
    const s = VEHICLES[t.kind], back = s.half + s.radius * 0.6, hw = halfWidth(t.kind);
    const fx = Math.sin(t.heading), fz = Math.cos(t.heading);
    for (let d = 0.3; d <= 3; d += 0.5) for (const l of [-hw, 0, hw]) {
      const x = t.x - fx * (back + d) - fz * l, z = t.z - fz * (back + d) + fx * l;
      if (this.solidAt(x, z) || !this.world.inBounds(x, z)) return false;
    }
    const near = (x: number, z: number, r: number) => {
      const dx = x - t.x, dz = z - t.z, along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      return along < 0 && along > -(back + 3 + r) && side < hw + r + 0.3;
    };
    if (near(this.car.x, this.car.z, VEHICLES[this.car.kind].half + 1)) return false;
    if (this.traffic.some((o) => o !== t && near(o.x, o.z, VEHICLES[o.kind].half + 1))) return false;
    if (this.parked.some((p) => near(p.x, p.z, VEHICLES[p.kind].half + 1))) return false;
    return !this.walkers.some((w) => near(w.x, w.z, 0.5));
  }

  /** Trottoir de droite : le tracé de la rue décalé au-delà de la chaussée. */
  private followWalk(w: Walker, index: number) {
    const e = this.world.edges[index]!;
    w.edge = index;
    const off = e.r + 1.3;
    w.targets = e.p.slice(1).map((q, i) => {
      const prev = e.p[i]!;
      const len = Math.hypot(q[0] - prev[0], q[1] - prev[1]) || 1;
      const dx = (q[0] - prev[0]) / len, dz = (q[1] - prev[1]) / len;
      return [q[0] - dz * off, q[1] + dx * off] as Pt;
    });
  }

  private spawnWalker(w: Walker, anywhere = false) {
    const c = this.focus;
    for (let tries = 0; tries < 40; tries++) {
      const index = Math.floor(this.rand() * this.world.edges.length);
      const e = this.world.edges[index]!;
      const [x, z] = e.p[0]!, q = e.p[1]!;
      const d = Math.hypot(x - c.x, z - c.z);
      if (d > (anywhere ? 170 : 200) || (!anywhere && d < 60)) continue;
      const len = Math.hypot(q[0] - x, q[1] - z) || 1;
      const t = this.rand() * len * 0.8;
      const dx = (q[0] - x) / len, dz = (q[1] - z) / len, off = e.r + 1.3;
      w.x = x + dx * t - dz * off;
      w.z = z + dz * t + dx * off;
      w.heading = Math.atan2(dx, dz);
      this.followWalk(w, index);
      return;
    }
  }

  private updateWalkers(dt: number) {
    const c = this.focus;
    const movers: { x: number; z: number; heading: number; speed: number }[] = [...this.traffic];
    if (this.mode === 'car') movers.push(this.car);
    for (const w of this.walkers) {
      w.phase += w.speed * dt * 3.2;
      if (this.recycle === 1 && Math.hypot(w.x - c.x, w.z - c.z) > 230) { this.spawnWalker(w); continue; }
      const target = w.targets[0];
      if (!target) {
        const e = this.world.edges[w.edge]!;
        const out = (this.outEdges.get(e.b) ?? []).filter((i) => this.world.edges[i]!.b !== e.a);
        if (!out.length) { this.spawnWalker(w); continue; }
        this.followWalk(w, out[Math.floor(this.rand() * out.length)]!);
        continue;
      }
      // Un piéton s'arrête devant un véhicule qui roule, et s'écarte d'un bond s'il arrive trop vite.
      // Un véhicule arrêté, il le contourne : s'il l'attendait, le véhicule (qui l'attend aussi) ne repartait jamais,
      // et toute la file derrière restait figée (vu dans le jeu : un minibus et quatre véhicules bloqués plus de 3 minutes).
      let want = w.wait > 0 ? 0 : w.cruise;
      w.wait -= dt;
      const fx = Math.sin(w.heading), fz = Math.cos(w.heading);
      for (const m of movers) {
        const dx = m.x - w.x, dz = m.z - w.z, d = Math.hypot(dx, dz);
        if (d > 6) continue;
        const ahead = dx * fx + dz * fz, lateral = dx * fz - dz * fx;
        if (d < 3 && Math.abs(m.speed) > 3) {
          const side = lateral > 0 ? -1 : 1;
          w.x += fz * side * 1.6;
          w.z -= fx * side * 1.6;
          w.wait = 1.2;
          want = 0;
        } else if (ahead > 0 && Math.abs(lateral) < 2.2) {
          if (Math.abs(m.speed) > 0.3) want = 0;
          else {
            // Pas de côté, à l'écart du véhicule arrêté, tout en avançant.
            const side = lateral > 0 ? -1 : 1;
            w.x += fz * side * 1.2 * dt;
            w.z -= fx * side * 1.2 * dt;
          }
        }
      }
      if (this.mode === 'foot' && !this.room) {
        const dx = this.hero.x - w.x, dz = this.hero.z - w.z;
        if (Math.hypot(dx, dz) < 1.6 && dx * fx + dz * fz > 0) want = 0;
      }
      w.speed += (want - w.speed) * Math.min(1, dt * 4);
      const aim = Math.atan2(target[0] - w.x, target[1] - w.z);
      w.heading += Math.max(-3 * dt, Math.min(3 * dt, wrap(aim - w.heading)));
      w.x += Math.sin(w.heading) * w.speed * dt;
      w.z += Math.cos(w.heading) * w.speed * dt;
      if (Math.hypot(target[0] - w.x, target[1] - w.z) < 1.2) w.targets.shift();
    }
  }
}

/** En moyenne, un nid-de-poule (ou un groupe de deux ou trois) tous les POTHOLE_SPACING mètres de chaussée. */
const POTHOLE_SPACING = 70;

/**
 * Nids-de-poule déterministes, comme sur les routes abîmées de Lomé : sur toute la longueur des rues carrossables,
 * dans l'une ou l'autre voie, parfois groupés, jamais dans un carrefour. Rayon de 0,55 à 1 m : de quoi secouer la
 * voiture et être vu de loin par la caméra.
 */
function placePotholes(world: World): Pothole[] {
  const rand = mulberry(731);
  const out: Pothole[] = [];
  const free = (x: number, z: number, r: number) =>
    !world.junctions.some((j) => Math.hypot(j.x - x, j.z - z) < j.r + 10) && !out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 1);
  for (const e of world.edges) {
    if (e.r < 3 || e.p.length < 2) continue;
    // Abscisse le long de la rue → point et direction de la polyligne.
    const cum = [0];
    for (let k = 1; k < e.p.length; k++) cum.push(cum[k - 1]! + Math.hypot(e.p[k]![0] - e.p[k - 1]![0], e.p[k]![1] - e.p[k - 1]![1]));
    const len = cum[cum.length - 1]!;
    if (len < 30) continue;
    const at = (s: number) => {
      let k = 1;
      while (k < cum.length - 1 && cum[k]! < s) k++;
      const [ax, az] = e.p[k - 1]!, [bx, bz] = e.p[k]!;
      const seg = Math.max(1e-6, cum[k]! - cum[k - 1]!), u = (s - cum[k - 1]!) / seg;
      return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, dx: (bx - ax) / seg, dz: (bz - az) / seg };
    };
    const count = Math.floor((len / POTHOLE_SPACING) * (0.6 + rand() * 0.8) + rand());
    for (let n = 0; n < count; n++) {
      const s0 = 12 + rand() * (len - 24);
      const side = rand() < 0.65 ? 1 : -1;   // surtout dans la voie de droite du sens a → b
      const group = rand() < 0.3 ? 2 + Math.floor(rand() * 2) : 1;
      for (let g = 0; g < group; g++) {
        const s = Math.min(len - 8, Math.max(8, s0 + g * (2.5 + rand() * 3)));
        const p = at(s), r = 0.55 + rand() * 0.45;
        const off = side * e.l + (rand() - 0.5) * 1.4;
        const x = p.x - p.dz * off, z = p.z + p.dx * off;
        if (free(x, z, r)) out.push({ x, z, r });
      }
    }
  }
  // Rues étroites (chaussée de 4 m) : à Lomé, elles ont aussi leurs nids-de-poule, deux fois moins serrés. Tirage à part,
  // pour que ceux des grandes rues restent à leur place. Trop étroites pour les contourner : la voiture les franchit au pas.
  const rand2 = mulberry(977);
  for (const e of world.edges) {
    if (e.r >= 3 || e.r < 1.5 || e.p.length < 2) continue;
    const len = e.p.slice(1).reduce((a, q, k) => a + Math.hypot(q[0] - e.p[k]![0], q[1] - e.p[k]![1]), 0);
    if (len < 30) continue;
    const count = Math.floor((len / (POTHOLE_SPACING * 2)) * (0.6 + rand2() * 0.8) + rand2());
    for (let n = 0; n < count; n++) {
      let s = 12 + rand2() * (len - 24), k = 1;
      while (k < e.p.length - 1) { const l = Math.hypot(e.p[k]![0] - e.p[k - 1]![0], e.p[k]![1] - e.p[k - 1]![1]); if (s <= l) break; s -= l; k++; }
      const [ax, az] = e.p[k - 1]!, [bx, bz] = e.p[k]!, seg = Math.max(1e-6, Math.hypot(bx - ax, bz - az));
      const dx = (bx - ax) / seg, dz = (bz - az) / seg, u = Math.min(1, s / seg);
      const r = 0.5 + rand2() * 0.35, off = (rand2() < 0.65 ? 1 : -1) * e.l + (rand2() - 0.5) * 0.8;
      const x = ax + (bx - ax) * u - dz * off, z = az + (bz - az) * u + dx * off;
      if (free(x, z, r)) out.push({ x, z, r });
    }
  }
  return out;
}
