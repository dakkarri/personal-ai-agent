// Mock للـ fetch: يحاكي ردود Gemini عشان نختبر حلقة الوضع الحي من غير إنترنت.
let calls = 0;
global.fetch = async (url, opts) => {
    calls++;
    const body = JSON.parse(opts.body);
    let payload;
    if (calls === 1) {
        if (!url.includes('generateContent?key=')) throw new Error('URL غلط: ' + url);
        if (!body.tools?.[0]?.function_declarations?.length) throw new Error('مفيش tool schemas اتبعتت');
        payload = { candidates: [{ content: { parts: [{ functionCall: { name: 'add_task', args: { title: 'مهمة من الوضع الحي' } } }] } }] };
    } else {
        const last = body.contents[body.contents.length - 1];
        const fr = last.parts[0].functionResponse;
        if (!fr || !String(fr.response.result).includes('اتضافت المهمة')) throw new Error('نتيجة الأداة مرجعتش صح');
        payload = { candidates: [{ content: { parts: [{ text: 'تمام، ضفت المهمة ✅' }] } }] };
    }
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
};
