import type { GameSim, Input } from '../sim.ts';
import { pointAt, project } from './route.ts';
import type { Detection, Path } from './types.ts';

/**
 * Pilote appris : un réseau de neurones tient le volant, l'accélérateur et le frein à la place des règles de SMART AI
 * (DecisionEngine + VehicleController). Il a appris en imitant SMART AI, par DAgger, comme le pilote appris de
 * simulation.py dans le projet « détecteur routier » (entrainer_pilote_jeu.py).
 *
 * Ce qu'il voit, dans le repère du véhicule :
 *   - sa vitesse ;
 *   - la route à suivre (la voie de droite de l'itinéraire, comme un GPS) et la largeur de chaussée ;
 *   - le prochain feu rouge et le prochain mur sur la route ;
 *   - les 12 usagers les plus proches vus par NOTRE détecteur YOLO (4 caméras) : piétons, deux-roues, véhicules, nids-de-poule.
 * Il ne voit pas ses propres commandes précédentes : sinon il apprendrait à recopier ce qu'il faisait déjà
 * (le défaut d'inertie du pilote de simulation.py).
 */

const AHEAD = [2, 4, 6, 8, 10, 12, 15, 18, 21, 25, 30, 35, 42, 50, 60];
const OBJECTS = 12;
const PER_OBJECT = 14;
const RANGE = 60;
export const FEATURES = 1 + AHEAD.length * 2 + 5 + 4 + OBJECTS * PER_OBJECT;

const clip = (v: number, m = 3) => Math.max(-m, Math.min(m, v));
const USERS = new Set(['pieton', 'moto', 'voiture', 'camion', 'vehicule-gare', 'nid-de-poule']);

/** La scène vue par le réseau : un vecteur de FEATURES nombres. */
export function features(sim: GameSim, path: Path, dets: Detection[]): Float32Array {
  const f = new Float32Array(FEATURES);
  const c = sim.car, fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  // Repère du véhicule : latéral positif à droite, longitudinal positif devant.
  const ego = (x: number, z: number) => { const dx = x - c.x, dz = z - c.z; return [dx * -fz + dz * fx, dx * fx + dz * fz] as const; };
  let k = 0;
  f[k++] = c.speed / 15;
  const me = project(path, c.x, c.z);
  const end = path.cum[path.cum.length - 1]!;
  for (const a of AHEAD) {
    const p = pointAt(path, Math.min(end, me.s + a));
    const [lat, fwd] = ego(p.x, p.z);
    f[k++] = clip(lat / 10);
    f[k++] = clip(fwd / 30);
  }
  const here = pointAt(path, me.s);
  f[k++] = clip(me.d / 3);
  f[k++] = clip(here.left / 5);
  f[k++] = clip(here.right / 5);
  f[k++] = path.goalS !== undefined ? 1 : 0;
  f[k++] = path.goalS !== undefined ? Math.min(1, Math.max(0, (path.goalS - me.s) / RANGE)) : path.deadEnd ? Math.min(1, (end - me.s) / RANGE) : 1;
  // Feu rouge et mur sur la route : distance le long de la trajectoire.
  for (const cls of ['feu-rouge', 'obstacle']) {
    let gap = Infinity;
    for (const d of dets) if (d.cls === cls) gap = Math.min(gap, project(path, d.x, d.z).s - me.s);
    f[k++] = gap < RANGE ? 1 : 0;
    f[k++] = gap < RANGE ? Math.max(0, gap) / RANGE : 1;
  }
  // Usagers, du plus proche au plus loin.
  const users = dets
    .filter((d) => USERS.has(d.cls))
    .map((d) => ({ d, dist: Math.hypot(d.x - c.x, d.z - c.z) }))
    .filter((o) => o.dist < RANGE)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, OBJECTS);
  for (let i = 0; i < OBJECTS; i++) {
    const o = users[i];
    if (!o) { k += PER_OBJECT; continue; }
    const d = o.d;
    const [lat, fwd] = ego(d.x, d.z);
    const onPath = project(path, d.x, d.z);
    f[k++] = 1;
    f[k++] = clip(lat / 20);
    f[k++] = clip(fwd / 40);
    f[k++] = clip((onPath.s - me.s) / 40);
    f[k++] = clip(onPath.d / 5);
    f[k++] = clip((d.vx * -fz + d.vz * fx) / 10);
    f[k++] = clip((d.vx * fx + d.vz * fz) / 10);
    f[k++] = d.radius / 2;
    f[k++] = d.length / 3;
    f[k++] = d.fixed ? 1 : 0;
    f[k++] = d.cls === 'pieton' ? 1 : 0;
    f[k++] = d.cls === 'moto' ? 1 : 0;
    f[k++] = d.cls === 'voiture' || d.cls === 'camion' || d.cls === 'vehicule-gare' ? 1 : 0;
    f[k++] = d.cls === 'nid-de-poule' ? 1 : 0;
  }
  return f;
}

/** Motif de la décision de l'expert : 0 aucun objet (vitesse, virage), puis la classe de l'objet en cause. */
export const CAUSES = ['aucun', 'pieton', 'moto', 'voiture', 'camion', 'vehicule-gare', 'obstacle', 'nid-de-poule', 'feu-rouge'];

/** Commandes du jeu → les deux sorties du réseau : volant (−1 à 1) et pédale (accélérateur positif, frein négatif). */
export const labelOf = (i: Input): [number, number] => [i.steer, i.throttle - i.brake];

/** Sorties du réseau → commandes du jeu. À l'arrêt, le frein passerait en marche arrière : il n'est pas transmis. */
export function toInput([steer, pedal]: [number, number], speed: number): Input {
  return {
    steer: Math.max(-1, Math.min(1, steer)),
    throttle: pedal > 0.05 ? Math.min(1, pedal) : 0,
    brake: pedal < -0.05 && speed > 0.2 ? Math.min(1, -pedal) : 0,
  };
}

type Layer = { w: number[][]; b: number[] };
type Weights = { entrees: number; moyenne: number[]; ecart: number[]; couches: Layer[] };

/** Le réseau : perceptron à deux couches cachées (ReLU), sorties tanh. Poids entraînés en Python, servis par serveur_vision.py. */
export class LearnedPilot {
  ready = false;
  private net: Weights | null = null;

  constructor(url: string) {
    fetch(`${url}/pilote/poids`)
      .then((r) => (r.ok ? r.json() : null))
      .then((w: Weights | null) => {
        if (!w || w.entrees !== FEATURES) return;   // poids absents ou d'une autre version des entrées
        this.net = w;
        this.ready = true;
      })
      .catch(() => {});
  }

  act(f: Float32Array): [number, number] | null {
    const n = this.net;
    if (!n) return null;
    let x: number[] = Array.from(f, (v, i) => (v - n.moyenne[i]!) / n.ecart[i]!);
    n.couches.forEach((layer, j) => {
      const last = j === n.couches.length - 1;
      x = layer.w.map((row, o) => {
        let s = layer.b[o]!;
        for (let i = 0; i < row.length; i++) s += row[i]! * x[i]!;
        return last ? Math.tanh(s) : Math.max(0, s);
      });
    });
    return [x[0]!, x[1]!];
  }
}

/** Enregistre ce que voit le réseau et ce que l'expert aurait fait, par paquets envoyés au serveur. */
export class PilotRecorder {
  sent = 0;
  private x: number[][] = [];
  private y: [number, number][] = [];
  private who: number[] = [];
  private url: string;
  constructor(url: string) { this.url = url; }

  private cause: number[] = [];

  /** `cause` : ce qui motive la décision de l'expert (CAUSES), pour comprendre les erreurs du réseau. */
  push(f: Float32Array, label: [number, number], studentDrove: boolean, cause = 0) {
    this.x.push(Array.from(f, (v) => Math.round(v * 1e4) / 1e4));
    this.y.push(label);
    this.who.push(studentDrove ? 1 : 0);
    this.cause.push(cause);
    if (this.x.length >= 200) this.flush();
  }

  flush() {
    if (!this.x.length) return;
    const body = JSON.stringify({ x: this.x, y: this.y, conduite: this.who, cause: this.cause });
    this.x = []; this.y = []; this.who = []; this.cause = [];
    fetch(`${this.url}/pilote/enregistrer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      .then((r) => { if (r.ok) this.sent++; })
      .catch(() => {});
  }
}
