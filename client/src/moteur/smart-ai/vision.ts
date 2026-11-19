import * as THREE from 'three';
import { VEHICLES, type GameSim } from '../sim.ts';
import type { PerceptionContext, Sensor } from './detector.ts';
import type { Detection, ObjectClass } from './types.ts';

/**
 * Capteur de vision : SMART AI perçoit les usagers de la route par le détecteur du projet « détecteur routier »
 * (YOLOv8, spécialisé pour le jeu par entrainer_jeu.py), et non plus par l'état du jeu.
 *
 * Quatre caméras, comme sur une vraie voiture autonome : avant, arrière, gauche, droite, plus un zoom avant pour les nids-de-poule. Leurs images partent au
 * serveur de vision (serveur_vision.py), qui renvoie les boîtes détectées. Chaque boîte est replacée dans le monde :
 * on connaît exactement la caméra, donc le point où le bas de la boîte touche la chaussée. La vitesse d'un objet vient
 * de son identifiant de suivi (ByteTrack), d'une image à l'autre. Seuls les feux et les murs restent lus dans le jeu :
 * le détecteur ne les connaît pas.
 */

export const VISION_URL = 'http://127.0.0.1:8765';
/**
 * Image envoyée au détecteur, en pixels. Le modèle analyse à 640 de large : une image plus grande serait réduite
 * par le serveur, après avoir coûté 4 fois plus cher à dessiner et à compresser (vision trop lente sur un portable).
 */
const W = 640, H = 360;
/** Distance maximale parcourue entre deux regards de la caméra avant (m) : SMART AI ralentit si la vision est lente. */
const BLIND_DISTANCE = 6;
/** Vitesse plancher imposée par cette règle (m/s), pour ne jamais rester bloqué. */
const MIN_CAP = 4;
/** Images en route vers le serveur au plus. */
const MAX_IN_FLIGHT = 2;
/** Hauteur des caméras au-dessus de la route ; elles regardent légèrement vers le bas. */
const HEIGHT = 1.35, AIM = 25, AIM_HEIGHT = 0.6;
/** Au-delà, la position au sol déduite d'une boîte de quelques pixels n'est plus fiable. */
const MAX_DISTANCE = 90;
/** Un objet qui n'est plus revu (sorti du champ, caméra pas encore repassée) est gardé en mémoire ce temps-là (s). */
const MEMORY = 1.6;
/**
 * Un nid-de-poule ne bouge pas : il reste en mémoire plus longtemps. Tout près de la voiture, il sort du champ de la caméra
 * avant (sous le capot) ; sans cette mémoire, SMART AI le croyait dépassé et revenait dessus.
 */
const MEMORY_FIXED = 5;
/** Une détection reprend l'identité de l'objet déjà connu, de même classe, le plus proche à moins de cette distance (m). */
const GATE = 2.5, GATE_FIXED = 1.6;
/** Sans réponse du serveur pendant ce temps (s), la vision est déclarée indisponible. */
const OFFLINE_AFTER = 2.5;

type View = 'avant' | 'arriere' | 'gauche' | 'droite' | 'zoom';
/**
 * Chaque caméra : angle de vue par rapport à l'avant, recul depuis le centre, champ vertical (°), point visé (distance
 * et hauteur, m). Les côtés voient plus large.
 */
const VIEWS: Record<View, { angle: number; offset: (half: number) => number; fov: number; aim?: number; aimHeight?: number }> = {
  avant: { angle: 0, offset: (half) => half + 0.2, fov: 50 },
  arriere: { angle: Math.PI, offset: (half) => half + 0.2, fov: 55 },
  gauche: { angle: Math.PI / 2, offset: () => 0.9, fov: 62 },
  droite: { angle: -Math.PI / 2, offset: () => 0.9, fov: 62 },
  // Zoom sur la chaussée devant (champ 3 fois plus étroit, visée au sol à 12 m : de 5 m jusqu'à l'horizon).
  // Un nid-de-poule est plat : sa hauteur à l'image décroît avec le carré de la distance. Avec la caméra avant, YOLO
  // ne le voyait qu'à 7 m en moyenne, trop tard pour l'éviter à 30 km/h ; le zoom le grossit 3 fois.
  zoom: { angle: 0, offset: (half) => half + 0.2, fov: 16, aim: 12, aimHeight: 0 },
};
/** L'avant passe presque une fois sur deux : c'est là que les dangers arrivent le plus vite. Le zoom, deux fois par tour. */
const ORDER: View[] = ['avant', 'gauche', 'avant', 'zoom', 'avant', 'droite', 'avant', 'zoom', 'arriere'];

/** Catégories du détecteur → classes de SMART AI, et taille au sol par défaut (demi-largeur, demi-longueur). */
const CLASSES: Record<string, { cls: ObjectClass; radius: number; length: number }> = {
  pieton: { cls: 'pieton', radius: 0.35, length: 0.3 },
  velo: { cls: 'moto', radius: 0.4, length: 0.9 },
  moto: { cls: 'moto', radius: 0.45, length: 1 },
  vehicule: { cls: 'voiture', radius: 0.95, length: 2.2 },
  nid_de_poule: { cls: 'nid-de-poule', radius: 0.6, length: 0.6 },
};

type Seen = { categorie: string; confiance: number; boite: [number, number, number, number]; id: number };
/** Objet suivi ; « alias » : l'identifiant de suivi du serveur qui le désigne aussi (une autre caméra, ou un suivi repris). */
type Track = { det: Detection; t: number; x: number; z: number; alias?: string; ax?: number; az?: number; at?: number };
/* ax, az, at : point d'ancrage du calcul de vitesse (position mesurée et instant). */

/** Ce que le moteur prête au capteur : dessiner la scène depuis une caméra, dans le coin du canvas, puis la recopier. */
export type Shooter = (camera: THREE.PerspectiveCamera, width: number, height: number, into: CanvasRenderingContext2D) => boolean;
/** Classes du modèle entraîné sur le jeu, dans l'ordre de ses étiquettes. */
export const LABELS = ['pieton', 'moto', 'vehicule', 'nid_de_poule'] as const;
/** Cadre exact d'un objet dans l'image (pixels), d'après la scène : sert à étiqueter les images d'entraînement. */
export type Label = { cls: number; box: [number, number, number, number] };
export type Labeler = (camera: THREE.PerspectiveCamera, width: number, height: number) => Label[];

/** Place une caméra sur la voiture, regard dans la direction de sa vue. */
function aimCamera(camera: THREE.PerspectiveCamera, sim: GameSim, view: View = 'avant') {
  const c = sim.car, v = VIEWS[view], h = c.heading + v.angle;
  const fx = Math.sin(h), fz = Math.cos(h);
  const at = v.offset(VEHICLES[c.kind].half);
  camera.position.set(c.x + fx * at, HEIGHT, c.z + fz * at);
  camera.lookAt(c.x + fx * (v.aim ?? AIM), v.aimHeight ?? AIM_HEIGHT, c.z + fz * (v.aim ?? AIM));
  camera.updateMatrixWorld();
}

const newCamera = (view: View) => new THREE.PerspectiveCamera(VIEWS[view].fov, W / H, 0.3, 4000);

export class VisionSensor implements Sensor {
  readonly name = 'vision';
  /** Dernières mesures du serveur : temps de détection et nombre d'objets vus. */
  ms = 0;
  count = 0;
  private cameras = new Map<View, THREE.PerspectiveCamera>();
  /** Canvas libres : chaque image garde le sien jusqu'à ce qu'elle soit compressée. */
  private canvases: HTMLCanvasElement[] = [];
  private tracks = new Map<string, Track>();
  private seq = 0;
  private turn = 0;
  /** Images envoyées dont la réponse n'est pas revenue. */
  private inFlight = 0;
  private lastReply = -Infinity;
  private lastShot = -Infinity;
  private url: string;
  private shoot: Shooter;
  /** Intervalle lissé entre deux réponses de la caméra avant, et retard de ces réponses (s). */
  private frontPeriod = 1;
  private frontLatency = 0.3;
  private lastFront = -Infinity;

  constructor(shoot: Shooter, url = VISION_URL) {
    this.shoot = shoot;
    this.url = url;
    for (let k = 0; k < MAX_IN_FLIGHT; k++) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      this.canvases.push(c);
    }
    for (const v of Object.keys(VIEWS) as View[]) this.cameras.set(v, newCamera(v));
  }

  /** Le serveur de vision répond-il ? Sans lui, SMART AI est aveugle et ne doit pas rouler. */
  get online() { return performance.now() / 1000 - this.lastReply < OFFLINE_AFTER; }

  /**
   * Vitesse maximale (m/s) permise par la vision : entre deux images analysées de la caméra avant, plus leur retard,
   * la voiture roule à l'aveugle. Comme une vraie voiture autonome dont les capteurs voient mal, elle ralentit.
   */
  get speedCap() { return Math.max(MIN_CAP, BLIND_DISTANCE / (this.frontPeriod + this.frontLatency)); }

  reset() { this.tracks.clear(); }

  /**
   * Une image vers le serveur, caméra après caméra. Deux peuvent être en route à la fois : pendant que le serveur
   * analyse l'une, le navigateur dessine et compresse la suivante, et le détecteur n'attend jamais.
   * Deux images consécutives viennent toujours de caméras différentes : le suivi de chaque caméra reste dans l'ordre.
   */
  capture(sim: GameSim) {
    const now = performance.now() / 1000;
    if (this.inFlight >= MAX_IN_FLIGHT && now - this.lastShot < 3) return;
    if (now - this.lastShot < 0.05) return;
    const canvas = this.canvases.pop();
    if (!canvas) return;   // les images précédentes sont encore en cours de compression
    const view = ORDER[this.turn % ORDER.length]!;
    const camera = this.cameras.get(view)!;
    aimCamera(camera, sim, view);
    // Pas d'image (fenêtre trop petite) : rien n'est envoyé ; sans réponses, la vision passe hors service et SMART AI s'arrête.
    if (!this.shoot(camera, W, H, canvas.getContext('2d')!)) { this.canvases.push(canvas); return; }
    this.turn++;
    // La caméra telle qu'elle était au moment de la photo : les boîtes reviendront plus tard, la voiture aura bougé.
    const shot = camera.clone();
    shot.updateMatrixWorld();
    this.inFlight++;
    this.lastShot = now;
    canvas.toBlob((blob) => {
      this.canvases.push(canvas);
      if (!blob) { this.inFlight--; return; }
      fetch(`${this.url}/detecter?camera=${view}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob })
        .then((r) => (r.ok ? r.json() : null))
        .then((rep: { ms: number; objets: Seen[] } | null) => {
          if (!rep) return;
          this.lastReply = performance.now() / 1000;
          if (view === 'avant') {
            const t = this.lastReply;
            if (t - this.lastFront < 5) this.frontPeriod += (t - this.lastFront - this.frontPeriod) * 0.3;
            this.frontLatency += (t - now - this.frontLatency) * 0.3;
            this.lastFront = t;
          }
          this.ms = rep.ms;
          this.count = rep.objets.length;
          this.integrate(rep.objets, shot, view, now);
        })
        .catch(() => { /* serveur absent : `online` passe à faux */ })
        .finally(() => { this.inFlight = Math.max(0, this.inFlight - 1); });
    }, 'image/jpeg', 0.85);
  }

  /** Point de la chaussée vu au pixel (u, v), ou null s'il est au-dessus de l'horizon ou trop loin. */
  private ground(u: number, v: number, cam: THREE.PerspectiveCamera) {
    const p = new THREE.Vector3((u / W) * 2 - 1, 1 - (v / H) * 2, 0.5).unproject(cam);
    const dir = p.sub(cam.position).normalize();
    if (dir.y > -1e-3) return null;
    const t = -cam.position.y / dir.y;
    const x = cam.position.x + dir.x * t, z = cam.position.z + dir.z * t;
    const d = Math.hypot(x - cam.position.x, z - cam.position.z);
    return d > MAX_DISTANCE ? null : { x, z, d, dx: dir.x, dz: dir.z };
  }

  /** Boîtes de l'image → objets dans le monde, avec leur vitesse d'après le suivi. */
  private integrate(seen: Seen[], cam: THREE.PerspectiveCamera, view: View, t: number) {
    const focal = H / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    // D'abord, les détections dont le suivi du serveur est déjà connu reprennent leur objet ; les autres se répartissent
    // ensuite par proximité, sans pouvoir prendre l'identité d'un objet suivi (une voiture garée lointaine prenait sinon
    // celle d'une voiture qui roulait à côté).
    const known = (o: Seen) => {
      if (o.id < 0 || CLASSES[o.categorie]?.cls === 'nid-de-poule') return '';
      const key = `vision-${view}-${o.id}`;
      if (this.tracks.has(key)) return key;
      return [...this.tracks.entries()].find(([, tr]) => tr.alias === key)?.[0] ?? '';
    };
    const used = new Set<string>(seen.map(known).filter(Boolean));
    for (const o of seen) {
      const kind = CLASSES[o.categorie];
      if (!kind) continue;
      // Le zoom ne sert qu'aux nids-de-poule : les usagers sont suivis par la caméra avant (le suivi est propre à chaque caméra).
      if (view === 'zoom' && kind.cls !== 'nid-de-poule') continue;
      const [x1, y1, x2, y2] = o.boite;
      const fixed = kind.cls === 'nid-de-poule';
      // Un nid-de-poule est à plat : son centre est au milieu de la boîte. Un usager debout touche le sol au bas de la boîte.
      const g = this.ground((x1 + x2) / 2, fixed ? (y1 + y2) / 2 : y2, cam);
      if (!g) continue;
      // Largeur réelle d'après la largeur de la boîte ; le bas de la boîte est la face visible : le centre est derrière.
      // Le cadre d'un nid-de-poule déborde de 30 % autour du trou (bord affaissé ; c'est ainsi qu'il a été étiqueté pour
      // l'entraînement) : sans cette correction, son rayon était surestimé d'autant et aucun passage ne semblait assez large.
      const radius = fixed ? Math.min(1.5, Math.max(0.3, ((x2 - x1) * g.d) / focal / 2 / 1.3)) : kind.radius;
      const h = Math.hypot(g.dx, g.dz) || 1;
      const back = fixed ? 0 : kind.length;
      let x = g.x + (g.dx / h) * back, z = g.z + (g.dz / h) * back;
      // Identité de l'objet. Le suivi du serveur (ByteTrack) est propre à chaque caméra et perd parfois un objet ; une
      // identité tirée de la position changeait dès que la position tremblait. Avant, un véhicule garé changeait donc sans
      // cesse d'identité : SMART AI ne le voyait jamais immobile assez longtemps pour le contourner, et attendait derrière.
      // Désormais : même identifiant de suivi, sinon l'objet connu de même classe le plus proche (position prédite).
      let id = known(o);
      if (!id) {
        id = !fixed && o.id >= 0 ? `vision-${view}-${o.id}` : '';
        // L'erreur sur la distance croît avec son carré : 4 pixels de tremblement font ~0,7 m à 10 m, ~9 m à 35 m.
        let best = '', bd = (fixed ? GATE_FIXED : GATE) + Math.min(8, ((g.d * g.d) / (focal * HEIGHT)) * 4);
        for (const [k, tr] of this.tracks) {
          if (tr.det.cls !== kind.cls || used.has(k)) continue;
          const late = t - tr.t;
          const dd = Math.hypot(tr.x + tr.det.vx * late - x, tr.z + tr.det.vz * late - z);
          if (dd < bd) { bd = dd; best = k; }
        }
        if (best) {
          if (id) this.tracks.get(best)!.alias = id;
          id = best;
        } else id = id && !used.has(id) ? id : `vision-${fixed ? 'nid' : o.categorie}-${++this.seq}`;
      }
      used.add(id);
      const before = this.tracks.get(id);
      const rawX = x, rawZ = z;
      // Bruit de mesure attendu à cette distance (m) : sous ce seuil, un écart de position n'est pas un mouvement.
      const noise = 0.4 + ((g.d * g.d) / (focal * HEIGHT)) * 4;
      let vx = 0, vz = 0, ax = rawX, az = rawZ, at = t;
      if (before && !fixed) {
        // Vitesse : écart au point d'ancrage (dernière position sûre), retenu seulement s'il dépasse le bruit de mesure.
        // Avant, le tremblement des boîtes donnait à une voiture garée lointaine jusqu'à 10 m/s : jamais vue immobile.
        ax = before.ax ?? before.x; az = before.az ?? before.z; at = before.at ?? before.t;
        const dt = t - at, moved = Math.hypot(rawX - ax, rawZ - az);
        if (moved > noise && dt > 0.02) {
          const rx = (rawX - ax) / dt, rz = (rawZ - az) / dt;
          const k = Math.hypot(before.det.vx, before.det.vz) > 0 ? 0.5 : 1;
          vx = before.det.vx + (rx - before.det.vx) * k;
          vz = before.det.vz + (rz - before.det.vz) * k;
          ax = rawX; az = rawZ; at = t;
        } else if (dt < 1.2) {
          // Pas encore assez de recul pour trancher : la vitesse connue est gardée.
          vx = before.det.vx; vz = before.det.vz;
        } else { ax = before.ax ?? rawX; az = before.az ?? rawZ; at = t - 0.6; }
        const sp = Math.hypot(vx, vz);
        if (sp > 25) { vx *= 25 / sp; vz *= 25 / sp; }
      }
      // Position d'un objet immobile lissée : celle tirée d'une boîte tremble de quelques dizaines de centimètres.
      if (before && (fixed || Math.hypot(vx, vz) < 0.6)) {
        const k = fixed ? 0.3 : 0.5;
        x = before.x + (x - before.x) * k;
        z = before.z + (z - before.z) * k;
      }
      const speed = Math.hypot(vx, vz);
      const moving = speed > 0.6;
      const heading = moving ? Math.atan2(vx, vz) : before?.det.heading ?? Math.atan2(g.dx, g.dz);
      const r = fixed && before ? before.det.radius + (radius - before.det.radius) * 0.3 : radius;
      this.tracks.set(id, {
        t, x, z, ax, az, at, alias: before?.alias,
        det: { id, cls: kind.cls, x, z, vx: moving ? vx : 0, vz: moving ? vz : 0, heading, radius: r, length: fixed ? r : kind.length, fixed, source: this.name, confidence: o.confiance },
      });
    }
  }

  detect({ sim, range }: PerceptionContext): Detection[] {
    this.capture(sim);
    const now = performance.now() / 1000, c = sim.car;
    const out: Detection[] = [];
    for (const [id, tr] of this.tracks) {
      if (now - tr.t > (tr.det.fixed && tr.det.cls === 'nid-de-poule' ? MEMORY_FIXED : MEMORY)) { this.tracks.delete(id); continue; }
      // Position avancée jusqu'à maintenant : la réponse du serveur a toujours un peu de retard.
      const late = now - tr.t;
      const det = { ...tr.det, x: tr.x + tr.det.vx * late, z: tr.z + tr.det.vz * late };
      if (Math.hypot(det.x - c.x, det.z - c.z) < range) out.push(det);
    }
    return out;
  }
}

/**
 * Collecte d'images d'entraînement (lien ?collecte=1) : pendant que SMART AI conduit avec l'état réel du jeu,
 * la caméra avant photographie la route toutes les demi-secondes, et chaque image part au serveur
 * avec les cadres exacts des usagers, calculés d'après la scène. Aucune annotation à la main.
 */
export class VisionCollector {
  sent = 0;
  private camera = newCamera('avant');
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private busy = false;
  private last = -Infinity;
  private shoot: Shooter;
  private label: Labeler;
  private url: string;

  constructor(shoot: Shooter, label: Labeler, url = VISION_URL) {
    this.shoot = shoot;
    this.label = label;
    this.url = url;
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
  }

  tick(sim: GameSim) {
    const now = performance.now() / 1000;
    // À l'arrêt, la vue change peu : une image toutes les 3 s suffit.
    if (this.busy || now - this.last < (Math.abs(sim.car.speed) > 0.5 ? 0.5 : 3)) return;
    this.last = now;
    aimCamera(this.camera, sim);
    if (!this.shoot(this.camera, W, H, this.ctx)) return;
    const labels = this.label(this.camera, W, H);
    this.busy = true;
    this.canvas.toBlob((blob) => {
      if (!blob) { this.busy = false; return; }
      fetch(`${this.url}/collecter`, { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-etiquettes': JSON.stringify(labels) }, body: blob })
        .then((r) => { if (r.ok) this.sent++; })
        .catch(() => {})
        .finally(() => { this.busy = false; });
    }, 'image/jpeg', 0.9);
  }
}
