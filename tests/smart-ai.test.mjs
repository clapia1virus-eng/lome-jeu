// SMART AI : conduite autonome, éprouvée sur la simulation du jeu (sans rendu), avec de vrais piétons, véhicules, obstacles et nids-de-poule.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { GameSim } = await import('../client/src/moteur/sim.ts');
const { SmartAIController } = await import('../client/src/moteur/smart-ai/controller.ts');

/** Une rue droite à double sens, de 800 m : voies à 2 m de l'axe, chaussée de 8 m. On roule vers +z, sur la voie x = −2. */
function road({ colliders = [], potholes = [], junctions = [], impassable = [], sensors } = {}) {
  const world = {
    kind: 'grid', start: { x: -2, z: 10, heading: 0 }, steps: [{ kind: 'ignite', text: '', x: 0, z: 0 }], park: { x: 0, z: 0, heading: 0, halfW: 1, halfL: 2 },
    nodes: [[0, 0], [0, 800]], edges: [{ a: 0, b: 1, p: [[0, 0], [0, 800]], l: 2, r: 4 }, { a: 1, b: 0, p: [[0, 800], [0, 0]], l: 2, r: 4 }],
    junctions, colliders, potholes, impassable, inBounds: () => true, mapLines: [], mapWindow: 0, boundsMessage: '',
  };
  const sim = new GameSim(world, true, 0);
  sim.startEngine();
  const ai = new SmartAIController(sim, sensors);
  const events = [];
  const step = (seconds, manual = { throttle: 0, brake: 0, steer: 0 }, each) => {
    for (let i = 0; i < seconds * 60; i++) {
      const input = ai.update(sim, 1 / 60) ?? manual;
      sim.update(1 / 60, input);
      events.push(...sim.drain());
      each?.();
    }
  };
  return { sim, ai, events, step };
}
const pieton = (x, z, target, cruise = 0) => ({ x, z, heading: 0, speed: 0, cruise, look: 0, targets: [target], edge: 0, wait: 0, phase: 0 });
const kmh = (sim) => sim.car.speed * 3.6;
const front = (sim) => sim.car.z + 2.0;

test('SMART AI 1 : désactivée, le véhicule obéit au joueur comme avant', () => {
  const { sim, ai, step } = road();
  assert.equal(ai.active, false);
  assert.equal(ai.update(sim, 1 / 60), null, 'aucune commande de l’IA');
  step(3, { throttle: 1, brake: 0, steer: 0 });
  assert.ok(kmh(sim) > 30, `le joueur accélère (${kmh(sim).toFixed(0)} km/h)`);
  assert.ok(Math.abs(sim.car.heading) < 1e-6, 'aucun coup de volant');
});

// Rue de 4,6 m entre deux murs : aucun passage possible à côté d'un piéton.
const narrowWalls = [[[-4.6, 0], [-4.3, 0], [-4.3, 400], [-4.6, 400]], [[0.3, 0], [0.6, 0], [0.6, 400], [0.3, 400]]];

test('SMART AI 4 (exigé) : piéton qui bloque complètement le passage, arrêt et attente, puis reprise quand il est parti', () => {
  const { sim, ai, events, step } = road({ colliders: narrowWalls });
  sim.walkers.push(pieton(-2, 90, [-2, 1000]));
  ai.setActive(true, sim);
  let closest = Infinity, maxSpeed = 0, bypassed = false;
  step(25, undefined, () => {
    closest = Math.min(closest, Math.hypot(sim.walkers[0].x - sim.car.x, sim.walkers[0].z - sim.car.z) - 2);
    maxSpeed = Math.max(maxSpeed, kmh(sim));
    if (ai.lastDecision?.action === 'CONTOURNER') bypassed = true;
  });
  assert.ok(maxSpeed > 35, `il roule d’abord (${maxSpeed.toFixed(0)} km/h)`);
  assert.ok(!bypassed, 'aucun contournement : il n’y a pas la place');
  assert.ok(sim.car.speed < 0.3, `arrêté (${kmh(sim).toFixed(1)} km/h)`);
  assert.ok(closest > 1.5, `distance gardée (${closest.toFixed(1)} m)`);
  assert.equal(ai.status.objet, 'PIÉTON');
  assert.ok(!events.includes('walker') && !events.includes('hit'), 'aucun choc');
  // Le piéton s'en va : la voie se libère, le véhicule repart de lui-même.
  Object.assign(sim.walkers[0], { x: -2, z: 400 });
  step(8);
  assert.ok(kmh(sim) > 20, `reprise automatique (${kmh(sim).toFixed(0)} km/h)`);
});

test('SMART AI : piéton arrêté sur la voie avec de la place, contourné largement puis retour dans la voie', () => {
  const { sim, ai, events, step } = road();
  sim.walkers.push(pieton(-2, 90, [-2, 1000]));
  ai.setActive(true, sim);
  let closest = Infinity, bypassed = false, slowEnough = true;
  step(30, undefined, () => {
    const w = sim.walkers[0];
    const d = Math.hypot(w.x - sim.car.x, w.z - sim.car.z);
    closest = Math.min(closest, d);
    if (ai.lastDecision?.action === 'CONTOURNER') bypassed = true;
    if (d < 4 && kmh(sim) > 14) slowEnough = false;
  });
  assert.ok(bypassed, 'contournement du piéton');
  assert.ok(closest > 2.3, `passé largement (${closest.toFixed(1)} m du centre)`);
  assert.ok(slowEnough, 'au pas près du piéton');
  assert.ok(sim.car.z > 130 && Math.abs(sim.car.x + 2) < 0.6, `retour dans la voie (x ${sim.car.x.toFixed(2)}, z ${sim.car.z.toFixed(0)})`);
  assert.ok(!events.includes('walker') && !events.includes('hit'));
});

test('SMART AI 3 (exigé) : piéton qui traverse, le véhicule le laisse passer sans le toucher', () => {
  const { sim, ai, events, step } = road();
  sim.walkers.push(pieton(-7, 75, [7, 75], 1.3));
  ai.setActive(true, sim);
  let closest = Infinity, braked = false;
  step(30, undefined, () => {
    const w = sim.walkers[0];
    closest = Math.min(closest, Math.hypot(w.x - sim.car.x, w.z - sim.car.z));
    if (['FREINER', 'ARRET'].includes(ai.lastDecision?.action) && ai.lastDecision.threat?.det.cls === 'pieton') braked = true;
  });
  assert.ok(braked, 'freinage pour le piéton');
  assert.ok(closest > 2, `distance gardée (${closest.toFixed(1)} m)`);
  assert.ok(sim.car.z > 100, 'il est reparti après le passage');
  assert.ok(!events.includes('walker') && !events.includes('hit'));
});

test('SMART AI 3 : moto lente devant, le véhicule ralentit et garde ses distances', () => {
  const { sim, ai, events, step } = road();
  sim.traffic.push({ x: -2, z: 70, heading: 0, speed: 5, cruise: 5, color: 0, targets: [[-2, 790]], edge: 0, kind: 'moto' });
  ai.setActive(true, sim);
  let minGap = Infinity;
  step(30, undefined, () => { const m = sim.traffic[0]; minGap = Math.min(minGap, m.z - 0.9 - front(sim)); });
  const m = sim.traffic[0];
  assert.ok(Math.abs(sim.car.speed - m.speed) < 1.5, `vitesse calée sur la moto (${kmh(sim).toFixed(0)} contre ${(m.speed * 3.6).toFixed(0)} km/h)`);
  assert.ok(minGap > 5, `distance de sécurité (${minGap.toFixed(1)} m)`);
  assert.ok(['RALENTIR', 'CONTINUER', 'FREINER'].includes(ai.lastDecision.action));
  assert.match(ai.status.objet, /MOTO/);
  assert.ok(!events.includes('hit'));
});

test('Klaxon, conduite manuelle : la voiture devant se range à droite et s’arrête, puis reprend sa voie une fois dépassée', () => {
  const { sim, step } = road();
  sim.traffic.push({ x: -2, z: 40, heading: 0, speed: 4, cruise: 4, color: 0, targets: [[-2, 790]], edge: 0, kind: 'berline' });
  const t = sim.traffic[0];
  step(1);
  assert.equal(sim.honk(), 1, 'un véhicule devant se range');
  step(6);
  assert.ok(t.x < -3.2, `rangé à droite (x = ${t.x.toFixed(2)}, voie à −2)`);
  assert.ok(t.speed < 0.3, `arrêté pour laisser passer (${t.speed.toFixed(2)} m/s)`);
  // Un véhicule qui arrive en face n'est pas concerné.
  Object.assign(sim.car, { z: t.z - 15, speed: 0 });
  sim.traffic.push({ x: 2, z: 60, heading: Math.PI, speed: 6, cruise: 6, color: 0, targets: [[2, 0]], edge: 1, kind: 'berline' });
  assert.equal(sim.honk(), 1, 'seul celui de devant, dans le même sens');
  sim.traffic.pop();
  // Le joueur le dépasse : il revient dans sa voie et repart.
  Object.assign(sim.car, { x: 2, z: t.z + 15, speed: 0 });
  step(8);
  assert.ok(Math.abs(t.x + 2) < 0.5, `revenu dans sa voie (x = ${t.x.toFixed(2)})`);
  assert.ok(t.speed > 3, 'reparti');
});

test('Klaxon avec SMART AI : la voiture lente devant se range, SMART AI la dépasse sans aucun choc', () => {
  const { sim, ai, events, step } = road();
  sim.traffic.push({ x: -2, z: 45, heading: 0, speed: 2, cruise: 2, color: 0, targets: [[-2, 790]], edge: 0, kind: 'berline' });
  const t = sim.traffic[0];
  ai.setActive(true, sim);
  step(10);
  assert.ok(sim.car.z < t.z, 'SMART AI suit la voiture lente');
  let closest = Infinity, passed = -1;
  for (let i = 0; i < 40 && passed < 0; i++) {
    sim.honk();
    step(0.5, undefined, () => { closest = Math.min(closest, Math.hypot(sim.car.x - t.x, sim.car.z - t.z)); });
    if (sim.car.z > t.z + 8) passed = i * 0.5;
  }
  assert.ok(passed >= 0, `SMART AI a dépassé la voiture klaxonnée (voiture à z = ${t.z.toFixed(0)}, joueur à ${sim.car.z.toFixed(0)})`);
  assert.ok(!events.includes('hit'), 'aucun choc');
  assert.ok(closest > 2.1, `jamais au contact (${closest.toFixed(2)} m entre les centres)`);
});

test('SMART AI 4 : un mur barre toute la rue, arrêt avant lui, puis demi-tour pour rebrousser chemin', () => {
  const wall = [[-8, 120], [8, 120], [8, 121], [-8, 121]];
  const { sim, ai, events, step } = road({ colliders: [wall] });
  ai.setActive(true, sim);
  let stoppedBefore = false, closest = Infinity, sawUturn = false, fled = false;
  step(40, undefined, () => {
    closest = Math.min(closest, 120 - front(sim));
    if (sim.car.speed < 0.3 && sim.car.z > 80 && Math.cos(sim.car.heading) > 0.9) stoppedBefore = true;
    if (ai.status.decision === 'DEMI-TOUR') sawUturn = true;
    // Rebrousser chemin : retourné, il roule vers l'entrée de la rue.
    if (Math.cos(sim.car.heading) < -0.8 && kmh(sim) > 15 && sim.car.z < 100) fled = true;
  });
  assert.ok(stoppedBefore, 'arrêt devant le mur');
  assert.ok(closest > 0.5, `mur jamais touché (${closest.toFixed(1)} m)`);
  assert.ok(sawUturn, 'décision : demi-tour');
  assert.ok(fled, 'il repart dans l’autre sens');
  assert.ok(!events.includes('hit'));
});

test('SMART AI : impasse entre deux murs, demi-tour en plusieurs fois sans rien toucher', () => {
  // Rue de 8 m de large bordée de murs, fermée au bout : le demi-tour d'une traite est impossible.
  const walls = [[[-4.6, 0], [-4.3, 0], [-4.3, 160], [-4.6, 160]], [[4.3, 0], [4.6, 0], [4.6, 160], [4.3, 160]], [[-5, 160], [5, 160], [5, 161], [-5, 161]]];
  const { sim, ai, events, step } = road({ colliders: walls });
  sim.world.edges[0].p = [[0, 0], [0, 150]]; sim.world.edges[1].p = [[0, 150], [0, 0]];
  ai.setActive(true, sim);
  let reversed = false, fled = false;
  step(60, undefined, () => {
    if (sim.car.speed < -0.3) reversed = true;
    if (Math.cos(sim.car.heading) < -0.8 && kmh(sim) > 15 && sim.car.z < 120) fled = true;
  });
  assert.ok(reversed, 'marche arrière pendant le demi-tour');
  assert.ok(fled, 'retourné, il repart vers l’entrée de la rue');
  assert.ok(!events.includes('hit'), `aucun choc (${events.filter((e) => e === 'hit').length})`);
});

test('SMART AI : véhicule garé juste devant, marche arrière pour prendre de l’élan, puis contournement', () => {
  const { sim, ai, events, step } = road();
  sim.car.z = 84;
  sim.parked.push({ x: -2.3, z: 90, heading: 0, kind: 'suv', color: 0 });
  ai.setActive(true, sim);
  let backed = false, sawRecul = false;
  step(40, undefined, () => { if (sim.car.speed < -0.3) backed = true; if (ai.status.decision === 'RECUL') sawRecul = true; });
  assert.ok(sawRecul && backed, 'recul effectué');
  assert.ok(sim.car.z > 110, `obstacle dépassé (z ${sim.car.z.toFixed(0)})`);
  assert.ok(!events.includes('hit'));
});

test('SMART AI : véhicule en panne sur la voie, attente puis contournement', () => {
  const { sim, ai, events, step } = road();
  sim.traffic.push({ x: -2, z: 90, heading: 0, speed: 0, cruise: 0, color: 0, targets: [[-2, 790]], edge: 0, kind: 'berline' });
  ai.setActive(true, sim);
  let waited = 0;
  step(60, undefined, () => { if (sim.car.speed < 0.3 && sim.car.z < 90) waited += 1 / 60; });
  // Attente d'environ 8 s derrière lui (10 s d'immobilité, comptées à moins de 30 m), puis contournement.
  assert.ok(waited > 5 && waited < 15, `il attend d’abord, sans s’éterniser (${waited.toFixed(0)} s)`);
  assert.ok(sim.car.z > 110, `puis il contourne (z ${sim.car.z.toFixed(0)})`);
  assert.ok(!events.includes('hit'));
});

test('SMART AI : véhicule collé devant, invisible pour la caméra, les ultrasons l’empêchent de foncer dedans', async () => {
  // Régression vue dans le jeu : une voiture à 1 m remplit l'image, YOLO ne la reconnaît plus, SMART AI accélérait contre elle.
  // Ici, aucun capteur ne voit les usagers (comme la caméra dans cet angle mort) : seuls les ultrasons les sentent.
  const { GameStateSensor, UltrasonicSensor } = await import('../client/src/moteur/smart-ai/detector.ts');
  const { sim, ai, events, step } = road({ sensors: [new GameStateSensor({ users: false }), new UltrasonicSensor()] });
  sim.traffic.push({ x: -2, z: 16, heading: 0, speed: 0, cruise: 0, color: 0, targets: [[-2, 790]], edge: 0, kind: 'berline' });
  ai.setActive(true, sim);
  step(6);
  assert.ok(!events.includes('hit'), 'aucun choc');
  assert.ok(sim.car.z < 13, `il reste derrière (z ${sim.car.z.toFixed(1)})`);
});

test('SMART AI : moto arrêtée tout contre la voiture, perçue par les seuls ultrasons ; on attend qu’elle reparte, sans demi-tour', async () => {
  // Régression vue dans Lomé : une moto attendait dans un virage, collée à la voiture. Les ultrasons la signalaient comme
  // un obstacle ; au bout de 2 s, SMART AI lançait un demi-tour puis reculait dans la rue étroite.
  const { GameStateSensor, UltrasonicSensor } = await import('../client/src/moteur/smart-ai/detector.ts');
  const { sim, ai, events, step } = road({ sensors: [new GameStateSensor({ users: false }), new UltrasonicSensor()] });
  const moto = { x: -2, z: 15, heading: 0, speed: 0, cruise: 0, color: 0, targets: [[-2, 790]], edge: 0, kind: 'moto' };
  sim.traffic.push(moto);
  ai.setActive(true, sim);
  let frame = 0, maneuver = false;
  step(16, undefined, () => {
    // La moto repart au bout de 6 s.
    if (++frame === 6 * 60) { moto.cruise = 8; moto.speed = 2; }
    maneuver ||= !!ai.maneuver;
  });
  assert.ok(!events.includes('hit'), 'aucun choc');
  assert.ok(!maneuver, 'aucune manœuvre (demi-tour, marche arrière) pendant l’attente');
  assert.ok(sim.car.z > 30, `la voiture repart derrière la moto (z ${sim.car.z.toFixed(1)})`);
});

test('SMART AI : véhicule en biais collé devant, perçu par les seuls ultrasons, jamais poussé', async () => {
  // Régression vue dans le jeu : les ultrasons donnaient à tout véhicule un cap fixe ; une voiture en biais semblait hors
  // de la trajectoire, et SMART AI la poussait au pas pendant 2 minutes.
  const { GameStateSensor, UltrasonicSensor } = await import('../client/src/moteur/smart-ai/detector.ts');
  const { sim, ai, events, step } = road({ sensors: [new GameStateSensor({ users: false }), new UltrasonicSensor()] });
  sim.traffic.push({ x: 0.2, z: 16, heading: -1.0, speed: 0, cruise: 0, color: 0, targets: [[0.2, 16]], edge: 0, kind: 'berline' });
  ai.setActive(true, sim);
  // Écart entre les carrosseries : chaque véhicule est un segment (son axe) épaissi de sa demi-largeur.
  const { VEHICLES, halfWidth } = await import('../client/src/moteur/sim.ts');
  const axis = (o) => { const s = VEHICLES[o.kind], h = s.half + s.radius * 0.6 - halfWidth(o.kind); return [o.x - Math.sin(o.heading) * h, o.z - Math.cos(o.heading) * h, o.x + Math.sin(o.heading) * h, o.z + Math.cos(o.heading) * h]; };
  const gap = (a, b) => {
    const p = axis(a), q = axis(b); let m = Infinity;
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) m = Math.min(m, Math.hypot(p[0] + (p[2] - p[0]) * i / 20 - q[0] - (q[2] - q[0]) * j / 20, p[1] + (p[3] - p[1]) * i / 20 - q[1] - (q[3] - q[1]) * j / 20));
    return m - halfWidth(a.kind) - halfWidth(b.kind);
  };
  let closest = Infinity;
  step(12, undefined, () => { closest = Math.min(closest, gap(sim.car, sim.traffic[0])); });
  assert.ok(!events.includes('hit'), 'aucun choc');
  assert.ok(closest > 0.3, `jamais au contact du véhicule (écart minimal ${closest.toFixed(2)} m)`);
});

test('SMART AI 5 : véhicule garé dans la voie, contournement par la voie libre puis retour', () => {
  const { sim, ai, events, step } = road();
  sim.parked.push({ x: -2.3, z: 90, heading: 0, kind: 'suv', color: 0 });
  ai.setActive(true, sim);
  let leftMost = -Infinity, sawBypass = false;
  step(30, undefined, () => { leftMost = Math.max(leftMost, sim.car.x); if (ai.lastDecision?.action === 'CONTOURNER') sawBypass = true; });
  assert.ok(sawBypass, 'décision de contournement');
  assert.ok(leftMost > -0.5, `écart vers la gauche (x max ${leftMost.toFixed(2)})`);
  assert.ok(sim.car.z > 130, 'obstacle dépassé');
  assert.ok(Math.abs(sim.car.x + 2) < 0.6, `retour dans sa voie (x ${sim.car.x.toFixed(2)})`);
  assert.ok(!events.includes('hit'));
});

test('SMART AI 5 ter : des piétons qui marchent vers nous au bord de la rue n’empêchent pas de contourner un véhicule garé', () => {
  // Régression vue dans Lomé : tout objet venant en face comptait comme une voiture qui arrive ; dans une rue animée,
  // le contournement était refusé tant que des piétons arrivaient (« véhicule en face »), et la voiture restait bloquée.
  // Un mur longe la droite : le seul passage est à gauche, du côté des piétons.
  const { sim, ai, events, step } = road({ colliders: [narrowWalls[0]] });
  sim.parked.push({ x: -1.5, z: 90, heading: 0, kind: 'suv', color: 0 });
  for (let z = 100; z <= 260; z += 20) sim.walkers.push(pieton(3.2, z, [3.2, 0], 1.3));
  ai.setActive(true, sim);
  let sawBypass = false, minGap = Infinity;
  step(25, undefined, () => {
    if (ai.lastDecision?.action === 'CONTOURNER') sawBypass = true;
    for (const w of sim.walkers) minGap = Math.min(minGap, Math.hypot(w.x - sim.car.x, w.z - sim.car.z));
  });
  assert.ok(sawBypass, 'décision de contournement');
  assert.ok(sim.car.z > 130, `véhicule garé dépassé (z ${sim.car.z.toFixed(1)})`);
  assert.ok(!events.includes('hit') && !events.includes('walker'), 'aucun choc');
  assert.ok(minGap > 1.5, `piéton frôlé à ${minGap.toFixed(2)} m`);
});

test('SMART AI 5 bis : jamais de contournement si un véhicule arrive en face', () => {
  const { sim, ai, events, step } = road();
  sim.parked.push({ x: -2.3, z: 90, heading: 0, kind: 'suv', color: 0 });
  sim.traffic.push({ x: 2, z: 200, heading: Math.PI, speed: 9, cruise: 9, color: 0, targets: [[2, 0]], edge: 1, kind: 'berline' });
  ai.setActive(true, sim);
  let overtookWhileOncoming = false, minDist = Infinity;
  step(35, undefined, () => {
    const o = sim.traffic[0];
    minDist = Math.min(minDist, Math.hypot(o.x - sim.car.x, o.z - sim.car.z));
    if (sim.car.x > -0.5 && o.z > sim.car.z) overtookWhileOncoming = true;
  });
  assert.ok(!overtookWhileOncoming, 'il attend que le véhicule d’en face soit passé');
  assert.ok(minDist > 2.5, `aucun frôlement (${minDist.toFixed(1)} m)`);
  assert.ok(sim.car.z > 110, 'puis il contourne');
  assert.ok(!events.includes('hit'));
});

test('SMART AI : nid-de-poule évité ou franchi au ralenti', () => {
  const { sim, ai, events, step } = road({ potholes: [{ x: -2, z: 80, r: 0.6 }] });
  ai.setActive(true, sim);
  let speedAt = null;
  step(20, undefined, () => { if (speedAt === null && sim.car.z > 80) speedAt = kmh(sim); });
  assert.ok(speedAt !== null && speedAt <= 32, `vitesse au passage (${speedAt?.toFixed(0)} km/h)`);
  assert.ok(!events.includes('nid'), 'aucune roue dans le trou');
});

test('SMART AI : feu rouge, arrêt à la ligne', () => {
  const junction = { x: 0, z: 200, r: 8, axis: 0, dirs: [0, Math.PI], node: 1 };
  const { sim, ai, step } = road({ junctions: [junction] });
  ai.setActive(true, sim);
  // Le feu reste rouge pour notre axe pendant tout l'essai.
  step(1);
  for (const group of [0, 1]) { sim.forced = { junction: 0, group }; if (sim.lightAt(0, 0) === 'red') break; }
  assert.equal(sim.lightAt(0, 0), 'red');
  step(30);
  assert.ok(sim.car.speed < 0.3 && front(sim) < 200 - 8 && front(sim) > 200 - 8 - 6, `arrêté à la ligne (avant ${front(sim).toFixed(1)})`);
  assert.equal(ai.status.objet, 'FEU ROUGE');
});

test('SMART AI 7 : désactivée, le joueur reprend la main', () => {
  const { sim, ai, step } = road();
  ai.setActive(true, sim);
  step(6);
  assert.ok(kmh(sim) > 30);
  ai.setActive(false, sim);
  assert.equal(ai.update(sim, 1 / 60), null);
  assert.equal(ai.status.actif, false);
  step(4, { throttle: 0, brake: 1, steer: 0 });
  assert.ok(sim.car.speed < 0.3, 'le frein du joueur arrête le véhicule');
  step(2, { throttle: 1, brake: 0, steer: 1 });
  assert.ok(Math.abs(sim.car.heading) > 0.3, 'le volant du joueur tourne le véhicule');
});

test('SMART AI dans Lomé : vraie carte, vraie circulation, vrais piétons ; aucun choc et la voiture avance', async () => {
  const { readFileSync } = await import('node:fs');
  const { pointInPoly } = await import('../client/src/moteur/sim.ts');
  const map = JSON.parse(readFileSync(new URL('../client/public/game/lome.json', import.meta.url)));
  for (const start of [120, 520]) {
    const e = map.edges[start], [a, b] = [e.p[0], e.p[1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const world = {
      kind: 'lome', start: map.start, freeStart: { x: a[0] + dx * 5 - dz * e.l, z: a[1] + dz * 5 + dx * e.l, heading: Math.atan2(dx, dz) }, steps: map.steps, park: map.park,
      nodes: map.nodes, edges: map.edges, junctions: map.junctions, colliders: map.buildings.map((x) => x.p), colliderHeights: map.buildings.map((x) => x.h),
      inBounds: (x, z) => pointInPoly(x, z, map.boundary) || map.boundary.some((q) => Math.hypot(q[0] - x, q[1] - z) < 400), mapLines: [], mapWindow: 0, boundsMessage: '',
    };
    const sim = new GameSim(world, true, 16, { walkers: 22, parked: true });
    const ai = new SmartAIController(sim);
    assert.ok(ai.setActive(true, sim));
    const events = [];
    let dist = 0, px = sim.car.x, pz = sim.car.z;
    const t0 = performance.now();
    for (let i = 0; i < 120 * 60; i++) {
      sim.update(1 / 60, ai.update(sim, 1 / 60));
      events.push(...sim.drain());
      dist += Math.hypot(sim.car.x - px, sim.car.z - pz); px = sim.car.x; pz = sim.car.z;
    }
    const ms = (performance.now() - t0) / (120 * 60);
    assert.ok(!events.includes('hit') && !events.includes('walker'), `départ ${start} : aucun choc (${events.filter((x) => x === 'hit' || x === 'walker').length})`);
    assert.ok(dist > 400, `départ ${start} : ${Math.round(dist)} m parcourus`);
    assert.ok(ms < 2, `départ ${start} : ${ms.toFixed(2)} ms par image, simulation comprise`);
  }
});

test('SMART AI : rue étroite à sens unique bloquée, marche arrière jusqu’au carrefour puis autre rue', () => {
  // Une rue de 4 m entre deux immeubles, bloquée par un mur ; au carrefour d'entrée, une rue part à gauche.
  const walls = [[[-2.6, 20], [-2.3, 20], [-2.3, 160], [-2.6, 160]], [[2.3, 20], [2.6, 20], [2.6, 160], [2.3, 160]], [[-3, 120], [3, 120], [3, 121], [-3, 121]]];
  const world = {
    kind: 'grid', start: { x: 0, z: 40, heading: 0 }, steps: [{ kind: 'ignite', text: '', x: 0, z: 0 }], park: { x: 0, z: 0, heading: 0, halfW: 1, halfL: 2 },
    nodes: [[0, -60], [0, 0], [0, 200], [-120, 0]],
    edges: [
      { a: 0, b: 1, p: [[0, -60], [0, 0]], l: 2, r: 5 }, { a: 1, b: 0, p: [[0, 0], [0, -60]], l: 2, r: 5 },
      { a: 1, b: 2, p: [[0, 0], [0, 200]], l: 0, r: 2 },
      { a: 1, b: 3, p: [[0, 0], [-120, 0]], l: 2, r: 5 }, { a: 3, b: 1, p: [[-120, 0], [0, 0]], l: 2, r: 5 },
    ],
    junctions: [], colliders: walls, potholes: [], inBounds: () => true, mapLines: [], mapWindow: 0, boundsMessage: '',
  };
  const sim = new GameSim(world, true, 0);
  sim.startEngine();
  const ai = new SmartAIController(sim);
  ai.setActive(true, sim);
  const events = [];
  let backed = false, sawRetour = false;
  for (let i = 0; i < 90 * 60; i++) {
    sim.update(1 / 60, ai.update(sim, 1 / 60));
    events.push(...sim.drain());
    if (sim.car.speed < -0.5) backed = true;
    if (ai.status.decision === 'MARCHE ARRIÈRE') sawRetour = true;
  }
  assert.ok(sawRetour && backed, 'marche arrière jusqu’au carrefour');
  assert.ok(sim.car.z < 20, `sorti de la rue étroite (z ${sim.car.z.toFixed(0)})`);
  assert.ok(Math.hypot(sim.car.x, sim.car.z) > 15, `reparti par une autre rue (x ${sim.car.x.toFixed(0)}, z ${sim.car.z.toFixed(0)})`);
  assert.ok(!events.includes('hit'), `aucun choc (${events.filter((e) => e === 'hit').length})`);
});

test('SMART AI conduite libre : sur un rond-point, au plus un tour, puis une sortie (jamais en rond sans fin)', () => {
  // Vu dans Lomé : sans destination, la voiture prenait toujours la suite la plus droite, et sur un rond-point
  // c'est l'anneau : elle tournait sans fin. Ici, un anneau carré à sens unique (A→B→C→D→A) et une sortie en C,
  // plus serrée que l'anneau.
  const world = {
    kind: 'grid', start: { x: 0, z: -90, heading: 0 }, steps: [{ kind: 'ignite', text: '', x: 0, z: 0 }], park: { x: 0, z: 0, heading: 0, halfW: 1, halfL: 2 },
    nodes: [[0, -100], [0, 0], [0, 40], [40, 40], [40, 0], [25, 66], [-60, 210]],
    edges: [
      { a: 0, b: 1, p: [[0, -100], [0, 0]], l: 0, r: 4 }, { a: 1, b: 2, p: [[0, 0], [0, 40]], l: 0, r: 4 }, { a: 2, b: 3, p: [[0, 40], [40, 40]], l: 0, r: 4 },
      { a: 3, b: 4, p: [[40, 40], [40, 0]], l: 0, r: 4 }, { a: 4, b: 1, p: [[40, 0], [0, 0]], l: 0, r: 4 },
      { a: 3, b: 5, p: [[40, 40], [25, 66]], l: 0, r: 4 }, { a: 5, b: 6, p: [[25, 66], [-60, 210]], l: 0, r: 4 },
    ],
    junctions: [], colliders: [], potholes: [], inBounds: () => true, mapLines: [], mapWindow: 0, boundsMessage: '',
  };
  const sim = new GameSim(world, true, 0);
  sim.startEngine();
  const ai = new SmartAIController(sim);
  ai.setActive(true, sim);
  let laps = 0, wasNearC = false, left = false;
  for (let i = 0; i < 150 * 60; i++) {
    sim.update(1 / 60, ai.update(sim, 1 / 60) ?? { throttle: 0, brake: 0, steer: 0 });
    sim.drain();
    const nearC = Math.hypot(sim.car.x - 40, sim.car.z - 40) < 6;
    if (nearC && !wasNearC) laps++;
    wasNearC = nearC;
    if (sim.car.z > 100) { left = true; break; }
  }
  assert.ok(left, `sortie du rond-point (voiture en ${sim.car.x.toFixed(0)}, ${sim.car.z.toFixed(0)}, ${laps} passages en C)`);
  assert.ok(laps <= 2, `au plus un tour complet (${laps} passages en C)`);
});

/* Itinéraire, passages alternatifs, anti-blocage */

test('SMART AI 1 (exigé) : destination derrière le véhicule, demi-tour puis arrêt à la destination', () => {
  const { sim, ai, events, step } = road();
  sim.car.z = 200;
  ai.setActive(true, sim);
  ai.setDestination([-2, 60]);
  let sawUturn = false, reversed = false;
  step(60, undefined, () => { if (ai.status.decision === 'DEMI-TOUR') sawUturn = true; if (sim.car.speed < -0.3) reversed = true; });
  assert.ok(sawUturn, 'demi-tour décidé');
  assert.ok(ai.currentRoute && ai.routeCount === 1, `itinéraire inchangé (${ai.routeCount} calcul)`);
  assert.ok(Math.cos(sim.car.heading) < -0.8, 'retourné vers la destination');
  assert.ok(Math.abs(sim.car.z - 60) < 8 && sim.car.speed < 0.3, `arrêté à la destination (z ${sim.car.z.toFixed(1)})`);
  assert.match(ai.status.navigation, /Destination atteinte/);
  assert.ok(!events.includes('hit'));
});

test('SMART AI 2 (exigé) : demi-tour pour rejoindre l’itinéraire par une rue de côté', () => {
  // Grande rue nord-sud et, au carrefour du km 100, une rue vers l'ouest. Le véhicule est 100 m trop loin au nord.
  const world = {
    kind: 'grid', start: { x: -2, z: 200, heading: 0 }, steps: [{ kind: 'ignite', text: '', x: 0, z: 0 }], park: { x: 0, z: 0, heading: 0, halfW: 1, halfL: 2 },
    nodes: [[0, 0], [0, 100], [0, 400], [-150, 100]],
    edges: [
      { a: 0, b: 1, p: [[0, 0], [0, 100]], l: 2, r: 4 }, { a: 1, b: 0, p: [[0, 100], [0, 0]], l: 2, r: 4 },
      { a: 1, b: 2, p: [[0, 100], [0, 400]], l: 2, r: 4 }, { a: 2, b: 1, p: [[0, 400], [0, 100]], l: 2, r: 4 },
      { a: 1, b: 3, p: [[0, 100], [-150, 100]], l: 2, r: 4 }, { a: 3, b: 1, p: [[-150, 100], [0, 100]], l: 2, r: 4 },
    ],
    junctions: [], colliders: [], potholes: [], inBounds: () => true, mapLines: [], mapWindow: 0, boundsMessage: '',
  };
  const sim = new GameSim(world, true, 0);
  sim.startEngine();
  const ai = new SmartAIController(sim);
  ai.setActive(true, sim);
  ai.setDestination([-100, 102]);
  const events = [];
  let sawUturn = false;
  for (let i = 0; i < 90 * 60; i++) {
    sim.update(1 / 60, ai.update(sim, 1 / 60));
    events.push(...sim.drain());
    if (ai.status.decision === 'DEMI-TOUR') sawUturn = true;
  }
  assert.ok(sawUturn, 'demi-tour pour rejoindre l’itinéraire');
  assert.deepEqual(ai.currentRoute.edges, [3, 4], 'itinéraire suivi : retour vers le carrefour, puis la rue de l’ouest');
  assert.ok(Math.hypot(sim.car.x + 100, sim.car.z - 102) < 9 && sim.car.speed < 0.3, `arrivé (x ${sim.car.x.toFixed(0)}, z ${sim.car.z.toFixed(0)})`);
  assert.ok(!events.includes('hit'));
});

test('SMART AI 6 (exigé) : chaussée barrée, passage par le bas-côté praticable, puis retour dans la voie', () => {
  // Une barrière occupe toute la chaussée (x de −4 à 4) ; à l'ouest (x < −4), un terre-plein dégagé.
  const barrier = [[-4, 100], [4, 100], [4, 101.5], [-4, 101.5]];
  const { sim, ai, events, step } = road({ colliders: [barrier] });
  ai.setActive(true, sim);
  let offroad = false;
  step(45, undefined, () => { if (sim.car.x < -4.2) offroad = true; });
  assert.ok(offroad, 'passage par le bas-côté');
  assert.match(ai.status.passages + ' ' + JSON.stringify(ai.lastDecision), /bas-côté|CONTINUER/);
  assert.ok(sim.car.z > 130, `barrière dépassée (z ${sim.car.z.toFixed(0)})`);
  assert.ok(Math.abs(sim.car.x + 2) < 0.6, `retour dans la voie (x ${sim.car.x.toFixed(2)})`);
  assert.ok(!events.includes('hit'));
});

test('SMART AI 8 (exigé) : chaussée barrée et bas-côtés impraticables (eau), aucun passage par l’eau', () => {
  const barrier = [[-4, 100], [4, 100], [4, 101.5], [-4, 101.5]];
  const water = [[[-30, 40], [-4.05, 40], [-4.05, 300], [-30, 300]], [[4.05, 40], [30, 40], [30, 300], [4.05, 300]]];
  const { sim, ai, events, step } = road({ colliders: [barrier], impassable: water });
  ai.setActive(true, sim);
  let wet = false, sawRefusal = false;
  step(50, undefined, () => {
    if (Math.abs(sim.car.x) > 4.05 + 0.2 && sim.car.z > 40) wet = true;
    if (/impraticable/.test(ai.status.passages)) sawRefusal = true;
  });
  assert.ok(!wet, 'jamais dans l’eau');
  assert.ok(sawRefusal, 'bas-côté refusé : terrain impraticable');
  assert.ok(sim.car.z < 100, 'barrière jamais franchie');
  assert.ok(!events.includes('hit'));
});

test('SMART AI arrivée : voie fermée à quelques mètres du but, la voiture se gare au lieu de faire demi-tour', () => {
  // Vu dans le jeu : l'itinéraire de l'Hôtel 2 Février finit dans une allée fermée par une voiture garée ;
  // SMART AI enchaînait demi-tours et marches arrière à 25 m du but.
  const barrier = [[-4, 100], [4, 100], [4, 101.5], [-4, 101.5]];
  const water = [[[-30, 40], [-4.05, 40], [-4.05, 300], [-30, 300]], [[4.05, 40], [30, 40], [30, 300], [4.05, 300]]];
  const { sim, ai, events, step } = road({ colliders: [barrier], impassable: water });
  ai.setActive(true, sim);
  ai.setDestination([-2, 125]);
  let manoeuvre = false;
  step(40, undefined, () => { if (/DEMI-TOUR|MARCHE ARRIÈRE|RECUL/.test(ai.status.decision)) manoeuvre = true; });
  assert.match(ai.status.navigation, /Destination atteinte/);
  assert.ok(ai.arrived, 'arrivée signalée au jeu');
  assert.ok(!manoeuvre, 'aucun demi-tour ni marche arrière');
  assert.ok(sim.car.z < 100 && sim.car.z > 85 && Math.abs(sim.car.speed) < 0.3, `garée devant la barrière (z ${sim.car.z.toFixed(1)})`);
  assert.ok(!events.includes('hit'));
});

test('SMART AI 9 (exigé) : véhicule enfermé, il cherche des solutions puis s’arrête en sécurité, sans boucle', () => {
  // Rue étroite fermée devant et derrière : ni contournement, ni demi-tour, ni marche arrière jusqu'au carrefour.
  const walls = [[[-4.6, 0], [-4.3, 0], [-4.3, 200], [-4.6, 200]], [[0.3, 0], [0.6, 0], [0.6, 200], [0.3, 200]], [[-5, 120], [1, 120], [1, 121], [-5, 121]], [[-5, 70], [1, 70], [1, 71], [-5, 71]]];
  const { sim, ai, events, step } = road({ colliders: walls });
  sim.car.z = 85;
  ai.setActive(true, sim);
  let tries = 0;
  step(150, undefined, () => { tries = Math.max(tries, ai.antiBlock.count); });
  assert.ok(ai.antiBlock.halted, `arrêt sécurisé (${ai.antiBlock.state})`);
  assert.ok(tries >= 1 && tries <= 5, `quelques tentatives, pas de boucle (${tries})`);
  assert.match(ai.status.message, /Arrêt sécurisé.*reprenez le volant/);
  assert.equal(ai.status.couleur, 'rouge');
  assert.ok(sim.car.speed > -0.3 && sim.car.speed < 0.3, 'immobile à la fin');
  assert.ok(!events.includes('hit'), `aucun choc (${events.filter((e) => e === 'hit').length})`);
});

test('SMART AI 9 bis : le système anti-blocage repère un véhicule qui n’avance plus malgré la commande', async () => {
  const { AntiBlockage } = await import('../client/src/moteur/smart-ai/antiblock.ts');
  const a = new AntiBlockage();
  let cause = null;
  for (let i = 0; i < 5 * 60 && !cause; i++) cause = a.watch(1 / 60, 10 + i * 0.0005, 20, 0.2, 5, null);
  assert.equal(cause, 'immobilise');
  // Les tentatives sont comptées et plafonnées : au-delà, arrêt sécurisé avec explication.
  for (let k = 0; k < 6; k++) a.record('recul', k * 20, 0, 'immobilise');
  assert.ok(a.halted);
  assert.match(a.message, /véhicule immobilisé/);
});

test('SMART AI 10 (exigé) : contournement puis retour sur l’itinéraire, jusqu’à la destination', () => {
  const { sim, ai, events, step } = road();
  sim.parked.push({ x: -2.3, z: 90, heading: 0, kind: 'suv', color: 0 });
  ai.setActive(true, sim);
  ai.setDestination([-2, 220]);
  let bypassed = false, maxLeft = -Infinity;
  step(45, undefined, () => { if (ai.lastDecision?.action === 'CONTOURNER') bypassed = true; maxLeft = Math.max(maxLeft, sim.car.x); });
  assert.ok(bypassed && maxLeft > -0.5, 'contournement par la gauche');
  assert.equal(ai.routeCount, 1, 'le contournement n’a pas changé l’itinéraire');
  assert.ok(Math.abs(sim.car.z - 220) < 8 && sim.car.speed < 0.3 && Math.abs(sim.car.x + 2) < 0.6, `arrivé dans sa voie (x ${sim.car.x.toFixed(2)}, z ${sim.car.z.toFixed(1)})`);
  assert.ok(!events.includes('hit'));
});

/* Apprentissage par la conduite des joueurs */

test('SMART AI apprend d’un joueur : bloquée, puis elle rejoue le passage qu’un joueur a trouvé', async () => {
  const { KnowledgeBase, DrivingRecorder } = await import('../client/src/moteur/smart-ai/learning.ts');
  const { steerLimit } = await import('../client/src/moteur/sim.ts');
  // Rue entre deux murs, barrée à z = 100. À droite, un terrain clos (z de 88 à 112, x jusqu'à −15) : la barrière y avance
  // jusqu'à x = −10, il reste un passage de 5 m derrière elle, trop loin de la chaussée pour SMART AI seule.
  const walls = [
    [[4.3, 0], [4.6, 0], [4.6, 400], [4.3, 400]],
    [[-4.6, 0], [-4.3, 0], [-4.3, 88], [-4.6, 88]], [[-4.6, 112], [-4.3, 112], [-4.3, 400], [-4.6, 400]],
    [[-10, 100], [4.3, 100], [4.3, 101], [-10, 101]],
    [[-15, 87.7], [-4.3, 87.7], [-4.3, 88], [-15, 88]], [[-15, 112], [-4.3, 112], [-4.3, 112.3], [-15, 112.3]], [[-15.3, 87.7], [-15, 87.7], [-15, 112.3], [-15.3, 112.3]],
  ];
  const kb = new KnowledgeBase();

  // 1. SMART AI seule : elle bute sur la barrière ; l'endroit devient un point critique.
  {
    const { sim, ai, step } = road({ colliders: walls });
    ai.knowledge = kb;
    ai.setActive(true, sim);
    step(20);
    assert.ok(kb.critiques.length >= 1, 'point critique noté');
    assert.ok(Math.hypot(kb.critiques[0].x + 2, kb.critiques[0].z - 92) < 8, `point critique devant la barrière (${kb.critiques[0].x.toFixed(0)}, ${kb.critiques[0].z.toFixed(0)})`);
  }

  // 2. Un joueur conduit lui-même et passe par le terrain, derrière la barrière, sans rien toucher.
  {
    const { sim, events, step } = road({ colliders: walls });
    const rec = new DrivingRecorder();
    const route = [[-2, 20], [-2, 84], [-5, 89], [-9, 92], [-12.5, 95], [-12.5, 105], [-9, 108], [-5, 111], [-2, 116], [-2, 200]];
    let k = 1, learned = null;
    const human = () => {
      const c = sim.car;
      while (k < route.length - 1 && Math.hypot(route[k][0] - c.x, route[k][1] - c.z) < 3) k++;
      const [tx, tz] = route[k];
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading), dx = tx - c.x, dz = tz - c.z;
      const lat = dx * -fz + dz * fx, L2 = dx * dx + dz * dz;
      const steer = Math.max(-1, Math.min(1, Math.atan((2 * lat * 2.66) / Math.max(1, L2)) / steerLimit(c.kind, Math.abs(c.speed))));
      return { throttle: c.speed < 3 ? 0.5 : 0, brake: c.speed > 4 ? 0.3 : 0, steer };
    };
    for (let i = 0; i < 90 * 60 && !learned; i++) {
      sim.update(1 / 60, human());
      for (const e of sim.drain()) if (e === 'hit') rec.noteHit();
      const demo = rec.sample(sim, 1 / 60, kb);
      if (demo) learned = kb.addDemo(demo);
    }
    assert.ok(!events.includes('hit'), 'le joueur n’a rien touché');
    assert.ok(learned, 'sa conduite est devenue une démonstration');
    assert.ok(learned.pts.some((p) => p[0] < -10.5), 'elle passe derrière la barrière');
  }

  // 3. SMART AI, avec ce savoir : bloquée au même endroit, elle rejoue le passage et continue sa route.
  {
    const { sim, ai, events, step } = road({ colliders: walls });
    ai.knowledge = kb;
    ai.setActive(true, sim);
    ai.setDestination([-2, 300]);
    let replayed = false;
    step(120, undefined, () => { if (ai.status.decision === 'SOLUTION APPRISE') replayed = true; });
    assert.ok(replayed, 'solution apprise rejouée');
    assert.ok(sim.car.z > 150, `barrière franchie (z ${sim.car.z.toFixed(0)})`);
    assert.ok(!events.includes('hit'), `aucun choc (${events.filter((e) => e === 'hit').length})`);
    assert.equal(kb.demos[0].ok, 1, 'la réussite est comptée : le savoir s’améliore');
  }
});

test('SMART AI apprend : une conduite avec un choc n’est jamais apprise, une démonstration qui échoue est abandonnée', async () => {
  const { KnowledgeBase, validDemo } = await import('../client/src/moteur/smart-ai/learning.ts');
  const kb = new KnowledgeBase();
  const pts = Array.from({ length: 40 }, (_, i) => [0, i, 1]);
  assert.ok(validDemo(pts));
  assert.ok(!validDemo([[0, 0, 1], [0, 50, 1]]), 'saut impossible refusé');
  assert.ok(!validDemo(pts.map((p, i) => (i === 3 ? [Number.NaN, 0, 1] : p))), 'valeur invalide refusée');
  const d = kb.addDemo(pts);
  assert.ok(d && kb.find(0.5, 5, 0), 'démonstration trouvée dans le bon sens');
  assert.equal(kb.find(0.5, 5, Math.PI), null, 'pas dans le sens contraire');
  kb.result(d.id, false); kb.result(d.id, false);
  assert.equal(kb.demos.length, 0, 'deux échecs sans réussite : abandonnée');
});

/* SMART AI pour tous les véhicules */

const crossing = () => {
  // Deux rues qui se croisent en (0, 0), sans feu : nord-sud et ouest-est.
  const world = {
    kind: 'grid', start: { x: 300, z: 300, heading: 0 }, steps: [{ kind: 'ignite', text: '', x: 0, z: 0 }], park: { x: 0, z: 0, heading: 0, halfW: 1, halfL: 2 },
    nodes: [[0, -200], [0, 0], [0, 200], [-200, 0], [200, 0]],
    edges: [
      { a: 0, b: 1, p: [[0, -200], [0, 0]], l: 2, r: 4 }, { a: 1, b: 2, p: [[0, 0], [0, 200]], l: 2, r: 4 },
      { a: 3, b: 1, p: [[-200, 0], [0, 0]], l: 2, r: 4 }, { a: 1, b: 4, p: [[0, 0], [200, 0]], l: 2, r: 4 },
    ],
    junctions: [], colliders: [], potholes: [], inBounds: () => true, mapLines: [], mapWindow: 0, boundsMessage: '',
  };
  return world;
};
async function trafficRun(withSafety, setup, seconds, each) {
  const { FleetSafety } = await import('../client/src/moteur/smart-ai/fleet.ts');
  const sim = new GameSim(crossing(), true, 0, { foot: true });
  // Honorable, à pied, tout près : la circulation n'est recyclée qu'au-delà de 380 m de lui.
  Object.assign(sim.hero, { x: 25, z: -25 });
  if (withSafety) sim.safety = new FleetSafety();
  setup(sim);
  for (let i = 0; i < seconds * 60; i++) { sim.update(1 / 60, { throttle: 0, brake: 0, steer: 0 }); sim.drain(); each(sim); }
  return sim;
}
const car = (x, z, heading, targets, kind = 'berline') => ({ x, z, heading, speed: 8, cruise: 8, color: 0, targets, edge: 0, kind });

test('SMART AI circulation : deux véhicules qui arrivent ensemble à un croisement sans feu, l’un cède, aucun ne passe à travers l’autre', async () => {
  const run = async (on) => {
    const { bodyGap } = await import('../client/src/moteur/sim.ts');
    let closest = Infinity, body = Infinity;
    const sim = await trafficRun(on, (s) => { s.traffic.push(car(-2, -80, 0, [[-2, 0], [-2, 150]])); s.traffic.push(car(-84, 2, Math.PI / 2, [[0, 2], [150, 2]], 'moto')); }, 30, (s) => {
      closest = Math.min(closest, Math.hypot(s.traffic[0].x - s.traffic[1].x, s.traffic[0].z - s.traffic[1].z));
      body = Math.min(body, bodyGap(s.traffic[0], s.traffic[1]));
    });
    return { closest, body, passed: sim.traffic[0].z > 20 && sim.traffic[1].x > 20 };
  };
  const without = await run(false), withAi = await run(true);
  // Sans SMART AI, ils se heurtent : les carrosseries se touchent (la simulation les empêche seulement de se traverser).
  assert.ok(without.body < 0.2, `sans SMART AI, ils se heurtent (${without.body.toFixed(2)} m entre les carrosseries)`);
  // Voiture (demi-largeur 0,95 m) et moto (demi-longueur 0,9 m) : au-delà de 2,2 m entre les centres, ils ne se touchent pas.
  assert.ok(withAi.closest > 2.2, `avec SMART AI, ils ne se touchent pas (${withAi.closest.toFixed(1)} m entre les centres)`);
  assert.ok(withAi.passed, 'puis tous deux repartent');
});

test('SMART AI circulation : un piéton traverse devant une voiture de la circulation, elle s’arrête', async () => {
  let closest = Infinity;
  await trafficRun(true, (s) => {
    s.traffic.push(car(-2, -60, 0, [[-2, 0], [-2, 150]]));
    s.walkers.push({ x: -8, z: -30, heading: Math.PI / 2, speed: 1.2, cruise: 1.2, look: 0, targets: [[8, -30]], edge: 0, wait: 0, phase: 0 });
  }, 25, (s) => { const w = s.walkers[0], t = s.traffic[0]; if (w) closest = Math.min(closest, Math.hypot(w.x - t.x, w.z - t.z)); });
  assert.ok(closest > 2.5, `piéton épargné (${closest.toFixed(1)} m du centre)`);
});

test('Circulation : un piéton face à un véhicule arrêté le contourne ; ni l’un ni l’autre ne reste figé', async () => {
  // Régression vue dans le jeu : le piéton attendait le minibus arrêté, qui l'attendait aussi ; quatre véhicules
  // derrière et la voiture SMART AI sont restés bloqués plus de 3 minutes.
  let passed = false, hit = false;
  const sim = await trafficRun(true, (s) => {
    s.traffic.push(car(-2, 10, 0, [[-2, 150]]));
    s.walkers.push({ x: -2, z: 22, heading: Math.PI, speed: 0, cruise: 1.3, look: 0, targets: [[-2, -40]], edge: 0, wait: 0, phase: 0 });
  }, 30, (s) => {
    const t = s.traffic[0], w = s.walkers.at(-1);
    if (t.z > 60) passed = true;
    if (Math.hypot(t.x - w.x, t.z - w.z) < 1.2) hit = true;
  });
  assert.ok(passed, `le véhicule repart (z ${sim.traffic[0].z.toFixed(1)})`);
  assert.ok(!hit, 'sans toucher le piéton');
});

test('Circulation : un véhicule n’entre jamais dans la voiture du joueur, même en travers de la voie', async () => {
  // Régression vue dans le jeu : la collision n'était vérifiée qu'au centre du véhicule ; notre voiture en travers,
  // l'avant sur la voie, se faisait traverser par la circulation. Ici sans l'anti-collision SMART AI de la circulation.
  const { bodyGap } = await import('../client/src/moteur/sim.ts');
  let closest = Infinity;
  await trafficRun(false, (s) => {
    s.leave?.();
    s.mode = 'car';
    Object.assign(s.car, { x: -4.6, z: 30, heading: Math.PI / 2, speed: 0, kind: 'berline' });
    s.traffic.push(car(-2, -10, 0, [[-2, 0], [-2, 150]]));
  }, 12, (s) => { closest = Math.min(closest, bodyGap(s.traffic[0], s.car)); });
  assert.ok(closest > -0.05, `aucune pénétration dans la voiture du joueur (écart minimal ${closest.toFixed(2)} m)`);
});

test('Circulation : un véhicule dont l’anti-collision ne voit pas le joueur bute contre lui, puis recule au lieu de rester collé', async () => {
  // Régression vue dans le jeu : dans un virage, l'anti-collision d'un taxi ne voyait pas la voiture SMART AI ;
  // seule la carrosserie l'arrêtait, et il restait collé à elle, nez à nez, jusqu'à la fin.
  const { bodyGap } = await import('../client/src/moteur/sim.ts');
  let frame = 0, gapAt8 = null, gapEnd = null;
  await trafficRun(false, (s) => {
    s.safety = { tick() {}, guard: () => Infinity, heldByPlayer: () => false };
    s.leave?.();
    s.mode = 'car';
    Object.assign(s.car, { x: -2, z: 40, heading: 0, speed: 0, kind: 'berline' });
    s.traffic.push(car(-2, 60, Math.PI, [[-2, 0], [-2, -150]]));
  }, 20, (s) => {
    const g = bodyGap(s.traffic[0], s.car);
    if (++frame === 8 * 60) gapAt8 = g;
    gapEnd = g;
  });
  assert.ok(gapAt8 > -0.05 && gapAt8 < 0.3, `il bute contre la voiture du joueur sans y entrer (écart ${gapAt8.toFixed(2)} m)`);
  assert.ok(gapEnd > 2, `puis il recule et reste en retrait (écart final ${gapEnd.toFixed(2)} m)`);
});

test('SMART AI circulation : face à face avec la voiture du joueur arrêtée, le véhicule recule pour lui laisser la place', async () => {
  // Régression vue dans Lomé : un taxi en travers devant la voiture SMART AI, chacun attendait l'autre jusqu'à la fin.
  // Il arrive en face, s'arrête devant la voiture du joueur, recule et reste en retrait ; si le joueur ne repart toujours pas,
  // il le contourne comme un véhicule garé, sans jamais le toucher.
  const { bodyGap } = await import('../client/src/moteur/sim.ts');
  let frame = 0, stoppedAt = null, backed = -Infinity, closest = Infinity;
  await trafficRun(true, (s) => {
    s.leave?.();
    s.mode = 'car';
    Object.assign(s.car, { x: -2, z: 40, heading: 0, speed: 0, kind: 'berline' });
    s.traffic.push(car(-2, 52, Math.PI, [[-2, 0], [-2, -150]]));
  }, 20, (s) => {
    const t = s.traffic[0];
    if (++frame === 5 * 60) stoppedAt = t.z;
    if (frame > 5 * 60 && frame < 12 * 60) backed = Math.max(backed, t.z);
    closest = Math.min(closest, bodyGap(t, s.car));
  });
  assert.ok(backed - stoppedAt > 2, `le véhicule a reculé pour laisser la place (z ${stoppedAt.toFixed(1)} → ${backed.toFixed(1)})`);
  assert.ok(closest > 0.5, `sans toucher la voiture du joueur (${closest.toFixed(2)} m entre les carrosseries)`);
});

test('SMART AI circulation : le véhicule qui a reculé reste en retrait quand le joueur avance un peu, puis le contourne (pas de face-à-face sans fin)', async () => {
  // Régression vue dans Lomé : SMART AI avançait de 2 m vers le véhicule qui lui avait laissé la place ; il se croyait libre,
  // revenait, s'arrêtait nez à nez, reculait encore… toutes les 11 s pendant deux minutes.
  const { bodyGap } = await import('../client/src/moteur/sim.ts');
  let frame = 0, backs = 0, wasBacking = false, closest = Infinity;
  const sim = await trafficRun(true, (s) => {
    s.leave?.();
    s.mode = 'car';
    Object.assign(s.car, { x: -2, z: 40, heading: 0, speed: 0, kind: 'berline' });
    s.traffic.push(car(-2, 52, Math.PI, [[-2, 0], [-2, -150]]));
  }, 45, (s) => {
    const t = s.traffic[0];
    frame++;
    // Le joueur avance au pas pendant 3 s, une fois le véhicule en retrait, puis s'arrête de nouveau.
    if (frame > 12 * 60 && frame < 15 * 60) s.car.speed = 0.8; else s.car.speed = 0;
    const backing = (t.backT ?? 0) > 0;
    if (backing && !wasBacking) backs++;
    wasBacking = backing;
    closest = Math.min(closest, bodyGap(t, s.car));
  });
  const t = sim.traffic[0];
  assert.equal(backs, 1, `le véhicule recule une seule fois (${backs})`);
  assert.ok(t.z < sim.car.z - 3, `puis il contourne la voiture du joueur et poursuit sa route (z ${t.z.toFixed(1)}, joueur ${sim.car.z.toFixed(1)})`);
  assert.ok(closest > 0.5, `sans la toucher (${closest.toFixed(2)} m entre les carrosseries)`);
});

test('SMART AI circulation : voiture garée sur la voie, le véhicule s’arrête à distance puis la dépasse sans la frôler', async () => {
  // Vu dans Lomé : arrêté à 20 cm d'une voiture garée, un fourgon ne pouvait plus la dépasser ; il restait figé,
  // à moitié sur la voie d'en face, et la voiture SMART AI qui arrivait s'arrêtait devant lui, puis faisait demi-tour.
  const { bodyGap } = await import('../client/src/moteur/sim.ts');
  let stopGap = Infinity, closest = Infinity, passedAt = null, frame = 0;
  await trafficRun(true, (s) => {
    s.parked.push({ x: -2.3, z: 30, heading: 0, kind: 'suv', color: 0 });
    s.traffic.push(car(-2, -40, 0, [[-2, 0], [-2, 150]], 'fourgon'));
  }, 25, (s) => {
    const t = s.traffic[0];
    frame++;
    if (Math.abs(t.speed) < 0.05 && !t.passing && t.z < 30) stopGap = Math.min(stopGap, bodyGap(t, s.parked[0]));
    closest = Math.min(closest, bodyGap(t, s.parked[0]));
    if (passedAt === null && t.z > 40) passedAt = frame / 60;
  });
  assert.ok(stopGap > 1.5 && stopGap < Infinity, `arrêt à distance de la voiture garée (${stopGap.toFixed(2)} m)`);
  assert.ok(closest > 0.5, `dépassement sans la frôler (${closest.toFixed(2)} m entre les carrosseries)`);
  assert.ok(passedAt !== null && passedAt < 20, `voiture garée dépassée (${passedAt?.toFixed(0)} s)`);
});

test('SMART AI circulation : deux véhicules face à face sur la même voie, l’un contourne l’autre, aucun ne reste figé', async () => {
  // Vu dans Lomé : une moto et un fourgon face à face s'attendaient l'un l'autre plus de 20 s, et bloquaient la rue.
  const { bodyGap } = await import('../client/src/moteur/sim.ts');
  let closest = Infinity;
  const sim = await trafficRun(true, (s) => {
    s.traffic.push(car(-2, 60, 0, [[-2, 200]], 'fourgon'));
    s.traffic.push(car(-2, 80, Math.PI, [[-2, 0], [-2, -150]], 'moto'));
  }, 25, (s) => { closest = Math.min(closest, bodyGap(s.traffic[0], s.traffic[1])); });
  const [a, b] = sim.traffic;
  assert.ok(a.z > 90 && b.z < 50, `ils se sont croisés (fourgon z ${a.z.toFixed(0)}, moto z ${b.z.toFixed(0)})`);
  assert.ok(closest > 0.2, `sans contact (${closest.toFixed(2)} m entre les carrosseries)`);
});

test('SMART AI circulation : la voiture du joueur arrêtée sur la voie, le véhicule qui suit s’arrête derrière', async () => {
  // Puis, le joueur restant arrêté plus de 5 s, il le dépasse par la voie d'en face, sans le toucher.
  const { bodyGap } = await import('../client/src/moteur/sim.ts');
  let stopGap = Infinity, closest = Infinity, passed = false;
  await trafficRun(true, (s) => {
    s.leave?.();
    s.mode = 'car';
    Object.assign(s.car, { x: -2, z: 40, heading: 0, speed: 0, kind: 'berline' });
    s.traffic.push(car(-2, -60, 0, [[-2, 0], [-2, 150]]));
  }, 25, (s) => {
    const t = s.traffic[0];
    if (!t.passing && t.z < s.car.z) stopGap = Math.min(stopGap, Math.hypot(s.car.x - t.x, s.car.z - t.z));
    closest = Math.min(closest, bodyGap(t, s.car));
    if (t.z > s.car.z + 8) passed = true;
  });
  assert.ok(stopGap > 4.5, `arrêt derrière la voiture du joueur (${stopGap.toFixed(1)} m)`);
  assert.ok(closest > 0.5, `jamais au contact (${closest.toFixed(2)} m entre les carrosseries)`);
  assert.ok(passed, 'puis dépassement du joueur resté arrêté');
});

test('SMART AI : freinage d’urgence de la voiture du joueur devant un piéton', async () => {
  const { FleetSafety } = await import('../client/src/moteur/smart-ai/fleet.ts');
  const { sim, events } = road();
  const fleet = new FleetSafety();
  sim.safety = fleet;
  sim.walkers.push(pieton(-2, 70, [-2, 1000]));
  let fired = 0, closest = Infinity;
  for (let i = 0; i < 20 * 60; i++) {
    sim.safety.tick(0);
    const seen = fleet.emergency(sim);
    if (seen) fired++;
    sim.update(1 / 60, seen ? { throttle: 0, brake: 1, steer: 0 } : { throttle: 1, brake: 0, steer: 0 });
    events.push(...sim.drain());
    closest = Math.min(closest, 70 - front(sim));
  }
  assert.ok(fired > 0, 'freinage d’urgence déclenché');
  assert.ok(closest > 0.3, `arrêt avant le piéton (${closest.toFixed(1)} m)`);
  assert.ok(!events.includes('walker') && !events.includes('hit'), 'aucun choc');
});

test('SMART AI circulation dans Lomé : 5 minutes de vraie circulation, aucune collision rapide entre véhicules', async () => {
  const { readFileSync } = await import('node:fs');
  const { pointInPoly, VEHICLES } = await import('../client/src/moteur/sim.ts');
  const { FleetSafety } = await import('../client/src/moteur/smart-ai/fleet.ts');
  const map = JSON.parse(readFileSync(new URL('../client/public/game/lome.json', import.meta.url)));
  const world = { kind: 'lome', start: map.start, freeStart: { x: map.park.x, z: map.park.z, heading: map.park.heading }, steps: map.steps, park: map.park, nodes: map.nodes, edges: map.edges, junctions: map.junctions,
    colliders: map.buildings.map((b) => b.p), inBounds: (x, z) => pointInPoly(x, z, map.boundary) || map.boundary.some((q) => Math.hypot(q[0] - x, q[1] - z) < 400), mapLines: [], mapWindow: 0, boundsMessage: '' };
  const sim = new GameSim(world, true, 16, { walkers: 22, parked: true, foot: true });
  sim.safety = new FleetSafety();
  const touching = new Set();
  let hard = 0, speed = 0, n = 0;
  for (let i = 0; i < 5 * 3600; i++) {
    sim.update(1 / 60, { throttle: 0, brake: 0, steer: 0 }); sim.drain();
    const T = sim.traffic.filter((t) => Math.abs(t.x - sim.focus.x) < 4000);
    for (let a = 0; a < T.length; a++) {
      speed += T[a].speed; n++;
      for (let b = a + 1; b < T.length; b++) {
        const key = `${sim.traffic.indexOf(T[a])}-${sim.traffic.indexOf(T[b])}`;
        const close = Math.hypot(T[a].x - T[b].x, T[a].z - T[b].z) < (VEHICLES[T[a].kind].radius + VEHICLES[T[b].kind].radius) * 0.9;
        if (close && !touching.has(key)) {
          const rv = Math.hypot(Math.sin(T[a].heading) * T[a].speed - Math.sin(T[b].heading) * T[b].speed, Math.cos(T[a].heading) * T[a].speed - Math.cos(T[b].heading) * T[b].speed);
          if (rv > 2) hard++;
        }
        if (close) touching.add(key); else touching.delete(key);
      }
    }
  }
  assert.equal(hard, 0, 'aucune collision rapide');
  assert.ok(speed / n * 3.6 > 6, `la circulation avance (${(speed / n * 3.6).toFixed(1)} km/h en moyenne)`);
});

test('SMART AI dans une rue étroite de Lomé, coin de mur et circulation en face : on se cède le passage, sans choc ni blocage', async () => {
  const { readFileSync } = await import('node:fs');
  const { pointInPoly } = await import('../client/src/moteur/sim.ts');
  const { FleetSafety } = await import('../client/src/moteur/smart-ai/fleet.ts');
  const map = JSON.parse(readFileSync(new URL('../client/public/game/lome.json', import.meta.url)));
  // Rue 245, (780,-600) → (760,-679) : au sud, un coin de bâtiment déborde sur notre voie juste avant le carrefour.
  const A = [780, -600], B = [760, -679], L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L;
  for (const [delay, n] of [[2, 1], [4, 1], [4, 3]]) {
    const world = {
      kind: 'lome', start: map.start, freeStart: { x: map.park.x, z: map.park.z, heading: map.park.heading }, steps: map.steps, park: map.park,
      nodes: map.nodes, edges: map.edges, junctions: map.junctions, colliders: map.buildings.map((x) => x.p), colliderHeights: map.buildings.map((x) => x.h),
      inBounds: (x, z) => pointInPoly(x, z, map.boundary) || map.boundary.some((q) => Math.hypot(q[0] - x, q[1] - z) < 400), mapLines: [], mapWindow: 0, boundsMessage: '',
    };
    const sim = new GameSim(world, true, 0, { walkers: 0, parked: true });
    sim.safety = new FleetSafety();
    Object.assign(sim.car, { x: A[0] + ux * 40 - uz * 1.8, z: A[1] + uz * 40 + ux * 1.8, heading: Math.atan2(ux, uz), speed: 0 });
    const ai = new SmartAIController(sim);
    assert.ok(ai.setActive(true, sim));
    const events = [];
    let out = null;
    for (let i = 0; i < 60 * 60 && out === null; i++) {
      if (i === delay * 60) for (let k = 0; k < n; k++) sim.traffic.push({
        x: B[0] + ux * (12 + k * 9) + uz * 1.8, z: B[1] + uz * (12 + k * 9) - ux * 1.8, heading: Math.atan2(-ux, -uz), speed: 6, cruise: 8, color: 0, edge: 246, kind: 'berline',
        targets: [[B[0] + uz * 1.8, B[1] - ux * 1.8], [A[0] + uz * 1.8 - ux * 4, A[1] - ux * 1.8 - uz * 4], [799, -536]],
      });
      sim.update(1 / 60, ai.update(sim, 1 / 60));
      events.push(...sim.drain());
      if ((sim.car.x - A[0]) * ux + (sim.car.z - A[1]) * uz > L - 4) out = i / 60;
    }
    assert.ok(!events.includes('hit'), `arrivée à ${delay} s, ${n} véhicule(s) : aucun choc`);
    assert.ok(out !== null && out < 40, `arrivée à ${delay} s, ${n} véhicule(s) : la voiture sort de la rue (${out?.toFixed(1)} s)`);
    assert.ok(!ai.antiBlock.halted, 'pas d’arrêt sécurisé');
  }
});

test('SMART AI : moto arrêtée dans la voie que la caméra n’a pas reconnue ; le radar avant la voit, arrêt derrière elle sans choc', async () => {
  const { readFileSync } = await import('node:fs');
  const { pointInPoly, bodyGap } = await import('../client/src/moteur/sim.ts');
  const { GameStateSensor, RadarSensor, UltrasonicSensor } = await import('../client/src/moteur/smart-ai/detector.ts');
  const map = JSON.parse(readFileSync(new URL('../client/public/game/lome.json', import.meta.url)));
  const world = {
    kind: 'lome', start: map.start, freeStart: { x: map.park.x, z: map.park.z, heading: map.park.heading }, steps: map.steps, park: map.park,
    nodes: map.nodes, edges: map.edges, junctions: map.junctions, colliders: map.buildings.map((x) => x.p), colliderHeights: map.buildings.map((x) => x.h),
    inBounds: (x, z) => pointInPoly(x, z, map.boundary) || map.boundary.some((q) => Math.hypot(q[0] - x, q[1] - z) < 400), mapLines: [], mapWindow: 0, boundsMessage: '',
  };
  // Vu dans Lomé, boulevard du 13 Janvier (rue 416) : la moto, petite et vue de dos, n'a pas été reconnue par YOLO.
  // Ici, aucun capteur ne donne les usagers comme le ferait la caméra : seuls le radar et les ultrasons peuvent la voir.
  const sim = new GameSim(world, true, 0, { walkers: 0, parked: true });
  Object.assign(sim.car, { x: 734.1, z: -462, heading: Math.atan2(15.3, 56.6), speed: 7.5 });
  const ai = new SmartAIController(sim, [new GameStateSensor({ users: false }), new RadarSensor(), new UltrasonicSensor()]);
  assert.ok(ai.setActive(true, sim));
  sim.traffic.push({ x: 747, z: -414, heading: -6.03, speed: 0, cruise: 0.0001, color: 0, targets: [[747.6, -411], [748.4, -408.9]], edge: 416, kind: 'moto' });
  const events = [];
  for (let i = 0; i < 10 * 60; i++) {
    Object.assign(sim.traffic[0], { x: 747, z: -414, speed: 0 });
    sim.update(1 / 60, ai.update(sim, 1 / 60));
    events.push(...sim.drain());
  }
  assert.ok(!events.includes('hit'), 'aucun choc');
  assert.ok(Math.abs(sim.car.speed) < 0.3 && bodyGap(sim.traffic[0], sim.car) > 2, `arrêt derrière la moto (écart ${bodyGap(sim.traffic[0], sim.car).toFixed(1)} m)`);
});
