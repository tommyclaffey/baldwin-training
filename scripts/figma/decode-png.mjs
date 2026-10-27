import fs from 'node:fs'; import zlib from 'node:zlib';
const buf=fs.readFileSync(process.argv[2]);let p=8,W=0,H=0;const idat=[];
while(p<buf.length){const len=buf.readUInt32BE(p);const type=buf.toString('ascii',p+4,p+8);const d=buf.subarray(p+8,p+8+len);if(type==='IHDR'){W=d.readUInt32BE(0);H=d.readUInt32BE(4);}if(type==='IDAT')idat.push(d);p+=12+len;}
const raw=zlib.inflateSync(Buffer.concat(idat));const out=Buffer.alloc(W*H);for(let y=0;y<H;y++){if(raw[y*(W+1)]!==0)throw new Error('filter '+raw[y*(W+1)]);raw.copy(out,y*W,y*(W+1)+1,y*(W+1)+1+W);}
const n=out.readUInt32BE(0);const json=out.subarray(4,4+n).toString('utf8');
if(process.argv[3])fs.writeFileSync(process.argv[3],json);else console.log(json);
