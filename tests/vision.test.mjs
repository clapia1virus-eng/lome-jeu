// Capteur de vision de SMART AI : des boîtes du détecteur YOLO aux objets dans le monde, avec une identité stable.
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Le capteur prépare ses images dans des canvas : sous Node, des canvas factices suffisent (on n'envoie aucune image).
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }) };
// Horloge du capteur pilotée par le test : une image de la caméra avant toutes les 0,3 s, comme dans le jeu.
let clock = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock * 1000 }, configurable: true });
const THREE = await import('../client/node_modules/three/build/three.module.js');
const { VisionSensor } = await import('../client/src/moteur/smart-ai/vision.ts');

const W = 640, H = 360;
/** Caméra avant d'une voiture en (0, 0) regardant vers +z, comme celle du capteur. */
function camera() {
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.3, 4000);
  cam.position.set(0, 1.35, 2.5);
  cam.lookAt(0, 0.6, 25);
  cam.updateMatrixWorld();
  return cam;
}
/** Boîte à l'écran d'un objet posé au sol en (x, z), de demi-largeur « half » et de hauteur « height ». */
function box(cam, x, z, half, height, jitter) {
  const p = (px, py, pz) => { const v = new THREE.Vector3(px, py, pz).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
  const [u1, v1] = p(x + half, height, z), [u2, v2] = p(x - half, 0, z);
  return [Math.min(u1, u2) + jitter, Math.min(v1, v2) + jitter, Math.max(u1, u2) - jitter, Math.max(v1, v2) + jitter];
}

test('Vision : voitures garées, voiture qui roule et nid-de-poule gardent chacun une identité ; le tremblement des boîtes ne fait pas rouler une voiture garée', () => {
  const sensor = new VisionSensor(() => false, 'http://localhost:1');
  const cam = camera();
  const all = new Set();
  let lastSpeed = null, movingSpeed = null;
  for (let f = 0; f < 40; f++) {
    const j = Math.sin(f * 1.7) * 3;   // ±3 pixels
    // Le suivi du serveur : tantôt aucun identifiant, tantôt un nouveau (objet perdu puis retrouvé).
    const track = f % 3 === 0 ? -1 : 10 + Math.floor(f / 7);
    sensor.integrate([
      { categorie: 'vehicule', confiance: 0.8, boite: box(cam, -1.8, 20, 0.95, 1.5, j), id: track },
      { categorie: 'vehicule', confiance: 0.8, boite: box(cam, 4, 35, 0.95, 1.5, -j), id: f % 2 ? 50 : -1 },
      // Une voiture qui roule vers nous à 3,3 m/s (1 m par image) sur l'autre voie, suivie par le serveur.
      { categorie: 'vehicule', confiance: 0.8, boite: box(cam, -5.5, 45 - f, 0.95, 1.5, j), id: 77 },
      { categorie: 'nid_de_poule', confiance: 0.6, boite: box(cam, 0.5, 12, 0.6, 0.05, j / 2), id: -1 },
    ], cam, 'avant', clock);
    clock += 0.3;
    const dets = sensor.detect({ sim: { car: { x: 0, z: 0, speed: 0, heading: 0, kind: 'berline' } }, range: 150 });
    assert.equal(new Set(dets.map((d) => d.id)).size, dets.length, `image ${f} : chaque objet a sa propre identité`);
    for (const d of dets) all.add(d.id);
    // La voiture garée proche est la voiture la plus proche de (−1,8 ; 20) ; celle qui roule, la plus à gauche.
    const cars = dets.filter((d) => d.cls === 'voiture');
    const parked = cars.reduce((a, b) => (Math.hypot(a.x + 1.8, a.z - 20) < Math.hypot(b.x + 1.8, b.z - 20) ? a : b));
    lastSpeed = Math.hypot(parked.vx, parked.vz);
    const mobile = cars.reduce((a, b) => (a.x / a.z < b.x / b.z ? a : b));
    if (f > 20) movingSpeed = Math.hypot(mobile.vx, mobile.vz);
  }
  assert.equal(all.size, 4, `4 objets, 4 identités en 40 images (${[...all].join(', ')})`);
  assert.equal(lastSpeed, 0, 'la voiture garée est vue immobile : le tremblement des boîtes ne lui donne pas de vitesse');
  assert.ok(movingSpeed > 2 && movingSpeed < 5, `la vitesse de la voiture qui roule est mesurée (${movingSpeed?.toFixed(1)} m/s pour 3,3)`);
});
