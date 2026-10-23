import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('www');
http.createServer(async(req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const path=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
 if(!path.startsWith(root+'/')&&path!==root){res.writeHead(403).end();return;}
 try{
  const file=path.endsWith('/')?path+'index.html':path;
  const body=await readFile(file===root?root+'/index.html':file);
  const types={'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
 }catch{res.writeHead(404).end('Not found');}
}).listen(8139,'127.0.0.1');
