// Build-time artwork only. Run tools/render-cases-art.mjs; no WebGL ships in the game.
import * as THREE from '/three.js';
const renderer = new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
renderer.setSize(480,374); renderer.setPixelRatio(1);
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.35;
document.body.append(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(32,360/280,.1,100);
camera.position.set(0,1.4,7.4);camera.lookAt(0,0,0);
const env=new THREE.Scene();
env.add(new THREE.Mesh(new THREE.SphereGeometry(25,24,16),new THREE.MeshBasicMaterial({color:0x343444,side:THREE.BackSide})));
for(const [x,y,z,w,h,color,power] of [[-5,5,6,3,9,0xffffff,7],[5,2,2,3,8,0xd7d8ff,5],[0,7,-3,12,4,0xffc9a0,7],[0,-4,5,7,1,0xffffff,3],[-6,0,-5,2,7,0x9a54ff,4]]){
 const p=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(power),side:THREE.DoubleSide}));p.position.set(x,y,z);p.lookAt(0,0,0);env.add(p);
}
const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(env,.025).texture;pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xffffff,0x282030,2));
const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-3,6,6);scene.add(light);
const metal=(color,rough=.19)=>new THREE.MeshPhysicalMaterial({color,metalness:1,roughness:rough,clearcoat:.5});
const matte=(color)=>new THREE.MeshStandardMaterial({color,roughness:.67,metalness:.22});
function bevel(g,w,h,d,mat,x=0,y=0,z=0,r=.035){
 const shape=new THREE.Shape();const a=-w/2,b=-h/2;
 shape.moveTo(a+r,b);shape.lineTo(a+w-r,b);shape.quadraticCurveTo(a+w,b,a+w,b+r);
 shape.lineTo(a+w,b+h-r);shape.quadraticCurveTo(a+w,b+h,a+w-r,b+h);
 shape.lineTo(a+r,b+h);shape.quadraticCurveTo(a,b+h,a,b+h-r);
 shape.lineTo(a,b+r);shape.quadraticCurveTo(a,b,a+r,b);
 return mesh(g,new THREE.ExtrudeGeometry(shape,{depth:d-2*r,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:r,bevelThickness:r,curveSegments:5}),mat,x,y,z-d/2+r);
}
const gold=metal(0xf5b94e),silver=metal(0xd9e3ef),black=matte(0x171823),purple=metal(0x7937dc,.25);
function mesh(g,geometry,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,mat);m.position.set(x,y,z);g.add(m);return m}
function box(g,w,h,d,mat,x=0,y=0,z=0){return mesh(g,new THREE.BoxGeometry(w,h,d),mat,x,y,z)}
function cyl(g,r,h,mat,x=0,y=0,z=0){const m=mesh(g,new THREE.CylinderGeometry(r,r,h,64),mat,x,y,z);m.rotation.x=Math.PI/2;return m}
function ring(g,r,t,mat,x=0,y=0,z=0){return mesh(g,new THREE.TorusGeometry(r,t,12,80),mat,x,y,z)}
function face(text,bg='#13131b',color='#e5c089'){
 const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,512,256);ctx.strokeStyle=color;ctx.lineWidth=4;ctx.strokeRect(20,20,472,216);ctx.fillStyle=color;ctx.font='600 57px sans-serif';ctx.textAlign='center';ctx.fillText(text,256,145);return new THREE.CanvasTexture(c);
}
function blade(){
 const g=new THREE.Group(),s=new THREE.Shape();s.moveTo(-1.17,-.13);s.lineTo(.49,-.13);s.quadraticCurveTo(1.24,-.10,1.75,.7);s.quadraticCurveTo(1.08,.43,.42,.39);s.lineTo(-1.17,.28);s.closePath();
 mesh(g,new THREE.ExtrudeGeometry(s,{depth:.09,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.045,bevelThickness:.025,curveSegments:30}),new THREE.MeshPhysicalMaterial({color:0x9764ff,metalness:.92,roughness:.12,iridescence:1,iridescenceIOR:1.6,iridescenceThicknessRange:[150,480],clearcoat:1}));
 box(g,.72,.33,.21,black,-1.48,.06,.035);box(g,.12,.66,.29,gold,-1.08,.05,.035);
 for(let i=0;i<6;i++)box(g,.035,.35,.22,purple,-1.75+i*.1,.06,.035);
 for(const x of [-1.72,-1.3])cyl(g,.035,.03,gold,x,.07,.16);
 g.rotation.set(-.12,.2,.48);g.scale.setScalar(.93);return g;
}
function watch(){const g=new THREE.Group();
 for(let i=-5;i<=5;i++)if(Math.abs(i)>1){box(g,.62,.19,.17,gold,0,i*.21,-.04);box(g,.25,.17,.2,silver,0,i*.21,-.018)}
 cyl(g,.59,.20,gold);cyl(g,.49,.025,black,0,0,.12);ring(g,.48,.025,gold,0,0,.14);
 for(let i=0;i<12;i++){const a=i*Math.PI/6;const m=box(g,.027,.09,.018,gold,Math.sin(a)*.4,Math.cos(a)*.4,.15);m.rotation.z=-a}
 const a=box(g,.028,.34,.02,gold,.054,.13,.16);a.rotation.z=-.38;const b=box(g,.025,.29,.025,silver,-.10,-.04,.18);b.rotation.z=2;
 for(let i=0;i<60;i++){const a=i*Math.PI/30;const m=box(g,.009,.035,.012,silver,Math.sin(a)*.44,Math.cos(a)*.44,.16);m.rotation.z=-a}
 for(const [x,y] of [[-.19,.1],[.19,.1],[0,-.21]]){cyl(g,.115,.015,matte(0x242334),x,y,.15);ring(g,.11,.008,gold,x,y,.17);box(g,.008,.075,.012,silver,x,y+.02,.18)}
 const label=mesh(g,new THREE.PlaneGeometry(.18,.075),new THREE.MeshBasicMaterial({map:face('28','#ebe4d8','#211622')}),.27,-.11,.18);
 cyl(g,.045,.028,gold,0,0,.20);cyl(g,.075,.12,gold,.64,0,0).rotation.y=Math.PI/2;
 ring(g,.55,.025,silver,0,0,.13);
 g.rotation.set(-.13,.3,-.46);g.scale.setScalar(1.12);return g;
}
function headphones(){const g=new THREE.Group();
 const band=mesh(g,new THREE.TorusGeometry(.74,.115,10,48,Math.PI),silver);band.position.y=.15;
 const pad=mesh(g,new THREE.TorusGeometry(.69,.095,10,48,Math.PI),black);pad.position.set(0,.14,.07);
 for(const x of [-.73,.73]){box(g,.13,.51,.14,silver,x,-.06,0);const m=mesh(g,new THREE.SphereGeometry(1,32,24),purple,x,-.39,.02);m.scale.set(.27,.43,.26);const cushion=mesh(g,new THREE.SphereGeometry(1,24,24),black,x*.85,-.39,.08);cushion.scale.set(.17,.35,.23)}
 for(const x of [-.73,.73]){const disc=cyl(g,.21,.03,black,x,-.39,.29);ring(g,.19,.014,silver,x,-.39,.32);const mark=mesh(g,new THREE.PlaneGeometry(.22,.11),new THREE.MeshBasicMaterial({map:face('CC','#14111b','#c2a2ed')}),x,-.39,.32)}
 g.rotation.set(.12,-.36,-.2);g.scale.setScalar(1.25);return g;
}
function diamond(){const g=new THREE.Group();const points=[[0,-.75],[.90,-.06],[.90,.02],[.68,.38],[.43,.54],[0,.54]].map(([x,y])=>new THREE.Vector2(x,y));
 mesh(g,new THREE.LatheGeometry(points,10),new THREE.MeshPhysicalMaterial({color:0x63baff,metalness:.75,roughness:.035,flatShading:true,iridescence:1,iridescenceIOR:1.8,clearcoat:1,envMapIntensity:1.8}));g.rotation.set(.22,.34,-.20);g.scale.setScalar(1.25);return g;
}
function chips(){const g=new THREE.Group();
 for(let i=0;i<6;i++){const x=i>3?.55:-.2,y=i>3?(i-4)*.18-.50:i*.18-.50,z=i>3?.14:0;const m=cyl(g,.56,.15,i%2?gold:silver,x,y,z);m.rotation.x=0;const r=ring(g,.44,.014,black,x,y+.077,z);r.rotation.x=Math.PI/2;for(let j=0;j<8;j++){const a=j*Math.PI/4;const p=box(g,.12,.155,.08,black,x+Math.sin(a)*.50,y,z+Math.cos(a)*.50);p.rotation.y=a}}
 g.rotation.set(.22,-.42,-.12);g.scale.setScalar(1.5);return g;
}
function signet(){const g=new THREE.Group();ring(g,.60,.17,gold);
 bevel(g,.84,.60,.24,gold,0,.55,.09,.04);
 const emerald=new THREE.MeshPhysicalMaterial({color:0x16bd78,metalness:.55,roughness:.045,clearcoat:1,flatShading:true});
 const gem=mesh(g,new THREE.OctahedronGeometry(.45,0),emerald,0,.57,.23);gem.scale.set(1,.7,.30);gem.rotation.z=Math.PI/4;
 for(const x of [-.36,.36])for(const y of [.32,.8])mesh(g,new THREE.SphereGeometry(.042,12,8),silver,x,y,.23);
 for(let i=0;i<9;i++){const a=i*Math.PI/8;mesh(g,new THREE.SphereGeometry(.033,8,6),silver,Math.cos(a)*.60,Math.sin(a)*.60,.17)}
 g.rotation.set(.28,.45,-.3);g.scale.setScalar(1.3);return g
}
function caseModel(open=0,theme){const g=new THREE.Group();
 const tint=theme==='neon-vault'?0x12baa0:theme==='high-roller'?0xd6a348:0x8c48d0;
 const accent=theme?new THREE.MeshPhysicalMaterial({color:tint,metalness:.65,roughness:.22,clearcoat:1}):purple;
 const shell=metal(theme==='after-hours'?0x30213d:0x292631,.38),edge=metal(theme==='high-roller'?0xd6a348:0x70707f,.25),foam=matte(0x100c19);
 bevel(g,2.9,.91,1.48,shell,0,-.12,0,.055);
 bevel(g,2.72,.055,1.32,accent,0,.35,0,.015);
 box(g,2.56,.035,1.19,foam,0,.39,0);
 // Recessed foam and individually lit metal ribs give the open shell real depth.
 for(let i=-6;i<=6;i++)box(g,.075,.035,1.05,matte(0x2a1939),i*.18,.42,0);
 for(const x of [-1.32,1.32]){
  bevel(g,.18,.98,1.51,edge,x,-.1,0,.02);
  for(const y of [-.43,.2])for(const z of [-.77,.77])cyl(g,.028,.025,silver,x,y,z);
 }
 for(const y of [-.45,-.32,-.19])box(g,1.18,.025,.022,black,0,y,.75);
 for(const x of [-.76,.76]){
  const latch=new THREE.Group();latch.position.set(x,.2,.79);g.add(latch);
  bevel(latch,.22,.35,.09,silver,0,-.05,0,.025);box(latch,.12,.14,.02,black,0,-.08,.055);
  latch.rotation.x=-Math.min(1,open*5)*1.1;
 }
 const lid=new THREE.Group();lid.position.set(0,.36,-.72);g.add(lid);
 bevel(lid,2.9,.25,1.48,shell,0,.125,.72,.04);
 bevel(lid,2.7,.025,1.29,accent,0,.28,.72,.01);
 if(theme){
  const led=new THREE.MeshStandardMaterial({color:tint,emissive:tint,emissiveIntensity:.8});
  for(const x of [-1.14,1.14]){box(g,.035,.6,.02,led,x,-.10,.76);box(lid,.05,.01,1.12,led,x,.31,.72)}
  for(let i=0;i<4;i++)box(g,.06,.024,.025,accent,-.1+i*.12,-.36,.76);
  for(const x of [-.96,.96]){const stripe=box(lid,.17,.015,.75,theme==='high-roller'?gold:silver,x,.305,.72);stripe.rotation.y=theme==='neon-vault'?.3:-.3}
 }
 // Brushed panel, corner fasteners, etched badge and two hinge barrels.
 for(const x of [-1.23,1.23])for(const z of [.18,1.24]){
  const bolt=cyl(lid,.038,.025,silver,x,.30,z);bolt.rotation.x=0;
 }
 const badge=mesh(lid,new THREE.PlaneGeometry(1.75,.74),new THREE.MeshStandardMaterial({map:face('CRANKED'),metalness:.65,roughness:.28}),0,.305,.72);badge.rotation.x=-Math.PI/2;
 for(const x of [-.87,.87]){const h=mesh(g,new THREE.CylinderGeometry(.085,.085,.36,32),edge,x,.36,-.72);h.rotation.z=Math.PI/2}
 lid.rotation.x=-open*1.18;
 if(open){
  box(lid,2.58,.02,1.14,foam,0,-.016,.72);
  for(let i=-5;i<=5;i++)box(lid,.065,.018,1.0,matte(0x30213e),i*.21,-.03,.72);
  const glow=new THREE.MeshStandardMaterial({color:theme?tint:0xd7a7ff,emissive:theme?tint:0xa34fff,emissiveIntensity:1.6});
  for(const z of [-.56,.56])box(g,2.5,.018,.015,glow,0,.44,z);
  for(const x of [-1.24,1.24])box(g,.015,.018,1.12,glow,x,.44,0);
 }
 for(const x of [-.47,.47])bevel(g,.13,.2,.18,edge,x,-.15,.82,.015);
 bevel(g,.98,.13,.15,edge,0,-.10,.93,.025);bevel(g,.68,.14,.16,black,0,-.11,.94,.025);
 g.rotation.set(.25,-.35,-.04);g.scale.setScalar(.98);return g;
}
const models={blade,watch,headphones,diamond,chips,signet,case:()=>caseModel(false),open:()=>caseModel(true)};
function disposeObject(obj){obj.traverse(node=>{node.geometry?.dispose()});}
window.renderAsset=(name)=>{
 renderer.setSize(480,374);
 const obj=name.startsWith('caseFrame')?caseModel(Number(name.slice(9))/18):models[name]();
 scene.add(obj);renderer.render(scene,camera);
 const result=renderer.domElement.toDataURL('image/webp',.94);scene.remove(obj);disposeObject(obj);return result;
};
window.renderTurntable=(name,inspect=false)=>{
 // 24 lit 3D views, packed into one small atlas. Final pose matches the static art.
 const width=inspect?512:256,height=inspect?400:200;
 renderer.setSize(width,height);
 const atlas=document.createElement('canvas');atlas.width=width*6;atlas.height=height*4;
 const ctx=atlas.getContext('2d');const obj=models[name]();const pivot=new THREE.Group();pivot.add(obj);scene.add(pivot);
 for(let i=0;i<24;i++){
  const t=i/23;
  pivot.rotation.set(0,-Math.PI*2*(1-t),0);
  renderer.render(scene,camera);ctx.drawImage(renderer.domElement,(i%6)*width,Math.floor(i/6)*height);
 }
 scene.remove(pivot);disposeObject(obj);return atlas.toDataURL('image/webp',.88);
};
window.renderShowcase=(theme,kind)=>{
 if(kind==='atlas'){
  renderer.setSize(320,250);
  const c=document.createElement('canvas');c.width=1600;c.height=1000;const ctx=c.getContext('2d');
  for(let i=0;i<20;i++){const obj=caseModel(i/19,theme);scene.add(obj);renderer.render(scene,camera);ctx.drawImage(renderer.domElement,(i%5)*320,Math.floor(i/5)*250);scene.remove(obj);disposeObject(obj)}
  return c.toDataURL('image/webp',.90);
 }
 renderer.setSize(720,560);const obj=caseModel(kind==='opened'?1:0,theme);scene.add(obj);renderer.render(scene,camera);const out=renderer.domElement.toDataURL('image/webp',.94);scene.remove(obj);disposeObject(obj);return out;
};
window.ready=true;
