// Orthographic model artwork. All positions are in lane units: x across the road,
// y uphill, z above the ground. The silhouettes are rasterized once per variant.
const logAxisHeight = 0.03;
const logRadius = 0.22;
export const logTop = logAxisHeight + logRadius;
export const padTop = 0.07;
const yaw = (23 * Math.PI) / 180;
const pitch = (41 * Math.PI) / 180;
const cy = Math.cos(yaw),
  sy = Math.sin(yaw);
const cp = Math.cos(pitch),
  sp = Math.sin(pitch);
export const plane = { xx: cy, xy: sy * sp, yx: sy, yy: -cy * sp, height: cp };

function project([x, y, z]) {
  return [x * cy + y * sy, (x * sy - y * cy) * sp - z * cp];
}
function depth([x, y, z]) {
  return (x * sy - y * cy) * cp + z * sp;
}
const cache = new Map();
const silhouettes = new Map();
const colors = ['#ef5144', '#eab43a', '#60aadb', '#96bd43', '#f38036', '#86bdd0', '#df635a', '#4bb5a6'];

function model(kind, variant, direction) {
  const faces = [];
  const points = [];
  function face(vertices, color) {
    const v = vertices.map(([x, y, z]) =>
      Math.abs(direction) === 2 ? [(y * direction) / 2, (-x * direction) / 2, z] : [x * direction, y * direction, z],
    );
    const [a, b, c] = v;
    const u = b.map((p, i) => p - a[i]),
      w = c.map((p, i) => p - a[i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    points.push(...v);
    if (depth(n) <= 0) return;
    const len = Math.hypot(...n);
    const nx=n[0]/len, ny=n[1]/len, nz=n[2]/len;
    const direct=Math.max(0,-.68*nx+.39*ny+.62*nz);
    const sky=.5+.5*nz;
    const gloss = color === '#344f60' || color === '#39586b' || color === '#345269';
    const enamel = colors.includes(color) || color === '#efb937';
    const shine = Math.pow(Math.max(0,-.32*nx-.26*ny+.91*nz),gloss ? 12 : 20) * (gloss ? 95 : enamel ? 51 : 8);
    const rgb = parseInt(color.slice(1), 16);
    const shade = [rgb >> 16, (rgb >> 8) & 255, rgb & 255].map((k,i) => {
      const fill=[.43,.51,.65][i] + sky*[.16,.19,.21][i];
      return Math.min(255, Math.round(k*(fill + direct*[.77,.64,.44][i]) + shine));
    });
    faces.push({
      v: v.map(project),
      depth: v.reduce((s, p) => s + depth(p), 0) / v.length,
      color: 'rgb(' + shade.join(',') + ')',
    });
  }
  // Stack polygon rings from bottom to top, winding counterclockwise.
  function solid(rings, color) {
    for (let j = 1; j < rings.length; j++) {
      const a = rings[j - 1],
        b = rings[j];
      for (let i = 0; i < a.length; i++) {
        const k = (i + 1) % a.length;
        face([a[i], a[k], b[k], b[i]], color);
      }
    }
    face(rings.at(-1), color);
  }
  function block(x, y, z, l, w, h, color, bevel = 0.08, taper = 1) {
    const ring = (height, k) => {
      const a = (l * k) / 2,
        b = (w * k) / 2,
        d = Math.min(a, b) * bevel;
      return [
        [-a + d, -b],
        [a - d, -b],
        [a, -b + d],
        [a, b - d],
        [a - d, b],
        [-a + d, b],
        [-a, b - d],
        [-a, -b + d],
      ].map(([i, j]) => [x + i, y + j, height]);
    };
    solid([ring(z, 0.97), ring(z + h * 0.12, 1), ring(z + h * 0.86, taper), ring(z + h, taper * 0.96)], color);
  }
  function bulb(x, y, z, rx, ry, rz, color, sides = 14) {
    // Project an ellipsoid analytically. Its silhouette and shading stay smooth
    // at every sprite resolution; sample points only for its cast shadow.
    const turn = ([i,j,k]) => Math.abs(direction) === 2
      ? [j * direction / 2, -i * direction / 2, k] : [i * direction, j * direction, k];
    const center3 = turn([x,y,z]);
    const center = project(center3);
    const axes = [[rx,0,0],[0,ry,0],[0,0,rz]].map(a => project(turn(a)));
    const xx = axes.reduce((v,a)=>v+a[0]*a[0],0);
    const xy = axes.reduce((v,a)=>v+a[0]*a[1],0);
    const yy = axes.reduce((v,a)=>v+a[1]*a[1],0);
    const angle=.5*Math.atan2(2*xy,xx-yy);
    const spread=Math.hypot(xx-yy,2*xy);
    const major=Math.sqrt((xx+yy+spread)/2), minor=Math.sqrt((xx+yy-spread)/2);
    for (const latitude of [-1.5,-.85,0,.85,1.5]) {
      for(let i=0;i<sides;i++){
        const a=2*Math.PI*i/sides;
        points.push(turn([x+rx*Math.cos(latitude)*Math.cos(a), y+ry*Math.cos(latitude)*Math.sin(a), z+rz*Math.sin(latitude)]));
      }
    }
    faces.push({oval:{center,major,minor,angle},depth:depth(center3),color});
  }
  function tube(x, y, z, l, r, color, axis = 'x', sides = 18) {
    const ring = (offset) =>
      Array.from({ length: sides }, (_, i) => {
        const a = (i * 2 * Math.PI) / sides;
        return axis === 'x'
          ? [x + offset, y + r * Math.cos(a), z + r * Math.sin(a)]
          : [x + r * Math.cos(a), y + offset, z - r * Math.sin(a)];
      });
    const a = ring(-l / 2),
      b = ring(l / 2);
    for (let i = 0; i < sides; i++) {
      const k = (i + 1) % sides;
      face([a[i], a[k], b[k], b[i]], color);
    }
    face(a.reverse(), color);
    face(b, color);
  }
  const paint = colors[variant % colors.length];
  function wheels(xs, halfWidth, radius) {
    for (const x of xs)
      for (const side of [-1, 1]) {
        tube(x, side * halfWidth, radius, 0.1, radius, '#303743', 'y');
        tube(x, side * (halfWidth + 0.056), radius, 0.018, radius * 0.48, '#aeb6af', 'y');
      }
  }
  if (kind === 'car' || kind === 'taxi') {
    const body = kind === 'taxi' ? '#efb937' : paint;
    wheels([-0.34, 0.33], 0.282, 0.118);
    block(0, 0, 0.13, 1.09, 0.59, 0.24, body, 0.29);
    block(-0.06, 0, 0.355, 0.67, 0.54, 0.225, '#344f60', 0.19, 0.78);
    block(-0.08, 0, 0.552, 0.49, 0.44, 0.052, body, 0.25);
    for (const side of [-1, 1]) {
      block(-0.085, side * 0.251, 0.368, 0.038, 0.035, 0.16, body);
      block(0.295, side * 0.302, 0.34, 0.09, 0.09, 0.055, body);
      block(0.527, side * 0.178, 0.225, 0.041, 0.123, 0.063, '#fff2bb');
      block(-0.528, side * 0.19, 0.223, 0.034, 0.099, 0.077, '#ad3232');
    }
    block(0.538, 0, 0.147, 0.043, 0.43, 0.047, '#79858b');
    if (kind === 'taxi') block(-0.08, 0, 0.605, 0.17, 0.2, 0.07, '#ffdc64');
  } else if (['bus', 'truck', 'coach', 'engine'].includes(kind)) {
    const rail = kind === 'coach' || kind === 'engine';
    const l = 2.7;
    wheels([-0.86, 0.87], 0.327, 0.147);
    block(0, 0, 0.19, l, 0.7, 0.17, '#3c4344');
    if (kind === 'truck') {
      block(-0.34, 0, 0.34, 1.94, 0.73, 0.72, '#eee7d5', 0.12);
      block(0.94, 0, 0.34, 0.67, 0.71, 0.47, paint, 0.19, 0.95);
      block(0.98, 0, 0.62, 0.55, 0.66, 0.22, '#39586b', 0.19, 0.9);
      block(0.92, 0, 0.84, 0.55, 0.68, 0.075, paint);
      block(1.27, 0, 0.35, 0.08, 0.64, 0.085, '#e7e1ce');
      for (const side of [-1, 1]) block(1.26, side * 0.23, 0.49, 0.05, 0.11, 0.065, '#ffe3a5');
    } else {
      const c = rail ? '#247c89' : paint;
      block(0, 0, 0.32, l, 0.73, 0.42, c, 0.16);
      block(0.015, 0, 0.68, l * 0.96, 0.71, 0.31, '#345269', 0.14);
      for (let x = -1.08; x < 1.3; x += 0.39) block(x, 0, 0.68, 0.045, 0.72, 0.29, c);
      block(0, 0, 0.985, l * 0.97, 0.74, 0.08, rail ? '#c7d1c9' : '#f4e8c6');
      for (const side of [-1, 1]) block(0, side * 0.367, 0.47, l * 0.94, 0.024, 0.08, rail ? '#f4bc59' : '#fff1da');
      if (kind === 'engine') block(0.6, 0, 1.05, 0.68, 0.53, 0.14, '#516671');
    }
  } else if (kind === 'tree') {
    const size = 0.8 + (variant % 4) * 0.09;
    block(0, 0, 0, 0.22, 0.24, 0.63, '#8a6143', 0.18, 0.73);
    bulb(
      0,
      0,
      0.91 * size,
      0.49 * size,
      0.43 * size,
      0.6 * size,
      ['#80aa3c', '#689e48', '#98b83f', '#5e9b4e'][variant % 4],
      15,
    );
    bulb(.20, -.11, .89*size, .25, .22, .27, '#76a346', 12);
    bulb(-.19, -.12, .87*size, .25, .22, .30, '#82ab43', 12);
    bulb(-0.18, 0.09, 1.08 * size, 0.25, 0.25, 0.32, '#91b947', 12);
  } else if (kind === 'bridge') {
    for (let j = 0; j < 6; j++) block(0, -0.425 + j * 0.17, 0.12, 1.1, 0.16, 0.08, j % 3 ? '#c79561' : '#d5aa76', 0.02);
    for (const x of [-0.52, 0.52]) {
      block(x, -0.43, 0, 0.085, 0.1, 0.54, '#987248');
      block(x, 0, 0.42, 0.064, 1, 0.065, '#dfb985');
    }
  } else if (kind === 'fence') {
    for (const x of [-0.5, 0.5]) {
      block(x, 0, 0, 0.135, 0.16, 0.53, '#ca9864');
      block(x, 0, 0.53, 0.148, 0.173, 0.04, '#e1b986');
    }
    for (const z of [0.14, 0.34]) block(0, 0.045, z, 1.99, 0.092, 0.09, '#cfaa78');
  } else if (kind === 'curb') {
    // One row's length of the low stone wall that edges the course, with a pale coping.
    block(0, 0, 0, 0.2, 1.01, 0.15, '#8f9a93', 0.25);
    block(0, 0, 0.15, 0.25, 1.01, 0.055, '#e9e0c6', 0.3);
  } else if (kind === 'rock') {
    bulb(0, 0, 0.14, 0.37, 0.29, 0.23, '#98a29a', 7);
  } else if (kind === 'log') {
    tube(0, 0, logAxisHeight, 2.46, logRadius, '#bc7442');
    for (const side of [-1, 1]) {
      tube(side * 1.236, 0, 0.03, 0.025, 0.215, '#e2a365');
      tube(side * 1.251, 0, 0.03, 0.009, 0.135, '#b97b48');
      tube(side * 1.26, 0, 0.03, 0.011, 0.09, '#e8af71');
    }
    block(-0.35, 0.035, 0.24, 0.82, 0.032, 0.012, '#e19b60');
    block(.57, -.10, .216, .66, .024, .010, '#db9865');
    block(-.22, -.203, .093, 1.85, .015, .018, '#825136');
  } else if (kind === 'pad') {
    const arc = Array.from({ length: 15 }, (_, i) => [0.44 * Math.cos(0.4 + i * 0.408), 0.32 * Math.sin(0.4 + i * 0.408)]);
    const shape = [[0, 0], ...arc];
    solid(
      [0.015, padTop].map((z) => shape.map(([x, y]) => [x, y, z])),
      '#86b83d',
    );
    face(
      [
        [0, 0, 0.073],
        [-0.32, 0.06, 0.073],
        [-0.23, 0.02, 0.073],
      ],
      '#b0ce61',
    );
    if (variant === 0) bulb(-0.12, -0.06, 0.12, 0.07, 0.07, 0.052, '#ffcdf0');
  } else if (kind === 'signal') {
    block(0, 0, 0, 0.14, 0.14, 0.8, '#5a6059');
    block(0, 0, 0.73, 0.5, 0.14, 0.22, '#394343');
    for (const side of [-1, 1]) bulb(side * 0.135, -0.08, 0.84, 0.077, 0.04, 0.077, variant === 1 ? '#ff6246' : '#9a463e');
    block(0, 0, 1.0, 0.35, 0.11, 0.08, '#f7efe1');
  } else if (kind === 'hen') {
    const crouch = variant === 4;
    const z = crouch ? -0.08 : 0;
    const flying = variant === 2;
    for (const side of [-1, 1]) {
      block(side * .104, flying ? -.05 : .025, flying ? .13 : .015,
        .10, flying ? .15 : .215, .07, '#e7a32b', .23);
    }
    bulb(0, -0.036, 0.25 + z, 0.242, 0.235, 0.23, '#fff4d9');
    bulb(0, 0.12, 0.47 + z, 0.19, 0.16, 0.18, '#fff9e9');
    bulb(0, 0.27, 0.455 + z, 0.071, 0.11, 0.063, '#f4ae36', 7);
    for (const side of [-1, 1]) {
      bulb(
        side * (flying ? 0.285 : 0.2),
        -0.055,
        (flying ? 0.38 : 0.28) + z,
        flying ? .13 : .077,
        0.135,
        0.13,
        '#eadcbd',
        8,
      );
      bulb(side * 0.16, 0.18, 0.505 + z, 0.027, 0.026, 0.033, '#2a3035', 7);
    }
    bulb(0, -0.248, 0.345 + z, 0.085, 0.11, 0.17, '#fff8e9', 7);
    for (const [i, h] of [
      [0, 0.075],
      [1, 0.1],
      [2, 0.067],
    ])
      bulb(0, 0.026 + i * 0.078, 0.626 + z, 0.048, 0.055, h, '#dc4337', 7);
  }
  return { faces, points };
}

// Load the original artwork ahead of new lane reveals. Play can start while it
// downloads. Every stamp also has a local procedural path for offline play.
let atlas, loading;
export function prepareSprites() {
  if (!loading) {
    const url = new URL('../../assets/rooster/models.json?v=75edf9c4dd59', import.meta.url);
    loading = (async () => {
      const response = await fetch(url);
      if (!response.ok) return;
      const { image: file, records, shapes } = await response.json();
      const image = new Image();
      image.src = new URL(file, url).href;
      await image.decode();
      atlas = { image, records, shapes };
    })().catch(() => {});
  }
  return loading;
}

function cropSprite([x, y, width, height]) {
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  image.getContext('2d').drawImage(atlas.image, x, y, width, height, 0, 0, width, height);
  return image;
}

export function stamp(kind, variant = 0, direction = 1) {
  if (kind === 'taxi' || kind === 'rock') variant = 0;
  if (kind === 'pad' && variant !== 0) variant = 1;
  const key = `${kind}/${variant}/${direction}`;
  if (cache.has(key)) return cache.get(key);
  const baked = atlas?.records[key];
  if (baked) {
    const { left, top, width, height, shadow } = baked;
    if (!silhouettes.has(shadow)) {
      const { x, y, w, h, rect } = atlas.shapes[shadow];
      silhouettes.set(shadow, { key: shadow, x, y, w, h, image: cropSprite(rect) });
    }
    const result = { left, top, width, height, penumbra: silhouettes.get(shadow), image: cropSprite(baked.rect) };
    cache.set(key, result);
    return result;
  }
  const { faces, points } = model(kind, variant, direction);
  const coords = points.map(project);
  const left = Math.min(...coords.map((p) => p[0])) - 0.025,
    top = Math.min(...coords.map((p) => p[1])) - 0.025;
  const right = Math.max(...coords.map((p) => p[0])) + 0.025,
    bottom = Math.max(...coords.map((p) => p[1])) + 0.025;
  const resolution = 104;
  const image = document.createElement('canvas');
  image.width = Math.ceil((right - left) * resolution);
  image.height = Math.ceil((bottom - top) * resolution);
  const g = image.getContext('2d');
  g.scale(resolution, resolution);
  g.translate(-left, -top);
  g.lineJoin = 'round';
  g.lineWidth = 0.005;
  for (const f of faces.sort((a, b) => a.depth - b.depth)) {
    if(f.oval) {
      const {center:[x,y],major,minor,angle} = f.oval;
      const rgb=parseInt(f.color.slice(1),16);
      const channels=[rgb>>16,(rgb>>8)&255,rgb&255];
      const tint = (gains,add) => 'rgb('+channels.map((v,i)=>Math.min(255,Math.round(v*gains[i]+add[i]))).join(',')+')';
      const light=g.createRadialGradient(x-.30*major,y-.55*major,.02*minor,x,y,major*1.08);
      light.addColorStop(0,tint([1.15,1.09,.94],[22,18,8]));
      light.addColorStop(.43,tint([1.04,1,.90],[7,6,4]));
      light.addColorStop(.87,tint([.53,.65,.72],[4,7,11]));
      light.addColorStop(1,tint([.49,.60,.66],[8,10,14]));
      g.fillStyle=light;
      g.beginPath(); g.ellipse(x,y,major,minor,angle,0,2*Math.PI); g.fill();
      continue;
    }
    g.beginPath();
    f.v.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = g.strokeStyle = f.color;
    g.fill();
    g.stroke();
  }
  if (kind === 'tree') {
    // Break up the broad canopy light with small overlapping leaf clusters.
    // Clip each dab to the baked silhouette, leaving the trunk untouched.
    g.save();
    g.globalCompositeOperation = 'source-atop';
    let state = 3419 + variant;
    const random = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i=0;i<230;i++){
      const x=left+random()*(right-left), y=top+random()*(bottom-top)*.73;
      const radius=.009+random()*.023;
      g.fillStyle=i%3?'rgba(220,232,134,.18)':'rgba(30,69,50,.22)';
      g.beginPath();g.ellipse(x,y,radius,radius*.52,-.5+random(),0,2*Math.PI);g.fill();
    }
    g.restore();
  }
  // Bake soft skylight and bounce light into the sprite once, including its bevels.
  g.globalCompositeOperation = 'source-atop';
  const light = g.createLinearGradient(left, top, right, bottom);
  light.addColorStop(0, 'rgba(255,247,205,.23)');
  light.addColorStop(.50, 'rgba(255,246,219,0)');
  light.addColorStop(1, 'rgba(38,66,97,.18)');
  g.fillStyle = light;
  g.fillRect(left, top, right - left, bottom - top);
  // Paint colors share geometry and cast the same shadow.
  const painted = kind === 'car' || kind === 'bus' || kind === 'truck';
  const shape = painted ? `${kind}/${direction}` : key;
  if (!silhouettes.has(shape)) silhouettes.set(shape, castShadow(shape, points));
  const penumbra = silhouettes.get(shape);
  const result = { image, penumbra, left, top, width: image.width / resolution, height: image.height / resolution };
  cache.set(key, result);
  return result;
}

function castShadow(key, points) {
  // Project the mesh onto the ground along the sunlight and retain its convex silhouette.
  const cast = points.map(([x, y, z]) => [x + 1.10 * z, y - 0.63 * z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  function boundary(vertices) {
    const edge = [];
    for (const p of vertices) {
      while (edge.length >= 2) {
        const a = edge.at(-2),
          b = edge.at(-1);
        if ((b[0] - a[0]) * (p[1] - a[1]) > (b[1] - a[1]) * (p[0] - a[0])) break;
        edge.pop();
      }
      edge.push(p);
    }
    return edge.slice(0, -1);
  }
  const outline = boundary(cast).concat(boundary(cast.reverse()));
  const shadow = new Path2D();
  outline.forEach(([x, y], i) => i ? shadow.lineTo(x, y) : shadow.moveTo(x, y));
  shadow.closePath();
  // Rasterize the penumbra in ground coordinates; no per-frame blur filter.
  const shadowScale=40, margin=.17;
  const xs=outline.map(p=>p[0]), ys=outline.map(p=>p[1]);
  const x0=Math.min(...xs)-margin, y0=Math.min(...ys)-margin;
  const shadeMap=document.createElement('canvas');
  shadeMap.width=Math.ceil((Math.max(...xs)+margin-x0)*shadowScale);
  shadeMap.height=Math.ceil((Math.max(...ys)+margin-y0)*shadowScale);
  const sg=shadeMap.getContext('2d');
  sg.scale(shadowScale,shadowScale);
  sg.translate(-x0,-y0);
  sg.fillStyle='#152a39';
  sg.shadowColor='#152a39';
  sg.shadowBlur=4;
  sg.globalAlpha=.40;
  sg.fill(shadow);
  return { key, image: shadeMap, x: x0, y: y0, w: shadeMap.width / shadowScale, h: shadeMap.height / shadowScale };
}
