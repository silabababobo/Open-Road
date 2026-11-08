// Open Road game server: serves ./public and runs WebSocket rooms on /ws (same port, same origin)
const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const PORT=process.env.PORT||3000,PUB=path.join(__dirname,'public'),MAXP=8;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
const srv=http.createServer((q,r)=>{
  if(q.url==='/health'){r.writeHead(200);return r.end('ok')}
  let p;try{p=decodeURIComponent(q.url.split('?')[0])}catch(e){r.writeHead(400);return r.end()}
  if(p==='/')p='/index.html';
  const f=path.join(PUB,path.normalize(p));
  if(!f.startsWith(PUB)){r.writeHead(403);return r.end()}
  fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end('not found')}
    r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache'});r.end(d)});
});
const wss=new WebSocketServer({server:srv,path:'/ws',maxPayload:2048});
const rooms=new Map(),CH='abcdefghjkmnpqrstuvwxyz23456789';
const newCode=()=>{let c;do{c=Array.from({length:5},()=>CH[Math.random()*CH.length|0]).join('')}while(rooms.has(c));return c};
const send=(ws,o)=>{if(ws.readyState===1)ws.send(JSON.stringify(o))};
const bcast=(r,o,except)=>{const s=JSON.stringify(o);r.players.forEach(p=>{if(p!==except&&p.readyState===1)p.send(s)})};
const clock=r=>((r.gt0+(Date.now()-r.t0)/240000)%1);
function leave(ws){const r=ws.room;if(!r)return;ws.room=null;if(r.players.get(ws.id)===ws)r.players.delete(ws.id);bcast(r,{t:'l',id:ws.id});if(!r.players.size)r.emptyAt=Date.now()}
wss.on('connection',ws=>{
  ws.alive=true;ws.hits=0;ws.room=null;ws.on('pong',()=>ws.alive=true);
  const rl=setInterval(()=>ws.hits=0,1000);
  ws.on('message',buf=>{
    if(++ws.hits>60)return;let m;try{m=JSON.parse(buf)}catch(e){return}
    if(!m||typeof m.t!=='string')return;
    if(m.t==='s'){if(!ws.room)return;const x=+m.x,z=+m.z;if(!isFinite(x)||!isFinite(z)||Math.abs(x)>5000||Math.abs(z)>5000)return;
      bcast(ws.room,{t:'s',id:ws.id,x,z,y:+m.y||0,v:+m.v||0,c:(m.c|0)&0xffffff,n:ws.nm},ws);return}
    if(m.t==='ping'){send(ws,{t:'pong',ts:m.ts});return}
    if(m.t==='leave'){leave(ws);return}
    if(m.t==='create'||m.t==='join'){
      if(ws.room)return;
      const nm=String(m.n||'Player').replace(/[^\p{L}\p{M}\p{N} ]/gu,'').trim().slice(0,12)||'Player';
      const id=/^[a-z0-9]{4,12}$/.test(m.id)?m.id:Math.random().toString(36).slice(2,8);
      let r;
      if(m.t==='create'){r={code:newCode(),players:new Map(),t0:Date.now(),gt0:(+m.gt>=0&&+m.gt<1)?+m.gt:.33,rt:0,wxAt:Date.now()+45000,emptyAt:0};rooms.set(r.code,r)}
      else{r=rooms.get(String(m.code||'').toLowerCase());if(!r)return send(ws,{t:'err',m:'ไม่พบห้องรหัสนี้'})}
      if(r.players.size>=MAXP&&!r.players.has(id))return send(ws,{t:'err',m:'ห้องเต็ม (สูงสุด '+MAXP+' คน)'});
      const old=r.players.get(id);if(old&&old!==ws){old.room=null;try{old.close()}catch(e){}}
      ws.room=r;ws.id=id;ws.nm=nm;r.players.set(id,ws);r.emptyAt=0;
      send(ws,{t:'room',code:r.code,id,gt:clock(r),rt:r.rt,players:[...r.players.values()].map(p=>({id:p.id,n:p.nm}))});
      bcast(r,{t:'j',id,n:nm},ws);
    }
  });
  ws.on('close',()=>{clearInterval(rl);leave(ws)});ws.on('error',()=>{});
});
// shared weather + time of day, broadcast every 4 s; drop empty rooms after 60 s
setInterval(()=>{const now=Date.now();rooms.forEach((r,c)=>{
  if(!r.players.size){if(r.emptyAt&&now-r.emptyAt>60000)rooms.delete(c);return}
  if(now>r.wxAt){r.rt=[0,0,.3,.7,1][Math.random()*5|0];r.wxAt=now+40000+Math.random()*50000}
  bcast(r,{t:'w',gt:clock(r),rt:r.rt})})},4000);
setInterval(()=>wss.clients.forEach(ws=>{if(!ws.alive)return ws.terminate();ws.alive=false;ws.ping()}),25000);
srv.listen(PORT,()=>console.log('Open Road server on :'+PORT));
