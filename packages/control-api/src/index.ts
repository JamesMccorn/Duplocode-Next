import { createServer } from 'node:http'
export function createControlServer(health=()=>({status:'ok'})) { return createServer((req,res)=>{if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(health()));return}res.writeHead(404);res.end()}) }
