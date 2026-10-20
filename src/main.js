import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createIcons, CircleHelp, ImagePlus, ArrowUpRight, RotateCcw, Download, X } from 'lucide';
const icons = {CircleHelp, ImagePlus, ArrowUpRight, RotateCcw, Download, X};
const $ = s => document.querySelector(s);
const iconify = () => createIcons({icons});
iconify();
let timer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(timer);timer=setTimeout(()=>$('#toast').classList.remove('show'),3200)}
let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});}catch{ $('#webgl-error').hidden=false;$('#capture').disabled=true;$('#build').disabled=true; }
const scene=new THREE.Scene();scene.background=new THREE.Color('#e7e4db');
const camera=new THREE.PerspectiveCamera(44,1,.05,150);
let controls, world=new THREE.Group(), currentScene='living', shotId=0, shots=[], referenceUrl;
scene.add(world);scene.add(new THREE.HemisphereLight(0xfff8e9,0x8a9282,2.6));
const sun=new THREE.DirectionalLight(0xfff4d9,4);sun.position.set(-3,7,4);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=9;sun.shadow.camera.bottom=-9;sun.shadow.normalBias=.03;scene.add(sun);
const fill=new THREE.DirectionalLight(0xffffff,.6);fill.position.set(5,3,5);scene.add(fill);
const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.85,flatShading:true,...extra});
function mesh(geometry,color,x,y,z,extra={}){const m=new THREE.Mesh(geometry,material(color,extra));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;world.add(m);return m}
const box=(w,h,d,c,x,y,z)=>mesh(new THREE.BoxGeometry(w,h,d),c,x,y,z);
const cylinder=(r1,r2,h,c,x,y,z,n=12)=>mesh(new THREE.CylinderGeometry(r1,r2,h,n),c,x,y,z);
function plant(x,z,size=1){cylinder(.19*size,.13*size,.35*size,'#b7aa91',x,.175*size,z);cylinder(.025*size,.03*size,1.25*size,'#7b7e50',x,.85*size,z,5);for(let i=0;i<9;i++){const a=i*2.4;const leaf=mesh(new THREE.IcosahedronGeometry(.35*size,0),i%2?'#7a8c58':'#94a375',x+Math.cos(a)*.23*size,(.7+i*.09)*size,z+Math.sin(a)*.23*size);leaf.scale.set(.65,1.4,.7);leaf.rotation.z=Math.cos(a)*.7}}
function clear(){for(const child of [...world.children]){world.remove(child);child.traverse(o=>{o.geometry?.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}})}}
const setups={living:{name:'SUNLIT LIVING ROOM',position:[6,4.1,7.8],target:[0,.9,0],min:2,max:18},jewellery:{name:'JEWELLERY STUDY',position:[3.8,3.1,4.8],target:[0,.75,0],min:1.2,max:10},industrial:{name:'INDUSTRIAL LANDSCAPE',position:[9,7,11],target:[0,1.4,0],min:3,max:30}};
function build(type){clear();currentScene=type;const floor=box(22,.12,22,'#e2dece',0,-.1,0);if(type==='living'){
 box(10,5,.18,'#dedbcf',0,2.4,-3.4);box(.16,5,7,'#e8e3d5',-5,2.4,0);
 // Window frame and a warm geometric patch of sunlight.
 box(3,2.4,.04,'#f8f5e9',-2.5,2.7,-3.28);box(.055,2.4,.07,'#d1ccbb',-2.5,2.7,-3.23);box(3,.055,.07,'#d1ccbb',-2.5,2.7,-3.23);
 const lightPatch=box(3.2,.008,3.5,'#efe8cc',-2.6,-.03,-.5);lightPatch.rotation.y=-.35;
 box(5,.025,3.6,'#c7c4ae',.2,0,.45);for(let i=0;i<24;i++)box(.018,.004,3.45,'#bdbca5',-2.1+i*.2,.017,.45);
 for(const x of [-1.55,1.55])for(const z of [-.68,.37])cylinder(.055,.045,.23,'#615c47',x,.16,z,6);
 box(3.7,.48,1.48,'#a4a687',0,.45,-.35);box(3.7,.83,.32,'#a5a88b',0,.99,-.93);box(.34,.7,1.48,'#b3b498',-1.7,.8,-.35);box(.34,.7,1.48,'#b3b498',1.7,.8,-.35);
 for(let i=0;i<3;i++){box(.94,.19,1.05,'#c1c2a4',-1+i,.77,-.25);const cushion=box(.93,.63,.22,'#bfc0a2',-1+i,1.12,-.69);cushion.rotation.x=-.1;}
 const pillow=box(.48,.48,.22,'#d6ceb4',-1.2,1.08,-.44);pillow.rotation.z=.24;
 cylinder(.72,.72,.13,'#a48c68',.55,.56,1.65,32);for(const x of [.15,.95])box(.07,.5,.07,'#8a755a',x,.25,1.65);cylinder(.15,.12,.26,'#ded5bc',.65,.76,1.6);box(.38,.05,.27,'#777f62',.2,.66,1.62);
 cylinder(.42,.42,.07,'#b5a488',-2.8,.66,-.35,24);cylinder(.08,.1,.65,'#a89473',-2.8,.3,-.35);cylinder(.15,.11,.32,'#d0c2a7',-2.8,.85,-.35);plant(3,-1.8,1.7);
 cylinder(.035,.035,2.3,'#5d6352',2.7,1.15,.3);cylinder(.45,.22,.43,'#eee6cf',2.7,2.3,.3);cylinder(.3,.3,.05,'#69705c',2.7,.03,.3);
 box(1.2,1.5,.06,'#a19576',1.2,2.55,-3.25);box(1.05,1.35,.07,'#c0b79b',1.2,2.55,-3.20);mesh(new THREE.CircleGeometry(.36,28),'#8c987b',1.25,2.7,-3.15);
}else if(type==='jewellery'){
 floor.material.color.set('#c6bca8');box(4,.25,3.2,'#a99c86',0,.1,0);cylinder(1.05,1.05,.3,'#e5d9c0',0,.38,0,48);cylinder(.7,.7,.18,'#eee6d4',0,.62,0,48);
 const ring=mesh(new THREE.TorusGeometry(.4,.065,12,48),'#d6aa4e',0,1.1,0,{metalness:.75,roughness:.25});ring.rotation.y=.2;
 const gem=mesh(new THREE.OctahedronGeometry(.22,0),'#457f69',0,1.54,0,{metalness:.3,roughness:.15});gem.scale.set(1,.8,.8);
 box(.7,.1,.6,'#7e826a',1.4,.3,-.5);cylinder(.17,.14,.7,'#c5b296',-1.45,.5,-.7);plant(-1.45,-.7,.55);box(8,5,.12,'#cfc4af',0,2,-2.5);
}else{
 floor.material.color.set('#9c9c8a');box(15,.06,12,'#b9b7a3',0,0,0);box(4,2.6,3,'#a5a68c',-1,1.35,-1.5);const roof=mesh(new THREE.ConeGeometry(3.1,1,4),'#7f8878',-1,3.15,-1.5);roof.rotation.y=Math.PI/4;roof.scale.z=.8;
 for(const x of [-2,0])cylinder(.4,.48,4.5,'#a29277',x,2.3,-2,12);
 for(const x of [2.2,3.6]){cylinder(.62,.62,2.7,'#bec1af',x,1.4,-.7,16);mesh(new THREE.SphereGeometry(.62,16,8,0,Math.PI*2,0,Math.PI/2),'#bec1af',x,2.75,-.7)}
 for(let i=0;i<3;i++){box(.8,.7,.8,'#7f8d75',-2+i*1.1,.4,1.4);box(.9,.08,.9,'#687660',-2+i*1.1,.8,1.4)}
 for(let i=0;i<5;i++)box(.14,.02,1.2,'#d9cca4',-3+i*1.4,.05,3.4);
 box(3.7,.12,.15,'#8c806a',2,2.4,1);for(const x of [.3,3.7])box(.12,2.4,.12,'#8c806a',x,1.2,1);plant(-4,-2,1.2);
}
 $('#scene-name').textContent=setups[type].name;document.querySelectorAll('.preset').forEach(b=>b.classList.toggle('active',b.dataset.scene===type));reset();}
function reset(){if(!controls)return;const s=setups[currentScene];camera.position.fromArray(s.position);controls.target.fromArray(s.target);controls.minDistance=s.min;controls.maxDistance=s.max;controls.update();}
function resize(){if(!renderer)return;const wrap=$('#canvas-wrap'), viewport=$('#viewport');const [rw,rh]=$('#ratio').value.split(':').map(Number);const aspect=rw/rh;const width=Math.min(viewport.clientWidth,viewport.clientHeight*aspect),height=width/aspect;Object.assign(wrap.style,{position:'absolute',width:`${width}px`,height:`${height}px`,left:`${(viewport.clientWidth-width)/2}px`,top:`${(viewport.clientHeight-height)/2}px`});renderer.setSize(width,height);camera.aspect=aspect;camera.updateProjectionMatrix();}
if(renderer){renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;$('#canvas-wrap').append(renderer.domElement);controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.maxPolarAngle=Math.PI*.49;controls.screenSpacePanning=true;controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;new ResizeObserver(resize).observe($('#viewport'));build('living');renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});}
const prompts={living:'A sculptural sofa in a warm, sunlit living room. Soft neutrals, olive accents, and a little room to breathe.',jewellery:'An emerald ring on a sculptural stone pedestal. Warm gold, soft daylight, and a quiet editorial feel.',industrial:'An industrial workshop with storage silos, tall chimneys, and a loading yard. Warm afternoon light.'};
document.querySelectorAll('.preset').forEach(b=>b.onclick=()=>{$('#prompt').value=prompts[b.dataset.scene];build(b.dataset.scene)});
$('#build').onclick=()=>{const p=$('#prompt').value.trim();if(!p){toast('Add a scene description to get started.');return}const type=/ring|jewel|necklace|diamond|earring/i.test(p)?'jewellery':/industrial|factory|smelt|workshop|warehouse/i.test(p)?'industrial':'living';build(type);toast('Scene ready. Find your angle.');if(innerWidth<=760) $('.workspace').scrollIntoView({behavior:'smooth',block:'start'});};
$('#reset').onclick=reset;

$('#ratio').onchange=()=>{resize();toast(`Shots will be captured in ${$('#ratio').value}`)};
function renderShot(){const [w,h]=$('#ratio').value.split(':').map(Number);const old=camera.aspect;const size=new THREE.Vector2();renderer.getSize(size);const pixel=renderer.getPixelRatio();renderer.setPixelRatio(1);renderer.setSize(Math.round(1200*w/h),1200,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);const image=renderer.domElement.toDataURL('image/png');renderer.setPixelRatio(pixel);renderer.setSize(size.x,size.y,false);camera.aspect=old;camera.updateProjectionMatrix();renderer.render(scene,camera);return image;}
function updateShots(){const container=$('#shots');container.replaceChildren();$('#shot-count').textContent=`${shots.length} shot${shots.length===1?'':'s'}`;$('#generate').disabled=!shots.some(s=>s.selected);if(!shots.length){container.innerHTML='<div class="empty-shot">Find a view you like. Tap the shutter.</div>';iconify();return}for(const shot of shots){const card=document.createElement('div');card.className='shot'+(shot.selected?' selected':'');card.innerHTML=`<button class="shot-image" aria-label="Restore shot ${shot.id}"><img alt="Saved composition ${shot.id}" src="${shot.image}"></button><button class="shot-delete" aria-label="Delete shot ${shot.id}"><i data-lucide="x"></i></button><div class="shot-caption"><span>SHOT ${String(shot.id).padStart(2,'0')}</span><label><input type="checkbox" aria-label="Select shot ${shot.id}" ${shot.selected?'checked':''}></label></div>`;card.querySelector('.shot-image').onclick=()=>{if(currentScene!==shot.type)build(shot.type);camera.position.fromArray(shot.position);controls.target.fromArray(shot.target);controls.update();$('#ratio').value=shot.ratio;resize();toast(`Shot ${shot.id} restored`)};card.querySelector('.shot-delete').onclick=()=>{shots=shots.filter(s=>s.id!==shot.id);updateShots()};card.querySelector('input').onchange=e=>{shot.selected=e.target.checked;updateShots()};container.append(card)}iconify()}
$('#capture').onclick=()=>{if(shots.length>=12){toast('Contact sheet full. Delete a shot to make room.');return}controls.update();shots.push({id:++shotId,image:renderShot(),type:currentScene,position:camera.position.toArray(),target:controls.target.toArray(),ratio:$('#ratio').value,selected:true});updateShots();$('#flash').classList.remove('fire');void $('#flash').offsetWidth;$('#flash').classList.add('fire');toast('Angle captured. Keep exploring.');};
$('#generate').onclick=()=>{const selected=shots.filter(s=>s.selected);for(const shot of selected){const a=document.createElement('a');a.download=`reframe-shot-${shot.id}.png`;a.href=shot.image;a.click()}toast(`Exported ${selected.length} composition${selected.length===1?'':'s'} · AI rendering is not connected`)};
function handleFile(file){if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){toast('Please choose a JPG, PNG, or WEBP image.');return}if(file.size>10*1024*1024){toast('Please choose an image smaller than 10 MB.');return}if(referenceUrl)URL.revokeObjectURL(referenceUrl);referenceUrl=URL.createObjectURL(file);const img=document.createElement('img');img.src=referenceUrl;img.alt='Your product reference';$('#upload-icon').replaceChildren(img);$('#upload-title').textContent=file.name;toast('Reference added for visual guidance.');}
$('#reference').onchange=e=>handleFile(e.target.files[0]);const upload=$('.upload');upload.ondragover=e=>e.preventDefault();upload.ondrop=e=>{e.preventDefault();handleFile(e.dataTransfer.files[0])};$('#help').onclick=()=>$('#help-dialog').showModal();$('#close-help').onclick=()=>$('#help-dialog').close();$('#help-dialog').onclick=e=>{if(e.target===$('#help-dialog'))$('#help-dialog').close()};
