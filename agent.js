// agent.js - قلب الـ agent: الحلقة + واجهة سطر الأوامر.
// وضعين:
//   1) وضع حي: لو فيه مفتاح GEMINI_API_KEY، الموديل هو اللي بيقرر أنهي أداة يستخدم.
//   2) وضع التجربة: من غير مفتاح، محلل أوامر بسيط يجرب نفس الأدوات (مش ذكاء اصطناعي).

const readline = require('readline');
const { tools } = require('./tools');

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const MAX_TURNS = 8;
const LIVE = API_KEY.length > 0;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// طابور أسطر: يخزن المدخلات اللي توصل قبل ما نسأل، ويصحّي المنتظرين لما سطر يوصل.
const lineQueue = [];
const waiters = [];
let closed = false;
rl.on('line', (line) => {
    if (waiters.length) waiters.shift()(line);
    else lineQueue.push(line);
});
rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()('');
});
const ask = (q) => new Promise((resolve) => {
    if (lineQueue.length) { process.stdout.write(q); resolve(lineQueue.shift()); return; }
    if (closed) { resolve(''); return; }
    process.stdout.write(q);
    waiters.push(resolve);
});

const SYSTEM_PROMPT = `إنت مساعد شخصي متعدد المهام. بتتكلم بالعربي المصري البسيط.
عندك أدوات: قراءة وعرض وبحث في الملفات، حفظ ملاحظات، وإدارة مهام محفوظة، ومسح ملفات.
لما المستخدم يطلب حاجة ليها أداة مناسبة، استخدم الأداة. رد باختصار ووضوح.`;

function findTool(name) {
    return tools.find((t) => t.name === name);
}

async function runTool(tool, args) {
    if (tool.requiresApproval) {
        const answer = await ask(`\n⚠️  الـ agent عايز ينفذ إجراء حساس: ${tool.name}(${JSON.stringify(args)})\nموافق؟ (نعم/لا): `);
        if (!['نعم', 'اه', 'أه', 'yes', 'y'].includes(answer.trim().toLowerCase())) {
            return 'المستخدم رفض الإجراء.';
        }
    }
    try {
        return String(tool.execute(args));
    } catch (err) {
        return `خطأ أثناء التنفيذ: ${err.message}`;
    }
}

// ---------------- الوضع الحي (Gemini API) ----------------

async function callGemini(contents) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
    const body = {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        tools: [{
            function_declarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters
            }))
        }]
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        throw new Error(`Gemini API رد بـ ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

async function runLiveTurn(userText, history) {
    history.push({ role: 'user', parts: [{ text: userText }] });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const data = await callGemini(history);
        const parts = data.candidates?.[0]?.content?.parts || [];
        const functionCalls = parts.filter((p) => p.functionCall);

        history.push({ role: 'model', parts });

        if (!functionCalls.length) {
            const text = parts.map((p) => p.text || '').join('').trim();
            return text || '(الموديل مردّش بنص)';
        }

        for (const call of functionCalls) {
            const tool = findTool(call.functionCall.name);
            const result = tool
                ? await runTool(tool, call.functionCall.args || {})
                : `أداة غير معروفة: ${call.functionCall.name}`;
            history.push({
                role: 'user',
                parts: [{ functionResponse: { name: call.functionCall.name, response: { result } } }]
            });
        }
    }
    return 'وصلت للحد الأقصى من الخطوات من غير ما أخلص. جرب تبسط الطلب.';
}

// ---------------- وضع التجربة (من غير موديل) ----------------
// محلل أوامر بسيط عشان تجرب الأدوات قبل ما تجيب مفتاح API.
// ده مش ذكاء اصطناعي - ده مجرد مطابقة كلمات.

async function runDemoTurn(text) {
    const t = text.trim();

    let m = t.match(/^(?:أضف|ضيف|add)\s+(?:مهمة|task)\s*[:：]?\s*(.+)$/i);
    if (m) return runTool(findTool('add_task'), { title: m[1].trim() });

    if (/^(عرض|وريني|list)?\s*(المهام|tasks)$/i.test(t) || /^tasks$/i.test(t)) {
        return runTool(findTool('list_tasks'), {});
    }

    m = t.match(/^(?:خلصت|أكمل|اكمل|complete|done)\s*(?:مهمة|task)?\s*(\d+)$/i);
    if (m) return runTool(findTool('complete_task'), { id: Number(m[1]) });

    m = t.match(/^(?:ملاحظة|سجل|سجّل|note)\s*[:：]?\s*(.+)$/i);
    if (m) return runTool(findTool('save_note'), { note: m[1].trim() });

    m = t.match(/^(?:ابحث عن|ابحث|search)\s*[:：]?\s*(.+)$/i);
    if (m) return runTool(findTool('search_files'), { query: m[1].trim() });

    m = t.match(/^(?:اقرأ|اقرألي|read)\s*[:：]?\s*(.+)$/i);
    if (m) return runTool(findTool('read_file'), { filename: m[1].trim() });

    if (/^(?:عرض|وريني|list)\s*(الملفات|files)$/i.test(t) || /^files$/i.test(t)) {
        return runTool(findTool('list_files'), {});
    }

    m = t.match(/^(?:امسح|امسحلي|delete)\s*[:：]?\s*(.+)$/i);
    if (m) return runTool(findTool('delete_file'), { filename: m[1].trim() });

    return [
        'وضع التجربة فاهم الأوامر دي بس:',
        '  أضف مهمة: <نص المهمة>',
        '  عرض المهام',
        '  خلصت مهمة <رقم>',
        '  ملاحظة: <نص>',
        '  ابحث عن <كلمة>',
        '  عرض الملفات',
        '  اقرأ <اسم ملف>',
        '  امسح <اسم ملف>   (هيسألك الأول)',
        'للردود الذكية الحرة، حط مفتاح Gemini في متغير GEMINI_API_KEY وشغّل تاني.'
    ].join('\n');
}

// ---------------- الواجهة ----------------

async function main() {
    console.log('🤖 المساعد الشخصي - نموذج أولي v0.1');
    console.log(LIVE
        ? `الوضع: حي (${MODEL})`
        : 'الوضع: تجربة محلي (من غير موديل ذكي - الأدوات شغالة بجد)');
    console.log('اكتب "خروج" أو exit للقفل.\n');

    const history = [];
    while (true) {
        const input = (await ask('إنت: ')).trim();
        if (!input) { if (closed) break; continue; }
        if (['خروج', 'exit', 'quit'].includes(input.toLowerCase())) break;

        try {
            const reply = LIVE ? await runLiveTurn(input, history) : await runDemoTurn(input);
            console.log(`\nالمساعد: ${reply}\n`);
        } catch (err) {
            console.log(`\nحصل خطأ: ${err.message}\n`);
        }
    }
    rl.close();
}

main();
