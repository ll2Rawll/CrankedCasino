// Original sculpted case and item models. Used only by the offline art renderer.
export function mythicArt(T, H) {
  const {mesh,box,bevel,cyl,ring,metal,matte,gold,silver,black} = H;
  const fire=metal(0xd65d27,.22), violet=metal(0x8b62dd,.16), sea=metal(0x289b91,.24);
  const glow=c=>new T.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:1.3,roughness:.25});
  const crystal=c=>new T.MeshPhysicalMaterial({color:c,metalness:.65,roughness:.06,clearcoat:1,iridescence:.7,flatShading:true});
  function tube(g,points,r,material){return mesh(g,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),32,r,8,false),material)}
  function gem(g,r,material,x=0,y=0,z=0){return mesh(g,new T.IcosahedronGeometry(r,0),material,x,y,z)}
  function orb(g,r,material,x=0,y=0,z=0){return mesh(g,new T.SphereGeometry(r,36,24),material,x,y,z)}
  function spike(g,r,h,material,x,y,z){return mesh(g,new T.ConeGeometry(r,h,8),material,x,y,z)}
  function base(g,color=gold){const a=cyl(g,1.08,.14,black,0,-1.05,0);a.rotation.x=0;const b=cyl(g,.97,.065,color,0,-.96,0);b.rotation.x=0;const c=ring(g,.92,.035,color,0,-.92,0);c.rotation.x=Math.PI/2}
  function eggGeometry(start){const geo=new T.SphereGeometry(.92,32,22,start,Math.PI);const pos=geo.attributes.position;for(let i=0;i<pos.count;i++){const y=pos.getY(i);const taper=1-(y+.92)*.14;pos.setXYZ(i,pos.getX(i)*taper,y*1.2,pos.getZ(i)*taper)}geo.computeVertexNormals();return geo}
  function dragonheart(p){const g=new T.Group();base(g,fire);
    const shell=new T.MeshPhysicalMaterial({color:0x22131c,metalness:.78,roughness:.3,clearcoat:.8,side:T.DoubleSide});
    for(let side=0;side<2;side++){
      const part=new T.Group();g.add(part);const geo=eggGeometry(side*Math.PI);mesh(part,geo,shell,0,.12,0);
      // A shaped lattice hugs each shell half instead of a rectangular lid.
      for(let j=0;j<9;j++){const a=side*Math.PI+j*Math.PI/8;const pts=[];for(let k=0;k<=8;k++){const y=-.75+k*.21;const rr=Math.sqrt(Math.max(0,.92*.92-(y/1.2)**2))*(1-(y/1.2+.92)*.14);pts.push([Math.cos(a)*rr,y+.12,Math.sin(a)*rr])}tube(part,pts,.012,fire)}
      for(let j=0;j<12;j++){const a=side*Math.PI+j*Math.PI/12;const link=ring(part,.061,.018,gold,Math.cos(a)*.86,-.04,Math.sin(a)*.86);link.rotation.y=-a;link.rotation.x=j%2?Math.PI/3:0}
      for(let j=0;j<5;j++){const a=side*Math.PI+.25+j*.56;const ruby=gem(part,.095,glow(0xc84218),Math.cos(a)*.78,.12,Math.sin(a)*.78);ruby.scale.set(.6,1.4,.5)}
      part.position.x=(side?1:-1)*p*.6;part.rotation.z=(side?-.45:.45)*p;
    }
    gem(g,.43,glow(0xf87425),0,.15+p*.32,0);const core=gem(g,.53,crystal(0xe7852f),0,.15+p*.32,0);core.rotation.y=p*2;
    for(let i=0;i<3;i++){const a=i*2*Math.PI/3;const x=Math.cos(a),z=Math.sin(a);tube(g,[[x*.8,-.95,z*.8],[x*1.05,-.65,z*1.05],[x*.92,-.25,z*.92]],.065,gold);spike(g,.09,.38,gold,x*.92,-.18,z*.92)}
    const halo=ring(g,.66+p*.3,.024,gold,0,.3+p*.2,0);halo.rotation.x=Math.PI/2;halo.rotation.z=p*.5;
    g.rotation.set(.12,-.3,-.03);g.scale.setScalar(.93);return g;
  }
  function starfall(p){const g=new T.Group();base(g,silver);
    const stem=spike(g,.5,.55,violet,0,-.72,0);stem.rotation.z=Math.PI;
    orb(g,.47,glow(0x7760ed),0,.15+p*.3,0);const core=gem(g,.59,crystal(0xa5b5ff),0,.15+p*.3,0);core.rotation.set(.3,p*2,.2);
    for(let i=0;i<3;i++){
      const frame=new T.Group();frame.position.y=.15;g.add(frame);
      ring(frame,.87+i*.15,.04,i===1?silver:gold);
      ring(frame,.82+i*.15,.012,glow(i===1?0x70dfee:0xaa77ee));
      for(let j=0;j<12;j++){const a=j*Math.PI/6;const mark=box(frame,.023,.065,.025,gold,Math.cos(a)*(.87+i*.15),Math.sin(a)*(.87+i*.15),0);mark.rotation.z=a-Math.PI/2}
      gem(frame,.10,crystal(0xc6c3ff),.87+i*.15,0,0);
      frame.rotation.set(.25+i*.65+p*(i===1?1.2:-.5),.3+i*.6+p*.65,i*.75+p*.4);
    }
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2;gem(g,.09+p*.035,glow(0xc6a4ff),Math.cos(a)*(.85+p*.5),.1+Math.sin(a)*(.85+p*.5),.05);
      const panel=new T.Group();panel.position.set(Math.cos(a)*(.60+p*.48),.1+Math.sin(a)*(.60+p*.48),.18);panel.rotation.z=a-Math.PI/2+p*.45;g.add(panel);
      const wing=gem(panel,.33,violet);wing.scale.set(.53,1.25,.23);const edge=ring(panel,.16,.015,gold,0,0,.06);edge.scale.y=1.8;
    }
    g.rotation.set(.08,-.2,-.12);g.scale.setScalar(.94);return g;
  }
  function leviathan(p){const g=new T.Group();base(g,sea);
    const shell=new T.MeshPhysicalMaterial({color:0x76b7bb,metalness:.55,roughness:.22,clearcoat:1,iridescence:.9,side:T.DoubleSide});
    const inner=new T.MeshPhysicalMaterial({color:0xcab8e1,metalness:.5,roughness:.15,iridescence:1,side:T.DoubleSide});
    const bottom=mesh(g,new T.SphereGeometry(1,48,24,0,Math.PI*2,Math.PI/2,Math.PI/2),shell,0,-.18,0);bottom.scale.set(1.16,.55,.86);
    const lid=new T.Group();lid.position.set(0,-.12,-.72);g.add(lid);const dome=mesh(lid,new T.SphereGeometry(1,48,24,0,Math.PI*2,0,Math.PI/2),shell,0,0,.72);dome.scale.set(1.16,.52,.86);
    const lining=mesh(lid,new T.SphereGeometry(1,36,20,0,Math.PI*2,0,Math.PI/2),inner,0,-.015,.72);lining.scale.set(1.12,.48,.82);
    for(let i=0;i<13;i++){const a=i*Math.PI/6;const pts=[];for(let j=0;j<=12;j++){const t=j*Math.PI/24;pts.push([Math.sin(t)*Math.cos(a)*1.17,Math.cos(t)*.53,.72+Math.sin(t)*Math.sin(a)*.87])}tube(lid,pts,.019,i%3===0?gold:sea)}
    const rim=ring(g,1,.035,gold,0,-.12,0);rim.rotation.x=Math.PI/2;rim.scale.set(1.16,.86,1);
    lid.rotation.x=-p*1.4;
    for(let i=0;i<6;i++){const a=i*Math.PI/3,x=Math.cos(a),z=Math.sin(a);tube(g,[[x*.65,-.85,z*.6],[x*1.05,-.72,z*.9],[x*1.25,-.35,z*1.05],[x*1.1,-.10,z*.95]],.058,sea);orb(g,.035,gold,x*1.1,-.1,z*.95)}
    const pearl=new T.MeshPhysicalMaterial({color:0xe3e8ee,metalness:.35,roughness:.11,iridescence:1,clearcoat:1});orb(g,.34,pearl,0,-.1+p*.42,.08);
    const crown=ring(g,.43,.025,glow(0x58d4c6),0,-.12+p*.25,.08);crown.rotation.x=Math.PI/2;
    g.rotation.set(.2,-.26,-.05);g.scale.setScalar(.98);return g;
  }
  function coin(theme){const g=new T.Group(),mat=theme==='ember'?fire:sea;for(let i=0;i<3;i++){cyl(g,.64,.13,mat,i*.08-.08,i*.12-.2,0);ring(g,.54,.025,gold,i*.08-.08,i*.12-.2,.08);gem(g,.20,theme==='ember'?crystal(0xf5a637):crystal(0x72d3c6),i*.08-.08,i*.12-.2,.10)}g.rotation.set(-.3,.35,-.15);return g}
  function fang(){const g=new T.Group();tube(g,[[0,.7,0],[-.25,.35,0],[-.22,-.2,0],[.15,-.75,0]],.13,new T.MeshPhysicalMaterial({color:0xeed3a4,roughness:.25,clearcoat:1}));const tip=spike(g,.13,.6,fire,.08,-.60,0);tip.rotation.z=.4;ring(g,.18,.055,gold,0,.65,0).rotation.x=Math.PI/2;gem(g,.12,crystal(0xf0662c),0,.75,.08);return g}
  function feather(){const g=new T.Group();tube(g,[[-.5,-.75,0],[-.1,-.2,0],[.2,.35,0],[.4,.95,0]],.025,gold);for(let i=0;i<11;i++){const y=-.6+i*.13,x=y*.5;for(const side of [-1,1]){const quill=mesh(g,new T.SphereGeometry(1,16,10),i%2?fire:gold,x+side*.18,y+.13,0);quill.scale.set(.065,.30,.035);quill.rotation.z=-side*.7}}g.rotation.z=-.35;return g}
  function ruby(){const g=new T.Group();gem(g,.66,crystal(0xf54e39));for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const prong=spike(g,.055,.45,gold,Math.cos(a)*.45,-.37,Math.sin(a)*.45);prong.rotation.z=Math.cos(a)*-.3}ring(g,.46,.07,gold,0,-.48,0).rotation.x=Math.PI/2;g.rotation.z=-.2;return g}
  function crown(tide=false){const g=new T.Group();const material=tide?sea:gold;const band=cyl(g,.68,.24,material,0,-.2,0);band.rotation.x=0;for(let i=0;i<8;i++){const a=i*Math.PI/4;spike(g,.12,.65+(i%2)*.18,material,Math.cos(a)*.57,.2,Math.sin(a)*.57);gem(g,.085,crystal(tide?0x83e3ec:0xed5e35),Math.cos(a)*.69,-.18,Math.sin(a)*.69)}g.rotation.set(.2,.3,-.12);return g}
  function sword(){const g=new T.Group();const s=new T.Shape();s.moveTo(-.15,-.45);s.lineTo(-.23,.4);s.lineTo(-.12,.32);s.lineTo(-.18,.72);s.lineTo(-.08,.6);s.lineTo(0,1.3);s.lineTo(.29,.6);s.lineTo(.16,.66);s.lineTo(.27,.24);s.lineTo(.17,.32);s.lineTo(.18,-.45);s.closePath();
    mesh(g,new T.ExtrudeGeometry(s,{depth:.07,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:3}),fire);
    tube(g,[[0,-.4,.1],[.03,.25,.1],[.02,.85,.1]],.022,glow(0xffa32c));
    tube(g,[[-.52,-.35,0],[-.38,-.55,0],[0,-.46,0],[.38,-.55,0],[.52,-.35,0]],.065,gold);
    for(const x of [-.45,.45])spike(g,.075,.27,black,x,-.3,0);
    cyl(g,.075,.62,black,0,-.81,0).rotation.x=0;for(let i=0;i<5;i++)ring(g,.085,.019,gold,0,-1.04+i*.11,0).rotation.x=Math.PI/2;
    gem(g,.15,crystal(0xff7b31),0,-.46,.12);g.rotation.set(.1,.25,-.6);return g}
  function vial(){const g=new T.Group();const glass=new T.MeshPhysicalMaterial({color:0x9a7ff0,metalness:.35,roughness:.12,transparent:true,opacity:.65,clearcoat:1});const bottle=cyl(g,.34,.95,glass);bottle.rotation.x=0;orb(g,.23,glow(0xb1a5ff),0,0,0);for(const y of [-.49,.49]){const cap=cyl(g,.38,.11,gold,0,y,0);cap.rotation.x=0}for(let i=0;i<8;i++){const a=i*Math.PI/4;gem(g,.025,silver,Math.cos(a)*.27,i*.07-.25,.2)}g.rotation.z=-.25;return g}
  function compass(){const g=new T.Group();cyl(g,.68,.14,gold);cyl(g,.57,.02,black,0,0,.08);ring(g,.55,.024,silver,0,0,.1);for(let i=0;i<8;i++){const a=i*Math.PI/4;const arm=spike(g,.075,i%2?.28:.43,i%2?silver:violet,Math.sin(a)*.19,Math.cos(a)*.19,.15);arm.rotation.z=-a}gem(g,.10,crystal(0x9ddbea),0,0,.2);ring(g,.16,.03,gold,0,.81,0);g.rotation.set(-.1,.3,-.25);return g}
  function orbit(){const g=new T.Group();ring(g,.6,.10,gold);for(let i=0;i<3;i++){const r=ring(g,.36,.025,i%2?silver:violet,0,.47,.12);r.rotation.set(i*.9,i*.6,.3)}gem(g,.24,crystal(0xb4a4ff),0,.5,.15);g.rotation.set(.2,.4,-.2);return g}
  function prism(){const g=new T.Group();const center=mesh(g,new T.OctahedronGeometry(.7,0),crystal(0x9869ee));center.scale.y=1.35;for(let i=0;i<4;i++){const a=i*Math.PI/2;const shard=mesh(g,new T.OctahedronGeometry(.22),crystal(0x71d7ed),Math.cos(a)*.62,Math.sin(a)*.62,0);shard.rotation.z=-a}g.rotation.set(.2,.3,-.25);return g}
  function eclipse(){const g=new T.Group();cyl(g,.68,.15,black);ring(g,.64,.06,gold,0,0,.07);orb(g,.37,matte(0x090716),-.07,.02,.11);ring(g,.4,.035,glow(0x9561dd),-.07,.02,.1);for(let i=0;i<12;i++){const a=i*Math.PI/6;gem(g,.022,silver,Math.sin(a)*.53,Math.cos(a)*.53,.12)}box(g,.025,.34,.03,gold,.03,.2,.49);box(g,.28,.025,.03,silver,.14,.04,.49);ring(g,.18,.04,gold,0,.83,0);g.rotation.set(-.1,.3,-.25);return g}
  function scythe(){const g=new T.Group();tube(g,[[0,-1.05,0],[.05,0,0],[.12,.8,0]],.055,silver);const shape=new T.Shape();shape.moveTo(.1,.8);shape.quadraticCurveTo(-.7,1.3,-1.15,.25);shape.quadraticCurveTo(-.5,.9,.15,.55);shape.closePath();mesh(g,new T.ExtrudeGeometry(shape,{depth:.05,bevelEnabled:true,bevelSize:.025,bevelThickness:.02,bevelSegments:3}),violet);gem(g,.16,crystal(0x82d9f1),.09,.72,.06);tube(g,[[-1.03,.4,.08],[-.68,.86,.08],[-.23,.91,.08]],.014,glow(0xa191ff));for(let i=0;i<3;i++)gem(g,.035,silver,-.3-i*.19,.84-i*.05,.11);for(let i=0;i<5;i++)ring(g,.075,.02,gold,0,-.9+i*.12,0).rotation.x=Math.PI/2;g.rotation.z=-.35;return g}
  function conch(){const g=new T.Group();const mat=new T.MeshPhysicalMaterial({color:0xe6b6bb,metalness:.4,roughness:.2,iridescence:.8,clearcoat:1});const points=[];for(let i=0;i<90;i++){const a=i*.16,r=.05+i*.007;points.push([Math.cos(a)*r,Math.sin(a)*r,i*.003])}tube(g,points,.11,mat);for(let i=0;i<8;i++){const a=i*.7;spike(g,.06,.20,gold,Math.cos(a)*.59,Math.sin(a)*.59,.12)}g.rotation.set(.1,.3,-.2);return g}
  function coral(){const g=new T.Group();ring(g,.55,.12,gold);for(let i=0;i<5;i++){const x=(i-2)*.15;tube(g,[[x,.38,.1],[x*1.2,.62,.12],[x*1.5,.8+Math.abs(x)*.3,.1]],.035,fire)}gem(g,.25,crystal(0x7bdcd0),0,.58,.18);g.rotation.set(.1,.4,-.25);return g}
  function pearl(){const g=new T.Group();orb(g,.50,new T.MeshPhysicalMaterial({color:0xe5edf4,metalness:.35,roughness:.08,clearcoat:1,iridescence:1}),0,.1,0);ring(g,.42,.06,gold,0,-.35,0).rotation.x=Math.PI/2;for(let i=0;i<4;i++){const a=i*Math.PI/2;tube(g,[[Math.cos(a)*.4,-.4,Math.sin(a)*.4],[Math.cos(a)*.5,-.1,Math.sin(a)*.5],[Math.cos(a)*.38,.1,Math.sin(a)*.38]],.035,sea)}g.rotation.z=-.15;return g}
  function trident(){const g=new T.Group();tube(g,[[0,-1.15,0],[0,.75,0]],.055,gold);for(const side of [-1,1]){tube(g,[[0,.2,0],[side*.4,.38,0],[side*.44,.85,0]],.045,sea);spike(g,.09,.4,silver,side*.44,.95,0)}spike(g,.10,.52,silver,0,1,0);gem(g,.13,crystal(0x75e4d8),0,.27,.09);for(let i=0;i<6;i++)ring(g,.073,.018,sea,0,-.9+i*.12,0).rotation.x=Math.PI/2;g.rotation.z=-.38;return g}
  const groups={ember:[()=>coin('ember'),fang,feather,ruby,()=>crown(),sword],astral:[vial,compass,orbit,prism,eclipse,scythe],tide:[()=>coin('tide'),conch,coral,pearl,()=>crown(true),trident]};
  const items={};for(const [theme,functions]of Object.entries(groups))functions.forEach((fn,i)=>items[`${theme}-${i}`]=()=>{const g=fn();g.scale.multiplyScalar(1.15);return g});
  return {items,cases:{dragonheart,starfall,leviathan}};
}
