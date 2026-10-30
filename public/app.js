// app.js - منطق واجهة الويب. بيتكلم مع /api على نفس السيرفر المحلي بس.
// مفيش أي مفاتيح أو أسرار هنا - المفتاح بيفضل على السيرفر.
// الواجهة بثلاث لغات: العربية (RTL) والإنجليزية والتركية (LTR).

const STRINGS = {
    ar: {
        dir: 'rtl', lang: 'ar', docTitle: 'المساعد الشخصي',
        title: 'المساعد الشخصي', subtitle: 'شغال محليًا على جهازك',
        welcome: 'أهلاً! أقدر أقرأ وأدور في ملفاتك، أحفظ ملاحظات، وأدير مهامك. لو طلبت حاجة مركبة (زي «اقرأ الملفات وحدد الناقص واعمل مهام») هنفذها خطوة خطوة وهوريك كل خطوة ونتيجتها. وأي إجراء حساس زي مسح ملف هيقف لحد ما توافق.',
        chip1: '▸ اقرأ الملفات وحدد الناقص واعمل مهام',
        chip1Prompt: 'اقرأ كل ملفات مجلد العمل، حدد إيه الناقص أو الممكن يتحسن، واعمل مهام بيها',
        chip2: '✓ عرض المهام', chip2Prompt: 'عرض المهام',
        chip3: '▸ عرض الملفات', chip3Prompt: 'عرض الملفات',
        placeholder: 'اكتب طلبك هنا...',
        tasks: 'المهام', files: 'ملفات مجلد العمل', notes: 'الملاحظات',
        noTasks: 'مفيش مهام لسه', emptyFiles: 'مجلد العمل فاضي', emptyNotes: '(فاضي)',
        typing: 'بيشتغل...',
        stepsToggle: (n) => `الخطوات المنفذة (${n}) - اضغط للعرض`,
        approvalTitle: '⚠️ إجراء حساس محتاج موافقتك',
        approve: 'موافق', reject: 'ارفض',
        approvedNote: '✓ وافقت - جاري التنفيذ...', rejectedNote: '✗ رفضت - الإجراء اتلغى',
        connErr: 'الاتصال بالسيرفر اتقطع: ', unexpected: 'حصل خطأ غير متوقع',
        badgeLive: (m) => `وضع حي - ${m}`, badgeDemo: 'وضع تجربة محلي (من غير موديل)'
    },
    en: {
        dir: 'ltr', lang: 'en', docTitle: 'Personal AI Agent',
        title: 'Personal AI Agent', subtitle: 'Running locally on your machine',
        welcome: 'Hi! I can read and search your files, save notes, and manage your tasks. Compound requests (like "read the files, find what is missing, and create tasks") run step by step with a visible trace of every step and its result. Any sensitive action like deleting a file pauses until you approve it.',
        chip1: '▸ Read files, find gaps, create tasks',
        chip1Prompt: 'Read all files in the workspace, identify what is missing or could be improved, and create tasks for them',
        chip2: '✓ List tasks', chip2Prompt: 'list tasks',
        chip3: '▸ List files', chip3Prompt: 'list files',
        placeholder: 'Type your request...',
        tasks: 'Tasks', files: 'Workspace files', notes: 'Notes',
        noTasks: 'No tasks yet', emptyFiles: 'Workspace is empty', emptyNotes: '(empty)',
        typing: 'Working...',
        stepsToggle: (n) => `Executed steps (${n}) - click to view`,
        approvalTitle: '⚠️ Sensitive action needs your approval',
        approve: 'Approve', reject: 'Reject',
        approvedNote: '✓ Approved - running...', rejectedNote: '✗ Rejected - action cancelled',
        connErr: 'Lost connection to the server: ', unexpected: 'Unexpected error',
        badgeLive: (m) => `Live mode - ${m}`, badgeDemo: 'Local demo mode (no model)'
    },
    tr: {
        dir: 'ltr', lang: 'tr', docTitle: 'Kişisel Yapay Zekâ Asistanı',
        title: 'Kişisel Asistan', subtitle: 'Bilgisayarınızda yerel olarak çalışıyor',
        welcome: 'Merhaba! Dosyalarınızı okuyabilir ve arayabilir, notlar kaydedebilir ve görevlerinizi yönetebilirim. Birleşik istekler ("dosyaları oku, eksikleri belirle ve görevler oluştur" gibi) adım adım çalışır ve her adımı sonucuyla birlikte görürsünüz. Dosya silme gibi hassas işlemler siz onaylayana kadar bekler.',
        chip1: '▸ Dosyaları oku, eksikleri bul, görev oluştur',
        chip1Prompt: 'Çalışma alanındaki tüm dosyaları oku, eksik veya iyileştirilebilecek şeyleri belirle ve bunlar için görevler oluştur',
        chip2: '✓ Görevleri listele', chip2Prompt: 'görevler',
        chip3: '▸ Dosyaları listele', chip3Prompt: 'dosyalar',
        placeholder: 'İsteğinizi buraya yazın...',
        tasks: 'Görevler', files: 'Çalışma alanı dosyaları', notes: 'Notlar',
        noTasks: 'Henüz görev yok', emptyFiles: 'Çalışma alanı boş', emptyNotes: '(boş)',
        typing: 'Çalışıyor...',
        stepsToggle: (n) => `Çalıştırılan adımlar (${n}) - görüntülemek için tıklayın`,
        approvalTitle: '⚠️ Hassas işlem onayınızı bekliyor',
        approve: 'Onayla', reject: 'Reddet',
        approvedNote: '✓ Onaylandı - çalıştırılıyor...', rejectedNote: '✗ Reddedildi - işlem iptal edildi',
        connErr: 'Sunucu bağlantısı kesildi: ', unexpected: 'Beklenmeyen hata',
        badgeLive: (m) => `Canlı mod - ${m}`, badgeDemo: 'Yerel demo modu (modelsiz)'
    }
};

let lang = localStorage.getItem('agent-lang') || 'ar';
if (!STRINGS[lang]) lang = 'ar';
const S = () => STRINGS[lang];

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const composer = document.getElementById('composer');
const modeBadge = document.getElementById('modeBadge');

function applyLang() {
    const s = S();
    document.documentElement.lang = s.lang;
    document.documentElement.dir = s.dir;
    document.title = s.docTitle;
    document.getElementById('uiTitle').textContent = s.title;
    document.getElementById('uiSubtitle').textContent = s.subtitle;
    document.getElementById('welcomeBubble').textContent = s.welcome;
    document.getElementById('chip1').textContent = s.chip1;
    document.getElementById('chip2').textContent = s.chip2;
    document.getElementById('chip3').textContent = s.chip3;
    inputEl.placeholder = s.placeholder;
    document.getElementById('tasksTitle').textContent = s.tasks;
    document.getElementById('filesTitle').textContent = s.files;
    document.getElementById('notesTitle').textContent = s.notes;
    document.getElementById('langSelect').value = lang;
}

document.getElementById('langSelect').addEventListener('change', (e) => {
    lang = e.target.value;
    localStorage.setItem('agent-lang', lang);
    applyLang();
    refreshState();
});

function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, text) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollDown();
    return wrap;
}

function addTyping() {
    const el = document.createElement('div');
    el.className = 'typing';
    el.textContent = S().typing;
    messagesEl.appendChild(el);
    scrollDown();
    return el;
}

function addError(text) {
    const el = document.createElement('div');
    el.className = 'error-banner';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollDown();
}

const STEP_ICONS = { done: '✓', rejected: '✗', error: '!' };

function renderSteps(container, steps) {
    if (!steps || !steps.length) return;
    let box = container.querySelector('.steps');
    if (!box) {
        box = document.createElement('div');
        box.className = 'steps';
        const toggle = document.createElement('button');
        toggle.className = 'steps-toggle';
        toggle.type = 'button';
        toggle.addEventListener('click', () => box.classList.toggle('open'));
        box.appendChild(toggle);
        const list = document.createElement('ul');
        list.className = 'steps-list';
        box.appendChild(list);
        container.appendChild(box);
    }
    box.querySelector('.steps-toggle').textContent = S().stepsToggle(steps.length);
    const list = box.querySelector('.steps-list');
    list.innerHTML = '';
    for (const st of steps) {
        const li = document.createElement('li');
        li.className = 'step';
        const head = document.createElement('div');
        head.className = 'step-head';
        const icon = document.createElement('span');
        icon.className = `step-icon ${st.status}`;
        icon.textContent = STEP_ICONS[st.status] || '?';
        const name = document.createElement('span');
        name.className = 'step-name';
        name.textContent = st.name;
        const args = document.createElement('span');
        args.className = 'step-args';
        args.textContent = JSON.stringify(st.args);
        head.append(icon, name, args);
        li.appendChild(head);
        if (st.result) {
            const res = document.createElement('div');
            res.className = 'step-result';
            res.textContent = st.result.length > 600 ? st.result.slice(0, 600) + '…' : st.result;
            li.appendChild(res);
        }
        list.appendChild(li);
    }
    scrollDown();
}

function renderApproval(turnEl, approval) {
    const s = S();
    const card = document.createElement('div');
    card.className = 'approval';
    const h = document.createElement('h3');
    h.textContent = s.approvalTitle;
    const p = document.createElement('p');
    p.textContent = `${approval.tool}(${JSON.stringify(approval.args)})`;
    const actions = document.createElement('div');
    actions.className = 'approval-actions';
    const yes = document.createElement('button');
    yes.className = 'btn btn-approve';
    yes.textContent = s.approve;
    const no = document.createElement('button');
    no.className = 'btn btn-reject';
    no.textContent = s.reject;
    actions.append(yes, no);
    card.append(h, p, actions);
    turnEl.appendChild(card);
    scrollDown();

    return (approved) => {
        yes.disabled = no.disabled = true;
        card.classList.add(approved ? 'decided-ok' : 'decided-no');
        const note = document.createElement('div');
        note.className = 'decision-note';
        note.textContent = approved ? S().approvedNote : S().rejectedNote;
        card.appendChild(note);
        scrollDown();
    };
}

async function refreshState() {
    try {
        const res = await fetch('/api/state');
        const state = await res.json();
        const s = S();

        if (state.live) {
            modeBadge.textContent = s.badgeLive(state.model);
            modeBadge.className = 'badge live';
        } else {
            modeBadge.textContent = s.badgeDemo;
            modeBadge.className = 'badge demo';
        }

        const taskList = document.getElementById('taskList');
        taskList.innerHTML = '';
        if (!state.tasks.length) {
            const li = document.createElement('li');
            li.className = 'empty-hint';
            li.textContent = s.noTasks;
            taskList.appendChild(li);
        }
        for (const t of state.tasks) {
            const li = document.createElement('li');
            if (t.done) li.className = 'done';
            const mark = document.createElement('span');
            mark.className = t.done ? 'task-check' : 'task-open';
            mark.textContent = t.done ? '✓' : '○';
            const label = document.createElement('span');
            label.textContent = `${t.id}. ${t.title}`;
            li.append(mark, label);
            taskList.appendChild(li);
        }

        const fileList = document.getElementById('fileList');
        fileList.innerHTML = '';
        if (!state.files.length) {
            const li = document.createElement('li');
            li.className = 'empty-hint';
            li.textContent = s.emptyFiles;
            fileList.appendChild(li);
        }
        for (const f of state.files) {
            const li = document.createElement('li');
            li.textContent = f;
            fileList.appendChild(li);
        }

        document.getElementById('notesView').textContent = state.notes || s.emptyNotes;
    } catch (err) {
        console.error('state refresh failed', err);
    }
}

async function handleResponse(turnEl, data) {
    renderSteps(turnEl, data.steps);
    if (data.status === 'approval') {
        const markDecision = renderApproval(turnEl, data.approval);
        const decide = async (approved) => {
            markDecision(approved);
            const typing = addTyping();
            try {
                const res = await fetch('/api/approval', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ approved })
                });
                const next = await res.json();
                typing.remove();
                if (!res.ok) { addError(next.error || S().unexpected); return; }
                await handleResponse(turnEl, next);
            } catch (err) {
                typing.remove();
                addError(S().connErr + err.message);
            }
        };
        const [yes, no] = turnEl.querySelectorAll('.approval .btn');
        yes.addEventListener('click', () => decide(true), { once: true });
        no.addEventListener('click', () => decide(false), { once: true });
        return;
    }
    if (data.reply) {
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = data.reply;
        turnEl.appendChild(bubble);
        scrollDown();
    }
    await refreshState();
}

async function send(text) {
    const message = text.trim();
    if (!message) return;
    inputEl.value = '';
    sendBtn.disabled = true;

    addMessage('user', message);
    const typing = addTyping();

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, lang })
        });
        const data = await res.json();
        typing.remove();
        if (!res.ok) {
            addError(data.error || S().unexpected);
        } else {
            const turnEl = document.createElement('div');
            turnEl.className = 'msg assistant';
            turnEl.style.flexDirection = 'column';
            turnEl.style.alignItems = 'flex-end';
            messagesEl.appendChild(turnEl);
            await handleResponse(turnEl, data);
        }
    } catch (err) {
        typing.remove();
        addError(S().connErr + err.message);
    } finally {
        sendBtn.disabled = false;
        inputEl.focus();
    }
}

composer.addEventListener('submit', (e) => {
    e.preventDefault();
    send(inputEl.value);
});

document.getElementById('chip1').addEventListener('click', () => send(S().chip1Prompt));
document.getElementById('chip2').addEventListener('click', () => send(S().chip2Prompt));
document.getElementById('chip3').addEventListener('click', () => send(S().chip3Prompt));

document.getElementById('refreshState').addEventListener('click', refreshState);

applyLang();
refreshState();
inputEl.focus();
