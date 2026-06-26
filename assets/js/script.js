// ─────────────────────────────────────────────
//  KRHDev Todo App  –  script.js
//  CRUD: Create · Read · Update · Delete
//  Features: Named lists · Light/Dark mode - mobile friendly · Change log · Local storage
//  Validation: Empty input blocked · Warnings shown · Duplicate prevention
// ─────────────────────────────────────────────

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
    // Apply personalised name on every page
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
    const name  = getUserName();

    const sidebarTitle = document.getElementById('sidebar-title');
    const mobileTitle  = document.getElementById('mobile-title');

    if (sidebarTitle) {
        // Sidebar on index has "App" suffix, settings does not
        const hasApp = sidebarTitle.dataset.suffix === 'app';
        sidebarTitle.textContent = name + TITLE_SUFFIX + (hasApp ? ' App' : '');
    }
    if (mobileTitle) mobileTitle.textContent = name + TITLE_SUFFIX;

    // Keep browser tab in sync on pages that include the name
    if (document.title.includes('To Do List')) {
        document.title = document.title.replace(/^[^']+(?='s To Do)/, name);
    }
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

// ── Validation helpers ────────────────────────
// Shows an inline warning message below an input, auto-clears after 3 s.
// Each input gets at most one warning at a time.
const _warnTimers = {};

function showWarning(inputEl, message) {
    const id = inputEl.id || inputEl.name || 'field';

    // Remove any existing warning for this input
    clearWarning(inputEl);

    const warn = document.createElement('p');
    warn.className = 'input-warning';
    warn.setAttribute('role', 'alert');
    warn.textContent = message;
    warn.id = `warn-${id}`;

    // Mark the input as invalid for styling
    inputEl.classList.add('input-invalid');
    inputEl.setAttribute('aria-describedby', warn.id);

    inputEl.insertAdjacentElement('afterend', warn);

    // Shake the input briefly
    inputEl.classList.add('input-shake');
    inputEl.addEventListener('animationend', () => inputEl.classList.remove('input-shake'), { once: true });

    // Auto-dismiss after 3 s
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

// Normalise text for duplicate comparison (case-insensitive, collapsed whitespace)
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
function addList() {
    const input = document.getElementById('new-list');
    if (!input) return;
    const name = input.value.trim();

    // ── Validation ──
    if (!name) {
        showWarning(input, 'Please enter a list name.');
        input.focus();
        return;
    }
    if (name.length > 60) {
        showWarning(input, 'List name must be 60 characters or fewer.');
        input.focus();
        return;
    }
    const duplicate = lists.find(l => normalise(l.name) === normalise(name));
    if (duplicate) {
        showWarning(input, `A list called "${duplicate.name}" already exists.`);
        input.focus();
        return;
    }
    // ── End validation ──

    clearWarning(input);
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

    // ── Validation ──
    if (!text) {
        showWarning(input, 'Please enter a task.');
        input.focus();
        return;
    }
    if (text.length > 200) {
        showWarning(input, 'Task must be 200 characters or fewer.');
        input.focus();
        return;
    }
    const activeTasks = todos.filter(t => t.listId === activeListId && !t.deleted);
    const duplicate = activeTasks.find(t => normalise(t.text) === normalise(text));
    if (duplicate) {
        showWarning(input, 'That task already exists in this list.');
        input.focus();
        return;
    }
    // ── End validation ──

    clearWarning(input);
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

    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = viewTitles[activeView] || 'My To-Do Lists';

    document.querySelectorAll('[data-view]').forEach(link => {
        link.classList.toggle('active', link.dataset.view === activeView);
    });

    renderListTabs();
    renderTaskWidgets();
    renderLog();
    updateStats();
}

function renderListTabs() {
    const tabsEl         = document.getElementById('list-tabs');
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
            e.stopPropagation();
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

    if (addWidget)       addWidget.style.display       = (hasList && activeView === 'all')       ? 'block' : 'none';
    if (allWidget)       allWidget.style.display       = (hasList && activeView === 'all')       ? 'block' : 'none';
    if (completedWidget) completedWidget.style.display = (hasList && activeView === 'completed') ? 'block' : 'none';
    if (deletedWidget)   deletedWidget.style.display   = (hasList && activeView === 'deleted')   ? 'block' : 'none';
    if (logWidget)       logWidget.style.display       = (activeView === 'log')                  ? 'block' : 'none';

    if (!hasList) return;

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
    const todo = todos.find(t => t.id === id);
    if (!todo) return;

    // ── Validation ──
    if (!text) {
        // Find the live edit input inside the task item and warn on it
        const li = document.querySelector(`.task-item[data-id="${id}"]`);
        const editInput = li ? li.querySelector('.edit-input') : null;
        if (editInput) {
            showWarning(editInput, 'Task cannot be empty.');
            editInput.focus();
        }
        return;
    }
    if (text.length > 200) {
        const li = document.querySelector(`.task-item[data-id="${id}"]`);
        const editInput = li ? li.querySelector('.edit-input') : null;
        if (editInput) {
            showWarning(editInput, 'Task must be 200 characters or fewer.');
            editInput.focus();
        }
        return;
    }
    // Duplicate check — exclude the task being edited from the comparison
    const activeTasks = todos.filter(t => t.listId === todo.listId && !t.deleted && t.id !== id);
    const duplicate = activeTasks.find(t => normalise(t.text) === normalise(text));
    if (duplicate) {
        const li = document.querySelector(`.task-item[data-id="${id}"]`);
        const editInput = li ? li.querySelector('.edit-input') : null;
        if (editInput) {
            showWarning(editInput, 'Another task with that name already exists.');
            editInput.focus();
        }
        return;
    }
    // ── End validation ──

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

    const completedLists = lists.filter(l => {
        const listTasks = todos.filter(t => t.listId === l.id && !t.deleted);
        return listTasks.length > 0 && listTasks.every(t => t.done);
    });

    const listsEl     = document.getElementById('stat-lists');
    const activeEl    = document.getElementById('stat-active');
    const doneEl      = document.getElementById('stat-done');
    const listsDoneEl = document.getElementById('stat-lists-done');

    if (listsEl)     listsEl.textContent    = lists.length;
    if (activeEl)    activeEl.textContent   = activeTodos.length;
    if (doneEl)      doneEl.textContent     = doneTodos.length;
    if (listsDoneEl) listsDoneEl.textContent = completedLists.length;
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
    radios.forEach(r => {
        r.addEventListener('change', () => applyTheme(r.value));
    });

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

    const navLinks = document.querySelectorAll('[data-view]');
    navLinks.forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            activeView = link.dataset.view;
            render();
        });
    });

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

    // Clear any stale warnings when the user starts typing again
    [newListInput, newTodoInput].forEach(input => {
        if (input) input.addEventListener('input', () => clearWarning(input));
    });

    // ── Personalisation (settings page) ────────
    const userNameInput  = document.getElementById('user-name-input');
    const saveNameBtn    = document.getElementById('save-name-btn');
    const clearNameBtn   = document.getElementById('clear-name-btn');
    const nameSavedMsg   = document.getElementById('name-saved-msg');

    if (userNameInput) {
        // Pre-fill with current saved name (but not the default)
        const current = localStorage.getItem(NAME_KEY);
        if (current) userNameInput.value = current;

        const showSaved = () => {
            if (!nameSavedMsg) return;
            nameSavedMsg.style.display = 'block';
            setTimeout(() => { nameSavedMsg.style.display = 'none'; }, 2500);
        };

        const saveName = () => {
            const raw  = userNameInput.value.trim();
            const name = raw.replace(/[<>"]/g, ''); // basic sanitise
            if (!name) {
                showWarning(userNameInput, 'Please enter a name, or use Reset to Default.');
                return;
            }
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
                setTimeout(() => {
                    nameSavedMsg.style.display = 'none';
                    nameSavedMsg.textContent = '✓ Name saved!';
                }, 2500);
            }
        });
    }

    if (lists.length > 0) {
        const lastActive = localStorage.getItem('krhdev-active-list');
        const found = lastActive && lists.find(l => l.id === parseInt(lastActive));
        activeListId = found ? found.id : lists[0].id;
    }

    render();
});

if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js');
        });
    }
