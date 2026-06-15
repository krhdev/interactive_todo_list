// ─────────────────────────────────────────────
//  KRHDev Todo App  –  script.js
//  CRUD: Create · Read · Update · Delete
//  Features: Named lists · Light/Dark mode - mobile friendly · Change log · Local storage
// ─────────────────────────────────────────────

// ── Theme ────────────────────────────────────
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('krhdev-theme', theme);
}

function loadTheme() {
    const saved = localStorage.getItem('krhdev-theme') || 'light';
    applyTheme(saved);
    // Sync radio buttons on settings page
    const radios = document.querySelectorAll('input[name="theme"]');
    radios.forEach(r => { r.checked = (r.value === saved); });
}

// ── Data store ───────────────────────────────
// Lists: [{ id, name }]
// Todos: [{ id, listId, text, done, deleted, editing }]
let lists = JSON.parse(localStorage.getItem('krhdev-lists') || '[]');
let todos = JSON.parse(localStorage.getItem('krhdev-todos') || '[]');

// One-time cleanup: remove any legacy todos that have no listId
todos = todos.filter(t => t.listId !== undefined);
localStorage.setItem('krhdev-todos', JSON.stringify(todos));

let nextListId = lists.length ? Math.max(...lists.map(l => l.id)) + 1 : 1;
let nextTodoId = todos.length ? Math.max(...todos.map(t => t.id)) + 1 : 1;
let activeListId = null;
let activeView = 'home'; // 'home' | 'all' | 'completed' | 'deleted' | 'log'

function save() {
    localStorage.setItem('krhdev-lists', JSON.stringify(lists));
    localStorage.setItem('krhdev-todos', JSON.stringify(todos));
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
function addList() {
    const input = document.getElementById('new-list');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;

    const list = { id: nextListId++, name };
    lists.push(list);
    activeListId = list.id;
    activeView = 'all';
    save();
    logChange(`Created list: "${name}"`);
    input.value = '';
    render();
}

// ── DELETE — List ────────────────────────────
function deleteList(id) {
    const list = lists.find(l => l.id === id);
    if (!list) return;
    if (!confirm(`Delete the list "${list.name}" and all its tasks?`)) return;

    lists = lists.filter(l => l.id !== id);
    todos = todos.filter(t => t.listId !== id);
    if (activeListId === id) {
        activeListId = lists.length ? lists[0].id : null;
    }
    save();
    logChange(`Deleted list: "${list.name}"`);
    render();
}

// ── CREATE — Task ─────────────────────────────
function addTodo() {
    if (!activeListId) return;
    const input = document.getElementById('new-todo');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const todo = { id: nextTodoId++, listId: activeListId, text, done: false, deleted: false, editing: false };
    todos.push(todo);
    save();
    logChange(`Added: "${text}"`);
    input.value = '';
    render();
}

// ── READ (render) ─────────────────────────────
const viewTitles = {
    home:      'My To-Do Lists',
    all:       'View Lists',
    completed: 'Completed Tasks',
    deleted:   'Deleted Tasks',
    log:       'Recent Changes'
};

function render() {
    if (activeListId !== null) {
        localStorage.setItem('krhdev-active-list', activeListId);
    }

    // Update page title
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = viewTitles[activeView] || 'My To-Do Lists';

    // Highlight active sidebar link
    document.querySelectorAll('[data-view]').forEach(link => {
        link.classList.toggle('active', link.dataset.view === activeView);
    });

    renderListTabs();
    renderTaskWidgets();
    renderLog();
    updateStats();
}

function renderListTabs() {
    const tabsEl   = document.getElementById('list-tabs');
    const selectorWidget = document.getElementById('widget-list-selector');
    if (!tabsEl || !selectorWidget) return;

    if (lists.length === 0) {
        selectorWidget.style.display = 'none';
        return;
    }

    selectorWidget.style.display = 'block';
    tabsEl.innerHTML = '';

    lists.forEach(list => {
        const btn = document.createElement('button');
        btn.className = 'list-tab' + (list.id === activeListId ? ' active' : '');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = list.name;
        btn.appendChild(nameSpan);

        const delBtn = document.createElement('button');
        delBtn.className = 'list-tab-delete';
        delBtn.textContent = '✕';
        delBtn.title = 'Delete this list';
        delBtn.addEventListener('click', e => {
            e.stopPropagation(); // don't also select the tab
            deleteList(list.id);
        });
        btn.appendChild(delBtn);

        btn.addEventListener('click', () => {
            activeListId = list.id;
            activeView = 'all';
            render();
        });

        tabsEl.appendChild(btn);
    });
}

function renderTaskWidgets() {
    const addWidget       = document.getElementById('widget-add-task');
    const allWidget       = document.getElementById('widget-all');
    const completedWidget = document.getElementById('widget-completed');
    const deletedWidget   = document.getElementById('widget-deleted');
    const logWidget       = document.getElementById('widget-log');
    const label           = document.getElementById('active-list-label');

    const hasList = activeListId !== null;

    // home: only New List + Your Lists tabs visible — no task widgets
    // all:  Add Task + Active Tasks visible (if a list is selected)
    // completed/deleted/log: only their widget visible
    if (addWidget)       addWidget.style.display       = (hasList && activeView === 'all')       ? 'block' : 'none';
    if (allWidget)       allWidget.style.display       = (hasList && activeView === 'all')       ? 'block' : 'none';
    if (completedWidget) completedWidget.style.display = (hasList && activeView === 'completed') ? 'block' : 'none';
    if (deletedWidget)   deletedWidget.style.display   = (hasList && activeView === 'deleted')   ? 'block' : 'none';
    if (logWidget)       logWidget.style.display       = (activeView === 'log')                  ? 'block' : 'none';

    if (!hasList) return;

    // Update the "in: List Name" label
    const activeList = lists.find(l => l.id === activeListId);
    if (label && activeList) label.textContent = `— ${activeList.name}`;

    const listTodos = todos.filter(t => t.listId === activeListId);

    renderList(
        'list-container',
        'empty-active',
        listTodos.filter(t => !t.done && !t.deleted),
        renderActiveItem
    );

    renderList(
        'completed-list-container',
        'empty-completed',
        listTodos.filter(t => t.done && !t.deleted),
        renderCompletedItem
    );

    renderList(
        'deleted-list-container',
        'empty-deleted',
        listTodos.filter(t => t.deleted),
        renderDeletedItem
    );

    const clearBtn = document.getElementById('clear-deleted-btn');
    if (clearBtn) {
        clearBtn.style.display = listTodos.some(t => t.deleted) ? 'inline-block' : 'none';
    }
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
        editInput.type = 'text';
        editInput.className = 'edit-input';
        editInput.value = todo.text;

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-save';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', () => saveEdit(todo.id, editInput.value));

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => cancelEdit(todo.id));

        editInput.addEventListener('keydown', e => {
            if (e.key === 'Enter')  saveEdit(todo.id, editInput.value);
            if (e.key === 'Escape') cancelEdit(todo.id);
        });

        li.appendChild(editInput);
        li.appendChild(saveBtn);
        li.appendChild(cancelBtn);

        setTimeout(() => { editInput.focus(); editInput.select(); }, 0);
    } else {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.addEventListener('change', () => toggleDone(todo.id));

        const span = document.createElement('span');
        span.className = 'task-text';
        span.textContent = todo.text;

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => startEdit(todo.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

        li.appendChild(checkbox);
        li.appendChild(span);
        li.appendChild(editBtn);
        li.appendChild(deleteBtn);
    }

    return li;
}

function renderCompletedItem(todo) {
    const li = document.createElement('li');
    li.className = 'task-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.addEventListener('change', () => toggleDone(todo.id));

    const span = document.createElement('span');
    span.className = 'task-text done';
    span.textContent = todo.text;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(deleteBtn);
    return li;
}

function renderDeletedItem(todo) {
    const li = document.createElement('li');
    li.className = 'task-item deleted';

    const span = document.createElement('span');
    span.className = 'task-text';
    span.textContent = todo.text;

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn-restore';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', () => restoreTodo(todo.id));

    li.appendChild(span);
    li.appendChild(restoreBtn);
    return li;
}

// ── UPDATE ────────────────────────────────────
function toggleDone(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.done = !todo.done;
    save();
    logChange(todo.done ? `Completed: "${todo.text}"` : `Reopened: "${todo.text}"`);
    render();
}

function startEdit(id) {
    todos.forEach(t => { t.editing = (t.id === id); });
    render();
}

function saveEdit(id, newText) {
    const text = newText.trim();
    if (!text) return;
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    const old = todo.text;
    todo.text = text;
    todo.editing = false;
    save();
    logChange(`Edited: "${old}" → "${text}"`);
    render();
}

function cancelEdit(id) {
    const todo = todos.find(t => t.id === id);
    if (todo) { todo.editing = false; render(); }
}

// ── DELETE ────────────────────────────────────
function deleteTodo(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.deleted = true;
    todo.done = false;
    todo.editing = false;
    save();
    logChange(`Deleted: "${todo.text}"`);
    render();
}

function restoreTodo(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    todo.deleted = false;
    save();
    logChange(`Restored: "${todo.text}"`);
    render();
}

function clearDeleted() {
    if (!activeListId) return;
    const count = todos.filter(t => t.listId === activeListId && t.deleted).length;
    todos = todos.filter(t => !(t.listId === activeListId && t.deleted));
    save();
    logChange(`Permanently removed ${count} deleted task(s)`);
    render();
}

// ── Stats ─────────────────────────────────────
function updateStats() {
    const activeTodos = todos.filter(t => !t.done && !t.deleted);
    const doneTodos   = todos.filter(t => t.done && !t.deleted);

    // A list is "completed" if it has at least one task and all non-deleted tasks are done
    const completedLists = lists.filter(l => {
        const listTasks = todos.filter(t => t.listId === l.id && !t.deleted);
        return listTasks.length > 0 && listTasks.every(t => t.done);
    });

    const listsEl      = document.getElementById('stat-lists');
    const activeEl     = document.getElementById('stat-active');
    const doneEl       = document.getElementById('stat-done');
    const listsDoneEl  = document.getElementById('stat-lists-done');

    if (listsEl)     listsEl.textContent     = lists.length;
    if (activeEl)    activeEl.textContent     = activeTodos.length;
    if (doneEl)      doneEl.textContent       = doneTodos.length;
    if (listsDoneEl) listsDoneEl.textContent  = completedLists.length;
}

// ── Change log ────────────────────────────────
function renderLog() {
    const log       = JSON.parse(localStorage.getItem('krhdev-log') || '[]');
    const container = document.getElementById('recent-changes-container');
    const emptyLog  = document.getElementById('empty-log');
    if (!container) return;

    container.innerHTML = '';
    container.className = 'log-list';
    if (emptyLog) emptyLog.style.display = log.length ? 'none' : 'block';

    log.forEach(entry => {
        const li = document.createElement('li');
        li.className = 'log-item';
        li.innerHTML = `${escapeHtml(entry.message)}<time>${entry.time}</time>`;
        container.appendChild(li);
    });
}

// ── Utility ───────────────────────────────────
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Wire up events ────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    // ── Mobile sidebar ──────────────────────────
    const sidebar        = document.getElementById('sidebar');
    const sidebarOpen    = document.getElementById('sidebar-open');
    const sidebarToggle  = document.getElementById('sidebar-toggle');

    // Create overlay element
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    function openSidebar()  { sidebar.classList.add('open');    overlay.classList.add('visible'); }
    function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('visible'); }

    if (sidebarOpen)   sidebarOpen.addEventListener('click', openSidebar);
    if (sidebarToggle) sidebarToggle.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);

    // Close sidebar when a nav link is tapped on mobile
    document.querySelectorAll('[data-view]').forEach(link => {
        link.addEventListener('click', () => { if (window.innerWidth <= 640) closeSidebar(); });
    });
    // Theme — apply on every page load
    loadTheme();

    // Theme radio buttons (settings page)
    const radios = document.querySelectorAll('input[name="theme"]');
    radios.forEach(r => {
        r.addEventListener('change', () => applyTheme(r.value));
    });

    // Settings: clear all data
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

    // Sidebar nav links
    const navLinks = document.querySelectorAll('[data-view]');
    navLinks.forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            activeView = link.dataset.view;
            render();
        });
    });

    // Index page buttons
    const addListBtn      = document.getElementById('add-list-btn');
    const newListInput    = document.getElementById('new-list');
    const addBtn          = document.getElementById('add-btn');
    const newTodoInput    = document.getElementById('new-todo');
    const clearDeletedBtn = document.getElementById('clear-deleted-btn');

    if (addListBtn)       addListBtn.addEventListener('click', addList);
    if (newListInput)     newListInput.addEventListener('keydown', e => { if (e.key === 'Enter') addList(); });
    if (addBtn)           addBtn.addEventListener('click', addTodo);
    if (newTodoInput)     newTodoInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });
    if (clearDeletedBtn)  clearDeletedBtn.addEventListener('click', clearDeleted);

    // Restore last active list (but stay on home view until user navigates)
    if (lists.length > 0) {
        const lastActive = localStorage.getItem('krhdev-active-list');
        const found = lastActive && lists.find(l => l.id === parseInt(lastActive));
        activeListId = found ? found.id : lists[0].id;
    }

    render();
});