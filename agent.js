// agent.js - واجهة سطر الأوامر: غلاف رفيع حوالين core.js.
// لو عايز واجهة ويب: node server.js وبعدين افتح http://127.0.0.1:3000

const readline = require('readline');
const core = require('./core');

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

function printStep(step) {
    const icon = step.status === 'done' ? '✓' : step.status === 'rejected' ? '✗' : '!';
    console.log(`  [${icon}] ${step.name}(${JSON.stringify(step.args)}) → ${step.result.split('\n')[0].slice(0, 120)}`);
}

async function main() {
    console.log('🤖 المساعد الشخصي - v0.2');
    console.log(core.LIVE
        ? `الوضع: حي (${core.MODEL}) - طلبات مركبة شغالة`
        : 'الوضع: تجربة محلي (من غير موديل ذكي - الأدوات شغالة بجد)');
    console.log('لواجهة الويب: node server.js | اكتب "خروج" أو exit للقفل.\n');

    const history = [];
    while (true) {
        const input = (await ask('إنت: ')).trim();
        if (!input) { if (closed) break; continue; }
        if (['خروج', 'exit', 'quit'].includes(input.toLowerCase())) break;

        try {
            const { reply, steps } = await core.runTurn(input, history, {
                requestApproval: async (name, args) => {
                    const answer = await ask(`\n⚠️  الـ agent عايز ينفذ إجراء حساس: ${name}(${JSON.stringify(args)})\nموافق؟ (نعم/لا): `);
                    return ['نعم', 'اه', 'أه', 'yes', 'y'].includes(answer.trim().toLowerCase());
                }
            });
            steps.forEach(printStep);
            console.log(`\nالمساعد: ${reply}\n`);
        } catch (err) {
            console.log(`\nحصل خطأ: ${err.message}\n`);
        }
    }
    rl.close();
}

main();
