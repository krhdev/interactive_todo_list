// ─────────────────────────────────────────────
//  KRHDev Todo App  –  script.js
//  CRUD: Create · Read · Update · Delete
//  Features: Named lists · Light/Dark mode · Mobile friendly
//             Change log · Local storage · Supabase cloud sync
//             Subtasks · Category filter · Focus task · Auto-reset
//             Due dates · Upcoming panel · Password reset
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
    lists = (cloudLists || []).map(l => ({ id: l.id, name: l.name, category: l.category || 'General', sortOrder: l.sort_order || 0 }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
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
    const stillExists = savedActive && lists.find(l => l.id === savedActive);
    activeListId = stillExists ? savedActive : (lists.length ? lists[0].id : null);
    activeView   = lists.length ? 'all' : 'home';
    await loadCategoryOrderFromCloud();
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
        const maxOrder = lists.length ? Math.max(...lists.map(l => l.sortOrder || 0)) : 0;
        const { data, error } = await window.supabase.from('lists').insert({ user_id: currentUser.id, name, category, sort_order: maxOrder + 1 }).select().single();
        if (error) { console.error(error); return; }
        lists.push({ id: data.id, name: data.name, category: data.category, sortOrder: data.sort_order || 0 });
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
            user_id: currentUser.id, list_id: parent.listId, parent_id: parentId,
            text, done: false, deleted: false
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
    if (useCloud) { await window.supabase.from('todos').update({ done: subtask.done }).eq('id', id); } else { save(); }
    render();
}

// ── DELETE — Subtask ──────────────────────────
async function deleteSubtask(id) {
    const subtask = todos.find(t => t.id === id);
    if (!subtask) return;
    if (useCloud) { await window.supabase.from('todos').delete().eq('id', id); }
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
    const focusHidden  = localStorage.getItem('krhdev-focus-hidden') === 'true';
    const focusStatBtn = document.getElementById('focus-toggle-stat-btn');
    if (focusStatBtn) { focusStatBtn.textContent = focusHidden ? 'Off' : 'On'; focusStatBtn.classList.toggle('off', focusHidden); }
    const focusShowBtn = document.getElementById('focus-show-btn');
    if (focusShowBtn) focusShowBtn.style.display = focusHidden ? 'inline-block' : 'none';
    renderFocusCard();
    renderUpcomingPanel();
    renderListTabs();
    renderTaskWidgets();
    renderLog();
    updateStats();
}

// ── Category order ───────────────────────────
function loadCategoryOrder() {
    return JSON.parse(localStorage.getItem('krhdev-category-order') || '[]');
}

async function saveCategoryOrder(order) {
    localStorage.setItem('krhdev-category-order', JSON.stringify(order));
    if (!useCloud || !currentUser) return;
    await window.supabase.from('category_order').upsert({
        user_id:    currentUser.id,
        order_data: order,
        updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
}

async function loadCategoryOrderFromCloud() {
    if (!useCloud || !currentUser) return;
    const { data, error } = await window.supabase
        .from('category_order')
        .select('order_data')
        .eq('user_id', currentUser.id)
        .single();
    if (error || !data) return;
    localStorage.setItem('krhdev-category-order', JSON.stringify(data.order_data || []));
}

function getSortedCategories(categories) {
    const saved = loadCategoryOrder();
    if (!saved.length) return categories;
    // Sort by saved order, append any new categories at the end
    const ordered = saved.filter(c => categories.includes(c));
    const unseen  = categories.filter(c => !saved.includes(c));
    return [...ordered, ...unseen];
}

async function saveListOrder() {
    if (!useCloud) { save(); return; }
    for (let i = 0; i < lists.length; i++) {
        lists[i].sortOrder = i;
        await window.supabase.from('lists').update({ sort_order: i }).eq('id', lists[i].id);
    }
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

        const realCats   = categories.filter(c => c !== 'All');
        const sortedCats = ['All', ...getSortedCategories(realCats)];

        sortedCats.forEach(cat => {
            const count = cat === 'All' ? lists.length : lists.filter(l => (l.category || 'General') === cat).length;
            const pill = document.createElement('button');
            pill.className = 'category-pill' + (activeCat === cat ? ' active' : '');
            pill.innerHTML = `${cat} <span class="pill-count">${count}</span>`;

            pill.addEventListener('click', () => {
                if (cat === 'All') {
                    pillsEl.dataset.active = activeCat === 'All' ? (sortedCats.find(c => c !== 'All') || 'All') : 'All';
                } else {
                    pillsEl.dataset.active = cat;
                }
                renderListTabs();
            });

            if (cat !== 'All') {
                pill.setAttribute('draggable', 'true');
                pill.addEventListener('dragstart', e => {
                    e.dataTransfer.setData('category-drag', cat);
                    setTimeout(() => pill.style.opacity = '0.5', 0);
                });
                pill.addEventListener('dragend', () => { pill.style.opacity = ''; pill.style.outline = ''; });
                pill.addEventListener('dragover', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    pill.style.outline = '2px dashed #f0a500';
                });
                pill.addEventListener('dragleave', () => pill.style.outline = '');
                pill.addEventListener('drop', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    pill.style.outline = '';
                    const draggedCat = e.dataTransfer.getData('category-drag');
                    if (!draggedCat || draggedCat === cat) return;
                    const current = getSortedCategories(realCats);
                    const fromIdx = current.indexOf(draggedCat);
                    const toIdx   = current.indexOf(cat);
                    if (fromIdx !== -1 && toIdx !== -1) {
                        current.splice(fromIdx, 1);
                        current.splice(toIdx, 0, draggedCat);
                        saveCategoryOrder(current);
                        renderListTabs();
                    }
                });
            }

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

            // Drag to reorder lists
            btn.setAttribute('draggable', 'true');
            btn.addEventListener('dragstart', e => {
                e.dataTransfer.setData('list-id', list.id);
                e.dataTransfer.setData('text/plain', ''); // prevent task drop conflict
                btn.style.opacity = '0.5';
            });
            btn.addEventListener('dragend', () => btn.style.opacity = '');
            btn.addEventListener('dragover', e => {
                e.preventDefault();
                // Only highlight if dragging a list (not a task)
                if (e.dataTransfer.types.includes('list-id') || !e.dataTransfer.getData('text/plain')) {
                    btn.classList.add('drag-over');
                }
            });
            btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
            btn.addEventListener('drop', e => {
                e.preventDefault();
                btn.classList.remove('drag-over');
                const draggedListId = e.dataTransfer.getData('list-id');
                const todoId = e.dataTransfer.getData('text/plain');

                if (draggedListId && draggedListId !== list.id) {
                    // Reorder lists
                    const fromIdx = lists.findIndex(l => l.id === draggedListId);
                    const toIdx   = lists.findIndex(l => l.id === list.id);
                    if (fromIdx !== -1 && toIdx !== -1) {
                        const [moved] = lists.splice(fromIdx, 1);
                        lists.splice(toIdx, 0, moved);
                        saveListOrder();
                        render();
                    }
                } else if (todoId) {
                    // Move task to this list
                    moveTask(todoId, list.id);
                }
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
        .filter(t => !t.deleted)
        .sort((a, b) => {
            if (a.done && !b.done) return 1;
            if (!a.done && b.done) return -1;
            if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
            if (a.dueDate) return -1;
            if (b.dueDate) return 1;
            return 0;
        });
    renderList('list-container',           'empty-active',    activeSorted, renderActiveItem);
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

// ── Subtask renderer ──────────────────────────
function renderSubtasks(parentId, container) {
    const subtasks = todos.filter(t => t.parentId === parentId && !t.deleted);
    if (subtasks.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'subtask-list';
        subtasks.forEach(sub => {
            const li = document.createElement('li');
            const overdueSubtask = isOverdue(sub);
            li.className = 'subtask-item' + (sub.done ? ' done' : '') + (overdueSubtask ? ' overdue' : '');
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = sub.done;
            cb.addEventListener('change', () => toggleSubtask(sub.id));
            const span = document.createElement('span');
            span.className = 'subtask-text' + (sub.done ? ' done' : '');
            span.textContent = sub.text;

            // Due date button for subtask
            const dueDateWrapper = document.createElement('div');
            dueDateWrapper.style.position = 'relative'; dueDateWrapper.style.flexShrink = '0';
            const dueBtn = document.createElement('button');
            dueBtn.className = 'due-date-btn';
            dueBtn.style.fontSize = '0.7rem';
            dueBtn.style.padding = '2px 7px';
            if (sub.dueDate) {
                dueBtn.textContent = formatDueDate(sub);
                if (overdueSubtask) dueBtn.classList.add('overdue');
                else if (isDueSoon(sub)) dueBtn.classList.add('due-soon');
                else dueBtn.classList.add('has-date');
            } else {
                dueBtn.textContent = '📅'; dueBtn.title = 'Set due date';
            }
            dueBtn.addEventListener('click', e => { e.stopPropagation(); showDueDatePicker(sub, dueDateWrapper); });
            dueDateWrapper.appendChild(dueBtn);

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-subtask-delete'; delBtn.textContent = '✕';
            delBtn.addEventListener('click', () => deleteSubtask(sub.id));
            li.appendChild(cb); li.appendChild(span); li.appendChild(dueDateWrapper); li.appendChild(delBtn);
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
        inp.className = 'subtask-input'; inp.placeholder = 'Subtask...'; inp.type = 'text';
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn-add-subtask'; confirmBtn.textContent = 'Add';
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
        row.appendChild(inp); row.appendChild(confirmBtn);
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
    li.className = 'task-item'; li.dataset.id = todo.id;
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
            if (e.key === 'Enter') saveEdit(todo.id, editInput.value);
            if (e.key === 'Escape') cancelEdit(todo.id);
        });
        li.appendChild(editInput); li.appendChild(saveBtn); li.appendChild(cancelBtn);
        setTimeout(() => { editInput.focus(); editInput.select(); }, 0);
    } else {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.checked = todo.done;
        checkbox.addEventListener('change', () => toggleDone(todo.id));
        const span = document.createElement('span');
        span.className = 'task-text' + (todo.done ? ' done' : '');
        span.textContent = todo.text + ' ';
        const subtasks = todos.filter(t => t.parentId === todo.id && !t.deleted);
        if (subtasks.length > 0) {
            const done = subtasks.filter(t => t.done).length;
            const prog = document.createElement('span');
            prog.className = 'subtask-progress';
            prog.textContent = `${done}/${subtasks.length}`;
            span.appendChild(prog);
        }
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit'; editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => startEdit(todo.id));
        const moveBtn = document.createElement('button');
        moveBtn.className = 'btn-move'; moveBtn.textContent = '→'; moveBtn.title = 'Move to another list';
        moveBtn.addEventListener('click', e => {
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
            li.appendChild(sel); sel.focus();
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete'; deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteTodo(todo.id));
        const dueDateWrapper = document.createElement('div');
        dueDateWrapper.style.position = 'relative'; dueDateWrapper.style.flexShrink = '0';
        const dueBtn = document.createElement('button');
        dueBtn.className = 'due-date-btn';
        if (todo.dueDate) {
            dueBtn.textContent = formatDueDate(todo);
            if (isOverdue(todo)) dueBtn.classList.add('overdue');
            else if (isDueSoon(todo)) dueBtn.classList.add('due-soon');
            else dueBtn.classList.add('has-date');
        } else {
            dueBtn.textContent = '📅'; dueBtn.title = 'Set due date';
        }
        dueBtn.addEventListener('click', e => { e.stopPropagation(); showDueDatePicker(todo, dueDateWrapper); });
        dueDateWrapper.appendChild(dueBtn);
        if (isOverdue(todo)) {
            const badge = document.createElement('span');
            badge.className = 'overdue-badge'; badge.textContent = 'Overdue';
            span.appendChild(badge);
            li.classList.add('overdue');
        }
        li.appendChild(checkbox); li.appendChild(span); li.appendChild(dueDateWrapper);
        li.appendChild(editBtn); li.appendChild(moveBtn); li.appendChild(deleteBtn);
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
    const todo = todos.find(t => t.id === id);
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

function startEdit(id) { todos.forEach(t => { t.editing = (t.id === id); }); render(); }

async function saveEdit(id, newText) {
    const text = newText.trim();
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const li = document.querySelector(`.task-item[data-id="${id}"]`);
    const editInput = li ? li.querySelector('.edit-input') : null;
    if (!text) { if (editInput) { showWarning(editInput, 'Task cannot be empty.'); editInput.focus(); } return; }
    if (text.length > 200) { if (editInput) { showWarning(editInput, 'Task must be 200 characters or fewer.'); editInput.focus(); } return; }
    const activeTasks = todos.filter(t => t.listId === todo.listId && !t.deleted && t.id !== id && !t.parentId);
    const duplicate = activeTasks.find(t => normalise(t.text) === normalise(text));
    if (duplicate) { if (editInput) { showWarning(editInput, 'Another task with that name already exists.'); editInput.focus(); } return; }
    const old = todo.text;
    todo.text = text; todo.editing = false;
    if (useCloud) { await window.supabase.from('todos').update({ text }).eq('id', id); } else { save(); }
    logChange(`Edited: "${old}" → "${text}"`);
    render();
}

function cancelEdit(id) { const todo = todos.find(t => t.id === id); if (todo) { todo.editing = false; render(); } }

// ── DELETE ────────────────────────────────────
async function deleteTodo(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.deleted = true; todo.done = false; todo.editing = false;
    if (useCloud) { await window.supabase.from('todos').update({ deleted: true, done: false }).eq('id', id); } else { save(); }
    logChange(`Deleted: "${todo.text}"`);
    render();
}

async function restoreTodo(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.deleted = false;
    if (useCloud) { await window.supabase.from('todos').update({ deleted: false }).eq('id', id); } else { save(); }
    logChange(`Restored: "${todo.text}"`);
    render();
}

async function clearDeleted() {
    if (!activeListId) return;
    const toDelete = todos.filter(t => t.listId === activeListId && t.deleted);
    const count = toDelete.length;
    if (useCloud) { for (const t of toDelete) { await window.supabase.from('todos').delete().eq('id', t.id); } }
    todos = todos.filter(t => !(t.listId === activeListId && t.deleted));
    if (!useCloud) save();
    logChange(`Permanently removed ${count} deleted task(s)`);
    render();
}

// ── Move task ────────────────────────────────
async function moveTask(todoId, newListId) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    const newList = lists.find(l => l.id === newListId);
    if (!newList || todo.listId === newListId) return;
    todo.listId = newListId;
    if (useCloud) { await window.supabase.from('todos').update({ list_id: newListId }).eq('id', todoId); } else { save(); }
    logChange(`Moved: "${todo.text}" → "${newList.name}"`);
    render();
}

// ── Stats ─────────────────────────────────────
function updateStats() {
    const activeTodos    = todos.filter(t => !t.done && !t.deleted && !t.parentId);
    const doneTodos      = todos.filter(t => t.done && !t.deleted && !t.parentId);
    const completedLists = lists.filter(l => {
        const listTasks = todos.filter(t => t.listId === l.id && !t.deleted && !t.parentId);
        return listTasks.length > 0 && listTasks.every(t => t.done);
    });
    const overdueTodos = todos.filter(t => isOverdue(t) && !t.parentId);
    if (document.getElementById('stat-lists'))     document.getElementById('stat-lists').textContent     = lists.length;
    if (document.getElementById('stat-active'))    document.getElementById('stat-active').textContent    = activeTodos.length;
    if (document.getElementById('stat-done'))      document.getElementById('stat-done').textContent      = doneTodos.length;
    if (document.getElementById('stat-lists-done')) document.getElementById('stat-lists-done').textContent = completedLists.length;
    if (document.getElementById('stat-overdue'))   document.getElementById('stat-overdue').textContent   = overdueTodos.length;
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

// ── Due date helpers ─────────────────────────
function isOverdue(todo) {
    if (!todo.dueDate || todo.done || todo.deleted) return false;
    const today = new Date().toISOString().slice(0, 10);
    return todo.dueDate < today;
}

function isDueSoon(todo) {
    if (!todo.dueDate || todo.done || todo.deleted) return false;
    const today = new Date();
    const due   = new Date(todo.dueDate);
    const diff  = (due - today) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 2;
}

function formatDueDate(todo) {
    if (!todo.dueDate) return null;
    const [y, m, d] = todo.dueDate.split('-');
    const label = `${d}/${m}/${y}`;
    if (todo.dueTime) return `${label} ${todo.dueTime.slice(0,5)}`;
    return label;
}

async function saveDueDate(todoId, dueDate, dueTime) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    todo.dueDate = dueDate || null;
    todo.dueTime = dueTime || null;
    if (useCloud) {
        await window.supabase.from('todos').update({ due_date: todo.dueDate, due_time: todo.dueTime || null }).eq('id', todoId);
    } else { save(); }
    render();
}

function showDueDatePicker(todo, anchorEl) {
    document.querySelectorAll('.due-date-picker').forEach(p => p.remove());
    const picker = document.createElement('div');
    picker.className = 'due-date-picker';
    const dateInput = document.createElement('input');
    dateInput.type = 'date'; dateInput.value = todo.dueDate || '';
    const timeLabel = document.createElement('label');
    timeLabel.style.cssText = 'font-size:0.78rem;color:var(--text-muted)';
    timeLabel.textContent = 'Time (optional)';
    const timeInput = document.createElement('input');
    timeInput.type = 'time'; timeInput.value = todo.dueTime ? todo.dueTime.slice(0,5) : '';
    const actions = document.createElement('div');
    actions.className = 'due-date-picker-actions';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-due-save'; saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => { await saveDueDate(todo.id, dateInput.value, timeInput.value); picker.remove(); });
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn-due-clear'; clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', async () => { await saveDueDate(todo.id, null, null); picker.remove(); });
    actions.appendChild(clearBtn); actions.appendChild(saveBtn);
    picker.appendChild(dateInput); picker.appendChild(timeLabel); picker.appendChild(timeInput); picker.appendChild(actions);

    // Append to body so it's not clipped by overflow
    document.body.appendChild(picker);

    // Position it near the anchor, keeping it inside the viewport
    const rect = anchorEl.getBoundingClientRect();
    const pickerW = 240;
    const pickerH = 160;
    let left = rect.left;
    let top  = rect.bottom + 6;

    // Flip left if overflowing right edge
    if (left + pickerW > window.innerWidth - 8) {
        left = window.innerWidth - pickerW - 8;
    }
    if (left < 8) left = 8;

    // Flip above if overflowing bottom
    if (top + pickerH > window.innerHeight - 8) {
        top = rect.top - pickerH - 6;
    }

    picker.style.left = `${left}px`;
    picker.style.top  = `${top}px`;

    setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
            if (!picker.contains(e.target) && !anchorEl.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        });
    }, 0);
    dateInput.focus();
}

// ── Upcoming / Overdue panel ─────────────────
function renderUpcomingPanel() {
    const widget = document.getElementById('widget-upcoming');
    const ul     = document.getElementById('upcoming-list');
    if (!widget || !ul) return;
    const today   = new Date().toISOString().slice(0, 10);
    const in2days = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dueTasks = todos
        .filter(t => t.dueDate && !t.done && !t.deleted)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (dueTasks.length === 0) { widget.style.display = 'none'; return; }
    widget.style.display = 'block';
    ul.innerHTML = '';
    dueTasks.forEach(todo => {
        const isSubtask = !!todo.parentId;
        const parent    = isSubtask ? todos.find(t => t.id === todo.parentId) : null;
        const list      = lists.find(l => l.id === todo.listId);
        const overdue  = todo.dueDate < today;
        const dueToday = todo.dueDate === today;
        const dueSoon  = todo.dueDate <= in2days && !overdue && !dueToday;
        const li = document.createElement('li');
        li.className = 'upcoming-item' + (overdue ? ' overdue' : dueToday ? ' due-today' : dueSoon ? ' due-soon' : '');
        const textSpan = document.createElement('span');
        textSpan.className = 'upcoming-item-text'; textSpan.textContent = todo.text; textSpan.title = todo.text;
        const listSpan = document.createElement('span');
        listSpan.className = 'upcoming-item-list';
        listSpan.textContent = isSubtask
            ? `${list ? list.name : ''} › ${parent ? parent.text : 'subtask'}`
            : (list ? list.name : '');
        const dateSpan = document.createElement('span');
        dateSpan.className = 'upcoming-item-date';
        dateSpan.textContent = overdue ? `Overdue · ${formatDueDate(todo)}` : dueToday ? `Today${todo.dueTime ? ' · ' + todo.dueTime.slice(0,5) : ''}` : formatDueDate(todo);
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => { activeListId = todo.listId; activeView = 'all'; render(); });
        li.appendChild(textSpan); li.appendChild(listSpan); li.appendChild(dateSpan);
        ul.appendChild(li);
    });
}

// ── Focus Task ───────────────────────────────
function renderFocusCard() {
    const widget = document.getElementById('widget-focus');
    if (!widget) return;
    if (localStorage.getItem('krhdev-focus-hidden') === 'true') {
        widget.style.display = 'none';
        const showBtn = document.getElementById('focus-show-btn');
        if (showBtn) showBtn.style.display = 'inline-block';
        return;
    }
    const pillsEl    = document.getElementById('category-pills');
    const activeCat  = pillsEl?.dataset.active || 'All';
    const catListIds = activeCat === 'All'
        ? lists.map(l => l.id)
        : lists.filter(l => (l.category || 'General') === activeCat).map(l => l.id);
    const activeTasks = todos.filter(t => !t.done && !t.deleted && !t.parentId && catListIds.includes(t.listId));
    if (activeTasks.length === 0) { widget.style.display = 'none'; return; }
    widget.style.display = 'block';
    let focusTask = activeTasks.find(t => String(t.id) === String(focusTaskId));
    if (!focusTask) {
        focusTask = activeTasks[Math.floor(Math.random() * activeTasks.length)];
        focusTaskId = focusTask.id;
        localStorage.setItem('krhdev-focus-task', focusTaskId);
    }
    const list = lists.find(l => l.id === focusTask.listId);
    document.getElementById('focus-task-text').textContent = focusTask.text;
    document.getElementById('focus-list-name').textContent = list ? list.name.toUpperCase() : '';
    const showBtn = document.getElementById('focus-show-btn');
    if (showBtn) showBtn.style.display = 'none';
    const focusToggleBtn = document.getElementById('focus-toggle-btn');
    if (focusToggleBtn) {
        focusToggleBtn.onclick = () => {
            localStorage.setItem('krhdev-focus-hidden', 'true');
            widget.style.display = 'none';
            const sb = document.getElementById('focus-show-btn');
            if (sb) sb.style.display = 'inline-block';
        };
    }
    const doneBtn = document.getElementById('focus-done-btn');
    if (doneBtn) {
        doneBtn.onclick = async () => {
            await toggleDone(focusTask.id);
            focusTaskId = null;
            localStorage.removeItem('krhdev-focus-task');
            renderFocusCard();
        };
    }
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
    const clearBtn = document.getElementById('focus-clear-btn');
    if (clearBtn) {
        clearBtn.onclick = () => {
            focusTaskId = null;
            localStorage.removeItem('krhdev-focus-task');
            widget.style.display = 'none';
        };
    }
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
const PASSWORD_RESET_REDIRECT = 'https://krhdev.github.io/interactive_todo_list/index.htm';

async function signOut() {
    await window.supabase.auth.signOut();
    currentUser = null; useCloud = false;
    lists = JSON.parse(localStorage.getItem('krhdev-lists') || '[]');
    todos = JSON.parse(localStorage.getItem('krhdev-todos') || '[]');
    renderSidebarUser();
    showAuthOverlay();
    render();
}

function showAuthOverlay() { const o = document.getElementById('auth-overlay'); if (o) o.style.display = 'flex'; }
function hideAuthOverlay() { const o = document.getElementById('auth-overlay'); if (o) o.style.display = 'none'; }

function showSignInForm() {
    document.getElementById('auth-main-form')?.style && (document.getElementById('auth-main-form').style.display = 'block');
    document.getElementById('auth-reset-request')?.style && (document.getElementById('auth-reset-request').style.display = 'none');
    document.getElementById('auth-new-password')?.style && (document.getElementById('auth-new-password').style.display = 'none');
}

function showResetRequestForm() {
    document.getElementById('auth-main-form')?.style && (document.getElementById('auth-main-form').style.display = 'none');
    document.getElementById('auth-reset-request')?.style && (document.getElementById('auth-reset-request').style.display = 'block');
    document.getElementById('auth-new-password')?.style && (document.getElementById('auth-new-password').style.display = 'none');
    const resetEmail = document.getElementById('reset-email');
    const authEmail  = document.getElementById('auth-email');
    if (resetEmail && authEmail?.value) resetEmail.value = authEmail.value;
    const resetMsg = document.getElementById('reset-msg');
    if (resetMsg) { resetMsg.textContent = ''; resetMsg.className = ''; }
}

function showNewPasswordForm() {
    document.getElementById('auth-main-form')?.style && (document.getElementById('auth-main-form').style.display = 'none');
    document.getElementById('auth-reset-request')?.style && (document.getElementById('auth-reset-request').style.display = 'none');
    document.getElementById('auth-new-password')?.style && (document.getElementById('auth-new-password').style.display = 'block');
    setTimeout(() => document.getElementById('new-password')?.focus(), 100);
}

async function sendPasswordReset() {
    const emailInput = document.getElementById('reset-email');
    const button     = document.getElementById('reset-email-btn');
    const message    = document.getElementById('reset-msg');
    if (!emailInput || !button || !message) return;
    const email = emailInput.value.trim();
    if (!email) { message.textContent = 'Please enter your email address.'; emailInput.focus(); return; }
    button.disabled = true; button.textContent = 'Sending…'; message.textContent = '';
    const { error } = await window.supabase.auth.resetPasswordForEmail(email, { redirectTo: PASSWORD_RESET_REDIRECT });
    button.disabled = false; button.textContent = 'Send Reset Email';
    if (error) { message.textContent = error.message; message.className = ''; return; }
    message.textContent = 'Password reset email sent. Please check your inbox.';
    message.className = 'success';
}

async function updatePassword() {
    const passwordInput = document.getElementById('new-password');
    const confirmInput  = document.getElementById('confirm-password');
    const button        = document.getElementById('update-password-btn');
    const message       = document.getElementById('new-password-msg');
    if (!passwordInput || !confirmInput || !button || !message) return;
    const password = passwordInput.value;
    const confirm  = confirmInput.value;
    if (!password) { message.textContent = 'Please enter a new password.'; passwordInput.focus(); return; }
    if (password.length < 6) { message.textContent = 'Password must be at least 6 characters.'; passwordInput.focus(); return; }
    if (password !== confirm) { message.textContent = 'Passwords do not match.'; confirmInput.focus(); return; }
    button.disabled = true; button.textContent = 'Updating…'; message.textContent = '';
    const { error } = await window.supabase.auth.updateUser({ password });
    button.disabled = false; button.textContent = 'Update Password';
    if (error) { message.textContent = error.message; message.className = ''; return; }
    message.textContent = 'Password updated! Signing you out…'; message.className = 'success';
    passwordInput.value = ''; confirmInput.value = '';
    setTimeout(async () => {
        await window.supabase.auth.signOut();
        showSignInForm();
        const authMsg = document.getElementById('auth-msg');
        if (authMsg) { authMsg.textContent = 'Password updated. Please sign in.'; authMsg.className = 'success'; }
        showAuthOverlay();
    }, 1500);
}

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

    // Auth elements
    const authSubmitBtn      = document.getElementById('auth-submit-btn');
    const authSwitch         = document.getElementById('auth-switch');
    const authSkipBtn        = document.getElementById('auth-skip-btn');
    const authEmail          = document.getElementById('auth-email');
    const authPassword       = document.getElementById('auth-password');
    const authMsg            = document.getElementById('auth-msg');
    const authTitle          = document.getElementById('auth-title');
    const authOverlay        = document.getElementById('auth-overlay');
    const forgotPasswordLink = document.getElementById('forgot-password-link');
    const resetEmailBtn      = document.getElementById('reset-email-btn');
    const backToSignin       = document.getElementById('back-to-signin');
    const updatePasswordBtn  = document.getElementById('update-password-btn');
    const confirmPasswordEl  = document.getElementById('confirm-password');
    let authMode = 'signin';

    if (authSwitch) {
        authSwitch.addEventListener('click', e => {
            e.preventDefault();
            authMode = authMode === 'signin' ? 'signup' : 'signin';
            if (authTitle) authTitle.textContent = authMode === 'signin' ? 'Sign in to KRHDev To Do List' : 'Create an account';
            authSwitch.textContent = authMode === 'signin' ? 'Sign Up' : 'Sign In';
            if (authSwitch.previousSibling) authSwitch.previousSibling.textContent = authMode === 'signin' ? "Don't have an account? " : 'Already have an account? ';
            if (authSubmitBtn) authSubmitBtn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
            if (authMsg) { authMsg.textContent = ''; authMsg.className = ''; }
        });
    }

    if (forgotPasswordLink) forgotPasswordLink.addEventListener('click', e => { e.preventDefault(); showResetRequestForm(); });
    if (backToSignin)       backToSignin.addEventListener('click',       e => { e.preventDefault(); showSignInForm(); });
    if (resetEmailBtn)      resetEmailBtn.addEventListener('click', sendPasswordReset);
    if (updatePasswordBtn)  updatePasswordBtn.addEventListener('click', updatePassword);
    if (confirmPasswordEl)  confirmPasswordEl.addEventListener('keydown', e => { if (e.key === 'Enter') updatePassword(); });

    if (authSubmitBtn) {
        authSubmitBtn.addEventListener('click', async () => {
            const email    = authEmail?.value.trim();
            const password = authPassword?.value;
            if (!email || !password) { if (authMsg) authMsg.textContent = 'Please enter your email and password.'; return; }
            authSubmitBtn.textContent = authMode === 'signin' ? 'Signing in…' : 'Creating account…';
            authSubmitBtn.disabled = true;
            let errMsg = null;
            if (authMode === 'signin') {
                const { error } = await window.supabase.auth.signInWithPassword({ email, password });
                if (error) errMsg = error.message;
            } else {
                const { error } = await window.supabase.auth.signUp({ email, password });
                if (error) errMsg = error.message;
                else if (authMsg) { authMsg.textContent = 'Account created! Check your email to confirm, then sign in.'; authMsg.className = 'success'; }
            }
            authSubmitBtn.disabled = false;
            authSubmitBtn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
            if (errMsg && authMsg) { authMsg.textContent = errMsg; authMsg.className = ''; }
        });
    }

    if (authPassword) authPassword.addEventListener('keydown', e => { if (e.key === 'Enter') authSubmitBtn?.click(); });
    if (authSkipBtn)  authSkipBtn.addEventListener('click', () => { hideAuthOverlay(); useCloud = false; render(); });

    // Show overlay immediately
    if (authOverlay) showAuthOverlay();

    // Supabase auth state
    const _supabase = (typeof window.supabase !== 'undefined' && window.supabase.auth) ? window.supabase : null;
    if (_supabase) {
        _supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                showAuthOverlay();
                showNewPasswordForm();
                return;
            }
            if (session?.user) {
                currentUser = session.user; useCloud = true;
                hideAuthOverlay(); renderSidebarUser();
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
        if (authOverlay) showAuthOverlay();
    }

    // Focus show button
    const focusShowBtn = document.getElementById('focus-show-btn');
    if (focusShowBtn) {
        focusShowBtn.addEventListener('click', () => {
            localStorage.removeItem('krhdev-focus-hidden');
            focusShowBtn.style.display = 'none';
            renderFocusCard();
        });
    }

    // Focus stat toggle
    const focusStatBtn = document.getElementById('focus-toggle-stat-btn');
    if (focusStatBtn) {
        focusStatBtn.addEventListener('click', () => {
            const isHidden = localStorage.getItem('krhdev-focus-hidden') === 'true';
            if (isHidden) localStorage.removeItem('krhdev-focus-hidden');
            else localStorage.setItem('krhdev-focus-hidden', 'true');
            render();
        });
    }

    // + New category
    const newCatSelect     = document.getElementById('new-list-category');
    const newCatInput      = document.getElementById('new-category-input');
    const newCatRow        = document.getElementById('new-category-row');
    const newCatConfirmBtn = document.getElementById('new-category-confirm-btn');

    function loadCustomCategories() {
        if (!newCatSelect) return;
        const saved = JSON.parse(localStorage.getItem('krhdev-custom-categories') || '[]');
        newCatSelect.selectedIndex = 0;
        saved.forEach(val => {
            const exists = Array.from(newCatSelect.options).find(o => o.value === val);
            if (!exists) {
                const opt = document.createElement('option');
                opt.value = val; opt.textContent = val;
                newCatSelect.insertBefore(opt, newCatSelect.lastElementChild);
            }
        });
    }
    loadCustomCategories();

    function confirmNewCategory() {
        const val = newCatInput?.value.trim();
        if (!val) return;
        const exists = Array.from(newCatSelect.options).find(o => o.value === val);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = val;
            newCatSelect.insertBefore(opt, newCatSelect.lastElementChild);
            const saved = JSON.parse(localStorage.getItem('krhdev-custom-categories') || '[]');
            if (!saved.includes(val)) { saved.push(val); localStorage.setItem('krhdev-custom-categories', JSON.stringify(saved)); }
        }
        newCatSelect.value = val;
        if (newCatRow) newCatRow.style.display = 'none';
        if (newCatInput) newCatInput.value = '';
        document.getElementById('new-list')?.focus();
    }

    if (newCatSelect && newCatInput) {
        newCatSelect.addEventListener('change', () => {
            if (newCatSelect.value === '__new__') { if (newCatRow) newCatRow.style.display = 'flex'; newCatInput.focus(); }
            else { if (newCatRow) newCatRow.style.display = 'none'; newCatInput.value = ''; }
        });
        newCatInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmNewCategory(); }
            if (e.key === 'Escape') { newCatSelect.value = 'General'; if (newCatRow) newCatRow.style.display = 'none'; newCatInput.value = ''; }
        });
    }
    if (newCatConfirmBtn) newCatConfirmBtn.addEventListener('click', confirmNewCategory);

    // Settings
    const clearDataBtn = document.getElementById('clear-data-btn');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', () => {
            if (confirm('This will permanently delete all your lists, tasks, and history. Are you sure?')) {
                ['krhdev-lists', 'krhdev-todos', 'krhdev-log'].forEach(k => localStorage.removeItem(k));
                lists = []; todos = []; nextListId = 1; nextTodoId = 1; activeListId = null;
                alert('All data cleared.'); render();
            }
        });
    }

    // Nav links
    document.querySelectorAll('[data-view]').forEach(link => {
        link.addEventListener('click', e => { e.preventDefault(); activeView = link.dataset.view; render(); });
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

    if (!useCloud && lists.length > 0) {
        const lastActive = localStorage.getItem('krhdev-active-list');
        const found = lastActive && lists.find(l => l.id === parseInt(lastActive));
        activeListId = found ? found.id : lists[0].id;
    }

    if (!useCloud) { await checkAndReset(); render(); }
});

// Service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js'); });
}