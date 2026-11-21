import sys,json
def _parse_fanqie_books(book_list, rank_offset=0):
    """将API返回的book_list解析为统一格式"""
    books = []
    for i, item in enumerate(book_list):
        if not isinstance(item, dict):
            continue

        book_id = str(item.get('bookId', ''))
        book_name = item.get('bookName', '')
        if not book_name:
            continue

        word_num = item.get('wordNumber', 0)
        # 番茄返回的 wordNumber 可能是字符串或数字，单位是字（不是万字）
        try:
            word_num = int(word_num)
        except (ValueError, TypeError):
            word_num = 0

        # 格式化字数显示
        if word_num > 10000:
            word_display = f"{word_num // 10000}万"
        else:
            word_display = str(word_num)

        # 阅读人数
        read_count = item.get('read_count', 0)
        try:
            read_count = int(read_count)
        except (ValueError, TypeError):
            read_count = 0
        if read_count >= 10000:
            read_display = f"{read_count // 10000}万"
        elif read_count > 0:
            read_display = str(read_count)
        else:
            read_display = ''

        # 封面图
        cover = item.get('thumbUri', '') or ''

        books.append({
            'rank': rank_offset + i + 1,
            'id': book_id,
            'title': book_name,
            'author': item.get('author', ''),
            'intro': (item.get('abstract', '') or '').replace('\\n', '\n')[:200],
            'word_count': word_num,
            'word_display': word_display,
            'read_count': read_count,
            'read_display': read_display,
            'cover': cover,
            'category': item.get('categoryV2', '') or item.get('category', ''),
            'last_chapter': item.get('lastChapterTitle', ''),
            'url': f"https://fanqienovel.com/page/{book_id}",
            'source': '番茄'
        })

    return books
print(json.dumps(_parse_fanqie_books(json.load(sys.stdin)), ensure_ascii=True))
