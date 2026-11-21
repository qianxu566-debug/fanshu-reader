import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gzipSync,gunzipSync} from 'node:zlib';
const local=process.argv[2];
const catalog=JSON.parse(gunzipSync(fs.readFileSync(local)));
const books=new Map(catalog.books.map(b=>[b.id,b]));
const state=catalog.refresh??={date:'',next:0,pages:{}};
const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const archiveFile='history/'+date+'.json.gz';
const savedRanks=fs.existsSync(archiveFile)
  ?new Map(JSON.parse(gunzipSync(fs.readFileSync(archiveFile))).scopes.filter(s=>s.ok).map(s=>[s.key,s])):new Map();
if(state.date!==date){state.date=date;state.next=0;}
const officialScopes=[];
for(const [g,gender] of [['1','男频'],['0','女频']]){
  const feed=await apiGet('/api/author/book/category_list/v0/',{gender:g});
  for(const item of feed.raw.data)if(item.label==='主分类')officialScopes.push([g,String(item.category_id),feed.decode(item.name)]);
}
if(!officialScopes.length)throw Error('官方分类表为空');
const jobs=[{kind:'shelf',page:1}];
for(const [gender,cid,name] of SCOPES){
  jobs.push({kind:'rank',gender,cid,name,mold:2},{kind:'rank',gender,cid,name,mold:1});
}
const lanes=officialScopes.map(([gender,cid,name])=>({kind:'expand',gender,cid,name}));
for(const lane of lanes)jobs.push({...lane,kind:'shelf',page:1},lane);
state.yields??={};
// Keep a stable plan across retries on the same date.
if(state.planDate!==date){
 state.bonus=[...lanes].sort((a,b)=>(state.yields[b.gender+'-'+b.cid]||0)-(state.yields[a.gender+'-'+a.cid]||0)).slice(0,Math.ceil(lanes.length/3));
 state.planDate=date;
}
for(let round=0;round<5;round++)jobs.push(...state.bonus);
const limit=Number(process.argv[3]||jobs.length);
let completed=0, received=0, stopped=false, missing=0;
function absorb(row){
  const old=books.get(row.id)||{};
  if(old.channelEvidence?.kind==='official-detail'){
    delete row.channel;delete row.channelEvidence;
  }
  if(!row.title||!/^\d+$/.test(row.id))throw Error('无效作品');
  const next={...old};
  for(const [key,v] of Object.entries(row))if(v!=null&&v!==''&&(!Array.isArray(v)||v.length))next[key]=v;
  for(const key of ['primary','tags'])next[key]=[...new Set([...(old[key]||[]),...(row[key]||[])])];
  if(row.readers!=null)next.readersText=row.readersText||'';
  else if(!row.readersText && old.observed)next.observed=old.observed;
  if(Number.isFinite(row.words))next.wordsObserved=row.observed;
  if(row.readersText && row.readers==null)next.readers=null;
  next.officialListings=old.officialListings;
  applyListings(next,row.officialListings||old.officialListings);
  books.set(row.id,next);
}
function decodeRank(s,font){
  return String(s||'').replace(/[\uE000-\uF8FF]/gu,c=>{
    const value=RANK_FONT[c.codePointAt(0)];
    if(!font.includes('DNMrHsV173Pd4pgy')||!value)throw Error('未核实榜单字体');
    return value;
  });
}
async function rank(job){
  const saved=savedRanks.get([job.gender,job.cid,job.mold].join('/'));
  if(saved)return saved.rows.map(b=>({
    id:b.id,title:b.title,author:b.author,words:b.words,readers:b.readers,status:b.status,
    intro:b.intro,coverUrl:b.coverUrl,primary:[job.name],channel:job.gender==='1'?'男频':'女频',
    rankInfo:job.name+(job.mold===2?'阅读榜':'新书榜')+' · 第'+b.pos+'名 · '+date,observed:saved.observed
  }));
  const q=new URLSearchParams({app_id:2503,rank_list_type:3,offset:0,limit:10,category_id:job.cid,rank_version:'',gender:job.gender,rankMold:job.mold});
  const r=await fetch('https://fanqienovel.com/api/rank/category/list?'+q,{signal:AbortSignal.timeout(20000)});
  if(!r.ok||r.headers.has('retry-after'))throw Error('官方榜单 HTTP '+r.status);
  const response=await r.json();
  if(response.code!==0||!Array.isArray(response.data?.book_list))throw Error('榜单返回 '+response.code);
  const font=r.headers.get('x-tt-zhal')||'';
  const raw=response.data.book_list;
  const parsed=JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',['-X','utf8','-c',QBOOK],{input:JSON.stringify(raw),encoding:'utf8'}));
  const source=new Map(raw.map(b=>[String(b.bookId),b]));
  return parsed.map(item=>{const b=source.get(item.id);return ({
    id:String(b.bookId),title:decodeRank(item.title,font),author:decodeRank(item.author,font),intro:decodeRank(b.abstract,font),
    readers:/^\d+$/.test(b.read_count)?Number(b.read_count):null,words:/^\d+$/.test(b.wordNumber)?Number(b.wordNumber):null,
    status:({'0':'已完结','1':'连载中'})[b.creationStatus],primary:[job.name],channel:job.gender==='1'?'男频':'女频',
    coverUrl:item.cover,rankInfo:job.name+(job.mold===2?'阅读榜':'新书榜')+' · 第'+b.currentPos+'名 · '+date,
    observed:new Date().toISOString()
  })});
}
while(state.next<jobs.length && completed<limit){
  const job=jobs[state.next],key=job.gender+'-'+job.cid;
  try{
    let rows;
    if(job.kind==='rank')rows=await rank(job);
    else{
      const page=job.page||state.pages[key]||2;
      const q=new URLSearchParams({page});
      if(job.cid){q.set('category',job.name);q.set('channel',job.gender==='1'?'男频':'女频');}
      const result=await shelf(q,officialScopes);
      rows=result.books.map(b=>({...b,channel:b.channelRecord?.value||''}));
      if(job.kind==='expand'){
        const fresh=rows.filter(r=>!books.has(r.id)).length;
        const audience=rows[Math.floor(rows.length/2)]?.readers||0;
        state.yields[key]=Math.pow(1+audience,.7)*(.4+.6*fresh/Math.max(1,rows.length));
        state.pages[key]=result.hasMore?page+1:2;
      }
    }
    if(job.cid){
      for(const row of rows)row.officialListings=[{gender:job.gender,category:job.cid,observed:new Date().toISOString(),kind:job.kind}];
    }
    await new Promise(resolve=>setTimeout(resolve,400));
    missing=0;rows.forEach(absorb);received+=rows.length;state.next++;completed++;
  }catch(e){
    if(/书库未返回有效分页 -100|榜单返回 -100/.test(e.message) && ++missing<3){
      console.warn('本次分类暂缺',job.name,e.message);state.next++;continue;
    }
    stopped=true;console.error('停在',state.next,job.kind,job.name||'全部',e.message);break;}
}
if(!completed){
  if(state.next===jobs.length){console.log('本日更新已完成');process.exit(0)}
  throw Error('未取得新页，保留原版本');
}
if(!stopped && state.channelDate!==date){
  const cutoff=Date.now()-30*86400000;
  const due=[...books.values()].filter(b=>(!b.channel || !b.tags?.length) && (b.readers||0)>=8000 && (!b.channelChecked || Date.parse(b.channelChecked)<cutoff))
    .sort((a,b)=>(b.readers||0)-(a.readers||0)).slice(0,40);
  let unavailable=0;
  for(const book of due){
    try{
      const response=await fetch('https://fanqienovel.com/api/book/info?bookId='+book.id,{signal:AbortSignal.timeout(16000)});
      if(!response.ok || response.headers.has('retry-after'))throw Error('HTTP '+response.status);
      const payload=await response.json();
      if(payload.code===-1 && ++unavailable<3){
        book.channelChecked=new Date().toISOString();
      }else{
        if(payload.code!==0)throw Error('官方返回 '+payload.code);
        unavailable=0;
        applyChannel(book,readChannel(book.id,payload.data,new Date().toISOString()));
      }
      await new Promise(resolve=>setTimeout(resolve,400));
    }catch(e){stopped=true;console.warn('频道核对暂停',e.message);break;}
  }
  if(!stopped)state.channelDate=date;
}
catalog.books=[...books.values()].filter(b=>Number.isFinite(b.readers)&&b.readers>=8000).sort((a,b)=>(b.readers??-1)-(a.readers??-1)||a.id.localeCompare(b.id));
catalog.updated=new Date().toISOString();
const body=gzipSync(JSON.stringify(catalog),{level:7});
fs.writeFileSync(local+'.tmp',body);
fs.renameSync(local+'.tmp',local);
console.log(JSON.stringify({completed,received,total:books.size,next:state.next,dayComplete:state.next===jobs.length,updated:catalog.updated}));
if(completed<limit && state.next!==jobs.length)process.exitCode=1;
