// run-tests.js - اختبارات أوﭽلاين كاملة: أدوات + وضع التجربة + حلقة حية بـ mock + سيرفر الويب.
// التشغيل: node test/run-tests.js   (مش محتاج إنترنت ولا مفتاح)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let passed = 0, failed = 0;
function check(name, cond, extra) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

// مجلدات معزولة للاختبار - لازم تتحط قبل require
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
const wsDir = path.join(tmp, 'workspace');
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(wsDir, { recursive: true });
fs.writeFileSync(path.join(wsDir, 'welcome.txt'), 'أهلاً بيك في المشروع\nالسطر التاني فيه كلمة قهوة\n');
fs.writeFileSync(path.join(wsDir, 'shopping.txt'), 'لبن\nعيش\nقهوة\n');
process.env.AGENT_WORKSPACE_DIR = wsDir;
process.env.AGENT_DATA_DIR = dataDir;
delete process.env.GEMINI_API_KEY;

const ROOT = path.join(__dirname, '..');
const { tools, TASKS_FILE, NOTES_FILE, safePath } = require(path.join(ROOT, 'tools'));
const core = require(path.join(ROOT, 'core'));
const findTool = core.findTool;

async function main() {
    console.log('\n[1] حماية المسارات');
    check('safePath بيرفض ../', (() => { try { safePath('../agent.js'); return false; } catch { return true; } })());
    check('safePath بيرفض مسار مطلق بره', (() => { try { safePath('/etc/passwd'); return false; } catch { return true; } })());
    check('safePath بيسمح بملف جوه', safePath('welcome.txt').startsWith(wsDir));
    check('read_file مش بتقرا بره المجلد', findTool('read_file').execute.constructor && (() => { try { findTool('read_file').execute({ filename: '../core.js' }); return false; } catch { return true; } })());

    console.log('\n[2] الأدوات على بيانات معزولة');
    check('add_task بيضيف', findTool('add_task').execute({ title: 'مهمة اختبار' }).includes('رقم 1'));
    check('add_task تانية بترقم صح', findTool('add_task').execute({ title: 'مهمة تانية' }).includes('رقم 2'));
    check('list_tasks بيعرض الاتنين', findTool('list_tasks').execute().split('\n').length === 2);
    check('complete_task بيعلم', findTool('complete_task').execute({ id: 1 }).includes('اكتملت'));
    check('complete_task لرقم مش موجود', findTool('complete_task').execute({ id: 99 }).includes('مفيش'));
    check('المهام اتحفظت على القرص', JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')).length === 2);
    check('save_note بيكتب', findTool('save_note').execute({ note: 'ملاحظة اختبار' }).includes('اتحفظت'));
    check('الملاحظة في الملف', fs.readFileSync(NOTES_FILE, 'utf8').includes('ملاحظة اختبار'));
    check('search_files بيلاقي في الملفات والملاحظات', findTool('search_files').execute({ query: 'قهوة' }).split('\n').length === 2);
    check('search_files من غير نتايج', findTool('search_files').execute({ query: 'xyzxyz' }).includes('مفيش'));
    check('list_files بيعرض', findTool('list_files').execute().includes('welcome.txt'));
    check('read_file بيقرا', findTool('read_file').execute({ filename: 'welcome.txt' }).includes('أهلاً'));
    check('read_file لملف مش موجود', findTool('read_file').execute({ filename: 'nope.txt' }).includes('مفيش'));

    console.log('\n[3] وضع التجربة (من غير موديل)');
    let r = await core.runDemoTurn('أضف مهمة: أذاكر C');
    check('demo: إضافة مهمة', r.reply.includes('اتضافت') && r.steps.length === 1 && r.steps[0].name === 'add_task');
    r = await core.runDemoTurn('عرض المهام');
    check('demo: عرض المهام', r.reply.includes('أذاكر C'));
    r = await core.runDemoTurn('امسح shopping.txt', { requestApproval: async () => false });
    check('demo: المسح بيرفض من غير موافقة', r.reply.includes('رفض') && r.steps[0].status === 'rejected');
    check('demo: الملف لسه موجود بعد الرفض', fs.existsSync(path.join(wsDir, 'shopping.txt')));
    r = await core.runDemoTurn('امسح shopping.txt', { requestApproval: async () => true });
    check('demo: المسح بينفذ بعد الموافقة', r.reply.includes('اتمسح'));
    check('demo: الملف اتمسح فعلًا', !fs.existsSync(path.join(wsDir, 'shopping.txt')));
    check('demo: من غير موافقة hook بيرفض تلقائي', (await core.runDemoTurn('امسح welcome.txt')).reply.includes('رفض'));

    console.log('\n[3ب] اللغات: عربي / English / Türkçe');
    r = await core.runTurn('hello there', [], {}, { lang: 'en' });
    check('demo EN: مساعدة إنجليزية', r.reply.includes('Demo mode understands'));
    r = await core.runTurn('merhaba', [], {}, { lang: 'tr' });
    check('demo TR: مساعدة تركية بحروف تركية', r.reply.includes('Demo modu') && /[şçğ]/.test(r.reply));
    r = await core.runTurn('görev ekle: süt al', [], {}, { lang: 'tr' });
    check('demo TR: أمر görev ekle بينفذ add_task', r.steps.length === 1 && r.steps[0].name === 'add_task' && r.steps[0].args.title === 'süt al');
    r = await core.runTurn('görevler', [], {}, { lang: 'tr' });
    check('demo TR: görevler بيعرض المهام', r.steps[0].name === 'list_tasks');
    r = await core.runTurn('sil welcome.txt', [], { requestApproval: async () => false }, { lang: 'tr' });
    check('demo TR: sil بيقف على الموافقة', r.steps[0].name === 'delete_file' && r.steps[0].status === 'rejected');
    r = await core.runTurn('أي كلام', [], {}, { lang: 'ar' });
    check('demo AR: الافتراضي عربي', r.reply.includes('وضع التجربة'));

    console.log('\n[4] الحلقة الحية بـ mock (من غير إنترنت)');
    const realFetch = global.fetch;
    let mockCalls = 0;
    global.fetch = async (url, opts) => {
        mockCalls++;
        const body = JSON.parse(opts.body);
        if (!url.includes('generateContent?key=')) throw new Error('URL غلط');
        if (!body.tools?.[0]?.function_declarations?.length) throw new Error('مفيش tool schemas');
        let payload;
        if (mockCalls === 1) {
            // الموديل بيطلب أداتين ورا بعض في نفس الرد (طلب مركب)
            payload = { candidates: [{ content: { parts: [
                { functionCall: { name: 'list_files', args: {} } },
                { functionCall: { name: 'read_file', args: { filename: 'welcome.txt' } } }
            ] } }] };
        } else if (mockCalls === 2) {
            payload = { candidates: [{ content: { parts: [
                { functionCall: { name: 'add_task', args: { title: 'مهمة مركبة' } } }
            ] } }] };
        } else {
            const last = body.contents[body.contents.length - 1];
            if (!last.parts[0].functionResponse) throw new Error('نتيجة الأداة مرجعتش');
            payload = { candidates: [{ content: { parts: [{ text: 'خلصت الطلب المركب ✅' }] } }] };
        }
        return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
    };
    const hist = [];
    r = await core.runLiveTurn('اقرأ الملفات واعمل مهمة', hist);
    check('live-mock: الرد النهائي وصل', r.reply.includes('خلصت'));
    check('live-mock: 3 خطوات متسجلة بالترتيب', r.steps.length === 3
        && r.steps[0].name === 'list_files' && r.steps[1].name === 'read_file' && r.steps[2].name === 'add_task');
    check('live-mock: كل الخطوات status=done', r.steps.every(s => s.status === 'done'));
    check('live-mock: النتايج رجعت للموديل', mockCalls === 3);

    // رفض إجراء حساس جوه الحلقة الحية
    mockCalls = 0;
    global.fetch = async () => {
        mockCalls++;
        const payload = mockCalls === 1
            ? { candidates: [{ content: { parts: [{ functionCall: { name: 'delete_file', args: { filename: 'welcome.txt' } } }] } }] }
            : { candidates: [{ content: { parts: [{ text: 'تمام، مسمحتوش يتمسح' }] } }] };
        return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
    };
    r = await core.runLiveTurn('امسح welcome.txt', [], { requestApproval: async () => false });
    check('live-mock: الرفض بيسجل rejected', r.steps[0].status === 'rejected');
    check('live-mock: الملف متمسحش', fs.existsSync(path.join(wsDir, 'welcome.txt')));

    // خطأ من الـ API بيتعالج
    global.fetch = async () => ({ ok: false, status: 429, text: async () => 'quota' });
    let threw = false;
    try { await core.runLiveTurn('أي حاجة', []); } catch (e) { threw = e.message.includes('429'); }
    check('live-mock: خطأ API بيرمي رسالة واضحة', threw);
    global.fetch = realFetch;

    console.log('\n[5] سيرفر الويب (HTTP حقيقي على منفذ عشوائي)');
    const port = 3900 + Math.floor(Math.random() * 400);
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        env: { ...process.env, PORT: String(port), AGENT_WORKSPACE_DIR: wsDir, AGENT_DATA_DIR: dataDir },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('السيرفر مخلصش تشغيل')), 8000);
        child.stdout.on('data', (d) => { if (String(d).includes('افتح')) { clearTimeout(t); resolve(); } });
        child.stderr.on('data', (d) => console.error('  [server]', String(d).trim()));
    });
    const base = `http://127.0.0.1:${port}`;
    const post = (p, obj) => realFetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

    let res = await realFetch(base + '/');
    check('GET / بيرجع الواجهة', res.status === 200 && (await res.text()).includes('المساعد الشخصي'));
    res = await realFetch(base + '/style.css');
    check('GET /style.css', res.status === 200 && (res.headers.get('content-type') || '').includes('css'));
    res = await realFetch(base + '/app.js');
    check('GET /app.js مش فيه أي مفتاح', res.status === 200 && !(await res.text()).match(/AIza|GEMINI_API_KEY\s*=\s*['"][^'"]/));
    res = await realFetch(base + '/../core.js');
    check('GET /../core.js ممنوع (traversal)', res.status === 403 || res.status === 404 || res.status === 400);
    res = await realFetch(base + '/%2e%2e/core.js');
    check('GET /%2e%2e/core.js ممنوع (encoded)', res.status === 403 || res.status === 404 || res.status === 400);
    res = await realFetch(base + '/api/state');
    const state = await res.json();
    check('GET /api/state', res.status === 200 && state.live === false && Array.isArray(state.tasks));

    // دورة كاملة بوضع التجربة عبر HTTP
    res = await post('/api/chat', { message: 'أضف مهمة: اختبار الويب' });
    let data = await res.json();
    check('POST /api/chat بينفذ', res.status === 200 && data.status === 'done' && data.reply.includes('اتضافت') && data.steps.length === 1);

    // دورة موافقة: رفض
    res = await post('/api/chat', { message: 'امسح welcome.txt' });
    data = await res.json();
    check('المسح بيقف على موافقة', data.status === 'approval' && data.approval.tool === 'delete_file');
    res = await post('/api/approval', { approved: false });
    data = await res.json();
    check('الرفض بيلغي المسح', data.status === 'done' && data.steps.at(-1).status === 'rejected');
    check('الملف لسه موجود', fs.existsSync(path.join(wsDir, 'welcome.txt')));

    // دورة موافقة: قبول
    res = await post('/api/chat', { message: 'امسح welcome.txt' });
    data = await res.json();
    res = await post('/api/approval', { approved: true });
    data = await res.json();
    check('القبول بينفذ المسح', data.status === 'done' && !fs.existsSync(path.join(wsDir, 'welcome.txt')));

    // طلب تاني أثناء انتظار موافقة
    await post('/api/chat', { message: 'امسح shopping.txt' }).then(r2 => r2.json());
    res = await post('/api/chat', { message: 'عرض المهام' });
    check('طلب أثناء انتظار موافقة = 409', res.status === 409);
    await post('/api/approval', { approved: false });

    res = await post('/api/approval', { approved: true });
    check('موافقة من غير pending = 409', res.status === 409);
    res = await post('/api/chat', { message: '' });
    check('رسالة فاضية = 400', res.status === 400);
    res = await post('/api/chat', { message: 'görevler', lang: 'tr' });
    data = await res.json();
    check('chat مع lang=tr بينفذ', res.status === 200 && data.status === 'done');
    res = await realFetch(base + '/api/state');
    check('السيرفر فاكر اللغة المختارة', (await res.json()).lang === 'tr');
    res = await realFetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' });
    check('JSON مكسور = 400', res.status === 400);

    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log(`\nالنتيجة: ${passed} نجح، ${failed} فشل`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('خطأ في الاختبارات:', err); process.exit(1); });
