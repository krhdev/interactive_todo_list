// ─────────────────────────────────────────────
//  KRHDev Todo App  –  script.js
//  CRUD: Create · Read · Update · Delete
//  Features: Named lists · Light/Dark mode · Mobile friendly
//             Change log · Local storage · Supabase cloud sync
//  Validation: Empty input blocked · Warnings shown · Duplicate prevention
// ─────────────────────────────────────────────

// ── Auth state ───────────────────────────────
let currentUser = null;
let useCloud    = false;

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
let focusTaskId  = localStorage.getItem('krhdev-focus-task') || null;

function save() {
    localStorage.setItem('krhdev-lists', JSON.stringify(lists));
    localStorage.setItem('krhdev-todos', JSON.stringify(todos));
}

// ── Auto-reset Daily / Weekly lists ─────────
async function checkAndReset() {
    const now       = new Date();
    const todayStr  = now.toISOString().slice(0, 10); // "2026-07-02"
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday

    // ── Daily reset ──
    const lastDaily = localStorage.getItem('krhdev-last-daily-reset');
    if (lastDaily !== todayStr) {
        const dailyLists = lists.filter(l => (l.category || '') === 'Daily');
        for (const list of dailyLists) {
            const toReset = todos.filter(t => t.listId === list.id && t.done && !t.deleted);
            for (const todo of toReset) {
                todo.done = false;
                if (useCloud) {
                    await window.supabase.from('todos').update({ done: false }).eq('id', todo.id);
                }
            }
            if (toReset.length) logChange(`Daily reset: "${list.name}" — ${toReset.length} task(s) reset`);
        }
        localStorage.setItem('krhdev-last-daily-reset', todayStr);
        if (!useCloud) save();
    }

    // ── Weekly reset — runs on Monday ──
    const lastWeekly = localStorage.getItem('krhdev-last-weekly-reset');
    const thisMonday = getThisMonday();
    if (dayOfWeek === 1 && lastWeekly !== thisMonday) {
        const weeklyLists = lists.filter(l => (l.category || '') === 'Weekly');
        for (const list of weeklyLists) {
            const toReset = todos.filter(t => t.listId === list.id && t.done && !t.deleted);
            for (const todo of toReset) {
                todo.done = false;
                if (useCloud) {
                    await window.supabase.from('todos').update({ done: false }).eq('id', todo.id);
                }
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
    const { data: cloudLists, error: le } = await supabase.from('lists').select('*').order('created_at');
    const { data: cloudTodos, error: te } = await supabase.from('todos').select('*').order('created_at');
    if (le || te) { console.error('Cloud load error', le || te); return; }
    lists = (cloudLists || []).map(l => ({ id: l.id, name: l.name, category: l.category || 'General' }));
    todos = (cloudTodos || []).map(t => ({ id: t.id, listId: t.list_id, text: t.text, done: t.done, deleted: t.deleted, editing: false }));
    activeListId = lists.length ? lists[0].id : null;
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
        const { data, error } = await supabase.from('lists').insert({ user_id: currentUser.id, name, category }).select().single();
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
        await supabase.from('lists').delete().eq('id', id);
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
    const activeTasks = todos.filter(t => t.listId === activeListId && !t.deleted);
    const duplicate = activeTasks.find(t => normalise(t.text) === normalise(text));
    if (duplicate) { showWarning(input, 'That task already exists in this list.'); input.focus(); return; }
    clearWarning(input);
    if (useCloud) {
        const { data, error } = await supabase.from('todos').insert({ user_id: currentUser.id, list_id: activeListId, text, done: false, deleted: false }).select().single();
        if (error) { console.error(error); return; }
        todos.push({ id: data.id, listId: data.list_id, text: data.text, done: false, deleted: false, editing: false });
    } else {
        const todo = { id: nextTodoId++, listId: activeListId, text, done: false, deleted: false, editing: false };
        todos.push(todo);
        save();
    }
    logChange(`Added: "${text}"`);
    input.value = '';
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

    // ── Category pills ──
    if (pillsEl) {
        pillsEl.innerHTML = '';
        const categories = ['All', ...new Set(lists.map(l => l.category || 'General'))];
        const activeCat  = pillsEl.dataset.active || 'All';

        categories.forEach(cat => {
            const count = cat === 'All'
                ? lists.length
                : lists.filter(l => (l.category || 'General') === cat).length;

            const pill = document.createElement('button');
            pill.className = 'category-pill' + (activeCat === cat ? ' active' : '');
            pill.innerHTML = `${cat} <span class="pill-count">${count}</span>`;
            pill.addEventListener('click', () => {
                pillsEl.dataset.active = cat;
                renderListTabs();
            });
            pillsEl.appendChild(pill);
        });

        // Filter lists by active category
        const activeCategory = activeCat;
        const visibleLists = activeCategory === 'All' ? lists : lists.filter(l => (l.category || 'General') === activeCategory);

        visibleLists.forEach(list => {
            const taskCount = todos.filter(t => t.listId === list.id && !t.done && !t.deleted).length;
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

            // Drop target
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
    const listTodos = todos.filter(t => t.listId === activeListId);
    renderList('list-container',           'empty-active',    listTodos.filter(t => !t.done && !t.deleted), renderActiveItem);
    renderList('completed-list-container', 'empty-completed', listTodos.filter(t => t.done && !t.deleted),  renderCompletedItem);
    renderList('deleted-list-container',   'empty-deleted',   listTodos.filter(t => t.deleted),             renderDeletedItem);
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

// ── Item renderers ────────────────────────────
function renderActiveItem(todo) {
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
        checkbox.addEventListener('change', () => toggleDone(todo.id));
        const span = document.createElement('span');
        span.className = 'task-text'; span.textContent = todo.text;
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit'; editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => startEdit(todo.id));
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete'; deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteTodo(todo.id));
        // Move button — shows a select dropdown
        const moveBtn = document.createElement('button');
        moveBtn.className = 'btn-move';
        moveBtn.textContent = '→';
        moveBtn.title = 'Move to another list';
        moveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Remove any existing move select
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

            sel.addEventListener('change', () => {
                if (sel.value) moveTask(todo.id, sel.value);
            });

            li.appendChild(sel);
            sel.focus();
        });

        li.appendChild(checkbox); li.appendChild(span); li.appendChild(editBtn); li.appendChild(moveBtn); li.appendChild(deleteBtn);

        // Drag and drop
        li.setAttribute('draggable', 'true');
        li.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', todo.id);
            li.classList.add('dragging');
        });
        li.addEventListener('dragend', () => li.classList.remove('dragging'));
    }
    return li;
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
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.done = !todo.done;
    if (useCloud) { await supabase.from('todos').update({ done: todo.done }).eq('id', id); } else { save(); }
    logChange(todo.done ? `Completed: "${todo.text}"` : `Reopened: "${todo.text}"`);
    render();
}

function startEdit(id) { todos.forEach(t => { t.editing = (t.id === id); }); render(); }

async function saveEdit(id, newText) {
    const text = newText.trim();
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const li = document.querySelector(`.task-item[data-id="${id}"]`);
    const editInput = li ? li.querySelector('.edit-input') : null;
    if (!text) { if (editInput) { showWarning(editInput, 'Task cannot be empty.'); editInput.focus(); } return; }
    if (text.length > 200) { if (editInput) { showWarning(editInput, 'Task must be 200 characters or fewer.'); editInput.focus(); } return; }
    const activeTasks = todos.filter(t => t.listId === todo.listId && !t.deleted && t.id !== id);
    const duplicate = activeTasks.find(t => normalise(t.text) === normalise(text));
    if (duplicate) { if (editInput) { showWarning(editInput, 'Another task with that name already exists.'); editInput.focus(); } return; }
    const old = todo.text;
    todo.text = text; todo.editing = false;
    if (useCloud) { await supabase.from('todos').update({ text }).eq('id', id); } else { save(); }
    logChange(`Edited: "${old}" → "${text}"`);
    render();
}

function cancelEdit(id) { const todo = todos.find(t => t.id === id); if (todo) { todo.editing = false; render(); } }

// ── DELETE ────────────────────────────────────
async function deleteTodo(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.deleted = true; todo.done = false; todo.editing = false;
    if (useCloud) { await supabase.from('todos').update({ deleted: true, done: false }).eq('id', id); } else { save(); }
    logChange(`Deleted: "${todo.text}"`);
    render();
}

async function restoreTodo(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.deleted = false;
    if (useCloud) { await supabase.from('todos').update({ deleted: false }).eq('id', id); } else { save(); }
    logChange(`Restored: "${todo.text}"`);
    render();
}

async function clearDeleted() {
    if (!activeListId) return;
    const toDelete = todos.filter(t => t.listId === activeListId && t.deleted);
    const count = toDelete.length;
    if (useCloud) { for (const t of toDelete) { await supabase.from('todos').delete().eq('id', t.id); } }
    todos = todos.filter(t => !(t.listId === activeListId && t.deleted));
    if (!useCloud) save();
    logChange(`Permanently removed ${count} deleted task(s)`);
    render();
}

// ── Stats ─────────────────────────────────────
function updateStats() {
    const activeTodos    = todos.filter(t => !t.done && !t.deleted);
    const doneTodos      = todos.filter(t => t.done && !t.deleted);
    const completedLists = lists.filter(l => {
        const listTasks = todos.filter(t => t.listId === l.id && !t.deleted);
        return listTasks.length > 0 && listTasks.every(t => t.done);
    });
    const listsEl     = document.getElementById('stat-lists');
    const activeEl    = document.getElementById('stat-active');
    const doneEl      = document.getElementById('stat-done');
    const listsDoneEl = document.getElementById('stat-lists-done');
    if (listsEl)     listsEl.textContent     = lists.length;
    if (activeEl)    activeEl.textContent    = activeTodos.length;
    if (doneEl)      doneEl.textContent      = doneTodos.length;
    if (listsDoneEl) listsDoneEl.textContent = completedLists.length;
}

// ── Change log ────────────────────────────────
function renderLog() {
    const log       = JSON.parse(localStorage.getItem('krhdev-log') || '[]');
    const container = document.getElementById('recent-changes-container');
    const emptyLog  = document.getElementById('empty-log');
    if (!container) return;
    container.innerHTML = ''; container.className = 'log-list';
    if (emptyLog) emptyLog.style.display = log.length ? 'none' : 'block';
    log.forEach(entry => {
        const li = document.createElement('li');
        li.className = 'log-item';
        li.innerHTML = `${escapeHtml(entry.message)}<time>${entry.time}</time>`;
        container.appendChild(li);
    });
}

// ── Focus Task ───────────────────────────────
function renderFocusCard() {
    const widget = document.getElementById('widget-focus');
    if (!widget) return;

    const activeTasks = todos.filter(t => !t.done && !t.deleted);
    if (activeTasks.length === 0) { widget.style.display = 'none'; return; }

    widget.style.display = 'block';

    // Restore or pick a focus task
    let focusTask = activeTasks.find(t => String(t.id) === String(focusTaskId));
    if (!focusTask) {
        focusTask = activeTasks[Math.floor(Math.random() * activeTasks.length)];
        focusTaskId = focusTask.id;
        localStorage.setItem('krhdev-focus-task', focusTaskId);
    }

    const list = lists.find(l => l.id === focusTask.listId);
    document.getElementById('focus-task-text').textContent = focusTask.text;
    document.getElementById('focus-list-name').textContent = list ? list.name.toUpperCase() : '';

    // Done button
    const doneBtn = document.getElementById('focus-done-btn');
    if (doneBtn) {
        doneBtn.onclick = async () => {
            await toggleDone(focusTask.id);
            focusTaskId = null;
            localStorage.removeItem('krhdev-focus-task');
            renderFocusCard();
        };
    }

    // Re-roll button
    const rerollBtn = document.getElementById('focus-reroll-btn');
    if (rerollBtn) {
        rerollBtn.onclick = () => {
            const others = activeTasks.filter(t => String(t.id) !== String(focusTaskId));
            const next = others.length ? others[Math.floor(Math.random() * others.length)] : activeTasks[0];
            focusTaskId = next.id;
            localStorage.setItem('krhdev-focus-task', focusTaskId);
            renderFocusCard();
        };
    }

    // Clear button
    const clearBtn = document.getElementById('focus-clear-btn');
    if (clearBtn) {
        clearBtn.onclick = () => {
            focusTaskId = null;
            localStorage.removeItem('krhdev-focus-task');
            widget.style.display = 'none';
        };
    }
}

// ── Move task ────────────────────────────────
async function moveTask(todoId, newListId) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    const oldList = lists.find(l => l.id === todo.listId);
    const newList = lists.find(l => l.id === newListId);
    if (!newList || todo.listId === newListId) return;

    todo.listId = newListId;

    if (useCloud) {
        await window.supabase.from('todos').update({ list_id: newListId }).eq('id', todoId);
    } else {
        save();
    }

    logChange(`Moved: "${todo.text}" → "${newList.name}"`);
    render();
}

// ── Utility ───────────────────────────────────
function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Sidebar user strip ────────────────────────
function renderSidebarUser() {
    const existing = document.getElementById('sidebar-user-strip');
    if (existing) existing.remove();
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (currentUser) {
        const strip = document.createElement('div');
        strip.id = 'sidebar-user-strip';
        strip.className = 'sidebar-user';
        strip.innerHTML = `<span title="${currentUser.email}">👤 ${currentUser.email}</span><button class="btn-signout" id="sign-out-btn">Sign out</button>`;
        const header = sidebar.querySelector('.sidebar-header');
        if (header) header.insertAdjacentElement('afterend', strip);
        else sidebar.prepend(strip);
        document.getElementById('sign-out-btn').addEventListener('click', signOut);
    }
}

// ── Auth ──────────────────────────────────────
async function signOut() {
    await supabase.auth.signOut();
    currentUser = null; useCloud = false;
    lists = JSON.parse(localStorage.getItem('krhdev-lists') || '[]');
    todos = JSON.parse(localStorage.getItem('krhdev-todos') || '[]');
    renderSidebarUser();
    showAuthOverlay();
    render();
}

function showAuthOverlay() { const o = document.getElementById('auth-overlay'); if (o) o.style.display = 'flex'; }
function hideAuthOverlay() { const o = document.getElementById('auth-overlay'); if (o) o.style.display = 'none'; }

// ── DOMContentLoaded ──────────────────────────
document.addEventListener('DOMContentLoaded', async function () {

    // Mobile sidebar
    const sidebar       = document.getElementById('sidebar');
    const sidebarOpen   = document.getElementById('sidebar-open');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
    function openSidebar()  { sidebar.classList.add('open');    overlay.classList.add('visible'); }
    function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('visible'); }
    if (sidebarOpen)   sidebarOpen.addEventListener('click', openSidebar);
    if (sidebarToggle) sidebarToggle.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);
    document.querySelectorAll('[data-view]').forEach(link => {
        link.addEventListener('click', () => { if (window.innerWidth <= 640) closeSidebar(); });
    });

    loadTheme();

    const radios = document.querySelectorAll('input[name="theme"]');
    radios.forEach(r => { r.addEventListener('change', () => applyTheme(r.value)); });

    // Auth overlay
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const authSwitch    = document.getElementById('auth-switch');
    const authSkipBtn   = document.getElementById('auth-skip-btn');
    const authEmail     = document.getElementById('auth-email');
    const authPassword  = document.getElementById('auth-password');
    const authMsg       = document.getElementById('auth-msg');
    const authTitle     = document.getElementById('auth-title');
    const authOverlay   = document.getElementById('auth-overlay');
    let authMode = 'signin';

    if (authSwitch) {
        authSwitch.addEventListener('click', e => {
            e.preventDefault();
            authMode = authMode === 'signin' ? 'signup' : 'signin';
            if (authTitle) authTitle.textContent = authMode === 'signin' ? 'Sign in to KRHDev To Do List' : 'Create an account';
            authSwitch.textContent = authMode === 'signin' ? 'Sign Up' : 'Sign In';
            authSwitch.previousSibling.textContent = authMode === 'signin' ? "Don't have an account? " : 'Already have an account? ';
            if (authSubmitBtn) authSubmitBtn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
            if (authMsg) { authMsg.textContent = ''; authMsg.className = ''; }
        });
    }

    if (authSubmitBtn) {
        authSubmitBtn.addEventListener('click', async () => {
            const email    = authEmail?.value.trim();
            const password = authPassword?.value;
            if (!email || !password) { if (authMsg) authMsg.textContent = 'Please enter your email and password.'; return; }
            authSubmitBtn.textContent = authMode === 'signin' ? 'Signing in…' : 'Creating account…';
            authSubmitBtn.disabled = true;
            let errMsg = null;
            if (authMode === 'signin') {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) errMsg = error.message;
            } else {
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) errMsg = error.message;
                else {
                    if (authMsg) { authMsg.textContent = 'Account created! Check your email to confirm, then sign in.'; authMsg.className = 'success'; }
                }
            }
            authSubmitBtn.disabled = false;
            authSubmitBtn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
            if (errMsg && authMsg) { authMsg.textContent = errMsg; authMsg.className = ''; }
        });
    }

    if (authPassword) {
        authPassword.addEventListener('keydown', e => { if (e.key === 'Enter') authSubmitBtn?.click(); });
    }

    if (authSkipBtn) {
        authSkipBtn.addEventListener('click', () => { hideAuthOverlay(); useCloud = false; render(); });
    }

    // Show overlay immediately — hide only once session confirmed
    if (authOverlay) showAuthOverlay();

    // Supabase auth state — use window.supabase to ensure CDN is loaded
    const _supabase = (typeof window.supabase !== 'undefined' && window.supabase.auth) ? window.supabase : null;
    if (_supabase) {
        _supabase.auth.onAuthStateChange(async (event, session) => {
            if (session?.user) {
                currentUser = session.user;
                useCloud    = true;
                hideAuthOverlay();
                renderSidebarUser();
                await loadFromCloud();
            } else {
                currentUser = null; useCloud = false;
                renderSidebarUser();
                if (authOverlay) showAuthOverlay();
            }
        });
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session && authOverlay) showAuthOverlay();
    } else {
        // Supabase not available — show overlay anyway so user sees the card
        if (authOverlay) showAuthOverlay();
    }

    // Category filter
    const categoryFilter = document.getElementById('category-filter');
    if (categoryFilter) categoryFilter.addEventListener('change', () => render());

    // + New category
    const newCatSelect = document.getElementById('new-list-category');
    const newCatInput  = document.getElementById('new-category-input');

    const newCatRow        = document.getElementById('new-category-row');
    const newCatConfirmBtn = document.getElementById('new-category-confirm-btn');

    function confirmNewCategory() {
        const val = newCatInput?.value.trim();
        if (!val) return;
        const exists = Array.from(newCatSelect.options).find(o => o.value === val);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = val;
            newCatSelect.insertBefore(opt, newCatSelect.lastElementChild);
        }
        newCatSelect.value = val;
        if (newCatRow) newCatRow.style.display = 'none';
        if (newCatInput) newCatInput.value = '';
        document.getElementById('new-list')?.focus();
    }

    if (newCatSelect && newCatInput) {
        newCatSelect.addEventListener('change', () => {
            if (newCatSelect.value === '__new__') {
                if (newCatRow) newCatRow.style.display = 'flex';
                newCatInput.focus();
            } else {
                if (newCatRow) newCatRow.style.display = 'none';
                newCatInput.value = '';
            }
        });

        newCatInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmNewCategory(); }
            if (e.key === 'Escape') {
                newCatSelect.value = 'General';
                if (newCatRow) newCatRow.style.display = 'none';
                newCatInput.value = '';
            }
        });
    }

    if (newCatConfirmBtn) {
        newCatConfirmBtn.addEventListener('click', confirmNewCategory);
    }

    // Settings: clear data
    const clearDataBtn = document.getElementById('clear-data-btn');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', () => {
            if (confirm('This will permanently delete all your lists, tasks, and history. Are you sure?')) {
                ['krhdev-lists', 'krhdev-todos', 'krhdev-log'].forEach(k => localStorage.removeItem(k));
                lists = []; todos = []; nextListId = 1; nextTodoId = 1; activeListId = null;
                alert('All data cleared.');
                render();
            }
        });
    }

    // Nav links
    document.querySelectorAll('[data-view]').forEach(link => {
        link.addEventListener('click', e => {
            // Only intercept the click if we're on the SPA page (index.htm),
            // where the view widgets actually exist. On other pages (help.htm,
            // settings.htm) let the browser navigate to index.htm normally —
            // the #view hash on the link tells index.htm which view to open.
            const onIndexPage = document.getElementById('widget-list-selector');
            if (onIndexPage) {
                e.preventDefault();
                activeView = link.dataset.view;
                render();
            }
        });
    });

    // Main inputs
    const addListBtn      = document.getElementById('add-list-btn');
    const newListInput    = document.getElementById('new-list');
    const addBtn          = document.getElementById('add-btn');
    const newTodoInput    = document.getElementById('new-todo');
    const clearDeletedBtn = document.getElementById('clear-deleted-btn');
    if (addListBtn)      addListBtn.addEventListener('click', addList);
    if (newListInput)    newListInput.addEventListener('keydown', e => { if (e.key === 'Enter') addList(); });
    if (addBtn)          addBtn.addEventListener('click', addTodo);
    if (newTodoInput)    newTodoInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
    if (clearDeletedBtn) clearDeletedBtn.addEventListener('click', clearDeleted);
    [newListInput, newTodoInput].forEach(input => { if (input) input.addEventListener('input', () => clearWarning(input)); });

    // Personalisation
    const userNameInput = document.getElementById('user-name-input');
    const saveNameBtn   = document.getElementById('save-name-btn');
    const clearNameBtn  = document.getElementById('clear-name-btn');
    const nameSavedMsg  = document.getElementById('name-saved-msg');
    if (userNameInput) {
        const current = localStorage.getItem(NAME_KEY);
        if (current) userNameInput.value = current;
        const showSaved = () => { if (!nameSavedMsg) return; nameSavedMsg.style.display = 'block'; setTimeout(() => { nameSavedMsg.style.display = 'none'; }, 2500); };
        const saveName = () => {
            const raw = userNameInput.value.trim();
            const name = raw.replace(/[<>"]/g, '');
            if (!name) { showWarning(userNameInput, 'Please enter a name, or use Reset to Default.'); return; }
            clearWarning(userNameInput);
            localStorage.setItem(NAME_KEY, name);
            applyUserName();
            showSaved();
        };
        saveNameBtn.addEventListener('click', saveName);
        userNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveName(); });
        userNameInput.addEventListener('input', () => clearWarning(userNameInput));
    }
    if (clearNameBtn) {
        clearNameBtn.addEventListener('click', () => {
            localStorage.removeItem(NAME_KEY);
            if (userNameInput) userNameInput.value = '';
            applyUserName();
            if (nameSavedMsg) {
                nameSavedMsg.textContent = '✓ Reset to default.';
                nameSavedMsg.style.display = 'block';
                setTimeout(() => { nameSavedMsg.style.display = 'none'; nameSavedMsg.textContent = '✓ Name saved!'; }, 2500);
            }
        });
    }

    // Restore last active list (localStorage mode only)
    if (!useCloud && lists.length > 0) {
        const lastActive = localStorage.getItem('krhdev-active-list');
        const found = lastActive && lists.find(l => l.id === parseInt(lastActive));
        activeListId = found ? found.id : lists[0].id;
    }

    // Read the requested view from the URL hash (e.g. index.htm#completed),
    // so links from help.htm / settings.htm land on the right view.
    const hashView = window.location.hash.replace('#', '');
    if (hashView && viewTitles[hashView]) activeView = hashView;

    if (!useCloud) {
        await checkAndReset();
        render();
    }
});

// Service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js'); });
}