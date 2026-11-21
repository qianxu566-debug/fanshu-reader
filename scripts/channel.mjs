export function readChannel(id, data, observed) {
  if (String(data?.bookId) !== id) throw Error('返回书号不匹配');
  let categories = data.categoryV2 || [];
  if (typeof categories === 'string') categories = JSON.parse(categories);
  if (!Array.isArray(categories)) throw Error('无分类列表');
  return {id, observed, categories};
}

export function applyChannel(book, detail) {
  const main = detail.categories.filter(c => c.MainCategory === true);
  const genders = new Set(main.map(c => c.Gender));
  const primary = [...new Set(main.map(c => c.Name).filter(Boolean))];
  let channel = '';
  // A general-purpose main category can accompany a gender-specific one.
  if (genders.size && [...genders].every(g => g === 0 || g === 1 || g === 2)) {
    if (genders.has(0) && !genders.has(1)) channel = '女频';
    else if (genders.has(1) && !genders.has(0)) channel = '男频';
    else channel = '共用';
  }
  if (channel) {
    book.channel = channel;
    book.channelEvidence = {kind:'official-detail', observed:detail.observed,
      main:main.map(c => [c.ObjectId, c.Name, c.Gender])};
    if (primary.length) book.primary = primary;
  }
  book.tags = [...new Set([...(book.tags || []), ...detail.categories.filter(c => !c.MainCategory).map(c => c.Name).filter(Boolean)])];
  book.channelChecked = detail.observed;
  applyListings(book, book.officialListings);
}

export function applyListings(book, listings) {
  if (!listings?.length) return;
  const routes = new Map((book.officialListings || []).map(r => [r.gender, r]));
  for (const row of listings) {
    const prev = routes.get(row.gender);
    if (!prev || row.observed >= prev.observed) routes.set(row.gender, row);
  }
  book.officialListings = [...routes.values()];
  book.channel = routes.size === 2 ? '共用' : routes.has('1') ? '男频' : '女频';
  book.channelEvidence = {kind:'official-listing', genders:[...routes.keys()].sort()};
}
