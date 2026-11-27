// Real-time chrome objects for the lobby hero (Three.js).
// Objects: logo (chrome C), mines (gem), plinko (pegs + ball), slots (gold 7), crash (rocket).

import * as THREE from '../vendor/three.module.min.js';
import { toCreasedNormals } from '../vendor/BufferGeometryUtils.js';

const easeOutBack = (t) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeIn = (t) => t * t * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function chrome(color = 0xffffff, roughness = 0.1, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 1,
    roughness,
    clearcoat: 0.7,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.25,
    ...extra,
  });
}

function extrude(shape, { depth = 0.34, bevel = 0.12, size = 0.09, segments = 10, curve = 64 } = {}) {
  let g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: size,
    bevelSegments: segments,
    curveSegments: curve,
  });
  g.center();
  g = toCreasedNormals(g, Math.PI / 4.5);
  return g;
}

// ------------------------------------------------------------------ environment
function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(30, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x6b7282) },
        mid: { value: new THREE.Color(0x14161c) },
        bottom: { value: new THREE.Color(0x2e3038) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(mid, top, pow(y, 0.8)) : mix(mid, bottom, pow(-y, 1.4)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  env.add(dome);
  const panel = (w, h, color, intensity, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(22, 6, 0xffffff, 8, 0, 12, 5); // overhead softbox
  panel(5, 22, 0xd6e4ff, 5.5, -12, 2, 4); // cool left strip
  panel(6, 20, 0xffffff, 6.5, 12, 1, -1); // right strip
  panel(16, 3, 0xffffff, 4.5, 0, -2.5, 12); // low front strip catches faces
  panel(26, 6, 0xa9bbff, 1.6, 0, -12, 0); // floor bounce
  panel(5, 5, 0xffe2c4, 3, 8, -6, 8); // warm kicker
  panel(12, 12, 0xbfd0ff, 2.2, 0, 3, -14); // back rim light
  panel(3, 3, 0xffffff, 10, -6, 7, 9); // hot specular spot
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.025).texture;
  pmrem.dispose();
  return tex;
}

// ------------------------------------------------------------------ objects
function makeLogo() {
  const R = 1;
  const r = 0.56;
  const mid = (R + r) / 2;
  const cap = (R - r) / 2;
  const a0 = THREE.MathUtils.degToRad(48);
  const a1 = THREE.MathUtils.degToRad(312);
  const s = new THREE.Shape();
  s.absarc(0, 0, R, a0, a1, false);
  s.absarc(mid * Math.cos(a1), mid * Math.sin(a1), cap, a1, a1 + Math.PI, false);
  s.absarc(0, 0, r, a1, a0, true);
  s.absarc(mid * Math.cos(a0), mid * Math.sin(a0), cap, a0 + Math.PI, a0 + Math.PI * 2, false);
  const mesh = new THREE.Mesh(extrude(s, { depth: 0.3, bevel: 0.14, size: 0.1, segments: 12, curve: 96 }), chrome(0xf4f6fb, 0.07));
  // A subtle ribbon twist so the reflections sweep across the letter.
  const pos = mesh.geometry.attributes.position;
  const nor = mesh.geometry.attributes.normal;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const ang = Math.atan2(v.y, v.x);
    axis.set(-Math.sin(ang), Math.cos(ang), 0);
    q.setFromAxisAngle(axis, Math.sin(ang) * 0.28);
    const radial = new THREE.Vector3(Math.cos(ang) * mid, Math.sin(ang) * mid, 0);
    v.sub(radial).applyQuaternion(q).add(radial);
    n.applyQuaternion(q);
    pos.setXYZ(i, v.x, v.y, v.z);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  const g = new THREE.Group();
  g.add(mesh);
  g.scale.setScalar(1.02);
  g.userData = { rx: 0.18, ry: -0.35, sway: 0.45 };
  return g;
}

function makeGem() {
  // Brilliant-ish cut: pavilion, girdle, two-tier crown, table.
  const pts = [
    new THREE.Vector2(0.0001, -1.1),
    new THREE.Vector2(1.04, -0.12),
    new THREE.Vector2(1.04, -0.02),
    new THREE.Vector2(0.86, 0.24),
    new THREE.Vector2(0.6, 0.44),
    new THREE.Vector2(0.0001, 0.44),
  ];
  const geo = new THREE.LatheGeometry(pts, 12);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x6dffcf,
    metalness: 0.6,
    roughness: 0.02,
    flatShading: true,
    emissive: 0x08875a,
    emissiveIntensity: 0.5,
    iridescence: 1,
    iridescenceIOR: 1.9,
    iridescenceThicknessRange: [200, 600],
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 2.4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.22;
  const g = new THREE.Group();
  g.add(mesh);
  g.userData = { rx: 0.42, ry: 0, spin: 0.55, sway: 0.2 };
  return g;
}

function makePlinko() {
  const g = new THREE.Group();
  const pegMat = chrome(0xf4f6fa, 0.34, { clearcoat: 0.3, clearcoatRoughness: 0.3 });
  const peg = new THREE.SphereGeometry(0.17, 48, 24);
  const sx = 0.62;
  const sy = 0.54;
  for (let r = 0; r < 3; r++) {
    for (let j = 0; j <= r; j++) {
      const m = new THREE.Mesh(peg, pegMat);
      m.position.set((j - r / 2) * sx, 0.42 - r * sy, 0);
      g.add(m);
    }
  }
  const binColors = [0xffc94a, 0xff4fae, 0xff4fae, 0xffc94a];
  const binGeo = new THREE.BoxGeometry(0.5, 0.3, 0.38);
  binColors.forEach((c, i) => {
    const m = new THREE.Mesh(binGeo, chrome(c, 0.18, { clearcoat: 1 }));
    m.position.set((i - 1.5) * sx, -1.02, 0);
    g.add(m);
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 64, 32), chrome(0xff7cc4, 0.3, { clearcoat: 0.8, clearcoatRoughness: 0.25 }));
  ball.position.set(0.0, 1.0, 0.05);
  g.add(ball);
  g.position.y = 0.0;
  g.userData = { rx: 0.1, ry: -0.3, sway: 0.4, ball };
  return g;
}

function makeSeven() {
  const s = new THREE.Shape();
  s.moveTo(-0.66, 0.94);
  s.lineTo(0.7, 0.94);
  s.lineTo(0.7, 0.66);
  s.quadraticCurveTo(0.14, 0.06, 0.06, -0.96);
  s.lineTo(-0.36, -0.96);
  s.quadraticCurveTo(-0.24, 0.0, 0.3, 0.62);
  s.lineTo(-0.66, 0.62);
  s.closePath();
  const mesh = new THREE.Mesh(extrude(s, { depth: 0.3, bevel: 0.12, size: 0.085, segments: 10, curve: 48 }), chrome(0xffcf72, 0.1));
  const g = new THREE.Group();
  g.add(mesh);
  g.userData = { rx: 0.12, ry: -0.3, sway: 0.5 };
  return g;
}

function makeRocket() {
  const g = new THREE.Group();
  const spline = new THREE.SplineCurve([
    new THREE.Vector2(0.0001, 1.2),
    new THREE.Vector2(0.17, 1.02),
    new THREE.Vector2(0.31, 0.62),
    new THREE.Vector2(0.36, 0.1),
    new THREE.Vector2(0.34, -0.46),
    new THREE.Vector2(0.24, -0.78),
  ]);
  const pts = spline.getPoints(60);
  pts.push(new THREE.Vector2(0.0001, -0.78));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), chrome(0xf3f5fa, 0.08));
  g.add(body);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.035, 20, 48), chrome(0xdfe6f2, 0.1));
  ring.position.set(0, 0.36, 0.335);
  ring.rotation.y = 0.02;
  g.add(ring);
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 32, 16),
    new THREE.MeshPhysicalMaterial({ color: 0x1a5cff, emissive: 0x2f8bff, emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.2, clearcoat: 1 }),
  );
  glass.scale.z = 0.45;
  glass.position.set(0, 0.36, 0.33);
  g.add(glass);

  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0.18);
  finShape.quadraticCurveTo(0.34, -0.1, 0.44, -0.62);
  finShape.lineTo(0.42, -0.74);
  finShape.lineTo(0, -0.52);
  finShape.closePath();
  const finGeo = extrude(finShape, { depth: 0.05, bevel: 0.025, size: 0.02, segments: 4, curve: 24 });
  const finMat = chrome(0x5ab4ff, 0.12, { clearcoat: 1 });
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.set(0.47, -0.42, 0);
    pivot.add(fin);
    pivot.rotation.y = (i / 3) * Math.PI * 2 + Math.PI / 6;
    g.add(pivot);
  }
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.16, 40, 1, true), chrome(0x9aa3b5, 0.25, { side: THREE.DoubleSide }));
  nozzle.position.y = -0.86;
  g.add(nozzle);

  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.8, 32, 1, true), flameMat);
  flame.rotation.x = Math.PI;
  flame.position.y = -1.32;
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 24, 1, true), coreMat);
  core.rotation.x = Math.PI;
  core.position.y = -1.16;
  g.add(flame, core);

  const wrap = new THREE.Group();
  wrap.add(g);
  g.rotation.z = -0.62;
  g.position.set(-0.1, -0.05, 0);
  wrap.scale.setScalar(1.05);
  wrap.userData = { rx: 0.1, ry: 0.25, sway: 0.35, flame, core };
  return wrap;
}

const BUILDERS = { logo: makeLogo, mines: makeGem, plinko: makePlinko, slots: makeSeven, crash: makeRocket };

// ------------------------------------------------------------------ hero
export function createHero(canvas, { initial = 'logo', interactive = true } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !interactive });
  } catch (e) {
    console.warn('[hero] WebGL unavailable', e);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0, 8.2);

  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(3, 4, 5);
  scene.add(key);

  const objects = {};
  const get = (name) => {
    if (!objects[name]) {
      const o = BUILDERS[name]();
      o.visible = false;
      o.scale.multiplyScalar(1);
      o.userData.base = o.scale.x;
      scene.add(o);
      objects[name] = o;
    }
    return objects[name];
  };

  let current = get(initial);
  current.visible = true;
  let outgoing = null;
  let outStart = 0;
  let inStart = -1e9;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const clock = new THREE.Clock();
  let raf = 0;
  let visible = true;
  let destroyed = false;

  function resize() {
    const parent = canvas.parentElement;
    const w = parent.clientWidth || 300;
    const h = parent.clientHeight || 375;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = camera.aspect < 0.85 ? 8.2 / Math.max(0.62, camera.aspect / 0.85) : 8.2;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);

  function pose(o, t, extraSpin) {
    const u = o.userData;
    const base = u.base ?? 1;
    if (u.spin) o.rotation.y = t * u.spin + extraSpin + pointer.x * 0.4;
    else o.rotation.y = (u.ry || 0) + Math.sin(t * 0.55) * (u.sway || 0.3) + pointer.x * 0.5 + extraSpin;
    o.rotation.x = (u.rx || 0) + pointer.y * 0.28 + Math.sin(t * 0.8) * 0.05;
    o.position.y = Math.sin(t * 1.25) * 0.07;
    if (u.ball) {
      const b = Math.abs(Math.sin(t * 2.6));
      u.ball.position.y = 0.93 + b * 0.5;
      const squash = b < 0.12 ? 1 - (0.12 - b) * 1.4 : 1;
      u.ball.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    }
    if (u.flame) {
      const f = 1 + Math.sin(t * 38) * 0.08 + Math.random() * 0.1;
      u.flame.scale.set(1, f, 1);
      u.core.scale.set(1, 1 + Math.random() * 0.15, 1);
    }
    return base;
  }

  function frame() {
    if (destroyed) return;
    raf = visible ? requestAnimationFrame(frame) : 0;
    const t = clock.getElapsedTime();
    const now = performance.now();
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;

    if (outgoing) {
      const k = Math.min(1, (now - outStart) / 320);
      const base = pose(outgoing, t, k * 2.4);
      outgoing.scale.setScalar(Math.max(0.0001, base * (1 - easeIn(k))));
      if (k >= 1) {
        outgoing.visible = false;
        outgoing = null;
        current.visible = true;
        inStart = now;
      }
    }
    if (!outgoing) {
      const k = Math.min(1, (now - inStart) / 950);
      const base = pose(current, t, (1 - easeOut(k)) * -2.6);
      current.scale.setScalar(Math.max(0.0001, base * easeOutBack(k)));
    }
    renderer.render(scene, camera);
  }

  function show(name) {
    if (!BUILDERS[name]) return;
    const next = get(name);
    if (next === current) return;
    if (outgoing) {
      outgoing.visible = false;
    }
    outgoing = current;
    outStart = performance.now();
    current = next;
    current.visible = false;
    current.scale.setScalar(0.0001);
  }

  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.tx = Math.max(-1, Math.min(1, ((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)) * 1.2));
    pointer.ty = Math.max(-1, Math.min(1, ((e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)) * 1.2));
  };
  if (interactive) window.addEventListener('pointermove', onMove, { passive: true });

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && document.visibilityState === 'visible';
    if (visible && !raf) raf = requestAnimationFrame(frame);
  });
  io.observe(canvas);
  const onVis = () => {
    visible = document.visibilityState === 'visible';
    if (visible && !raf) raf = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', onVis);
  if (interactive) raf = requestAnimationFrame(frame);

  /** Render a single still of an object (used to generate the PNG assets). */
  function still(name, { ry, rx, t = 0.6, zoom = 1, y = 0 } = {}) {
    resize();
    camera.position.z /= zoom;
    camera.position.y = y;
    camera.updateProjectionMatrix();
    for (const o of Object.values(objects)) o.visible = false;
    outgoing = null;
    const o = get(name);
    current = o;
    o.visible = true;
    pose(o, t, 0);
    if (ry != null) o.rotation.y = ry;
    if (rx != null) o.rotation.x = rx;
    o.position.y = 0;
    o.scale.setScalar(o.userData.base ?? 1);
    renderer.render(scene, camera);
    return canvas.toDataURL('image/png');
  }

  return {
    show,
    still,
    resize,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) [].concat(o.material).forEach((m) => m.dispose());
      });
      scene.environment?.dispose?.();
      renderer.dispose();
    },
  };
}
