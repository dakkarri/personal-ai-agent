// server.js - واجهة الويب المحلية للـ agent.
// بيشتغل على 127.0.0.1 بس (مش متاح للشبكة)، ومفتاح Gemini بيفضل على السيرفر ومبيوصلش المتصفح أبدًا.
// التشغيل: node server.js وبعدين افتح http://127.0.0.1:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const core = require('./core');
const { TASKS_FILE, NOTES_FILE, WORKSPACE } = require('./tools');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 64 * 1024;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

// محادثة واحدة محلية + إجراء حساس واحد مستني موافقة في نفس الوقت
const history = [];
let currentLang = 'ar'; // لغة الواجهة المختارة: ar / en / tr
let pending = null; // { tool, args, resolve, run, steps, session }

function sendJson(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) { reject(new Error('الطلب أكبر من اللازم')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

// يقدّم ملفات public/ بس، وحماية من الخروج بره المجلد
function serveStatic(req, res) {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
        res.writeHead(400); res.end('Bad request'); return;
    }
    if (pathname === '/') pathname = '/index.html';
    const full = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!full.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
    });
}

function readState() {
    let tasks = [];
    let notes = '';
    let files = [];
    try { tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch { /* فاضي */ }
    try { notes = fs.readFileSync(NOTES_FILE, 'utf8'); } catch { /* فاضي */ }
    try { files = fs.readdirSync(WORKSPACE).filter(f => fs.statSync(path.join(WORKSPACE, f)).isFile()); } catch { /* فاضي */ }
    return {
        live: core.LIVE,
        model: core.LIVE ? core.MODEL : null,
        lang: currentLang,
        tasks,
        notes,
        files
    };
}

// يسوق دورة الـ agent: يا إما تخلص، يا إما تقف على موافقة إجراء حساس.
// ملحوظة: requestApproval ممكن يتنده قبل ما drive يبدأ (الكود بيجري لحد أول await)،
// فبنسجل الطلب في session.pauseRequested بدل ما نعتمد على ترتيب النداء.
async function drive(run, session) {
    if (session.pauseRequested) return { paused: true };
    let firePause;
    const pause = new Promise((r) => { firePause = r; });
    session.firePause = firePause;
    return Promise.race([
        run.then(
            (value) => ({ done: value }),
            (err) => ({ error: err })
        ),
        pause.then(() => ({ paused: true }))
    ]);
}

function makeHooks(steps, session) {
    return {
        onStep: (step) => steps.push(step),
        requestApproval: (tool, args) => new Promise((resolve) => {
            pending = { tool, args, resolve, run: null, steps, session };
            session.pauseRequested = true;
            if (session.firePause) session.firePause();
        })
    };
}

async function startTurn(message, lang) {
    const steps = [];
    const session = { firePause: null, pauseRequested: false };
    const run = core.runTurn(message, history, makeHooks(steps, session), { lang });
    const outcome = await drive(run, session);
    if (outcome.paused || session.pauseRequested) {
        pending.run = run;
        return { status: 'approval', approval: { tool: pending.tool, args: pending.args }, steps };
    }
    if (outcome.error) throw outcome.error;
    return { status: 'done', reply: outcome.done.reply, steps };
}

async function resumeTurn(approved) {
    const p = pending;
    pending = null;
    p.session.pauseRequested = false;
    p.resolve(approved);
    const outcome = await drive(p.run, p.session);
    if (outcome.paused || p.session.pauseRequested) {
        // الإجراء اللي بعده كمان محتاج موافقة (pending اتعمل من جوه requestApproval)
        return { status: 'approval', approval: { tool: pending.tool, args: pending.args }, steps: p.steps };
    }
    if (outcome.error) throw outcome.error;
    return { status: 'done', reply: outcome.done.reply, steps: p.steps };
}

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'GET' && req.url.startsWith('/api/state')) {
            sendJson(res, 200, readState());
            return;
        }
        if (req.method === 'POST' && req.url === '/api/chat') {
            if (pending) {
                sendJson(res, 409, { error: 'فيه إجراء حساس مستني موافقتك. قرر فيه الأول.' });
                return;
            }
            let body;
            try { body = JSON.parse(await readBody(req)); }
            catch { sendJson(res, 400, { error: 'جسم الطلب مش JSON سليم' }); return; }
            const message = typeof body.message === 'string' ? body.message.trim() : '';
            if (!message || message.length > 4000) {
                sendJson(res, 400, { error: 'الرسالة فاضية أو أطول من 4000 حرف' });
                return;
            }
            if (['ar', 'en', 'tr'].includes(body.lang)) currentLang = body.lang;
            try {
                sendJson(res, 200, await startTurn(message, currentLang));
            } catch (err) {
                sendJson(res, 502, { error: `حصل خطأ أثناء التنفيذ: ${err.message}` });
            }
            return;
        }
        if (req.method === 'POST' && req.url === '/api/approval') {
            if (!pending) {
                sendJson(res, 409, { error: 'مفيش إجراء مستني موافقة' });
                return;
            }
            let body;
            try { body = JSON.parse(await readBody(req)); }
            catch { sendJson(res, 400, { error: 'جسم الطلب مش JSON سليم' }); return; }
            try {
                sendJson(res, 200, await resumeTurn(body.approved === true));
            } catch (err) {
                sendJson(res, 502, { error: `حصل خطأ أثناء التنفيذ: ${err.message}` });
            }
            return;
        }
        if (req.method === 'GET') {
            serveStatic(req, res);
            return;
        }
        res.writeHead(405); res.end('Method not allowed');
    } catch (err) {
        sendJson(res, 500, { error: `خطأ داخلي: ${err.message}` });
    }
});

server.listen(PORT, HOST, () => {
    console.log('🤖 المساعد الشخصي - واجهة الويب v0.2');
    console.log(core.LIVE
        ? `الوضع: حي (${core.MODEL})`
        : 'الوضع: تجربة محلي (من غير موديل ذكي - الأدوات شغالة بجد)');
    console.log(`افتح في المتصفح: http://${HOST}:${PORT}`);
    console.log('(السيرفر مقفول على جهازك بس - مش متاح لحد تاني على الشبكة)');
});
