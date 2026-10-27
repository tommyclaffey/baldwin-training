// Usage: set IDS to the screens to export and TAG to a new name (svg ids get the tag as prefix).
const IDS=__IDS__, TAG='__TAG__', INCLUDE_SIDEBAR=false;
// ---- shared: serialize Figma nodes to a compact layout tree, pack as PNG ----
const hx=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('').toUpperCase();
const R=v=>Math.round(v*10)/10;
const SVG={};let svgN=0;const svgKey=new Map();
const IMGS=new Set();
function paints(arr){if(!Array.isArray(arr))return undefined;const out=[];for(const p of arr){if(p.visible===false)continue;if(p.type==='SOLID'){const o={c:hx(p.color)};if(p.opacity!==undefined&&p.opacity<1)o.o=R(p.opacity*100)/100;out.push(o);}else if(p.type==='IMAGE'){IMGS.add(p.imageHash);out.push({img:p.imageHash.slice(0,12),m:p.scaleMode});}else if(p.type.startsWith('GRADIENT')){out.push({g:p.gradientStops.map(s=>[hx(s.color),R(s.color.a),R(s.position)]),gt:p.type,ga:gangle(p.gradientTransform)});}}return out.length?out:undefined;}
function gangle(t){const[[a,b,tx],[c,d,ty]]=t;const det=a*d-b*c;const inv=(gx,gy)=>{const x=gx-tx,y=gy-ty;return[(d*x-b*y)/det,(-c*x+a*y)/det];};const s=inv(0,.5),e=inv(1,.5);return Math.round(Math.atan2(e[0]-s[0],-(e[1]-s[1]))*180/Math.PI);}
const isVec=n=>['VECTOR','BOOLEAN_OPERATION','STAR','LINE','POLYGON'].includes(n.type);
const isIcon=n=>n.name==='icon'||(n.name&&n.name.startsWith('Shape · '))||isVec(n);
async function svgOf(n){let key;try{const parts=[n.type,R(n.width),R(n.height)];const vs=isVec(n)?[n]:n.findAll(isVec);for(const v of vs){parts.push(JSON.stringify(v.vectorPaths||v.type),JSON.stringify(v.strokes&&v.strokes.map(s=>s.color&&hx(s.color))),JSON.stringify(v.fills&&Array.isArray(v.fills)&&v.fills.map(s=>s.color&&hx(s.color))),v.strokeWeight,R(v.x),R(v.y),v.rotation);}key=parts.join('|');}catch(e){key=n.id;}
 if(svgKey.has(key))return svgKey.get(key);let s;try{s=await n.exportAsync({format:'SVG_STRING'});}catch(e){s='';}const id='s'+TAG+'_'+(svgN++);SVG[id]=s;svgKey.set(key,id);return id;}
async function ser(n,parentAuto){if(n.visible===false)return null;
 const o={t:n.type==='TEXT'?'T':n.type==='ELLIPSE'?'E':n.type==='RECTANGLE'?'R':isIcon(n)?'S':'F'};
 if(n.name)o.n=n.name;o.w=R(n.width);o.h=R(n.height);
 const abs=!parentAuto||n.layoutPositioning==='ABSOLUTE';if(abs){o.x=R(n.x);o.y=R(n.y);if(parentAuto)o.abs=1;}
 if(parentAuto&&!abs){o.sh=(n.layoutSizingHorizontal||'FIXED')[0];o.sv=(n.layoutSizingVertical||'FIXED')[0];}
 if(n.opacity!==undefined&&n.opacity<1)o.op=R(n.opacity*100)/100;
 if(n.rotation)o.rot=R(n.rotation);
 if(n.reactions&&n.reactions.length){const a=n.reactions[0].actions&&n.reactions[0].actions[0];if(a&&a.destinationId)o.to=a.destinationId;}
 if(o.t==='S'){o.svg=await svgOf(n);return o;}
 const f=paints(n.fills);if(f)o.f=f;
 const st=paints(n.strokes);if(st&&n.strokeWeight!==0){o.st=st[0].c||'#000000';if(st[0].o!==undefined)o.sto=st[0].o;
  if(typeof n.strokeWeight==='number')o.sw=n.strokeWeight;else o.sw=1;
  if(n.type!=='ELLIPSE'&&'strokeTopWeight' in n&&(n.strokeTopWeight!==n.strokeBottomWeight||n.strokeLeftWeight!==n.strokeRightWeight||n.strokeTopWeight!==n.strokeLeftWeight))o.sws=[n.strokeTopWeight,n.strokeRightWeight,n.strokeBottomWeight,n.strokeLeftWeight];
  if(n.dashPattern&&n.dashPattern.length)o.dash=1;if(n.strokeAlign&&n.strokeAlign!=='INSIDE')o.sa=n.strokeAlign[0];}
 if('cornerRadius' in n){if(typeof n.cornerRadius==='number'){if(n.cornerRadius)o.r=R(n.cornerRadius);}else o.rs=[n.topLeftRadius,n.topRightRadius,n.bottomRightRadius,n.bottomLeftRadius];}
 if(n.type==='TEXT'){o.s=n.characters;let fn=n.fontName;if(fn===figma.mixed){const seg=n.getStyledTextSegments(['fontName']);fn=seg[0].fontName;}o.ff=fn.family;o.fs=fn.style;o.z=n.fontSize===figma.mixed?n.getStyledTextSegments(['fontSize'])[0].fontSize:n.fontSize;
  const lh=n.lineHeight;if(lh&&lh!==figma.mixed&&lh.unit!=='AUTO')o.lh=lh.unit==='PERCENT'?R(lh.value)+'%':R(lh.value);
  const ls=n.letterSpacing;if(ls&&ls!==figma.mixed&&ls.value)o.ls=ls.unit==='PERCENT'?R(ls.value)+'%':R(ls.value);
  if(n.textAlignHorizontal&&n.textAlignHorizontal!=='LEFT')o.ta=n.textAlignHorizontal[0];
  o.ar=n.textAutoResize[0];
  const segs=n.getStyledTextSegments(['fontName','fills']);if(segs.length>1)o.segs=segs.map(s=>[s.start,s.end,s.fontName.style,s.fills&&s.fills[0]&&s.fills[0].color?hx(s.fills[0].color):null]);
  return o;}
 if(!('children' in n))return o;
 if(n.clipsContent)o.clip=1;
 const auto=n.layoutMode&&n.layoutMode!=='NONE';
 if(auto){o.lm=n.layoutMode[0];if(n.itemSpacing)o.gap=R(n.itemSpacing);const pd=[n.paddingTop,n.paddingRight,n.paddingBottom,n.paddingLeft].map(R);if(pd.some(x=>x))o.pd=pd;
  if(n.primaryAxisAlignItems!=='MIN')o.pa=n.primaryAxisAlignItems[0];if(n.counterAxisAlignItems!=='MIN')o.ca=n.counterAxisAlignItems[0];
  if(n.layoutWrap==='WRAP'){o.wrap=1;if(n.counterAxisSpacing)o.cg=R(n.counterAxisSpacing);}}
 const kids=[];for(const c of n.children){const s=await ser(c,auto);if(s)kids.push(s);}if(kids.length)o.c=kids;return o;}
function packPNG(json){const enc=[];for(let i=0;i<json.length;i++){let c=json.charCodeAt(i);if(c>=0xD800&&c<0xDC00){const c2=json.charCodeAt(++i);c=0x10000+((c-0xD800)<<10)+(c2-0xDC00);}if(c<0x80)enc.push(c);else if(c<0x800){enc.push(0xC0|c>>6,0x80|c&63);}else if(c<0x10000){enc.push(0xE0|c>>12,0x80|c>>6&63,0x80|c&63);}else enc.push(0xF0|c>>18,0x80|c>>12&63,0x80|c>>6&63,0x80|c&63);}
 const W=4096;const plen=enc.length+4;const H=Math.ceil(plen/W);const raw=new Uint8Array(H*(W+1));const hdr=[enc.length>>>24&255,enc.length>>>16&255,enc.length>>>8&255,enc.length&255];
 for(let i=0;i<plen;i++){const v=i<4?hdr[i]:enc[i-4];const y=Math.floor(i/W),x=i%W;raw[y*(W+1)+1+x]=v;}
 const crcT=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;crcT[n]=c>>>0;}const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
 let a=1,s2=0;for(let i=0;i<raw.length;i++){a=(a+raw[i])%65521;s2=(s2+a)%65521;}const ad=((s2<<16)|a)>>>0;
 const nb=Math.ceil(raw.length/65535);const z=new Uint8Array(2+raw.length+nb*5+4);let p=0;z[p++]=0x78;z[p++]=0x01;
 for(let i=0;i<raw.length;i+=65535){const n=Math.min(65535,raw.length-i);z[p++]=(i+n>=raw.length)?1:0;z[p++]=n&255;z[p++]=n>>8;z[p++]=(~n)&255;z[p++]=((~n)>>8)&255;z.set(raw.subarray(i,i+n),p);p+=n;}
 z[p++]=ad>>>24&255;z[p++]=ad>>>16&255;z[p++]=ad>>>8&255;z[p++]=ad&255;const be=v=>[v>>>24&255,v>>>16&255,v>>>8&255,v&255];
 const chunk=(type,d)=>{const body=new Uint8Array(4+d.length);for(let i=0;i<4;i++)body[i]=type.charCodeAt(i);body.set(d,4);const out=new Uint8Array(12+d.length);out.set(be(d.length),0);out.set(body,4);out.set(be(crc(body)),8+d.length);return out;};
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',new Uint8Array([...be(W),...be(H),8,0,0,0,0])),chunk('IDAT',z),chunk('IEND',new Uint8Array(0))];
 const total=parts.reduce((s,x)=>s+x.length,0);const png=new Uint8Array(total);let o=0;for(const x of parts){png.set(x,o);o+=x.length;}return {png,bytes:enc.length};}
const batch=[];for(const id of IDS){const f=await figma.getNodeByIdAsync(id);if(f)batch.push(f);}const frames=batch;const pages=[];
for(const p of batch){const m=p.findOne(n=>n.name==='Main'&&n.type==='FRAME');const main=await ser(m,false);const fill=paints(p.fills);
 const page={id:p.id,name:p.name.replace(' · Desktop',''),w:p.width,h:p.height,f:fill,main};if(INCLUDE_SIDEBAR&&p.id==='4:2'){page.side=[];for(const c of p.children){if(c===m)continue;const s=await ser(c,false);if(s)page.side.push(s);}}pages.push(page);}
const {png,bytes}=packPNG(JSON.stringify({pages,svgs:SVG,images:[...IMGS]}));
const img=figma.createImage(png);const name='EXPORT · layout '+TAG;const old=figma.currentPage.findOne(n=>n.name===name);if(old)old.remove();
const fr=figma.createFrame();fr.name=name;fr.resize(100,100);fr.x=-7000;fr.y=-7000;const r=figma.createRectangle();r.resize(100,100);r.fills=[{type:'IMAGE',scaleMode:'FILL',imageHash:img.hash}];fr.appendChild(r);
return {frame:fr.id,pages:pages.length,bytes,svgs:svgN,total:frames.length};
