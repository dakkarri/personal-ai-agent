// tools.js - أدوات الـ agent: كل أداة ليها وصف يفهمه الموديل، وكود بينفذها.
// الموديل بيختار الأداة، لكن اللي بينفذ فعلًا هو الكود ده.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
// المسارات الافتراضية جنب المشروع، وبتتغير بمتغيرات بيئة (بيستخدمها الاختبار بس)
const WORKSPACE = process.env.AGENT_WORKSPACE_DIR
    ? path.resolve(process.env.AGENT_WORKSPACE_DIR)
    : path.join(ROOT, 'workspace');                     // الملفات اللي الـ agent يقدر يتعامل معاها
const DATA_DIR = process.env.AGENT_DATA_DIR
    ? path.resolve(process.env.AGENT_DATA_DIR)
    : path.join(ROOT, 'data');                          // الذاكرة الدائمة
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const NOTES_FILE = path.join(DATA_DIR, 'notes.md');

for (const dir of [WORKSPACE, DATA_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(TASKS_FILE)) fs.writeFileSync(TASKS_FILE, '[]');
if (!fs.existsSync(NOTES_FILE)) fs.writeFileSync(NOTES_FILE, '# Notes — الملاحظات — Notlar\n');

// حماية: ممنوع الخروج بره مجلد workspace
function safePath(p) {
    const full = path.resolve(WORKSPACE, String(p));
    if (full !== path.resolve(WORKSPACE) && !full.startsWith(path.resolve(WORKSPACE) + path.sep)) {
        throw new Error('المسار ده بره مجلد العمل المسموح بيه');
    }
    return full;
}

function readTasks() {
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
}

function writeTasks(tasks) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

const tools = [
    {
        name: 'list_files',
        description: 'عرض كل الملفات الموجودة في مجلد العمل',
        parameters: { type: 'object', properties: {} },
        execute() {
            const files = fs.readdirSync(WORKSPACE).filter(f => fs.statSync(path.join(WORKSPACE, f)).isFile());
            return files.length ? files.join('\n') : '(مجلد العمل فاضي)';
        }
    },
    {
        name: 'read_file',
        description: 'قراءة محتوى ملف من مجلد العمل',
        parameters: {
            type: 'object',
            properties: { filename: { type: 'string', description: 'اسم الملف' } },
            required: ['filename']
        },
        execute({ filename }) {
            const full = safePath(filename);
            if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return `مفيش ملف بالاسم ده: ${filename}`;
            return fs.readFileSync(full, 'utf8');
        }
    },
    {
        name: 'search_files',
        description: 'البحث عن كلمة أو جملة داخل كل ملفات مجلد العمل والملاحظات',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'الكلمة أو الجملة المطلوب البحث عنها' } },
            required: ['query']
        },
        execute({ query }) {
            const results = [];
            const targets = fs.readdirSync(WORKSPACE).map(f => path.join(WORKSPACE, f));
            targets.push(NOTES_FILE);
            for (const file of targets) {
                if (!fs.statSync(file).isFile()) continue;
                const lines = fs.readFileSync(file, 'utf8').split('\n');
                lines.forEach((line, i) => {
                    if (line.includes(query)) {
                        results.push(`${path.basename(file)}:${i + 1}: ${line.trim()}`);
                    }
                });
            }
            return results.length ? results.join('\n') : `مفيش نتائج لـ "${query}"`;
        }
    },
    {
        name: 'save_note',
        description: 'حفظ ملاحظة جديدة في دفتر الملاحظات الدائم',
        parameters: {
            type: 'object',
            properties: { note: { type: 'string', description: 'نص الملاحظة' } },
            required: ['note']
        },
        execute({ note }) {
            const stamp = new Date().toISOString().slice(0, 10);
            fs.appendFileSync(NOTES_FILE, `- [${stamp}] ${note}\n`);
            return 'اتحفظت الملاحظة في data/notes.md';
        }
    },
    {
        name: 'add_task',
        description: 'إضافة مهمة جديدة لقائمة المهام المحفوظة',
        parameters: {
            type: 'object',
            properties: { title: { type: 'string', description: 'وصف المهمة' } },
            required: ['title']
        },
        execute({ title }) {
            const tasks = readTasks();
            const task = { id: tasks.length ? Math.max(...tasks.map(t => t.id)) + 1 : 1, title, done: false, created: new Date().toISOString() };
            tasks.push(task);
            writeTasks(tasks);
            return `اتضافت المهمة رقم ${task.id}: ${title}`;
        }
    },
    {
        name: 'list_tasks',
        description: 'عرض قائمة المهام المحفوظة (المفتوحة والمكتملة)',
        parameters: { type: 'object', properties: {} },
        execute() {
            const tasks = readTasks();
            if (!tasks.length) return '(مفيش مهام لسه)';
            return tasks.map(t => `${t.done ? '[x]' : '[ ]'} ${t.id}. ${t.title}`).join('\n');
        }
    },
    {
        name: 'complete_task',
        description: 'تعليم مهمة إنها اكتملت برقمها',
        parameters: {
            type: 'object',
            properties: { id: { type: 'number', description: 'رقم المهمة' } },
            required: ['id']
        },
        execute({ id }) {
            const tasks = readTasks();
            const task = tasks.find(t => t.id === id);
            if (!task) return `مفيش مهمة بالرقم ${id}`;
            task.done = true;
            writeTasks(tasks);
            return `اتعلمت المهمة ${id} إنها اكتملت ✅`;
        }
    },
    {
        name: 'delete_file',
        description: 'مسح ملف من مجلد العمل - إجراء حساس يحتاج موافقة المستخدم',
        requiresApproval: true,
        parameters: {
            type: 'object',
            properties: { filename: { type: 'string', description: 'اسم الملف' } },
            required: ['filename']
        },
        execute({ filename }) {
            const full = safePath(filename);
            if (!fs.existsSync(full)) return `مفيش ملف بالاسم ده: ${filename}`;
            fs.unlinkSync(full);
            return `اتمسح الملف: ${filename}`;
        }
    }
];

module.exports = { tools, WORKSPACE, DATA_DIR, TASKS_FILE, NOTES_FILE, safePath };
