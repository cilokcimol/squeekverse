/**
 * Last Light. Hold the lantern over your field through one night.
 *
 * The wave comes from the current round and the newest settled data hash, so everyone playing in a
 * round faces the same night. The hamster has a hand in it as you play: while he is really running,
 * your lantern recharges faster and throws a wider circle.
 */
import * as THREE from 'three';
import { buildWave, GAME_LIMITS, rng, type MothSpawn } from '../../shared/seed';
import { flowerHeadGeometry, glowTexture, World } from '../world/scene';
import { sfx } from '../lib/sound';

interface Moth { spawn: MothSpawn; pos: THREE.Vector3; hp: number; alive: boolean; eating: number; phase: number; burning: number }
interface Flower { group: THREE.Group; world: THREE.Vector3; alive: boolean; health: number }
export interface Result { score: number; flowers: number; seeds: number; burned: number; owl: boolean; round: number; dayShift: boolean; running: boolean }
export interface Hud { score: number; combo: number; flowers: number; time: number; battery: number; fast: boolean; seeds: number; owl: number | null }

const MAX = 90;

export class LastLight {
  private group = new THREE.Group();
  private moths: Moth[] = [];
  private flowers: Flower[] = [];
  private mesh!: THREE.InstancedMesh;
  private lantern = new THREE.Group();
  private lanternLight = new THREE.PointLight(0xffc873, 0, 1.2, 1.6);
  private ring!: THREE.Mesh;
  private sparks!: THREE.Points;
  private sparkData: { p: THREE.Vector3; v: THREE.Vector3; life: number }[] = [];
  private owlGroup = new THREE.Group();
  private owl = { active: false, hp: 2.4, t: 0, done: false, spawned: false, pos: new THREE.Vector3(), won: false };
  private wave: ReturnType<typeof buildWave>;
  private next = 0;
  private t = 0;
  private score = 0;
  private combo = 1;
  private comboT = 0;
  private burned = 0;
  private seeds = 0;
  private battery = 100;
  private lit = false;
  private aim = new THREE.Vector3(0, 0, 1.02);
  private keyAim = new THREE.Vector2();
  private finished = false;
  private dummy = new THREE.Object3D();
  private frameBefore: World['onFrame'];
  private cleanup: (() => void)[] = [];
  private dayMultiplier: number;

  constructor(private world: World, private opts: {
    seedText: string; round: number; rpm: () => number; holderLevel?: number; onHud: (h: Hud) => void; onMessage: (m: string) => void; onEnd: (r: Result) => void; dayShift: boolean;
  }) {
    this.wave = buildWave(opts.seedText, GAME_LIMITS.flowers, GAME_LIMITS.seconds, Boolean(opts.holderLevel));
    this.dayMultiplier = opts.dayShift ? 0.78 : 1;
    this.frameBefore = world.onFrame;
    world.scene.add(this.group);
    this.buildField();
    this.buildMoths();
    this.buildLantern();
    this.buildSparks();
    this.buildOwl();
    this.bindInput();
    world.onFrame = (dt, time) => { this.frameBefore?.(dt, time); this.update(dt, time); };
  }

  private buildField() {
    const r = rng(this.wave.seedNumber ^ 0x51f15);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x2f8f5b, flatShading: true });
    const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, emissive: 0xff9a1f, emissiveIntensity: 0.22 });
    const headGeo = flowerHeadGeometry();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < GAME_LIMITS.flowers; i++) {
      // Rings on the facing side of the planet, jittered by the round's seed.
      const ring = i < 6 ? 0.2 : 0.45;
      const count = i < 6 ? 6 : 12;
      const a = ((i < 6 ? i : i - 6) / count) * Math.PI * 2 + (r() - 0.5) * 0.3;
      const dir = new THREE.Vector3(Math.cos(a) * ring * 1.1, Math.sin(a) * ring, 1).normalize();
      const group = new THREE.Group();
      group.position.copy(dir).multiplyScalar(1.015);
      group.quaternion.setFromUnitVectors(up, dir);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.006, 0.075, 5), stemMat); stem.position.y = 0.0375;
      const head = new THREE.Mesh(headGeo, headMat); head.position.y = 0.08; head.rotation.x = -Math.PI / 2; head.scale.setScalar(0.042);
      group.add(stem, head);
      this.group.add(group);
      this.flowers.push({ group, world: dir.clone().multiplyScalar(1.09), alive: true, health: 1 });
    }
  }

  private buildMoths() {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.012); shape.quadraticCurveTo(0.05, 0.03, 0.04, 0.05); shape.quadraticCurveTo(0.015, 0.03, 0, 0.012);
    shape.quadraticCurveTo(-0.015, 0.03, -0.04, 0.05); shape.quadraticCurveTo(-0.05, 0.03, 0, -0.012);
    const geo = new THREE.ShapeGeometry(shape, 3);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  private buildLantern() {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc873, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
    glow.scale.setScalar(0.5);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }));
    this.lantern.add(glow, this.ring, this.lanternLight);
    this.lantern.visible = false;
    this.group.add(this.lantern);
  }

  private buildSparks() {
    const n = 200;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(99), 3));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc62b, size: 0.022, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    for (let i = 0; i < n; i++) this.sparkData.push({ p: new THREE.Vector3(99, 99, 99), v: new THREE.Vector3(), life: 0 });
  }

  private buildOwl() {
    const fur = new THREE.MeshStandardMaterial({ color: 0xcdb495, flatShading: true });
    const wing = new THREE.MeshStandardMaterial({ color: 0x7c6650, flatShading: true, side: THREE.DoubleSide });
    const eyes = new THREE.MeshBasicMaterial({ color: 0xffd24a });
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), fur); body.scale.set(1, 1.15, 0.8);
    const left = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.3, 4), wing); left.rotation.z = Math.PI / 2; left.position.x = -0.2; left.scale.z = 0.25; left.name = 'wing';
    const right = left.clone(); right.position.x = 0.2; right.rotation.z = -Math.PI / 2;
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), eyes); e.position.set(s * 0.04, 0.045, 0.085); this.owlGroup.add(e); }
    this.owlGroup.add(body, left, right);
    this.owlGroup.visible = false;
    this.group.add(this.owlGroup);
  }

  private bindInput() {
    const canvas = this.world.renderer.domElement;
    const move = (e: PointerEvent) => { const hit = this.world.pick(e.clientX, e.clientY); if (hit) this.aim.copy(hit); };
    const down = (e: PointerEvent) => { move(e); this.lit = true; canvas.setPointerCapture?.(e.pointerId); e.preventDefault(); };
    const up = () => { this.lit = false; };
    const key = (e: KeyboardEvent) => {
      const on = e.type === 'keydown';
      if (e.code === 'Space') { this.lit = on; e.preventDefault(); }
      if (e.code === 'ArrowLeft') this.keyAim.x = on ? -1 : 0;
      if (e.code === 'ArrowRight') this.keyAim.x = on ? 1 : 0;
      if (e.code === 'ArrowUp') this.keyAim.y = on ? 1 : 0;
      if (e.code === 'ArrowDown') this.keyAim.y = on ? -1 : 0;
      if (e.code.startsWith('Arrow')) e.preventDefault();
    };
    canvas.addEventListener('pointerdown', down);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('keydown', key);
    addEventListener('keyup', key);
    this.cleanup.push(() => { canvas.removeEventListener('pointerdown', down); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); removeEventListener('keydown', key); removeEventListener('keyup', key); });
  }

  private burst(at: THREE.Vector3, count: number, color?: number) {
    let made = 0;
    for (const s of this.sparkData) {
      if (s.life > 0) continue;
      s.p.copy(at);
      s.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8);
      s.life = 0.4 + Math.random() * 0.5;
      if (++made >= count) break;
    }
    void color;
  }

  private update(dt: number, time: number) {
    if (this.finished) return;
    this.t += dt;
    const rpm = this.opts.rpm();
    const fast = rpm > 1;
    // A holder's lantern reaches further with the level of their best Squeek.
    const radius = 0.2 + (fast ? Math.min(0.1, rpm * 0.001) : 0) + Math.min(0.08, (this.opts.holderLevel ?? 0) * 0.012);
    // Keyboard moves the lantern over the surface.
    if (this.keyAim.lengthSq()) { this.aim.x += this.keyAim.x * dt * 0.9; this.aim.y += this.keyAim.y * dt * 0.9; this.aim.setLength(1.03); }

    if (this.lit && this.battery > 0) this.battery = Math.max(0, this.battery - dt * 13);
    else if (!this.lit) this.battery = Math.min(100, this.battery + dt * (15 + (fast ? 6 + rpm * 0.12 : 0)));
    const on = this.lit && this.battery > 0;
    this.lantern.visible = this.t >= 0;
    this.lantern.position.copy(this.aim).setLength(1.09);
    this.lantern.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.aim.clone().normalize());
    this.ring.scale.setScalar(radius);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.95 : 0.3;
    this.lanternLight.intensity = on ? 0.9 : 0.15;
    (this.lantern.children[0] as THREE.Sprite).scale.setScalar(on ? radius * 2.3 : radius * 1);
    ((this.lantern.children[0] as THREE.Sprite).material as THREE.SpriteMaterial).opacity = on ? 0.5 : 0.25;

    while (this.next < this.wave.spawns.length && this.wave.spawns[this.next].at <= this.t) this.spawn(this.wave.spawns[this.next++]);
    this.updateMoths(dt, time, on, radius);
    if (this.t > this.wave.owlAt && !this.owl.spawned) this.spawnOwl();
    this.updateOwl(dt, time, on, radius);
    this.updateSparks(dt);

    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 1;
    const alive = this.flowers.filter((f) => f.alive).length;
    this.opts.onHud({ score: this.score, combo: this.combo, flowers: alive, time: Math.max(0, GAME_LIMITS.seconds - this.t), battery: this.battery, fast, seeds: this.seeds, owl: this.owl.active ? this.owl.hp / 2.4 : null });
    if (alive === 0 || this.t >= GAME_LIMITS.seconds) this.finish(alive);
  }

  private spawn(spawn: MothSpawn) {
    const edge = new THREE.Vector3(Math.cos(spawn.lat), Math.sin(spawn.lat), spawn.lon - 0.4).normalize().multiplyScalar(2.2);
    this.moths.push({ spawn, pos: edge, hp: spawn.kind === 'hawk' ? 0.45 : 0.16, alive: true, eating: 0, phase: Math.random() * 6, burning: 0 });
  }

  private targetFor(m: Moth): Flower | null {
    const preferred = this.flowers[m.spawn.target];
    if (preferred?.alive) return preferred;
    let best: Flower | null = null, d = Infinity;
    for (const f of this.flowers) { if (!f.alive) continue; const q = f.world.distanceToSquared(m.pos); if (q < d) { d = q; best = f; } }
    return best;
  }

  private updateMoths(dt: number, time: number, on: boolean, radius: number) {
    const m = this.dummy;
    let shown = 0;
    const colorMoth = new THREE.Color(0xc9b8ff), colorHawk = new THREE.Color(0xff6a4d), burn = new THREE.Color(0xffd166);
    for (const moth of this.moths) {
      if (!moth.alive) continue;
      const target = this.targetFor(moth);
      if (target) {
        const to = target.world.clone().sub(moth.pos);
        const dist = to.length();
        if (dist > 0.03) {
          to.normalize();
          const wobble = new THREE.Vector3(Math.sin(time * 3 + moth.phase), Math.cos(time * 2.4 + moth.phase), 0).multiplyScalar(0.28);
          moth.pos.addScaledVector(to.add(wobble), moth.spawn.speed * this.dayMultiplier * dt * 1.5);
          if (moth.pos.length() < 1.05) moth.pos.setLength(1.05);
        } else {
          moth.eating += dt;
          target.health -= dt * (moth.spawn.kind === 'hawk' ? 0.34 : 0.17);
          target.group.scale.setScalar(Math.max(0.45, target.health));
          if (target.health <= 0) { target.alive = false; target.group.visible = false; sfx('eaten'); this.burst(target.world, 10); }
        }
      }
      const burning = on && moth.pos.distanceTo(this.lantern.position) < radius + 0.03;
      if (burning) {
        moth.hp -= dt;
        moth.burning = 0.1;
        if (moth.hp <= 0) this.kill(moth);
      }
      moth.burning = Math.max(0, moth.burning - dt);
      const flap = 0.55 + Math.abs(Math.sin(time * 18 + moth.phase)) * 0.7;
      const size = moth.spawn.kind === 'hawk' ? 2.3 : 1.55;
      m.position.copy(moth.pos);
      m.quaternion.copy(this.world.camera.quaternion);
      m.scale.set(size * flap, size, size);
      m.updateMatrix();
      this.mesh.setMatrixAt(shown, m.matrix);
      this.mesh.setColorAt(shown, moth.burning > 0 ? burn : moth.spawn.kind === 'hawk' ? colorHawk : colorMoth);
      shown++;
      if (shown >= MAX) break;
    }
    this.mesh.count = shown;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private kill(moth: Moth) {
    moth.alive = false;
    this.burned++;
    this.combo = Math.min(5, this.combo + 0.25);
    this.comboT = 2.2;
    const base = moth.spawn.kind === 'hawk' ? 260 : 100;
    this.score += Math.round(base * this.combo);
    this.seeds += this.opts.dayShift ? 2 : 1;
    this.burst(moth.pos, moth.spawn.kind === 'hawk' ? 22 : 12);
    sfx('burn');
  }

  private spawnOwl() {
    this.owl.spawned = true; this.owl.active = true;
    this.owl.pos.set(-2.6, 1.8, 1.4);
    this.owlGroup.visible = true;
    this.opts.onMessage('The owl is coming. Keep it in your light.');
    sfx('owl');
  }

  private updateOwl(dt: number, time: number, on: boolean, radius: number) {
    if (!this.owl.active) return;
    this.owl.t += dt;
    const path = Math.min(1, this.owl.t / 9);
    const arc = new THREE.Vector3(Math.sin(this.owl.t * 0.9) * (1.05 - path * 0.7), Math.cos(this.owl.t * 0.7) * (0.9 - path * 0.6), 1.45 - path * 0.3);
    this.owl.pos.lerp(arc, Math.min(1, dt * 2));
    this.owlGroup.position.copy(this.owl.pos);
    this.owlGroup.quaternion.copy(this.world.camera.quaternion);
    const flap = Math.sin(time * 7) * 0.5;
    this.owlGroup.children.forEach((c) => { if (c.name === 'wing') c.rotation.y = flap * (c.position.x < 0 ? 1 : -1); });
    this.owlGroup.scale.setScalar(this.owl.hp < 1 ? 0.8 : 1);
    if (on && this.owl.pos.clone().setLength(1.09).distanceTo(this.lantern.position) < radius + 0.13) {
      this.owl.hp -= dt;
      if (Math.random() < 0.5) this.burst(this.owl.pos, 2);
    }
    if (this.owl.hp <= 0) {
      this.owl.active = false; this.owl.won = true; this.owlGroup.visible = false;
      this.score += 3000 * Math.round(this.combo);
      this.seeds += 25;
      this.burst(this.owl.pos, 60);
      this.opts.onMessage('The owl turned back.');
      sfx('win');
    } else if (this.owl.t > 11) {
      this.owl.active = false; this.owlGroup.visible = false;
      let taken = 0;
      for (const f of this.flowers) { if (f.alive && taken < 4) { f.alive = false; f.group.visible = false; this.burst(f.world, 10); taken++; } }
      this.opts.onMessage(`The owl took ${taken} flowers.`);
      sfx('eaten');
    }
  }

  private updateSparks(dt: number) {
    const a = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    this.sparkData.forEach((s, i) => {
      if (s.life > 0) { s.life -= dt; s.p.addScaledVector(s.v, dt); if (s.life <= 0) s.p.set(99, 99, 99); }
      a.setXYZ(i, s.p.x, s.p.y, s.p.z);
    });
    a.needsUpdate = true;
  }

  private finish(alive: number) {
    this.finished = true;
    const running = this.opts.rpm() > 1;
    const bonus = alive * 500;
    const deepBonus = this.opts.holderLevel ? 1.5 : 1;
    const score = Math.min(GAME_LIMITS.maxScore, Math.round((this.score + bonus) * deepBonus));
    this.opts.onEnd({ score, flowers: alive, seeds: (this.seeds + alive) * (this.opts.holderLevel ? 2 : 1), burned: this.burned, owl: this.owl.won, round: this.opts.round, dayShift: this.opts.dayShift, running });
  }

  /** Ends the shift early and scores what is left. */
  endNow() { this.finish(this.flowers.filter((f) => f.alive).length); }

  destroy() {
    this.finished = true;
    this.cleanup.forEach((fn) => fn());
    this.world.onFrame = this.frameBefore;
    this.world.scene.remove(this.group);
    this.group.traverse((o) => { const mesh = o as THREE.Mesh; mesh.geometry?.dispose?.(); });
  }
}
