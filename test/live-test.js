// live-test.js - اختبار حي حقيقي مع Gemini API. مش بيشتغل ضمن الاختبارات العادية.
// التشغيل: GEMINI_API_KEY=مفتاحك node test/live-test.js
// بيختبر طلب مركب حقيقي: يقرأ الملفات، يحدد الناقص، ويعمل مهام - وبوابة الموافقة على المسح.

const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.GEMINI_API_KEY) {
    console.error('محتاج GEMINI_API_KEY في البيئة');
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-live-'));
const wsDir = path.join(tmp, 'workspace');
fs.mkdirSync(wsDir, { recursive: true });
fs.writeFileSync(path.join(wsDir, 'ideas.txt'), 'أفكار مشروع التخرج:\n- تطبيق مذاكرة للطلاب\n- لسه محتاج: مخطط قاعدة البيانات\n- لسه محتاج: تصميم الشاشات\n');
fs.writeFileSync(path.join(wsDir, 'week.txt'), 'الأسبوع ده: مراجعة خطبة الجمعة، وتسليم واجب قواعد البيانات يوم الثلاثاء\n');
process.env.AGENT_WORKSPACE_DIR = wsDir;
process.env.AGENT_DATA_DIR = path.join(tmp, 'data');

const core = require(path.join(__dirname, '..', 'core'));
console.log(`الموديل: ${core.MODEL} | الوضع الحي: ${core.LIVE}`);

let passed = 0, failed = 0;
const check = (name, cond) => { cond ? passed++ : failed++; console.log(`  ${cond ? '✓' : '✗'} ${name}`); };

async function main() {
    console.log('\n[حي 1] طلب مركب: اقرأ الملفات وحدد الناقص واعمل مهام');
    const history = [];
    const r1 = await core.runTurn('اقرأ كل ملفات مجلد العمل، وحدد إيه الناقص أو الممكن يتعمل، واعمل مهام باللي يطلع معاك', history);
    console.log('  الخطوات:', r1.steps.map(s => `${s.name}(${JSON.stringify(s.args)})`).toString().slice(0, 400));
    console.log('  الرد:', r1.reply.slice(0, 300));
    const names = r1.steps.map(s => s.name);
    check('نفذ 3 خطوات أو أكتر', r1.steps.length >= 3);
    check('عرض أو قرأ ملفات فعلًا', names.includes('list_files') || names.includes('read_file'));
    check('أضف مهمة واحدة على الأقل', names.includes('add_task'));
    check('كل الخطوات نجحت', r1.steps.every(s => s.status === 'done'));
    const tasks = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'tasks.json'), 'utf8'));
    check('المهام اتحفظت على القرص', tasks.length >= 1);
    check('الرد فيه ملخص', r1.reply.length > 10);

    console.log('\n[حي 2] بوابة الموافقة على المسح (رفض)');
    // محادثة جديدة: بوابة المسح بتتختبر من غير سياق الطلب المركب.
    // أحيانًا الموديل بيتأكد الأول ("متأكد؟") قبل ما ينده الأداة - ده سلوك مقبول،
    // فبنرد بتأكيد ونكمل لحد ما يطلب delete_file فعلًا.
    const hist2 = [];
    let r2 = await core.runTurn('امسح ملف week.txt', hist2, { requestApproval: async () => false });
    let delStep = r2.steps.find(s => s.name === 'delete_file');
    if (!delStep) {
        console.log('  (الموديل اتأكد الأول:', r2.reply.slice(0, 80) + ')');
        r2 = await core.runTurn('نعم، امسحه', hist2, { requestApproval: async () => false });
        delStep = r2.steps.find(s => s.name === 'delete_file');
    }
    check('الموديل طلب delete_file (مباشرة أو بعد تأكيد)', !!delStep);
    check('الرفض سجل rejected', delStep && delStep.status === 'rejected');
    check('الملف متمسحش', fs.existsSync(path.join(wsDir, 'week.txt')));

    console.log('\n[حي 3] رد الموديل بنفس لغة الواجهة');
    const r3 = await core.runTurn('Please list my workspace files', [], {}, { lang: 'en' });
    console.log('  EN:', r3.reply.slice(0, 150));
    check('EN: رد إنجليزي من غير عربي', !/[\u0600-\u06FF]/.test(r3.reply) && r3.steps.some(s => s.name === 'list_files'));
    const r4 = await core.runTurn('Çalışma alanımdaki dosyaları listeler misin?', [], {}, { lang: 'tr' });
    console.log('  TR:', r4.reply.slice(0, 150));
    check('TR: رد تركي من غير عربي', !/[\u0600-\u06FF]/.test(r4.reply) && r4.steps.some(s => s.name === 'list_files'));
    check('TR: الرد فيه كلمات تركية', /[çğıöşüİ]/.test(r4.reply) || r4.reply.toLowerCase().includes('dosya'));

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\nالنتيجة الحية: ${passed} نجح، ${failed} فشل`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('خطأ:', err.message); process.exit(1); });
