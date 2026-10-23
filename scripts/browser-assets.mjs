import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),cache=new URL('.e2e-assets/',root);
export async function browserAssets(){
 const html=await readFile(new URL('index.html',root),'utf8');await mkdir(cache,{recursive:true});
 const assets=new Map();
 for(const m of html.matchAll(/<script src="([^"]+)" integrity="sha384-([^"]+)"/g)){
  const file=new URL(createHash('sha256').update(m[1]).digest('hex')+'.js',cache);let bytes;
  try{bytes=await readFile(file)}catch{}
  if(!bytes||createHash('sha384').update(bytes).digest('base64')!==m[2]){
   const response=await fetch(m[1],{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Browser dependency unavailable: '+m[1]);
   bytes=Buffer.from(await response.arrayBuffer());
   if(createHash('sha384').update(bytes).digest('base64')!==m[2])throw Error('Browser dependency integrity mismatch: '+m[1]);
   await writeFile(file,bytes);
  }
  assets.set(m[1],bytes);
 }
 return assets;
}
if(process.argv[1]===new URL(import.meta.url).pathname)await browserAssets();
