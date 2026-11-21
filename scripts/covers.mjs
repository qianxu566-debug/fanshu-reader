import fs from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';

const file=process.argv[2];
const catalog=JSON.parse(gunzipSync(fs.readFileSync(file)));
const books=new Map(catalog.books.map(b=>[b.id,b]));
const now=Date.now();
function expires(url){
  try{return Number(new URL(url).searchParams.get('x-expires'))*1000||0}
  catch{return 0}
}
function remaining(b){return Math.max(expires(b.coverUrl),expires(b.longCoverUrl))-now}
const before=catalog.books.filter(b=>remaining(b)>0).length;
let requests=0, touched=new Set(), stopped='';
async function official(path,params){
  await delay(450);
  requests++;
  const r=await fetch('https://fanqienovel.com'+path+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(18000)});
  if(!r.ok||r.headers.has('retry-after'))throw Error('官方 HTTP '+r.status);
  const data=await r.json();
  if(data.code===-100)return null;
  if(data.code!==0)throw Error('官方状态 '+data.code);
  return data.data;
}
function keep(id,url){
  const b=books.get(String(id));
  if(!b||typeof url!=='string')return;
  const address=url.replace(/^http:/,'https:');
  const u=new URL(address);
  if(u.protocol!=='https:'||!/(^|\.)(byteimg\.com|fqnovelpic\.com|bytecdn\.cn|toutiaoimg\.com)$/.test(u.hostname))return;
  if(expires(address)>Math.max(now,expires(b.longCoverUrl))){
    b.longCoverUrl=address;touched.add(b.id);
  }
}
const scopes=JSON.parse(fs.readFileSync(new URL('./scopes.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const lanes=scopes.flatMap(([gender,category_id])=>[2,1].map(rankMold=>({gender,category_id,rankMold,offset:0,miss:0,last:''})));
const recent=now-Date.parse(catalog.refresh?.coverSweep||0)<3*86400000;
try{
  if(!recent){
    let active=lanes;
    for(let round=0;round<14&&active.length;round++){
      const next=[];
      for(const lane of active){
        const data=await official('/api/rank/category/list',{app_id:2503,rank_list_type:3,offset:lane.offset,limit:100,category_id:lane.category_id,gender:lane.gender,rankMold:lane.rankMold,rank_version:lane.version||''});
        const rows=data?.book_list||[];
        if(!rows.length)continue;
        const signature=rows.map(b=>b.bookId).join(',');
        if(signature===lane.last)continue;
        lane.last=signature;lane.version=data.rankVersion;
        for(const r of rows)keep(r.bookId,r.thumbUri);
        lane.miss=rows.some(r=>books.has(String(r.bookId)))?0:lane.miss+1;
        lane.offset+=rows.length;
        if(rows.length===100 && lane.miss<2)next.push(lane);
      }
      active=next;
      console.log('轮次',round+1,'已取得长效直链',touched.size);
    }
    (catalog.refresh??={}).coverSweep=new Date(now).toISOString();
  }
  for(const b of catalog.books.filter(b=>remaining(b)<3600000).slice(0,60)){
    const detail=await official('/api/book/info',{bookId:b.id});
    if(String(detail?.bookId)===b.id)keep(b.id,detail.thumbUrl);
  }
}catch(e){stopped=e.message}
const temp=file+'.covers.tmp';
fs.writeFileSync(temp,gzipSync(JSON.stringify(catalog),{level:6}));fs.renameSync(temp,file);
console.log(JSON.stringify({requests,touched:touched.size,before,after:catalog.books.filter(b=>remaining(b)>0).length,total:books.size,stopped}));
if(stopped)process.exitCode=1;
