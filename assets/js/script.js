// ─────────────────────────────────────────────
//  KRHDev Todo App – script.js
//  CRUD: Create · Read · Update · Delete
//  Features: Named lists · Light/Dark mode · Mobile friendly
//            Change log · Local storage · Supabase cloud sync
//            Subtasks · Category filter · Focus task · Auto-reset
//  Validation: Empty input blocked · Warnings shown · Duplicate prevention
// ─────────────────────────────────────────────

// ── Auth state ───────────────────────────────
let currentUser = null;
let useCloud    = false;
const PASSWORD_RESET_REDIRECT = 'https://krhdev.github.io/interactive_todo_list/index.htm';

// ── Theme ────────────────────────────────────
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('krhdev-theme', theme);
}

function loadTheme() {
    const saved = localStorage.getItem('krhdev-theme') || 'light';
    applyTheme(saved);
    const radios = document.querySelectorAll('input[name="theme"]');
    radios.forEach(r => { r.checked = (r.value === saved); });
    applyUserName();
}

// ── User name ────────────────────────────────
const NAME_KEY     = 'krhdev-user-name';
const DEFAULT_NAME = 'KRHDev';
const TITLE_SUFFIX = "'s To Do List";

function getUserName() {
    return localStorage.getItem(NAME_KEY) || DEFAULT_NAME;
}

function applyUserName() {
    const name = getUserName();
    const sidebarTitle = document.getElementById('sidebar-title');
    const mobileTitle  = document.getElementById('mobile-title');
    if (sidebarTitle) {
        const hasApp = sidebarTitle.dataset.suffix === 'app';
        sidebarTitle.textContent = name + TITLE_SUFFIX + (hasApp ? ' App' : '');
    }
    if (mobileTitle) mobileTitle.textContent = name + TITLE_SUFFIX;
    if (document.title.includes('To Do List')) {
        document.title = document.title.replace(/^[^']+(?='s To Do)/, name);
    }
}

// ── Data store ───────────────────────────────
let lists = JSON.parse(localStorage.getItem('krhdev-lists') || '[]');
let todos = JSON.parse(localStorage.getItem('krhdev-todos') || '[]');

todos = todos.filter(t => t.listId !== undefined);
localStorage.setItem('krhdev-todos', JSON.stringify(todos));

let nextListId = lists.length ? Math.max(...lists.map(l => l.id)) + 1 : 1;
let nextTodoId = todos.length ? Math.max(...todos.map(t => t.id)) + 1 : 1;
let activeListId = null;
let activeView   = 'home';
let focusTaskId      = localStorage.getItem('krhdev-focus-task') || null;
let focusEnabled     = localStorage.getItem('krhdev-focus-enabled') !== 'false'; // default on

function save() {
    localStorage.setItem('krhdev-lists', JSON.stringify(lists));
    localStorage.setItem('krhdev-todos', JSON.stringify(todos));
}

// ── Auto-reset Daily / Weekly lists ─────────
async function checkAndReset() {
    const now       = new Date();
    const todayStr  = now.toISOString().slice(0, 10);
    const dayOfWeek = now.getDay();

    const lastDaily = localStorage.getItem('krhdev-last-daily-reset');
    if (lastDaily !== todayStr) {
        const dailyLists = lists.filter(l => (l.category || '') === 'Daily');
        for (const list of dailyLists) {
            const toReset = todos.filter(t => t.listId === list.id && t.done && !t.deleted && !t.parentId);
            for (const todo of toReset) {
                todo.done = false;
                if (useCloud) await window.supabase.from('todos').update({ done: false }).eq('id', todo.id);
            }
            if (toReset.length) logChange(`Daily reset: "${list.name}" — ${toReset.length} task(s) reset`);
        }
        localStorage.setItem('krhdev-last-daily-reset', todayStr);
        if (!useCloud) save();
    }

    const lastWeekly = localStorage.getItem('krhdev-last-weekly-reset');
    const thisMonday = getThisMonday();
    if (dayOfWeek === 1 && lastWeekly !== thisMonday) {
        const weeklyLists = lists.filter(l => (l.category || '') === 'Weekly');
        for (const list of weeklyLists) {
            const toReset = todos.filter(t => t.listId === list.id && t.done && !t.deleted && !t.parentId);
            for (const todo of toReset) {
                todo.done = false;
                if (useCloud) await window.supabase.from('todos').update({ done: false }).eq('id', todo.id);
            }
            if (toReset.length) logChange(`Weekly reset: "${list.name}" — ${toReset.length} task(s) reset`);
        }
        localStorage.setItem('krhdev-last-weekly-reset', thisMonday);
        if (!useCloud) save();
    }
}

function getThisMonday() {
    const now  = new Date();
    const day  = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().slice(0, 10);
}

// ── Supabase helpers ──────────────────────────
async function loadFromCloud() {
    if (!useCloud) return;
    const { data: cloudLists, error: le } = await window.supabase.from('lists').select('*').order('created_at');
    const { data: cloudTodos, error: te } = await window.supabase.from('todos').select('*').order('created_at');
    if (le || te) { console.error('Cloud load error', le || te); return; }
    lists = (cloudLists || []).map(l => ({ id: l.id, name: l.name, category: l.category || 'General' }));
    todos = (cloudTodos || []).map(t => ({
        id:       t.id,
        listId:   t.list_id,
        parentId: t.parent_id || null,
        text:     t.text,
        done:     t.done,
        deleted:  t.deleted,
        editing:  false,
        dueDate:  t.due_date || null,
        dueTime:  t.due_time || null
    }));
    const savedActive = localStorage.getItem('krhdev-active-list');
    const stillExists = savedActive && lists.find(l => String(l.id) === String(savedActive));
    activeListId = stillExists ? savedActive : (lists.length ? lists[0].id : null);
    activeView   = lists.length ? 'all' : 'home';
    await checkAndReset();
    render();
}

// ── Validation helpers ────────────────────────
const _warnTimers = {};

function showWarning(inputEl, message) {
    const id = inputEl.id || inputEl.name || 'field';
    clearWarning(inputEl);
    const warn = document.createElement('p');
    warn.className = 'input-warning';
    warn.setAttribute('role', 'alert');
    warn.textContent = message;
    warn.id = `warn-${id}`;
    inputEl.classList.add('input-invalid');
    inputEl.setAttribute('aria-describedby', warn.id);
    inputEl.insertAdjacentElement('afterend', warn);
    inputEl.classList.add('input-shake');
    inputEl.addEventListener('animationend', () => inputEl.classList.remove('input-shake'), { once: true });
    if (_warnTimers[id]) clearTimeout(_warnTimers[id]);
    _warnTimers[id] = setTimeout(() => clearWarning(inputEl), 3000);
}

function clearWarning(inputEl) {
    const id = inputEl.id || inputEl.name || 'field';
    const existing = document.getElementById(`warn-${id}`);
    if (existing) existing.remove();
    inputEl.classList.remove('input-invalid');
    inputEl.removeAttribute('aria-describedby');
    if (_warnTimers[id]) { clearTimeout(_warnTimers[id]); delete _warnTimers[id]; }
}

function normalise(str) {
    return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Logging ──────────────────────────────────
const MAX_LOG = 10;

function logChange(message) {
    const log = JSON.parse(localStorage.getItem('krhdev-log') || '[]');
    log.unshift({ message, time: new Date().toLocaleTimeString() });
    if (log.length > MAX_LOG) log.pop();
    localStorage.setItem('krhdev-log', JSON.stringify(log));
    renderLog();
}

function renderLog() {
    const logContainer = document.getElementById('recent-changes-container');
    const emptyLog = document.getElementById('empty-log');
    if (!logContainer) return;
    const log = JSON.parse(localStorage.getItem('krhdev-log') || '[]');
    logContainer.innerHTML = '';
    if (emptyLog) emptyLog.style.display = log.length ? 'none' : 'block';
    log.forEach(item => {
        const li = document.createElement('li');
        li.className = 'log-item';
        li.textContent = `[${item.time}] ${item.message}`;
        logContainer.appendChild(li);
    });
}

// ── CREATE — List ─────────────────────────────
async function addList() {
    const input = document.getElementById('new-list');
    if (!input) return;
    const name = input.value.trim();
    if (!name) { showWarning(input, 'Please enter a list name.'); input.focus(); return; }
    if (name.length > 60) { showWarning(input, 'List name must be 60 characters or fewer.'); input.focus(); return; }
    const duplicate = lists.find(l => normalise(l.name) === normalise(name));
    if (duplicate) { showWarning(input, `A list called "${duplicate.name}" already exists.`); input.focus(); return; }
    clearWarning(input);
    const rawCat    = document.getElementById('new-list-category')?.value || 'General';
    const customCat = document.getElementById('new-category-input')?.value.trim();
    const category  = (rawCat === '__new__') ? (customCat || 'General') : rawCat;
    if (useCloud) {
        const { data, error } = await window.supabase.from('lists').insert({ user_id: currentUser.id, name, category }).select().single();
        if (error) { console.error(error); return; }
        lists.push({ id: data.id, name: data.name, category: data.category });
        activeListId = data.id;
    } else {
        const list = { id: nextListId++, name, category };
        lists.push(list);
        activeListId = list.id;
        save();
    }
    activeView = 'all';
    logChange(`Created list: "${name}"`);
    input.value = '';
    render();
}

// ── DELETE — List ────────────────────────────
async function deleteList(id) {
    const list = lists.find(l => l.id === id);
    if (!list) return;
    if (!confirm(`Delete the list "${list.name}" and all its tasks?`)) return;
    if (useCloud) {
        await window.supabase.from('lists').delete().eq('id', id);
    } else {
        todos = todos.filter(t => t.listId !== id);
        save();
    }
    lists = lists.filter(l => l.id !== id);
    todos = todos.filter(t => t.listId !== id);
    if (activeListId === id) activeListId = lists.length ? lists[0].id : null;
    logChange(`Deleted list: "${list.name}"`);
    render();
}

// ── CREATE — Task ─────────────────────────────
async function addTodo() {
    if (!activeListId) return;
    const input = document.getElementById('new-todo');
    if (!input) return;
    const text = input.value.trim();
    if (!text) { showWarning(input, 'Please enter a task.'); input.focus(); return; }
    if (text.length > 200) { showWarning(input, 'Task must be 200 characters or fewer.'); input.focus(); return; }
    const activeTasks = todos.filter(t => t.listId === activeListId && !t.deleted && !t.parentId);
    const duplicate = activeTasks.find(t => normalise(t.text) === normalise(text));
    if (duplicate) { showWarning(input, 'That task already exists in this list.'); input.focus(); return; }
    clearWarning(input);
    if (useCloud) {
        const { data, error } = await window.supabase.from('todos').insert({ user_id: currentUser.id, list_id: activeListId, text, done: false, deleted: false, parent_id: null, due_date: null, due_time: null }).select().single();
        if (error) { console.error(error); return; }
        todos.push({ id: data.id, listId: data.list_id, parentId: null, text: data.text, done: false, deleted: false, editing: false, dueDate: null, dueTime: null });
    } else {
        const todo = { id: nextTodoId++, listId: activeListId, parentId: null, text, done: false, deleted: false, editing: false, dueDate: null, dueTime: null };
        todos.push(todo);
        save();
    }
    logChange(`Added: "${text}"`);
    input.value = '';
    render();
}

// ── CREATE — Subtask ──────────────────────────
async function addSubtask(parentId, text) {
    if (!text) return;
    const parent = todos.find(t => t.id === parentId);
    if (!parent) return;
    if (useCloud) {
        const { data, error } = await window.supabase.from('todos').insert({
            user_id:   currentUser.id,
            list_id:   parent.listId,
            parent_id: parentId,
            text,
            done:      false,
            deleted:   false
        }).select().single();
        if (error) { console.error(error); return; }
        todos.push({ id: data.id, listId: data.list_id, parentId: data.parent_id, text: data.text, done: false, deleted: false, editing: false });
    } else {
        const subtask = { id: nextTodoId++, listId: parent.listId, parentId, text, done: false, deleted: false, editing: false };
        todos.push(subtask);
        save();
    }
    logChange(`Added subtask: "${text}"`);
    render();
}

// ── TOGGLE — Subtask ──────────────────────────
async function toggleSubtask(id) {
    const subtask = todos.find(t => t.id === id);
    if (!subtask) return;
    subtask.done = !subtask.done;
    if (useCloud) {
        await window.supabase.from('todos').update({ done: subtask.done }).eq('id', id);
    } else {
        save();
    }
    render();
}

// ── DELETE — Subtask ──────────────────────────
async function deleteSubtask(id) {
    const subtask = todos.find(t => t.id === id);
    if (!subtask) return;
    if (useCloud) {
        await window.supabase.from('todos').delete().eq('id', id);
    }
    todos = todos.filter(t => t.id !== id);
    if (!useCloud) save();
    logChange(`Removed subtask: "${subtask.text}"`);
    render();
}

// ── READ (render) ─────────────────────────────
const viewTitles = { home: 'My To-Do Lists', all: 'View Lists', completed: 'Completed Tasks', deleted: 'Deleted Tasks', log: 'Recent Changes' };

function render() {
    if (activeListId !== null) localStorage.setItem('krhdev-active-list', activeListId);
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = viewTitles[activeView] || 'My To-Do Lists';
    document.querySelectorAll('[data-view]').forEach(link => {
        link.classList.toggle('active', link.dataset.view === activeView);
    });

    const focusHidden   = localStorage.getItem('krhdev-focus-hidden') === 'true';
    const focusStatBtn  = document.getElementById('focus-toggle-stat-btn');
    if (focusStatBtn) {
        focusStatBtn.textContent = focusHidden ? 'Off' : 'On';
        focusStatBtn.classList.toggle('off', focusHidden);
    }
    const focusShowBtn = document.getElementById('focus-show-btn');
    if (focusShowBtn) focusShowBtn.style.display = focusHidden ? 'inline-block' : 'none';

    renderUpcomingPanel();
    renderFocusCard();
    renderListTabs();
    renderTaskWidgets();
    renderLog();
    updateStats();
}

function renderListTabs() {
    const tabsEl         = document.getElementById('list-tabs');
    const selectorWidget = document.getElementById('widget-list-selector');
    const pillsEl        = document.getElementById('category-pills');
    if (!tabsEl || !selectorWidget) return;
    if (lists.length === 0) { selectorWidget.style.display = 'none'; return; }
    selectorWidget.style.display = 'block';
    tabsEl.innerHTML = '';

    if (pillsEl) {
        pillsEl.innerHTML = '';
        const categories = ['All', ...new Set(lists.map(l => l.category || 'General'))];
        const firstCat   = categories.find(c => c !== 'All') || 'All';
        const activeCat  = pillsEl.dataset.active || firstCat;

        categories.forEach(cat => {
            const count = cat === 'All'
                ? lists.length
                : lists.filter(l => (l.category || 'General') === cat).length;
            const pill = document.createElement('button');
            pill.className = 'category-pill' + (activeCat === cat ? ' active' : '');
            pill.innerHTML = `${cat} <span class="pill-count">${count}</span>`;

            pill.addEventListener('click', () => {
                if (cat === 'All') {
                    if (activeCat === 'All') {
                        const firstReal = categories.find(c => c !== 'All');
                        pillsEl.dataset.active = firstReal || 'All';
                    } else {
                        pillsEl.dataset.active = 'All';
                    }
                } else {
                    pillsEl.dataset.active = cat;
                }
                renderListTabs();
            });
            pillsEl.appendChild(pill);
        });

        const visibleLists = activeCat === 'All' ? lists : lists.filter(l => (l.category || 'General') === activeCat);

        const activeListInView = visibleLists.find(l => l.id === activeListId);
        if (!activeListInView && visibleLists.length > 0) {
            activeListId = visibleLists[0].id;
            activeView = 'all';
            setTimeout(() => render(), 0);
        }

        visibleLists.forEach(list => {
            const taskCount = todos.filter(t => t.listId === list.id && !t.done && !t.deleted && !t.parentId).length;
            const btn = document.createElement('button');
            btn.className = 'list-tab' + (list.id === activeListId ? ' active' : '');
            const nameSpan = document.createElement('span');
            nameSpan.textContent = list.name;
            btn.appendChild(nameSpan);
            if (taskCount > 0) {
                const countBadge = document.createElement('span');
                countBadge.className = 'list-tab-count';
                countBadge.textContent = taskCount;
                btn.appendChild(countBadge);
            }
            const delBtn = document.createElement('button');
            delBtn.className = 'list-tab-delete';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete this list';
            delBtn.addEventListener('click', e => { e.stopPropagation(); deleteList(list.id); });
            btn.appendChild(delBtn);
            btn.addEventListener('click', () => { activeListId = list.id; activeView = 'all'; render(); });
            btn.addEventListener('dragover', e => { e.preventDefault(); btn.classList.add('drag-over'); });
            btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
            btn.addEventListener('drop', e => {
                e.preventDefault();
                btn.classList.remove('drag-over');
                const todoId = e.dataTransfer.getData('text/plain');
                if (todoId) moveTask(todoId, list.id);
            });
            tabsEl.appendChild(btn);
        });
    }
}

function renderTaskWidgets() {
    const addWidget       = document.getElementById('widget-add-task');
    const allWidget       = document.getElementById('widget-all');
    const completedWidget = document.getElementById('widget-completed');
    const deletedWidget   = document.getElementById('widget-deleted');
    const logWidget       = document.getElementById('widget-log');
    const label           = document.getElementById('active-list-label');
    const hasList = activeListId !== null;
    if (addWidget)       addWidget.style.display       = (hasList && activeView === 'all')       ? 'block' : 'none';
    if (allWidget)       allWidget.style.display       = (hasList && activeView === 'all')       ? 'block' : 'none';
    if (completedWidget) completedWidget.style.display = (hasList && activeView === 'completed') ? 'block' : 'none';
    if (deletedWidget)   deletedWidget.style.display   = (hasList && activeView === 'deleted')   ? 'block' : 'none';
    if (logWidget)       logWidget.style.display       = (activeView === 'log')                  ? 'block' : 'none';
    if (!hasList) return;
    const activeList = lists.find(l => l.id === activeListId);
    if (label && activeList) label.textContent = `— ${activeList.name}`;
    
    const listTodos = todos.filter(t => t.listId === activeListId && !t.parentId);
    const activeSorted = listTodos
        .filter(t => !t.deleted && !t.parentId)
        .sort((a, b) => {
            if (a.done && !b.done) return 1;
            if (!a.done && b.done) return -1;
            if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
            if (a.dueDate) return -1;
            if (b.dueDate) return 1;
            return 0;
        });

    renderList('list-container',           'empty-active',    activeSorted, renderActiveItem);
    renderList('completed-list-container', 'empty-completed', listTodos.filter(t => t.done && !t.deleted && !t.parentId),  renderCompletedItem);
    renderList('deleted-list-container',   'empty-deleted',   listTodos.filter(t => t.deleted && !t.parentId),             renderDeletedItem);
    const clearBtn = document.getElementById('clear-deleted-btn');
    if (clearBtn) clearBtn.style.display = listTodos.some(t => t.deleted) ? 'inline-block' : 'none';
}

function renderList(listId, emptyId, items, itemRenderer) {
    const list  = document.getElementById(listId);
    const empty = document.getElementById(emptyId);
    if (!list) return;
    list.innerHTML = '';
    list.className = 'task-list';
    if (empty) empty.style.display = items.length ? 'none' : 'block';
    items.forEach(todo => list.appendChild(itemRenderer(todo)));
}

// ── Subtask renderer ──────────────────────────
function renderSubtasks(parentId, container) {
    const subtasks = todos.filter(t => t.parentId === parentId && !t.deleted);
    if (subtasks.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'subtask-list';
        subtasks.forEach(sub => {
            const li = document.createElement('li');
            li.className = 'subtask-item' + (sub.done ? ' done' : '');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = sub.done;
            cb.addEventListener('change', () => toggleSubtask(sub.id));
            const span = document.createElement('span');
            span.className = 'subtask-text';
            span.textContent = sub.text;
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-subtask-delete';
            delBtn.textContent = '✕';
            delBtn.title = 'Remove subtask';
            delBtn.addEventListener('click', () => deleteSubtask(sub.id));
            li.appendChild(cb);
            li.appendChild(span);
            li.appendChild(delBtn);
            ul.appendChild(li);
        });
        container.appendChild(ul);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add-subtask';
    addBtn.textContent = '+ Add subtask';
    addBtn.addEventListener('click', () => {
        addBtn.style.display = 'none';
        const row = document.createElement('div');
        row.className = 'subtask-input-row';
        const inp = document.createElement('input');
        inp.className = 'subtask-input';
        inp.placeholder = 'Subtask...';
        inp.type = 'text';
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn-add-subtask';
        confirmBtn.textContent = 'Add';
        confirmBtn.style.marginLeft = '6px';

        const doAdd = async () => {
            const val = inp.value.trim();
            if (val) await addSubtask(parentId, val);
            else { row.remove(); addBtn.style.display = ''; }
        };

        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
            if (e.key === 'Escape') { row.remove(); addBtn.style.display = ''; }
        });
        confirmBtn.addEventListener('click', doAdd);
        row.appendChild(inp);
        row.appendChild(confirmBtn);
        container.appendChild(row);
        inp.focus();
    });
    container.appendChild(addBtn);
}

// ── Item renderers ────────────────────────────
function renderActiveItem(todo) {
    const wrapper = document.createElement('div');
    wrapper.className = 'subtask-container';

    const li = document.createElement('li');
    li.className = 'task-item';
    li.dataset.id = todo.id;

    if (todo.editing) {
        const editInput = document.createElement('input');
        editInput.type = 'text'; editInput.className = 'edit-input'; editInput.value = todo.text;
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-save'; saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', () => saveEdit(todo.id, editInput.value));
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-cancel'; cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => cancelEdit(todo.id));
        editInput.addEventListener('keydown', e => {
            if (e.key === 'Enter')  saveEdit(todo.id, editInput.value);
            if (e.key === 'Escape') cancelEdit(todo.id);
        });
        li.appendChild(editInput); li.appendChild(saveBtn); li.appendChild(cancelBtn);
        setTimeout(() => { editInput.focus(); editInput.select(); }, 0);
    } else {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = todo.done;
        checkbox.addEventListener('change', () => toggleDone(todo.id));
        const span = document.createElement('span');
        span.className = 'task-text' + (todo.done ? ' done' : ''); span.textContent = todo.text;

        const subtasks = todos.filter(t => t.parentId === todo.id && !t.deleted);
        if (subtasks.length > 0) {
            const done = subtasks.filter(t => t.done).length;
            const prog = document.createElement('span');
            prog.className = 'subtask-progress';
            prog.textContent = `${done}/${subtasks.length}`;
            span.textContent = todo.text + ' ';
            span.appendChild(prog);
        }

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit'; editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => startEdit(todo.id));
        const moveBtn = document.createElement('button');
        moveBtn.className = 'btn-move';
        moveBtn.textContent = '→';
        moveBtn.title = 'Move to another list';
        moveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const existing = li.querySelector('.move-select');
            if (existing) { existing.remove(); return; }
            const sel = document.createElement('select');
            sel.className = 'move-select';
            const defaultOpt = document.createElement('option');
            defaultOpt.value = ''; defaultOpt.textContent = 'Move to...';
            sel.appendChild(defaultOpt);
            lists.filter(l => l.id !== todo.listId).forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.id; opt.textContent = l.name;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', () => { if (sel.value) moveTask(todo.id, sel.value); });
            li.appendChild(sel);
            sel.focus();
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete'; deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

        const dueDateWrapper = document.createElement('div');
        dueDateWrapper.style.position = 'relative';
        dueDateWrapper.style.flexShrink = '0';
        const dueBtn = document.createElement('button');
        dueBtn.className = 'due-date-btn';
        if (todo.dueDate) {
            dueBtn.textContent = formatDueDate(todo);
            if (isOverdue(todo)) dueBtn.classList.add('overdue');
            else if (isDueSoon(todo)) dueBtn.classList.add('due-soon');
            else dueBtn.classList.add('has-date');
        } else {
            dueBtn.textContent = '📅';
            dueBtn.title = 'Set due date';
        }
        dueBtn.addEventListener('click', e => { e.stopPropagation(); showDueDatePicker(todo, dueDateWrapper); });
        dueDateWrapper.appendChild(dueBtn);

        if (isOverdue(todo)) {
            const badge = document.createElement('span');
            badge.className = 'overdue-badge';
            badge.textContent = 'Overdue';
            span.appendChild(badge);
            li.classList.add('overdue');
        }

        li.appendChild(checkbox); li.appendChild(span); li.appendChild(dueDateWrapper); li.appendChild(editBtn); li.appendChild(moveBtn); li.appendChild(deleteBtn);

        li.setAttribute('draggable', 'true');
        li.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', todo.id); li.classList.add('dragging'); });
        li.addEventListener('dragend', () => li.classList.remove('dragging'));
    }

    wrapper.appendChild(li);
    renderSubtasks(todo.id, wrapper);
    return wrapper;
}

function renderCompletedItem(todo) {
    const li = document.createElement('li'); li.className = 'task-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = true;
    checkbox.addEventListener('change', () => toggleDone(todo.id));
    const span = document.createElement('span');
    span.className = 'task-text done'; span.textContent = todo.text;
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete'; deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteTodo(todo.id));
    li.appendChild(checkbox); li.appendChild(span); li.appendChild(deleteBtn);
    return li;
}

function renderDeletedItem(todo) {
    const li = document.createElement('li'); li.className = 'task-item deleted';
    const span = document.createElement('span');
    span.className = 'task-text'; span.textContent = todo.text;
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn-restore'; restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => restoreTodo(todo.id));
    li.appendChild(span); li.appendChild(restoreBtn);
    return li;
}

// ── UPDATE ────────────────────────────────────
async function toggleDone(id) {
    const todo = todos.find(t => String(t.id) === String(id));
    if (!todo) return;
    todo.done = !todo.done;
    if (useCloud) { await window.supabase.from('todos').update({ done: todo.done }).eq('id', id); } else { save(); }
    logChange(todo.done ? `Completed: "${todo.text}"` : `Reopened: "${todo.text}"`);

    const listTasks = todos.filter(t => t.listId === todo.listId && !t.deleted && !t.parentId);
    if (listTasks.length > 0 && listTasks.every(t => t.done)) {
        activeView = 'completed';
        logChange(`List complete! All tasks done.`);
    }

    render();
}

function startEdit(id) { todos.forEach(t => { t.editing = (String(t.id) === String(id)); }); render(); }

async function saveEdit(id, newText) {
    const text = newText.trim();
    const todo = todos.find(t => String(t.id) === String(id));
    if (!todo) return;
    const li = document.querySelector(`.task-item[data-id="${id}"]`);
    const editInput = li ? li.querySelector('.edit-input') : null;
    if (!text) { if (editInput) { showWarning(editInput, 'Task cannot be empty.'); editInput.focus(); } return; }
    if (text.length > 200) { if (editInput) { showWarning(editInput, 'Task must be 200 characters or fewer.'); editInput.focus(); } return; }
    const activeTasks = todos.filter(t => t.listId === todo.listId && !t.deleted && String(t.id) !== String(id) && !t.parentId);
    const duplicate = activeTasks.find(t => normalise(t.text) === normalise(text));
    if (duplicate) { if (editInput) { showWarning(editInput, 'Another task with that name already exists.'); editInput.focus(); } return; }
    const old = todo.text;
    todo.text = text; todo.editing = false;
    if (useCloud) { await window.supabase.from('todos').update({ text }).eq('id', id); } else { save(); }
    logChange(`Edited: "${old}" → "${text}"`);
    render();
}

function cancelEdit(id) { const todo = todos.find(t => String(t.id) === String(id)); if (todo) { todo.editing = false; render(); } }

// ── MOVE TASK ─────────────────────────────────
async function moveTask(todoId, targetListId) {
    const todo = todos.find(t => String(t.id) === String(todoId));
    if (!todo) return;
    todo.listId = targetListId;
    if (useCloud) {
        await window.supabase.from('todos').update({ list_id: targetListId }).eq('id', todo.id);
    } else {
        save();
    }
    logChange(`Moved: "${todo.text}"`);
    render();
}

// ── DELETE / RESTORE ──────────────────────────
async function deleteTodo(id) {
    const todo = todos.find(t => String(t.id) === String(id));
    if (!todo) return;
    todo.deleted = true; todo.done = false; todo.editing = false;
    if (useCloud) { await window.supabase.from('todos').update({ deleted: true, done: false }).eq('id', id); } else { save(); }
    logChange(`Deleted: "${todo.text}"`);
    render();
}

async function restoreTodo(id) {
    const todo = todos.find(t => String(t.id) === String(id));
    if (!todo) return;
    todo.deleted = false;
    if (useCloud) { await window.supabase.from('todos').update({ deleted: false }).eq('id', id); } else { save(); }
    logChange(`Restored: "${todo.text}"`);
    render();
}

async function clearDeleted() {
    if (!confirm('Permanently remove all deleted tasks from this list?')) return;
    const toRemove = todos.filter(t => t.listId === activeListId && t.deleted);
    if (useCloud) {
        for (const t of toRemove) await window.supabase.from('todos').delete().eq('id', t.id);
    }
    todos = todos.filter(t => !(t.listId === activeListId && t.deleted));
    if (!useCloud) save();
    logChange('Cleared all deleted tasks');
    render();
}

// ── DUE DATE PICKER & CALCULATIONS ───────────
function isOverdue(todo) {
    if (!todo.dueDate || todo.done || todo.deleted) return false;
    const now = new Date();
    const due = new Date(`${todo.dueDate}T${todo.dueTime || '23:59:59'}`);
    return due < now;
}

function isDueSoon(todo) {
    if (!todo.dueDate || todo.done || todo.deleted || isOverdue(todo)) return false;
    const now = new Date();
    const due = new Date(`${todo.dueDate}T${todo.dueTime || '23:59:59'}`);
    const diffHours = (due - now) / (1000 * 60 * 60);
    return diffHours <= 24 && diffHours >= 0;
}

function formatDueDate(todo) {
    if (!todo.dueDate) return '';
    const date = new Date(todo.dueDate);
    let str = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (todo.dueTime) str += ` ${todo.dueTime}`;
    return str;
}

function showDueDatePicker(todo, container) {
    const existing = container.querySelector('.due-picker-popover');
    if (existing) { existing.remove(); return; }

    const popover = document.createElement('div');
    popover.className = 'due-picker-popover';
    
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = todo.dueDate || '';

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = todo.dueTime || '';

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '6px';
    btnRow.style.marginTop = '6px';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
        todo.dueDate = dateInput.value || null;
        todo.dueTime = timeInput.value || null;
        if (useCloud) {
            await window.supabase.from('todos').update({ due_date: todo.dueDate, due_time: todo.dueTime }).eq('id', todo.id);
        } else {
            save();
        }
        popover.remove();
        render();
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.className = 'btn-secondary';
    clearBtn.addEventListener('click', async () => {
        todo.dueDate = null;
        todo.dueTime = null;
        if (useCloud) {
            await window.supabase.from('todos').update({ due_date: null, due_time: null }).eq('id', todo.id);
        } else {
            save();
        }
        popover.remove();
        render();
    });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(clearBtn);
    popover.appendChild(dateInput);
    popover.appendChild(timeInput);
    popover.appendChild(btnRow);
    container.appendChild(popover);
}

// ── FOCUS TASK WIDGET ─────────────────────────
function renderFocusCard() {
    const focusWidget = document.getElementById('widget-focus');
    if (!focusWidget) return;
    const focusHidden = localStorage.getItem('krhdev-focus-hidden') === 'true';
    if (focusHidden || !focusEnabled) { focusWidget.style.display = 'none'; return; }

    const activeTasks = todos.filter(t => !t.done && !t.deleted && !t.parentId);
    if (!activeTasks.length) { focusWidget.style.display = 'none'; return; }

    let currentFocus = activeTasks.find(t => String(t.id) === String(focusTaskId));
    if (!currentFocus) {
        currentFocus = activeTasks[Math.floor(Math.random() * activeTasks.length)];
        focusTaskId = currentFocus.id;
        localStorage.setItem('krhdev-focus-task', focusTaskId);
    }

    const listName = lists.find(l => l.id === currentFocus.listId)?.name || 'General';
    const focusListName = document.getElementById('focus-list-name');
    const focusTaskText = document.getElementById('focus-task-text');

    if (focusListName) focusListName.textContent = `LIST: ${listName.toUpperCase()}`;
    if (focusTaskText) focusTaskText.textContent = currentFocus.text;

    focusWidget.style.display = 'block';
}

function rerollFocusTask() {
    const activeTasks = todos.filter(t => !t.done && !t.deleted && !t.parentId && String(t.id) !== String(focusTaskId));
    if (activeTasks.length > 0) {
        const next = activeTasks[Math.floor(Math.random() * activeTasks.length)];
        focusTaskId = next.id;
        localStorage.setItem('krhdev-focus-task', focusTaskId);
        render();
    }
}

// ── UPCOMING & OVERDUE PANEL ──────────────────
function renderUpcomingPanel() {
    const panel = document.getElementById('widget-upcoming');
    const listEl = document.getElementById('upcoming-list');
    if (!panel || !listEl) return;

    const urgentTasks = todos.filter(t => !t.done && !t.deleted && !t.parentId && t.dueDate && (isOverdue(t) || isDueSoon(t)));
    if (!urgentTasks.length) { panel.style.display = 'none'; return; }

    listEl.innerHTML = '';
    urgentTasks.forEach(t => {
        const li = document.createElement('li');
        li.className = 'upcoming-item' + (isOverdue(t) ? ' overdue' : '');
        li.textContent = `${t.text} (${formatDueDate(t)})`;
        li.addEventListener('click', () => { activeListId = t.listId; activeView = 'all'; render(); });
        listEl.appendChild(li);
    });

    panel.style.display = 'block';
}

// ── SIDEBAR STATS ──────────────────────────────
function updateStats() {
    const activeCount = todos.filter(t => !t.done && !t.deleted && !t.parentId).length;
    const doneCount   = todos.filter(t => t.done && !t.deleted && !t.parentId).length;
    const overdueCount = todos.filter(t => isOverdue(t)).length;
    
    const listsCompleted = lists.filter(l => {
        const lTasks = todos.filter(t => t.listId === l.id && !t.deleted && !t.parentId);
        return lTasks.length > 0 && lTasks.every(t => t.done);
    }).length;

    const elLists = document.getElementById('stat-lists');
    const elActive = document.getElementById('stat-active');
    const elDone = document.getElementById('stat-done');
    const elListsDone = document.getElementById('stat-lists-done');
    const elOverdue = document.getElementById('stat-overdue');

    if (elLists) elLists.textContent = lists.length;
    if (elActive) elActive.textContent = activeCount;
    if (elDone) elDone.textContent = doneCount;
    if (elListsDone) elListsDone.textContent = listsCompleted;
    if (elOverdue) elOverdue.textContent = overdueCount;
}

// ── AUTH & OVERLAY HANDLERS ────────────────────
function initAuth() {
    const overlay = document.getElementById('auth-overlay');
    const skipBtn = document.getElementById('auth-skip-btn');
    const submitBtn = document.getElementById('auth-submit-btn');

    if (!overlay) return;

    // Direct Overlay visibility
    overlay.style.display = 'flex';

    if (skipBtn) {
        skipBtn.addEventListener('click', () => {
            useCloud = false;
            overlay.style.display = 'none';
            render();
        });
    }

    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            const email = document.getElementById('auth-email')?.value.trim();
            const password = document.getElementById('auth-password')?.value.trim();
            const msg = document.getElementById('auth-msg');

            if (!email || !password) {
                if (msg) msg.textContent = 'Please enter both email and password.';
                return;
            }

            const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
            if (error) {
                if (msg) msg.textContent = error.message;
            } else {
                currentUser = data.user;
                useCloud = true;
                overlay.style.display = 'none';
                await loadFromCloud();
            }
        });
    }
}

// ── APPLICATION INITIALISATION ─────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    initAuth();

    // Event listeners for Create List & Add Task
    document.getElementById('add-list-btn')?.addEventListener('click', addList);
    document.getElementById('new-list')?.addEventListener('keydown', e => { if (e.key === 'Enter') addList(); });

    document.getElementById('add-btn')?.addEventListener('click', addTodo);
    document.getElementById('new-todo')?.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });

    document.getElementById('clear-deleted-btn')?.addEventListener('click', clearDeleted);

    // Sidebar navigation bindings
    document.querySelectorAll('[data-view]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            activeView = link.dataset.view;
            render();
        });
    });

    // Sidebar Toggle (Mobile view)
    const sidebar = document.getElementById('sidebar');
    document.getElementById('sidebar-open')?.addEventListener('click', () => sidebar?.classList.add('open'));
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => sidebar?.classList.remove('open'));

    // Category Selector Switch
    document.getElementById('new-list-category')?.addEventListener('change', e => {
        const catRow = document.getElementById('new-category-row');
        if (catRow) catRow.style.display = (e.target.value === '__new__') ? 'flex' : 'none';
    });

    // Focus Task Controls
    document.getElementById('focus-reroll-btn')?.addEventListener('click', rerollFocusTask);
    document.getElementById('focus-done-btn')?.addEventListener('click', () => {
        if (focusTaskId) toggleDone(focusTaskId);
    });
    document.getElementById('focus-clear-btn')?.addEventListener('click', () => {
        focusTaskId = null;
        localStorage.removeItem('krhdev-focus-task');
        render();
    });
    document.getElementById('focus-toggle-btn')?.addEventListener('click', () => {
        localStorage.setItem('krhdev-focus-hidden', 'true');
        render();
    });
    document.getElementById('focus-show-btn')?.addEventListener('click', () => {
        localStorage.setItem('krhdev-focus-hidden', 'false');
        render();
    });
    document.getElementById('focus-toggle-stat-btn')?.addEventListener('click', () => {
        const isHidden = localStorage.getItem('krhdev-focus-hidden') === 'true';
        localStorage.setItem('krhdev-focus-hidden', isHidden ? 'false' : 'true');
        render();
    });

    render();
});