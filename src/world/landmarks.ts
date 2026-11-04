/** The places on the planet. Each room in the site is a place you can turn the world to. */
import * as THREE from 'three';
import { terrainHeight } from './scene';

export type PlaceId = 'lastlight' | 'dawn' | 'raid' | 'almanac' | 'shed' | 'market' | 'garden' | 'stream';

const spots: Record<PlaceId, [number, number]> = {
  lastlight: [18, 25], dawn: [40, 95], raid: [8, 160], almanac: [-22, 215], shed: [30, 285], market: [-8, 340], garden: [55, 200], stream: [-35, 100],
};

const toDirection = (lat: number, lon: number) => {
  const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)).normalize();
};
const snapped = new Map<PlaceId, THREE.Vector3>();

/** Each place starts from a rough spot, then moves to the nearest dry, gentle ground. */
export function surfaceDirection(place: PlaceId): THREE.Vector3 {
  const known = snapped.get(place);
  if (known) return known;
  const [lat, lon] = spots[place];
  const dry = (d: THREE.Vector3) => { const h = terrainHeight(d); return h > 1.012 && h < 1.04; };
  let best = toDirection(lat, lon);
  search: for (let ring = 0; ring < 40; ring++) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const c = toDirection(lat + Math.sin(a) * ring * 3, lon + Math.cos(a) * ring * 3);
      // Check the ground around the spot too, so a building does not hang over the shore.
      const side = new THREE.Vector3(c.z, 0, -c.x).normalize().multiplyScalar(0.05);
      const up = new THREE.Vector3().crossVectors(c, side).normalize().multiplyScalar(0.05);
      if ([c, c.clone().add(side).normalize(), c.clone().sub(side).normalize(), c.clone().add(up).normalize(), c.clone().sub(up).normalize()].every(dry)) { best = c; break search; }
    }
  }
  snapped.set(place, best);
  return best;
}

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });
const box = (w: number, h: number, d: number, m: THREE.Material, y = h / 2) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.y = y; return o; };
const roof = (w: number, h: number, d: number, m: THREE.Material, y: number) => {
  const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(0, h); shape.lineTo(w / 2, 0); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2);
  const o = new THREE.Mesh(g, m); o.position.y = y; return o;
};
const lit = () => std(0xffd27a, { emissive: 0xffa53a, emissiveIntensity: 2 });

export function buildLandmarks(planet: THREE.Group) {
  const blades: THREE.Object3D[] = [], lamps: THREE.Object3D[] = [], beacon: THREE.Object3D[] = [];
  const places = {} as Record<PlaceId, THREE.Vector3>;
  const place = (id: PlaceId, group: THREE.Group, scale = 1) => {
    const dir = surfaceDirection(id);
    places[id] = dir.clone();
    group.position.copy(dir).multiplyScalar(terrainHeight(dir) - 0.004);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.scale.setScalar(scale);
    group.name = id;
    planet.add(group);
  };

  // Lantern tower: the night shift starts here.
  const tower = new THREE.Group();
  tower.add(box(0.012, 0.13, 0.012, std(0x4a3320)));
  const lantern = box(0.03, 0.036, 0.03, lit(), 0.145); tower.add(lantern); lamps.push(lantern);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.022, 4), std(0x23194f)); cap.position.y = 0.174; cap.rotation.y = Math.PI / 4; tower.add(cap);
  place('lastlight', tower);

  // Windmill and weather vane: the blades turn at the real rpm.
  const mill = new THREE.Group();
  const millBody = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.04, 0.12, 8), std(0xfff1c9)); millBody.position.y = 0.06; mill.add(millBody);
  const millCap = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.04, 8), std(0xc8452f)); millCap.position.y = 0.14; mill.add(millCap);
  const hub = new THREE.Group(); hub.position.set(0, 0.115, 0.03);
  for (let i = 0; i < 4; i++) { const b = box(0.012, 0.08, 0.002, std(0xffffff), 0.04); const arm = new THREE.Group(); arm.add(b); arm.rotation.z = (i * Math.PI) / 2; hub.add(arm); }
  mill.add(hub); blades.push(hub);
  place('dawn', mill);

  // The owl's oak: this week's boss roosts here.
  const oak = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.024, 0.11, 6), std(0x3b2a1e)); trunk.position.y = 0.055; oak.add(trunk);
  for (const [x, y, z, s] of [[0, 0.135, 0, 0.055], [0.04, 0.115, 0.012, 0.038], [-0.04, 0.11, -0.01, 0.036], [0.005, 0.11, 0.04, 0.036]]) {
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), std(0x24513a)); crown.position.set(x, y, z); oak.add(crown);
  }
  const owlBody = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018, 1), std(0xbda68a)); owlBody.position.set(0.024, 0.086, 0.022); oak.add(owlBody);
  for (const side of [-1, 1]) { const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.0048, 1), std(0xffd24a, { emissive: 0xffb300, emissiveIntensity: 2 })); eye.position.set(0.024 + side * 0.0075, 0.091, 0.038); oak.add(eye); }
  place('raid', oak);

  // The Almanac's cottage.
  const cottage = new THREE.Group();
  cottage.add(box(0.07, 0.04, 0.05, std(0xefe0b4)));
  cottage.add(roof(0.08, 0.035, 0.056, std(0x7a3f26), 0.04));
  const window1 = box(0.014, 0.014, 0.002, lit(), 0.022); window1.position.z = 0.026; cottage.add(window1); lamps.push(window1);
  place('almanac', cottage);

  // The barn, for Squeek holders.
  const barn = new THREE.Group();
  barn.add(box(0.09, 0.05, 0.06, std(0xb5362b)));
  barn.add(roof(0.102, 0.04, 0.066, std(0x5a2a22), 0.05));
  const barnDoor = box(0.03, 0.034, 0.002, std(0xfff1c9), 0.017); barnDoor.position.z = 0.031; barn.add(barnDoor);
  place('shed', barn);

  // Market stall with a striped awning.
  const stall = new THREE.Group();
  stall.add(box(0.07, 0.022, 0.035, std(0x8a5a2e)));
  for (const [x, z] of [[-0.03, 0.014], [0.03, 0.014], [-0.03, -0.014], [0.03, -0.014]]) { const post = box(0.003, 0.06, 0.003, std(0x4a3320), 0.03); post.position.x = x; post.position.z = z; stall.add(post); }
  for (let i = 0; i < 6; i++) { const stripe = box(0.0135, 0.004, 0.05, std(i % 2 ? 0xfff1c9 : 0xd9392f), 0.062); stripe.position.x = -0.034 + i * 0.0135; stripe.rotation.x = 0.2; stall.add(stripe); }
  place('market', stall);

  // Greenhouse, for the on-chain sunflowers.
  const house = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.38, roughness: 0.1, metalness: 0.2 });
  house.add(box(0.08, 0.04, 0.05, glass));
  house.add(roof(0.086, 0.028, 0.054, glass, 0.04));
  for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.007, 0), std(0xffc62b, { emissive: 0xff9a1f, emissiveIntensity: 0.5 })); f.position.set(-0.028 + i * 0.014, 0.024, 0); house.add(f); }
  place('garden', house);

  // Radio mast for the stream.
  const mast = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.008, 0.2, 5), std(0xd8d4e4)); pole.position.y = 0.1; mast.add(pole);
  for (const y of [0.05, 0.1, 0.15]) { const bar = box(0.04 - y * 0.15, 0.0024, 0.0024, std(0xd8d4e4), y); mast.add(bar); }
  const light = new THREE.Mesh(new THREE.IcosahedronGeometry(0.008, 1), std(0xff5a3c, { emissive: 0xff2a1a, emissiveIntensity: 3 })); light.position.y = 0.205; mast.add(light); beacon.push(light);
  place('stream', mast);

  return { places, blades, lamps, beacon };
}
