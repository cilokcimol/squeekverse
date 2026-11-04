/**
 * The planet. It is one scene shared by the home page, every room and the game.
 *
 * The wheel-sun hangs still in the sky and the planet turns beneath it. Real work drives the turning,
 * so when the hamster stops the planet stops, and when he runs the day comes up. Navigating to a room
 * turns the planet until that place faces the camera.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from './noise';
import { buildLandmarks, surfaceDirection, type PlaceId } from './landmarks';

const low = () => matchMedia('(max-width: 860px)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;

export interface Pose { pos: THREE.Vector3; look: THREE.Vector3; shiftX: number; shiftY: number }
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const narrowAtLoad = typeof innerWidth === 'number' && innerWidth < 860;
export const SUN_POS = narrowAtLoad ? v(0.55, 2.6, -1.6) : v(2.1, 2.5, -1.6);

export function terrainHeight(d: THREE.Vector3) {
  const h = fbm(d.x * 2.1 + 3, d.y * 2.1, d.z * 2.1 - 4, 4);
  return 1 + Math.max(-0.018, h * 0.1);
}

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.01, 60);
  planet = new THREE.Group();
  /** 0 is deep night, 1 is full day. */
  light = 0;
  lightTarget = 0;
  rpm = 0;
  lost = false;
  private key = new THREE.DirectionalLight(0xffffff, 1);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1);
  private fill = new THREE.DirectionalLight(0xffffff, 0.7);
  private lampGlow: THREE.Sprite[] = [];
  private sun = new THREE.Group();
  private sunGlow!: THREE.Sprite;
  private sunRays!: THREE.Mesh;
  private wheel = new THREE.Group();
  private hamster = new THREE.Group();
  private hamsterParts: THREE.Object3D[] = [];
  private stars!: THREE.Points;
  private atmosphere!: THREE.ShaderMaterial;
  private water!: THREE.Mesh;
  private flowerStems!: THREE.InstancedMesh;
  private flowerHeads!: THREE.InstancedMesh;
  private flowers: { pos: THREE.Vector3; normal: THREE.Vector3; size: number; phase: number; lean: THREE.Vector3 }[] = [];
  private fireflies!: THREE.Points;
  private blades: THREE.Object3D[] = [];
  private lamps: THREE.Object3D[] = [];
  private beacon: THREE.Object3D[] = [];
  places: Record<PlaceId, THREE.Vector3>;
  private qTarget = new THREE.Quaternion();
  private qFrom = new THREE.Quaternion();
  private qT = 1;
  /** Spin follows real work. Null means a room has taken control of the planet. */
  private spinning = true;
  private spin = 0;
  private spinTarget = 0;
  private poseFrom: Pose; private poseTo: Pose; private poseT = 1; private poseDur = 1.4;
  private pose: Pose;
  private scrollPose: ((t: number) => Pose) | null = null;
  scrollT = 0;
  private clock = new THREE.Clock();
  private lowPower = low();
  onFrame: ((dt: number, t: number) => void) | null = null;
  private frameMark = 0;
  private dummy = new THREE.Object3D();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private transparentOnly = false;

  constructor(canvas: HTMLCanvasElement, options: { overlay?: boolean } = {}) {
    this.transparentOnly = Boolean(options.overlay);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowPower, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.lowPower ? 1.6 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.scene.add(this.planet, this.key, this.key.target, this.hemi, this.sun);
    this.key.position.copy(SUN_POS);
    this.fill.position.set(-1.2, 1, 3); this.scene.add(this.fill);
    this.buildPlanet();
    this.buildStars();
    this.buildSun();
    this.buildFlowers();
    this.buildFireflies();
    const built = buildLandmarks(this.planet);
    this.places = built.places;
    this.blades = built.blades;
    this.lamps = built.lamps;
    this.beacon = built.beacon;
    for (const lamp of this.lamps) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb44a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.scale.setScalar(0.09);
      lamp.add(glow);
      this.lampGlow.push(glow);
    }
    this.pose = this.homePose(0);
    this.poseFrom = this.pose; this.poseTo = this.pose;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private homePose(t: number): Pose {
    const narrow = innerWidth < 860;
    const keys: Pose[] = narrow ? [
      { pos: v(0, 0.85, 2.3), look: v(0.12, 1.25, -0.2), shiftX: 0, shiftY: 0 },
      { pos: v(0.4, 2.3, 0.75), look: SUN_POS, shiftX: 0, shiftY: 0.08 },
      { pos: v(0.25, 1.32, 0.86), look: v(0.05, 0.9, 0.2), shiftX: 0, shiftY: 0 },
      { pos: v(-1.5, 0.6, 3.0), look: v(0, 0.1, 0), shiftX: 0, shiftY: 0 },
      { pos: v(0, 0.3, 3.9), look: v(0, 0.2, 0), shiftX: 0, shiftY: 0 },
    ] : [
      { pos: v(-0.4, 1.02, 1.9), look: v(0.55, 1.2, -0.3), shiftX: 0, shiftY: 0 },
      { pos: v(1.3, 2.25, 0.95), look: SUN_POS, shiftX: -0.14, shiftY: 0 },
      { pos: v(0.3, 1.26, 0.82), look: v(-0.1, 0.92, 0.2), shiftX: -0.14, shiftY: 0 },
      { pos: v(-1.3, 0.65, 2.7), look: v(0, 0.15, 0), shiftX: 0.14, shiftY: 0 },
      { pos: v(0, 0.2, 3.4), look: v(0, 0.2, 0), shiftX: 0, shiftY: 0 },
    ];
    const scaled = Math.min(keys.length - 1.0001, t * (keys.length - 1));
    const i = Math.floor(scaled), f = scaled - i, e = f * f * (3 - 2 * f);
    const a = keys[i], b = keys[i + 1];
    return { pos: a.pos.clone().lerp(b.pos, e), look: a.look.clone().lerp(b.look, e), shiftX: a.shiftX + (b.shiftX - a.shiftX) * e, shiftY: a.shiftY + (b.shiftY - a.shiftY) * e };
  }

  /** The overlay shows the whole planet, small, in one corner of the stream. */
  overlayPose(corner: string) {
    const x = corner.endsWith('l') ? -0.38 : 0.38, y = corner.startsWith('t') ? -0.3 : 0.3;
    this.scrollPose = null; this.spinning = true;
    this.pose = { pos: v(0, 0.2, 8), look: v(0, 0.2, 0), shiftX: x, shiftY: y };
    this.poseT = 1;
    (this.stars as THREE.Object3D).visible = false;
    this.sun.position.set(1.5, 1.6, -0.5);
    this.sun.scale.setScalar(0.8);
  }

  /** Back to the home page: the planet turns on real work again. */
  goHome() {
    this.spinning = true;
    this.scrollPose = (t) => this.homePose(t);
    this.flyTo(this.homePose(this.scrollT), 1.5);
    this.setPlanetTurn(null);
  }

  /** Turn a place to face the camera and frame it. `side` leaves room for a panel. */
  goTo(place: PlaceId) {
    this.scrollPose = null;
    this.spinning = false;
    const narrow = innerWidth < 860;
    const direction = this.places[place].clone().normalize();
    // The place stands near the top of the planet, seen from the side against the sky.
    const facing = v(0.08, 0.8, 0.6).normalize();
    this.setPlanetTurn(new THREE.Quaternion().setFromUnitVectors(direction, facing));
    const spot = facing.clone().multiplyScalar(terrainHeight(direction));
    const back = narrow ? 0.5 : 0.42;
    this.flyTo({ pos: spot.clone().add(v(0.02, narrow ? 0.1 : 0.09, back)), look: spot.clone().add(v(0, narrow ? 0.07 : 0.075, 0)), shiftX: narrow ? 0 : 0.2, shiftY: narrow ? 0.3 : 0.04 }, 1.5);
  }

  /** The game frames one patch of field and holds it still. */
  goToField() {
    this.scrollPose = null;
    this.spinning = false;
    const direction = surfaceDirection('lastlight').clone();
    const facing = v(0, 0, 1);
    this.setPlanetTurn(new THREE.Quaternion().setFromUnitVectors(direction, facing));
    this.flyTo({ pos: v(0, 0, innerWidth < 860 ? 3.05 : 2.6), look: v(0, 0, 0), shiftX: 0, shiftY: 0 }, 1.1);
  }

  private setPlanetTurn(q: THREE.Quaternion | null) {
    this.qFrom.copy(this.planet.quaternion);
    if (q) { this.qTarget.copy(q); this.qT = 0; }
    else { this.qT = 1; this.resumeSpinFromCurrent(); }
  }

  private resumeSpinFromCurrent() {
    this.qFrom.copy(this.planet.quaternion);
    this.qTarget.setFromAxisAngle(v(0, 1, 0), this.spin);
    this.qT = 0;
  }

  private flyTo(pose: Pose, seconds: number) {
    this.poseFrom = { ...this.pose, pos: this.pose.pos.clone(), look: this.pose.look.clone() };
    this.poseTo = pose;
    this.poseDur = this.reduced ? 0.01 : seconds;
    this.poseT = 0;
  }

  setWork(work: number) { this.spinTarget = work * 0.0035; }

  /** Rotation from real work, extended by the live rpm between readings. */
  private updateSpin(dt: number) {
    this.spinTarget += (this.rpm / 60) * dt * 0.0035 * 2;
    this.spin += (this.spinTarget - this.spin) * Math.min(1, dt * 1.2);
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.light += (this.lightTarget - this.light) * Math.min(1, dt * 0.7);
    this.updateSpin(dt);

    if (this.qT < 1) {
      this.qT = Math.min(1, this.qT + dt / (this.reduced ? 0.01 : 1.5));
      const e = 1 - Math.pow(1 - this.qT, 3);
      this.planet.quaternion.slerpQuaternions(this.qFrom, this.qTarget, e);
    } else if (this.spinning) {
      this.planet.quaternion.setFromAxisAngle(v(0, 1, 0), this.spin);
    }

    if (this.poseT < 1) {
      this.poseT = Math.min(1, this.poseT + dt / this.poseDur);
      const e = 1 - Math.pow(1 - this.poseT, 3);
      const target = this.scrollPose ? this.scrollPose(this.scrollT) : this.poseTo;
      this.pose = { pos: this.poseFrom.pos.clone().lerp(target.pos, e), look: this.poseFrom.look.clone().lerp(target.look, e), shiftX: this.poseFrom.shiftX + (target.shiftX - this.poseFrom.shiftX) * e, shiftY: this.poseFrom.shiftY + (target.shiftY - this.poseFrom.shiftY) * e };
    } else if (this.scrollPose) {
      const target = this.scrollPose(this.scrollT);
      this.pose.pos.lerp(target.pos, Math.min(1, dt * 5));
      this.pose.look.lerp(target.look, Math.min(1, dt * 5));
      this.pose.shiftX += (target.shiftX - this.pose.shiftX) * Math.min(1, dt * 5);
      this.pose.shiftY += (target.shiftY - this.pose.shiftY) * Math.min(1, dt * 5);
    }
    this.applyCamera(t);
    this.updateLight(dt, t);
    this.updateSun(dt, t);
    this.updateFlowers(t);
    this.onFrame?.(dt, t);
    this.renderer.render(this.scene, this.camera);
  }

  private applyCamera(t: number) {
    const sway = this.reduced ? 0 : 0.012;
    this.camera.position.copy(this.pose.pos).add(v(Math.sin(t * 0.2) * sway, Math.cos(t * 0.17) * sway, 0));
    this.camera.lookAt(this.pose.look);
    const w = this.renderer.domElement.clientWidth || innerWidth, h = this.renderer.domElement.clientHeight || innerHeight;
    this.camera.setViewOffset(w, h, this.pose.shiftX * w, this.pose.shiftY * h, w, h);
  }

  resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 54 : 42;
    this.camera.updateProjectionMatrix();
  }

  private updateLight(dt: number, t: number) {
    const l = this.light;
    const dayKey = new THREE.Color(0xfff0cf), nightKey = new THREE.Color(0x6f7bd9), lostKey = new THREE.Color(0x8f8ea8);
    this.key.color.copy(this.lost ? lostKey : nightKey.lerp(dayKey, l));
    this.key.intensity = this.lost ? 1 : 1.5 + l * 2.3;
    this.fill.intensity = 0.55 + l * 0.65;
    this.fill.color.set(0x8f8bf0).lerp(new THREE.Color(0xfff4dc), l);
    this.hemi.color.set(0xffffff).lerp(new THREE.Color(0x6a5fc9), 1 - l);
    this.hemi.groundColor.set(0x4b3a22).lerp(new THREE.Color(0x1a1440), 1 - l);
    this.hemi.intensity = 1.15 + l * 0.35;
    (this.stars.material as THREE.PointsMaterial).opacity = (1 - l) * 0.95;
    (this.fireflies.material as THREE.PointsMaterial).opacity = (1 - l) * (0.6 + Math.sin(t * 3) * 0.2);
    this.fireflies.rotation.y = t * 0.03;
    this.atmosphere.uniforms.color.value.set(0x4a3ad0).lerp(new THREE.Color(0x8fd4ff), l);
    this.atmosphere.uniforms.power.value = 3.2 + l * 0.8;
    (this.water.material as THREE.MeshStandardMaterial).color.set(0x1d2c73).lerp(new THREE.Color(0x2c8fe0), l);
    for (const glow of this.lampGlow) (glow.material as THREE.SpriteMaterial).opacity = (1 - l) * (0.75 + Math.sin(t * 7 + glow.id) * 0.1);
    for (const lamp of this.lamps) {
      const mesh = lamp as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat?.emissiveIntensity !== undefined) mat.emissiveIntensity = 0.2 + (1 - l) * 2.4;
    }
    for (const blade of this.blades) blade.rotation.z += dt * (0.1 + this.rpm * 0.05);
    for (const b of this.beacon) (b as THREE.Mesh).scale.setScalar(1 + Math.sin(t * 4) * 0.25);
  }

  private buildPlanet() {
    const detail = this.lowPower ? 34 : 56;
    const geo = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const d = new THREE.Vector3();
    const heights: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      const h = terrainHeight(d);
      heights.push(h);
      pos.setXYZ(i, d.x * h, d.y * h, d.z * h);
    }
    const grassA = new THREE.Color(0x5fae4a), grassB = new THREE.Color(0x3b8f55), wheat = new THREE.Color(0xd9b84e), soil = new THREE.Color(0x7a5230), rock = new THREE.Color(0x8c8577), sand = new THREE.Color(0xd8c98a);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 3) {
      d.set((pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3);
      const h = d.length();
      d.normalize();
      const patch = fbm(d.x * 3.3 - 9, d.y * 3.3 + 2, d.z * 3.3, 3);
      // Ploughed rows circle the planet in the farming band.
      const rows = Math.sin(Math.asin(d.y) * 46) > 0.2;
      if (h < 1.002) c.copy(sand);
      else if (h > 1.044) c.copy(rock);
      else if (patch > 0.1) c.copy(rows ? soil : wheat);
      else c.copy(grassA).lerp(grassB, THREE.MathUtils.clamp(patch * 4 + 0.6, 0, 1));
      c.offsetHSL(0, 0, ((i * 2654435761) >>> 0) % 100 / 2000 - 0.025);
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 }));
    this.planet.add(mesh);
    this.water = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 12), new THREE.MeshStandardMaterial({ color: 0x2c8fe0, roughness: 0.55, metalness: 0, flatShading: true, transparent: true, opacity: 0.9 }));
    this.water.scale.setScalar(0.999);
    this.planet.add(this.water);
    this.atmosphere = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0x4a3ad0) }, power: { value: 3 } },
      vertexShader: 'varying vec3 n; varying vec3 p; void main(){ n=normalize(normalMatrix*normal); vec4 m=modelViewMatrix*vec4(position,1.); p=normalize(-m.xyz); gl_Position=projectionMatrix*m; }',
      fragmentShader: 'uniform vec3 color; uniform float power; varying vec3 n; varying vec3 p; void main(){ float f=pow(abs(dot(n,p)),power); gl_FragColor=vec4(color,f*.85); }',
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.16, 48, 32), this.atmosphere);
    if (!this.transparentOnly) this.scene.add(halo);
  }

  private buildStars() {
    const n = 1500, p = new Float32Array(n * 3);
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const dir = v(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(14 + r() * 16);
      p.set([dir.x, dir.y, dir.z], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff6dc, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false }));
    this.scene.add(this.stars);
  }

  private buildSun() {
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc62b, emissive: 0xff9a1f, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.4 });
    this.wheelGold = gold;
    this.wheelLamp = new THREE.PointLight(0xffd9a0, 1.2, 3, 1.4); this.wheelLamp.position.set(0.15, 0.1, 0.7); this.sun.add(this.wheelLamp);
    const dark = new THREE.MeshStandardMaterial({ color: 0xb9792a, emissive: 0xff8a3d, emissiveIntensity: 0.5, roughness: 0.6 });
    const R = 0.42;
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(R, 0.028, 10, 60), gold); ringA.position.z = 0.09;
    const ringB = ringA.clone(); ringB.position.z = -0.09;
    this.wheel.add(ringA, ringB);
    const rungs = 26;
    for (let i = 0; i < rungs; i++) {
      const a = (i / rungs) * Math.PI * 2;
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.18, 6), dark);
      rung.rotation.x = Math.PI / 2;
      rung.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      this.wheel.add(rung);
    }
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, R * 2, 6), gold);
      spoke.rotation.z = (i / 6) * Math.PI;
      spoke.position.z = -0.09;
      this.wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16), gold); hub.rotation.x = Math.PI / 2; hub.position.z = -0.09;
    this.wheel.add(hub);
    this.buildHamster();
    this.sun.add(this.wheel, this.hamster);

    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb648, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sunGlow.scale.setScalar(2.4);
    this.sun.add(this.sunGlow);

    const rayMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 }, power: { value: 1 } },
      vertexShader: 'varying vec2 u; void main(){ u=uv-.5; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform float t; uniform float power; varying vec2 u; void main(){ float a=atan(u.y,u.x); float r=length(u)*2.; float s=.5+.5*sin(a*14.+t)*sin(a*5.-t*.6); float f=smoothstep(1.,.28,r)*smoothstep(.2,.32,r); gl_FragColor=vec4(1.,.72,.25,f*s*.32*power); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.sunRays = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), rayMat);
    this.sun.add(this.sunRays);
    this.sun.position.copy(SUN_POS);
  }

  private buildHamster() {
    const fur = new THREE.MeshStandardMaterial({ color: 0xe8b16c, flatShading: true, roughness: 0.8 });
    const belly = new THREE.MeshStandardMaterial({ color: 0xfff1d6, flatShading: true, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.4 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xf2a0a0, flatShading: true });
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 2), fur); body.scale.set(1.3, 0.92, 0.95);
    const tummy = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 2), belly); tummy.position.set(0.02, -0.035, 0); tummy.scale.set(1.3, 0.8, 0.9);
    const head = new THREE.Group(); head.position.set(0.15, 0.04, 0);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 2), fur);
    const cheek = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 1), belly); cheek.position.set(0.03, -0.03, 0.05); const cheek2 = cheek.clone(); cheek2.position.z = -0.05;
    const nose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.014, 1), pink); nose.position.set(0.09, 0, 0);
    const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.014, 1), dark); eye.position.set(0.055, 0.03, 0.05); const eye2 = eye.clone(); eye2.position.z = -0.05;
    const ear = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 1), pink); ear.position.set(-0.03, 0.08, 0.05); const ear2 = ear.clone(); ear2.position.z = -0.05;
    head.add(skull, cheek, cheek2, nose, eye, eye2, ear, ear2);
    this.hamster.add(body, tummy, head);
    const feet: THREE.Object3D[] = [];
    for (const [x, z] of [[0.1, 0.06], [0.1, -0.06], [-0.1, 0.06], [-0.1, -0.06]]) {
      const foot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.027, 1), pink);
      foot.position.set(x, -0.1, z);
      this.hamster.add(foot); feet.push(foot);
    }
    this.hamsterParts = feet;
    this.hamster.userData.head = head;
    this.hamster.position.set(0, -R_HAMSTER, 0);
  }

  private wheelAngle = 0;
  private wheelGold!: THREE.MeshStandardMaterial;
  private wheelLamp!: THREE.PointLight;
  private updateSun(dt: number, t: number) {
    this.sun.lookAt(this.camera.position);
    const omega = (this.rpm / 60) * Math.PI * 2;
    // Real rpm, so the wheel turns on screen at the speed it turns in the room.
    this.wheelAngle -= omega * dt;
    this.wheel.rotation.z = this.wheelAngle;
    const running = this.rpm > 1;
    const stride = t * (4 + this.rpm * 0.2);
    this.hamsterParts.forEach((foot, i) => {
      foot.position.x = (i < 2 ? 0.1 : -0.1) + (running ? Math.sin(stride + (i % 3) * Math.PI) * 0.04 : 0);
      foot.position.y = -0.1 + (running ? Math.max(0, Math.cos(stride + (i % 3) * Math.PI)) * 0.022 : 0);
    });
    const breathe = 1 + Math.sin(t * 1.6) * 0.025;
    this.hamster.scale.set(1, running ? 1 + Math.sin(stride * 2) * 0.03 : breathe, 1);
    this.hamster.position.y = -R_HAMSTER + (running ? Math.abs(Math.sin(stride)) * 0.012 : -0.015);
    const head = this.hamster.userData.head as THREE.Object3D;
    head.rotation.z = running ? 0.1 : -0.42;
    this.wheelGold.emissiveIntensity = 0.16 + this.light * 1.3;
    this.wheelGold.color.set(0x8a6a2c).lerp(new THREE.Color(0xffc62b), this.light);
    this.wheelLamp.intensity = 0.7 + this.light * 1.1;
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = 0.1 + this.light * 0.9;
    this.sunGlow.scale.setScalar(1.7 + this.light * 1.5 + Math.sin(t * 2) * 0.04 * this.light);
    const ray = this.sunRays.material as THREE.ShaderMaterial;
    ray.uniforms.t.value = t * 0.35; ray.uniforms.power.value = this.light;
  }

  private buildFlowers() {
    const count = this.lowPower ? 240 : 560;
    const stemGeo = new THREE.CylinderGeometry(0.0026, 0.0038, 1, 5); stemGeo.translate(0, 0.5, 0);
    this.flowerStems = new THREE.InstancedMesh(stemGeo, new THREE.MeshStandardMaterial({ color: 0x4faf6a, flatShading: true }), count);
    const head = flowerHeadGeometry();
    this.flowerHeads = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 }), count);
    let seed = 42; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let placed = 0, guard = 0;
    const d = v(0, 0, 0);
    while (placed < count && guard++ < count * 200) {
      d.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      const h = terrainHeight(d);
      const patch = fbm(d.x * 3.3 - 9, d.y * 3.3 + 2, d.z * 3.3, 3);
      if (h < 1.006 || h > 1.04 || patch < 0.02) continue;
      const normal = d.clone();
      this.flowers.push({ pos: d.clone().multiplyScalar(h - 0.002), normal, size: 0.8 + r() * 0.6, phase: r() * 6.28, lean: v(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.18) });
      placed++;
    }
    this.flowerStems.count = placed; this.flowerHeads.count = placed;
    this.flowerStems.frustumCulled = false; this.flowerHeads.frustumCulled = false;
    this.planet.add(this.flowerStems, this.flowerHeads);
  }

  /** Heads open and turn to the wheel by day, and droop shut by night. */
  private updateFlowers(t: number) {
    const n = this.flowers.length;
    if (!n) return;
    const sunLocal = this.planet.worldToLocal(SUN_POS.clone());
    const slice = this.lowPower ? 4 : 3;
    this.frameMark = (this.frameMark + 1) % slice;
    const open = 0.46 + this.light * 0.54;
    const m = this.dummy;
    const up = v(0, 1, 0);
    for (let i = this.frameMark; i < n; i += slice) {
      const f = this.flowers[i];
      const height = 0.034 * f.size * (0.72 + this.light * 0.28);
      m.position.copy(f.pos);
      m.quaternion.setFromUnitVectors(up, f.normal);
      m.scale.set(f.size, height, f.size);
      m.updateMatrix();
      this.flowerStems.setMatrixAt(i, m.matrix);
      const top = f.pos.clone().addScaledVector(f.normal, height);
      const toSun = sunLocal.clone().sub(top).normalize();
      const droop = f.normal.clone().addScaledVector(f.lean, 1).multiplyScalar(-0.2).addScaledVector(f.normal, -0.55).add(f.lean);
      const aim = droop.lerp(toSun.add(f.normal.clone().multiplyScalar(0.7)), this.light).normalize();
      m.position.copy(top);
      m.lookAt(this.planet.localToWorld(top.clone().add(aim)));
      // lookAt works in world space, so convert the orientation back into the planet's frame.
      m.quaternion.premultiply(this.planet.quaternion.clone().invert());
      const s = 0.021 * f.size * open * (1 + Math.sin(t * 1.3 + f.phase) * 0.018);
      m.scale.set(s, s, s);
      m.updateMatrix();
      this.flowerHeads.setMatrixAt(i, m.matrix);
    }
    this.flowerStems.instanceMatrix.needsUpdate = true;
    this.flowerHeads.instanceMatrix.needsUpdate = true;
  }

  private buildFireflies() {
    const n = 160, p = new Float32Array(n * 3);
    let seed = 11; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const d = v(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(1.03 + r() * 0.1);
      p.set([d.x, d.y, d.z], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.fireflies = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe28a, size: 0.012, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.planet.add(this.fireflies);
  }

  /** Point on the planet under a screen position, in world space. Null if the pointer is off it. */
  pick(clientX: number, clientY: number, radius = 1.02): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), radius), new THREE.Vector3());
    return hit;
  }
}

const R_HAMSTER = 0.27;

/** One sunflower head, painted with vertex colours and facing +Z. */
export function flowerHeadGeometry(petalCount = 12) {
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, color: number) => {
    const n = g.attributes.position.count, c = new THREE.Color(color), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const disc = new THREE.CylinderGeometry(0.42, 0.34, 0.14, 10); disc.rotateX(Math.PI / 2); disc.translate(0, 0, 0.05);
  parts.push(paint(disc.toNonIndexed(), 0x3a2414));
  for (let i = 0; i < petalCount; i++) {
    const petal = new THREE.ConeGeometry(0.16, 0.62, 4); petal.scale(1, 1, 0.3);
    petal.translate(0, 0.66, 0.02); petal.rotateZ((i / petalCount) * Math.PI * 2);
    parts.push(paint(petal.toNonIndexed(), i % 2 ? 0xffc62b : 0xffb01f));
  }
  const head = mergeGeometries(parts); head.computeVertexNormals();
  return head;
}

let glow: THREE.CanvasTexture | null = null;
export function glowTexture() {
  if (glow) return glow;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(0.6, 'rgba(255,255,255,.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  glow = new THREE.CanvasTexture(c); glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}
