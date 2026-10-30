// core.js - قلب الـ agent المشترك بين سطر الأوامر (agent.js) وواجهة الويب (server.js).
// وضعين:
//   1) وضع حي: لو فيه مفتاح GEMINI_API_KEY، الموديل هو اللي بيقرر أنهي أداة يستخدم،
//      والطلبات المركبة بتتنفذ على خطوات ورا بعض.
//   2) وضع التجربة: من غير مفتاح، محلل أوامر بسيط يجرب نفس الأدوات (مش ذكاء اصطناعي).
// الاتنين بيرجعوا { reply, steps } - steps هي أثر كل خطوة ونتيجتها عشان الواجهة تعرضها.

const { tools } = require('./tools');

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const MAX_TURNS = 12;
const LIVE = API_KEY.length > 0;

const SYSTEM_PROMPT = `إنت مساعد شخصي متعدد المهام شغال محليًا على جهاز المستخدم. بتتكلم بالعربي المصري البسيط.
عندك أدوات حقيقية: عرض وقراءة وبحث في ملفات مجلد العمل، حفظ ملاحظات، إدارة مهام محفوظة، ومسح ملفات.

قواعد شغلك:
- لما الطلب فيه حاجة ليها أداة مناسبة، استخدم الأداة. متقولش "عملت" من غير ما تنفذ فعلًا.
- الطلبات المركبة بتتنفذ على خطوات بالترتيب. مثال: "اقرأ الملفات وحدد الناقص واعمل مهام" يعني: اعرض الملفات، اقرأ اللي يهم منها، استنتج إيه الناقص، وبعدين أضف مهام باللي طلع معاك. متضيفش مهام من غير ما تقرأ الأول.
- الإجراءات الحساسة زي مسح الملفات بتقف لوحدها لحد ما المستخدم يوافق أو يرفض، فمتطلبش تأكيد بنفسك.
- لو الطلب ناقصه معلومة أساسية، اسأل سؤال واحد محدد.
- متخترعش محتوى ملفات: اللي يهمك فيه اقرأه بالأداة.
- رد في الآخر باختصار: إيه اللي اتعمل وإيه النتيجة.`;

const LANG_NOTE = {
    ar: '',
    en: '\nThe user\'s interface language is English: always reply in clear simple English.',
    tr: '\nKullanıcının arayüz dili Türkçe: her zaman açık ve sade Türkçe ile yanıt ver.'
};

function findTool(name) {
    return tools.find((t) => t.name === name);
}

async function runTool(tool, args, hooks) {
    if (tool.requiresApproval) {
        const approved = hooks && hooks.requestApproval
            ? await hooks.requestApproval(tool.name, args)
            : false;
        if (!approved) return 'المستخدم رفض الإجراء.';
    }
    try {
        return String(tool.execute(args));
    } catch (err) {
        return `خطأ أثناء التنفيذ: ${err.message}`;
    }
}

// ---------------- الوضع الحي (Gemini API) ----------------

async function callGemini(contents, lang) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
    const body = {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT + (LANG_NOTE[lang] || '') }] },
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

// hooks (اختياري): { onStep(step), requestApproval(name, args) => Promise<boolean> }
async function runLiveTurn(userText, history, hooks, lang) {
    const steps = [];
    history.push({ role: 'user', parts: [{ text: userText }] });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const data = await callGemini(history, lang);
        const parts = data.candidates?.[0]?.content?.parts || [];
        const functionCalls = parts.filter((p) => p.functionCall);

        history.push({ role: 'model', parts });

        if (!functionCalls.length) {
            const text = parts.map((p) => p.text || '').join('').trim();
            return { reply: text || '(الموديل مردّش بنص)', steps };
        }

        for (const call of functionCalls) {
            const tool = findTool(call.functionCall.name);
            const args = call.functionCall.args || {};
            const result = tool
                ? await runTool(tool, args, hooks)
                : `أداة غير معروفة: ${call.functionCall.name}`;
            const step = {
                type: 'tool',
                name: call.functionCall.name,
                args,
                status: result === 'المستخدم رفض الإجراء.' ? 'rejected'
                    : result.startsWith('خطأ') ? 'error' : 'done',
                result
            };
            steps.push(step);
            if (hooks && hooks.onStep) hooks.onStep(step);
            history.push({
                role: 'user',
                parts: [{ functionResponse: { name: call.functionCall.name, response: { result } } }]
            });
        }
    }
    return { reply: 'وصلت للحد الأقصى من الخطوات من غير ما أخلص. جرب تبسط الطلب.', steps };
}

// ---------------- وضع التجربة (من غير موديل) ----------------
// محلل أوامر بسيط عشان تجرب الأدوات قبل ما تجيب مفتاح API.
// ده مش ذكاء اصطناعي - ده مجرد مطابقة كلمات، ومش بيفهم طلبات مركبة.

async function runDemoTurn(text, hooks, lang) {
    const t = text.trim();
    const steps = [];
    const use = async (name, args) => {
        const result = await runTool(findTool(name), args, hooks);
        const step = {
            type: 'tool', name, args,
            status: result === 'المستخدم رفض الإجراء.' ? 'rejected'
                : result.startsWith('خطأ') ? 'error' : 'done',
            result
        };
        steps.push(step);
        if (hooks && hooks.onStep) hooks.onStep(step);
        return result;
    };

    let m = t.match(/^(?:أضف|ضيف|add|ekle)\s+(?:مهمة|task|görev)\s*[:：]?\s*(.+)$/i) || t.match(/^(?:görev)\s+(?:ekle)\s*[:：]?\s*(.+)$/i);
    if (m) return { reply: await use('add_task', { title: m[1].trim() }), steps };

    if (/^(عرض|وريني|list|listele)?\s*(المهام|tasks|görevler)$/i.test(t) || /^(tasks|görevler)$/i.test(t)) {
        return { reply: await use('list_tasks', {}), steps };
    }

    m = t.match(/^(?:خلصت|أكمل|اكمل|complete|done|bitirdim)\s*(?:مهمة|task|görev)?\s*(\d+)$/i);
    if (m) return { reply: await use('complete_task', { id: Number(m[1]) }), steps };

    m = t.match(/^(?:ملاحظة|سجل|سجّل|note|not)\s*[:：]?\s*(.+)$/i);
    if (m) return { reply: await use('save_note', { note: m[1].trim() }), steps };

    m = t.match(/^(?:ابحث عن|ابحث|search|ara)\s*[:：]?\s*(.+)$/i);
    if (m) return { reply: await use('search_files', { query: m[1].trim() }), steps };

    m = t.match(/^(?:اقرأ|اقرألي|read|oku)\s*[:：]?\s*(.+)$/i);
    if (m) return { reply: await use('read_file', { filename: m[1].trim() }), steps };

    if (/^(?:عرض|وريني|list|listele)\s*(الملفات|files|dosyalar)$/i.test(t) || /^(files|dosyalar)$/i.test(t)) {
        return { reply: await use('list_files', {}), steps };
    }

    m = t.match(/^(?:امسح|امسحلي|delete|sil)\s*[:：]?\s*(.+)$/i);
    if (m) return { reply: await use('delete_file', { filename: m[1].trim() }), steps };

    return { reply: DEMO_HELP[lang] || DEMO_HELP.ar, steps };
}

const DEMO_HELP = {
    ar: [
        'وضع التجربة فاهم الأوامر دي بس:',
        '  أضف مهمة: <نص المهمة>',
        '  عرض المهام',
        '  خلصت مهمة <رقم>',
        '  ملاحظة: <نص>',
        '  ابحث عن <كلمة>',
        '  عرض الملفات',
        '  اقرأ <اسم ملف>',
        '  امسح <اسم ملف>   (هيسألك الأول)',
        'للردود الذكية والطلبات المركبة، حط مفتاح Gemini في متغير GEMINI_API_KEY وشغّل تاني.'
    ].join('\n'),
    en: [
        'Demo mode understands only these commands:',
        '  add task: <task text>',
        '  list tasks',
        '  done task <number>',
        '  note: <text>',
        '  search <word>',
        '  list files',
        '  read <filename>',
        '  delete <filename>   (asks for your approval first)',
        'For smart free-form and compound requests, set GEMINI_API_KEY and restart.'
    ].join('\n'),
    tr: [
        'Demo modu yalnızca şu komutları anlar:',
        '  görev ekle: <görev metni>',
        '  görevler',
        '  bitirdim görev <numara>',
        '  not: <metin>',
        '  ara <kelime>',
        '  dosyalar',
        '  oku <dosya adı>',
        '  sil <dosya adı>   (önce onayınızı ister)',
        'Akıllı ve birleşik istekler için GEMINI_API_KEY ayarlayıp yeniden başlatın.'
    ].join('\n')
};

// نقطة الدخول الموحدة - opts.lang: ar (افتراضي) / en / tr
async function runTurn(userText, history, hooks, opts) {
    const lang = opts && ['ar', 'en', 'tr'].includes(opts.lang) ? opts.lang : 'ar';
    return LIVE ? runLiveTurn(userText, history, hooks, lang) : runDemoTurn(userText, hooks, lang);
}

module.exports = { runTurn, runLiveTurn, runDemoTurn, callGemini, findTool, runTool, LIVE, MODEL, SYSTEM_PROMPT };
