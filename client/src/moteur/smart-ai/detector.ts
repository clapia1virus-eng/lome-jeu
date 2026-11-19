import { TWO_WHEELS, VEHICLES, halfWidth, type GameSim, type VehicleKind } from '../sim.ts';
import { pointAt, project } from './route.ts';
import type { Detection, ObjectClass, Path } from './types.ts';

/** Ce que voit un capteur à un instant : la simulation, la trajectoire prévue, la portée d'analyse. */
export type PerceptionContext = { sim: GameSim; path: Path | null; range: number };

/**
 * Un capteur produit des détections. Le jeu fournit aujourd'hui GameStateSensor, qui lit l'état réel de la simulation.
 * Un capteur de vision (image de la caméra du véhicule passée à YOLO, par ONNX Runtime Web, ou à OpenCV.js)
 * implémentera la même interface et sera ajouté à EnvironmentDetector : ses détections, moins sûres (confidence < 1),
 * sont fusionnées avec les autres sans rien changer à l'analyse du risque ni à la décision.
 */
export interface Sensor {
  readonly name: string;
  detect(ctx: PerceptionContext): Detection[];
}

const classOf = (k: VehicleKind): ObjectClass => (TWO_WHEELS.has(k) ? 'moto' : k === 'minibus' || k === 'fourgon' || k === 'pickup' ? 'camion' : 'voiture');

/** Capteur « état du jeu » : piétons, circulation, véhicules garés, nids-de-poule, feux et obstacles fixes, tels que la simulation les connaît. */
export class GameStateSensor implements Sensor {
  readonly name = 'jeu';
  /** Faux quand un capteur de vision perçoit les usagers (piétons, véhicules, nids-de-poule) : seuls les feux et les murs sont alors lus ici. */
  private users: boolean;
  constructor({ users = true }: { users?: boolean } = {}) { this.users = users; }

  detect({ sim, path, range }: PerceptionContext): Detection[] {
    const c = sim.car;
    const near = (x: number, z: number) => Math.abs(x - c.x) < range && Math.abs(z - c.z) < range && Math.hypot(x - c.x, z - c.z) < range;
    const user = (x: number, z: number) => this.users && near(x, z);
    const out: Detection[] = [];
    const base = { source: this.name, confidence: 1 };
    sim.walkers.forEach((w, i) => {
      if (!user(w.x, w.z)) return;
      out.push({ ...base, id: `pieton-${i}`, cls: 'pieton', x: w.x, z: w.z, vx: Math.sin(w.heading) * w.speed, vz: Math.cos(w.heading) * w.speed, heading: w.heading, radius: 0.35, length: 0.3, fixed: false });
    });
    sim.traffic.forEach((t, i) => {
      if (!user(t.x, t.z)) return;
      const s = VEHICLES[t.kind];
      out.push({ ...base, id: `vehicule-${i}`, cls: classOf(t.kind), x: t.x, z: t.z, vx: Math.sin(t.heading) * t.speed, vz: Math.cos(t.heading) * t.speed, heading: t.heading, radius: halfWidth(t.kind), length: s.half + s.radius * 0.6,
        // Klaxonné, rangé et arrêté : il attend qu'on passe, on le contourne comme un véhicule garé (venue d'en face toujours vérifiée).
        fixed: !!t.yieldT && t.yieldT > 0 && t.speed < 0.3 });
    });
    sim.parked.forEach((p, i) => {
      if (p.kind === 'helico' || !user(p.x, p.z)) return;
      const s = VEHICLES[p.kind];
      out.push({ ...base, id: `gare-${i}`, cls: 'vehicule-gare', x: p.x, z: p.z, vx: 0, vz: 0, heading: p.heading, radius: halfWidth(p.kind), length: s.half + s.radius * 0.6, fixed: true });
    });
    sim.potholes.forEach((p, i) => {
      if (!user(p.x, p.z)) return;
      out.push({ ...base, id: `nid-${i}`, cls: 'nid-de-poule', x: p.x, z: p.z, vx: 0, vz: 0, heading: 0, radius: p.r, length: p.r, fixed: true });
    });
    if (!path) return out;
    const me = project(path, c.x, c.z);
    // Feux : un carrefour sur la trajectoire dont le feu n'est pas vert pour notre direction devient une ligne d'arrêt.
    sim.world.junctions.forEach((j, index) => {
      if (!near(j.x, j.z)) return;
      const p = project(path, j.x, j.z);
      if (Math.abs(p.d) > j.r || p.s - me.s < j.r) return;
      const stop = p.s - j.r - 1.5;
      const at = pointAt(path, stop);
      const state = sim.lightAt(index, Math.atan2(at.dx, at.dz));
      if (state === 'green') return;
      out.push({ ...base, id: `feu-${index}-${state}`, cls: 'feu-rouge', x: at.x, z: at.z, vx: 0, vz: 0, heading: 0, radius: 0, length: 0, fixed: true });
    });
    // Obstacles fixes (murs, poteaux, arbres) sur la trajectoire : le premier rencontré, au centre de la voie ou sur ses bords.
    // solidAt garde déjà 25 cm de marge autour des murs : on sonde aux flancs exacts du véhicule.
    const w = halfWidth(c.kind) - 0.25;
    for (let s = me.s + 2; s < me.s + Math.min(range, 45); s += 1.5) {
      const at = pointAt(path, s);
      const hit = [-w, 0, w].find((l) => sim.solidAt(at.x - at.dz * l, at.z + at.dx * l));
      if (hit === undefined) continue;
      out.push({ ...base, id: `obstacle-${Math.round(at.x)}-${Math.round(at.z)}`, cls: 'obstacle', x: at.x - at.dz * hit, z: at.z + at.dx * hit, vx: 0, vz: 0, heading: 0, radius: 0.15, length: 0.15, fixed: true });
      break;
    }
    return out;
  }
}

/** Portée des capteurs à ultrasons, depuis la carrosserie (m). */
export const ULTRASON_RANGE = 2.5;

/**
 * Capteurs à ultrasons, comme les radars de recul des voitures de série : ils couvrent l'angle mort de la caméra.
 * Un véhicule collé devant remplit toute l'image et dépasse du cadre : YOLO ne le reconnaît plus, et SMART AI
 * accélérait contre lui. Les ultrasons ne disent pas ce qu'est l'objet, seulement qu'il est là et à quelle distance :
 * il est signalé comme un obstacle. Ils ne voient ni les nids-de-poule (au sol) ni au-delà de 2,5 m.
 */
export class UltrasonicSensor implements Sensor {
  readonly name = 'ultrasons';

  detect({ sim }: PerceptionContext): Detection[] {
    const c = sim.car, spec = VEHICLES[c.kind];
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const halfL = spec.half + spec.radius * 0.6, halfW = halfWidth(c.kind);
    const out: Detection[] = [];
    // « heading » : l'orientation réelle de l'objet. Les véhicules sont des segments orientés : avec un cap fixe, une voiture
    // garée en biais était vue de travers, hors de notre trajectoire, et SMART AI poussait contre elle.
    const sense = (id: string, x: number, z: number, heading: number, radius: number, length: number) => {
      const dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx) > 12 || Math.abs(dz) > 12) return;
      const lon = dx * fx + dz * fz, lat = dx * -fz + dz * fx;
      const size = Math.max(radius, length);
      // Écart entre les deux carrosseries, le long de la voiture et sur le côté.
      if (Math.abs(lon) - halfL - size > ULTRASON_RANGE || Math.abs(lat) - halfW - size > ULTRASON_RANGE) return;
      out.push({ id: `ultrason-${id}`, cls: 'obstacle', x, z, vx: 0, vz: 0, heading, radius, length, fixed: true, source: this.name, confidence: 0.9 });
    };
    sim.walkers.forEach((w, i) => sense(`pieton-${i}`, w.x, w.z, w.heading, 0.35, 0.3));
    sim.traffic.forEach((t, i) => { const s = VEHICLES[t.kind]; sense(`vehicule-${i}`, t.x, t.z, t.heading, halfWidth(t.kind), s.half + s.radius * 0.6); });
    sim.parked.forEach((p, i) => { if (p.kind !== 'helico') { const s = VEHICLES[p.kind]; sense(`gare-${i}`, p.x, p.z, p.heading, halfWidth(p.kind), s.half + s.radius * 0.6); } });
    return out;
  }
}

/** Portée du radar avant (m). */
export const RADAR_RANGE = 50;

/**
 * Radar avant, comme celui du régulateur de vitesse adaptatif des voitures de série : un faisceau étroit devant la voiture,
 * qui mesure la position et la vitesse des véhicules (effet Doppler), sans dire ce qu'ils sont. Il complète la caméra :
 * vu dans Lomé, YOLO n'a pas reconnu une moto arrêtée dans la voie, petite et vue de dos, et SMART AI l'a heurtée à 26 km/h ;
 * les ultrasons ne l'ont perçue qu'à 2,5 m, trop tard pour freiner. Il ne voit pas les piétons ni les nids-de-poule.
 */
export class RadarSensor implements Sensor {
  readonly name = 'radar';

  detect({ sim }: PerceptionContext): Detection[] {
    const c = sim.car, spec = VEHICLES[c.kind];
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const halfL = spec.half + spec.radius * 0.6, halfW = halfWidth(c.kind);
    const out: Detection[] = [];
    const sense = (id: string, x: number, z: number, heading: number, speed: number, radius: number, length: number) => {
      const dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx) > RADAR_RANGE + 5 || Math.abs(dz) > RADAR_RANGE + 5) return;
      const lon = dx * fx + dz * fz, lat = dx * -fz + dz * fx;
      const size = Math.max(radius, length);
      // Faisceau : la largeur de la voie près de la voiture, puis un cône de ±9° au loin.
      if (lon - halfL < 0 || lon - halfL - size > RADAR_RANGE || Math.abs(lat) - size > Math.max(halfW + 1, lon * 0.16)) return;
      out.push({ id: `radar-${id}`, cls: 'voiture', x, z, vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed, heading, radius, length, fixed: false, source: this.name, confidence: 0.8 });
    };
    sim.traffic.forEach((t, i) => { const s = VEHICLES[t.kind]; sense(`vehicule-${i}`, t.x, t.z, t.heading, t.speed, halfWidth(t.kind), s.half + s.radius * 0.6); });
    sim.parked.forEach((p, i) => { if (p.kind !== 'helico') { const s = VEHICLES[p.kind]; sense(`gare-${i}`, p.x, p.z, p.heading, 0, halfWidth(p.kind), s.half + s.radius * 0.6); } });
    return out;
  }
}

/** EnvironmentDetector : réunit les détections de tous les capteurs, et fusionne celles qui désignent le même objet. */
export class EnvironmentDetector {
  private sensors: Sensor[];
  constructor(sensors: Sensor[] = [new GameStateSensor()]) { this.sensors = sensors; }

  addSensor(s: Sensor) { this.sensors.push(s); }

  detect(ctx: PerceptionContext): Detection[] {
    const all = this.sensors.flatMap((s) => s.detect(ctx));
    if (this.sensors.length < 2) return all;
    // Même classe, à moins d'un mètre : on garde la détection la plus sûre.
    const kept: Detection[] = [];
    for (const d of all.sort((a, b) => b.confidence - a.confidence)) {
      if (!kept.some((k) => k.cls === d.cls && Math.hypot(k.x - d.x, k.z - d.z) < 1)) kept.push(d);
    }
    // Le radar complète la caméra : un véhicule qu'elle a déjà reconnu n'est pas doublé (sa position estimée peut s'écarter
    // de quelques mètres de celle que mesure le radar).
    const radar = kept.filter((d) => d.source !== 'radar' || !kept.some((k) => k.source !== 'radar' && k.source !== 'ultrasons' && k.cls !== 'obstacle' && k.cls !== 'feu-rouge'
      && k.cls !== 'pieton' && k.cls !== 'nid-de-poule' && Math.hypot(k.x - d.x, k.z - d.z) < Math.max(d.radius, d.length) + Math.max(k.radius, k.length) + 2));
    // Les ultrasons complètent les autres capteurs dans leur angle mort : un objet déjà perçu ailleurs n'est pas doublé.
    return radar.filter((d) => d.source !== 'ultrasons' || !radar.some((k) => k.source !== 'ultrasons' && k.cls !== 'obstacle' && k.cls !== 'feu-rouge'
      && Math.hypot(k.x - d.x, k.z - d.z) < Math.max(d.radius, d.length) + Math.max(k.radius, k.length) + 1));
  }
}
