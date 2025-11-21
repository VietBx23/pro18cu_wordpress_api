const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const pLimit = require("p-limit");

const app = express();
const PORT = 3000;

const concurrencyBooks = 10;    // số truyện crawl đồng thời
const concurrencyChapters = 20; // số chương crawl đồng thời

const limitBooks = pLimit(concurrencyBooks);
const limitChapters = pLimit(concurrencyChapters);

// Lấy nội dung chương
async function getChapterContent(chapterUrl) {
    try {
        const { data } = await axios.get(chapterUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        const $ = cheerio.load(data);
        const contentEl = $('div.readcontent');
        contentEl.find('script, style').remove();
        const content = contentEl.html()
            ? contentEl.html().replace(/<br\s*\/?>/gi, '\n').replace(/&emsp;/g, '    ').trim()
            : '';
        return content;
    } catch (err) {
        console.error(`Lỗi lấy nội dung chương ${chapterUrl}:`, err.message);
        return '';
    }
}

// Lấy chi tiết truyện
async function getBookDetail(bookUrl, numChapters = 20) {
    try {
        const { data } = await axios.get(bookUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        const $ = cheerio.load(data);

        const cover_image = $('img.thumbnail').first().attr('src');

        const introEl = $('p.bookintro');
        introEl.find('img').remove();
        const description = introEl.text().trim();

        const genres = [];
        const breadcrumb = $('ol.breadcrumb li').eq(1);
        if (breadcrumb) genres.push(breadcrumb.text().trim());

        const chapterLinks = $('#list-chapterAll dd a').slice(0, numChapters).toArray();
        const chapters = await Promise.all(
            chapterLinks.map(el => limitChapters(async () => {
                const chapterTitle = $(el).text().trim();
                const chapterUrl = $(el).attr('href');
                const content = await getChapterContent(chapterUrl);
                return { title: chapterTitle, content };
            }))
        );

        return { cover_image, description, genres, chapters };
    } catch (err) {
        console.error(`Lỗi lấy chi tiết truyện ${bookUrl}:`, err.message);
        return { cover_image: null, description: null, genres: [], chapters: [] };
    }
}

// API: /crawl?page=1&num_chapters=20
app.get('/crawl', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const num_chapters = parseInt(req.query.num_chapters) || 20;
    const url = `https://www.po18cu.com/sort/0/${page}.html`;

    try {
        const { data } = await axios.get(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        const $ = cheerio.load(data);

        const books = [];
        $('div.p10').each((i, el) => {
            const info = $(el).find('div.bookinfo');
            const titleEl = info.find('h4.bookname a');
            const title = titleEl.text().trim();
            const bookUrl = titleEl.attr('href');
            const author = info.find('div.author').first().text().replace('作者：', '').trim();
            books.push({ title, url: bookUrl, author });
        });

        const results = await Promise.all(
            books.map(book => limitBooks(async () => {
                const detail = await getBookDetail(book.url, num_chapters);
                return {
                    title: book.title,
                    author: book.author,
                    cover_image: detail.cover_image,
                    genres: detail.genres,
                    description: detail.description,
                    chapters: detail.chapters
                };
            }))
        );

        // --- Thêm log số truyện và tổng số chương ---
        const totalChapters = results.reduce((sum, b) => sum + b.chapters.length, 0);
        console.log(`Crawl xong: ${results.length} truyện, ${totalChapters} chương`);

        res.json({ results });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Crawl lỗi' });
    }
});


app.listen(PORT, () => console.log(`Server chạy ở http://localhost:${PORT}`));
