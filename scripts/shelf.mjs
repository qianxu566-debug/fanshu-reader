// Values from the original catalog’s verified public library display font.
const fontKey = 'fKts9tCXDjS49UhH';
const glyphs = [
  "体y十现快便话却月物水的放知爱万",
  " 表风理O老也p常克平几最主她s",
  "将法情o光a我呢J员太每望受教w",
  "利军已U人如变得要少斯门电m男没",
  "AK国时中走么何口小向问轻Td神",
  "下间车fG度D又大面远就写j给通",
  "起实E 它去S到道数吃们加P是无",
  "把事西多界 发新外活解孩只作前Y",
  "尔经 u心告父等Q民全这9果安 ",
  "i母8r说任先和地C张战场g像c",
  "q你使 样总目x性处音头 应乐关",
  "能花l当名手4重字声力友然生代内",
  "里本回真入师象 0点R亲V种动英",
  "命ZhX做特边高有B为期自年马认",
  "出接至H正方感所明者稜F住学还分",
  "意更其n但比觉以由死家让失士L2",
  "I金叫身报听W再原山海白很见5直",
  "位第工个开岁好用都于可同3次四 ",
  "日信与女笑满并部件不从或机此 了",
  "记三e些bN夫会才儿眼两美被一公",
  "来立z长对己看k许因相色后往打结",
  "格过世气7子条在书之定v拉成进带",
  "着东上想天他妈1文而路那别德6M",
  "t行候难            ",
].join('');

function display(value, font) {
  return String(value ?? '').replace(/[\uE000-\uF8FF]/gu, ch => {
    const glyph = glyphs[ch.codePointAt(0) - 0xe3e8];
    if (!font.includes(fontKey) || !glyph || glyph === ' ') {
      throw new Error('番茄书库显示字体已变化，请稍后重试。');
    }
    return glyph;
  });
}


// Adapted from jinhuang712/fanqie-cli, library.ts @ ac567924 (AGPL-3.0-or-later).
// Uses the official category IDs in the validated daily scopes and public HTTPS.
const LIBRARY_PAGE=18,GENDER_PARAM={male:1,female:0},SORT_PARAM={hot:0};
const STATUS_PARAM={finished:0,ongoing:1},WORDS_PARAM={};
const libraryCategories=async()=>({categories:SCOPES});
const resolveCategory=(categories,id)=>({id});
const coverUrl=v=>v,formatDate=v=>v;
function parseCount(text){
  const m=/^([\d.]+)(万|亿)?/.exec(text.trim());
  return m?Math.round(Number(m[1])*(m[2]==='万'?10000:m[2]==='亿'?100000000:1)):undefined;
}
async function apiGet(path,params){
 const response=await fetch('https://fanqienovel.com'+path+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(18000)});
 if(!response.ok||response.headers.has('retry-after'))throw Error('官方书库 HTTP '+response.status);
 const text=await response.text();
 if(!text.trim())throw Error('空响应 HTTP '+response.status+' '+path+' '+JSON.stringify(params));
 const raw=JSON.parse(text);
 if(raw.code!==0||!(Array.isArray(raw.data?.book_list)||path.includes('/category_list/')&&Array.isArray(raw.data)))throw Error('书库未返回有效分页 '+raw.code);
 return {raw,decode:v=>display(v,response.headers.get('x-tt-zhal')||'')};
}
async function library(f){

  let categoryId = "-1";
  if (f.category) {
    const { categories } = await libraryCategories(f.gender);
    categoryId = resolveCategory(categories, f.category, "fanqie categories --for library").id;
  }
  const { raw, decode } = await apiGet("/api/author/library/book_list/v0/", {
    page_count: LIBRARY_PAGE,
    page_index: f.page - 1,
    gender: f.gender ? GENDER_PARAM[f.gender] : -1,
    category_id: categoryId,
    creation_status: f.status ? STATUS_PARAM[f.status] : -1,
    word_count: f.words ? WORDS_PARAM[f.words] : -1,
    book_type: -1,
    sort: SORT_PARAM[f.sort],
  });
  const books = raw.data.book_list.map((b) => {
    const wordsText = decode(b.word_count);
    const readsText = decode(b.read_count);
    return {
      bookId: b.book_id,
      title: decode(b.book_name),
      author: decode(b.author),
      finished: b.creation_status === 0,
      words: parseCount(wordsText),
      reads: parseCount(readsText),
      wordsText,
      readsText,
      abstract: decode(b.abstract).trim(),
      coverUrl: coverUrl(b.thumb_uri),
      lastUpdate: formatDate(b.last_chapter_time),
    };
  });
  return { page: f.page, hasMore: raw.data.has_more, books, raw };
}

async function shelf(q,scopeTable=SCOPES){
 const gender=q.get('channel'),cat=q.get('category');
 const scope=scopeTable.find(([g,c,n])=>n===cat&&(g==='1'?'男频':'女频')===gender);
 if(cat&&!scope)throw Error('官方分类表未找到所选频道和分类');
 const r=await library({sort:'hot',page:Number(q.get('page')),gender:gender?(gender==='男频'?'male':'female'):undefined,category:scope?.[1]});
 const exclusive=scope&&!scopeTable.some(([g,c])=>g!==scope[0]&&c===scope[1]);
 return {hasMore:r.hasMore,books:r.books.map((b,i)=>({id:b.bookId,title:b.title,author:b.author,intro:b.abstract,
 readers:b.reads,readersText:b.readsText,words:b.words,status:b.finished?'已完结':'连载中',primary:cat?[cat]:[],channelRecord:exclusive?{value:gender}:null,
 coverUrl:(r.raw.data.book_list[i].thumb_url||'').replace(/^http:/,'https:'),observed:new Date().toISOString()}))};
}
