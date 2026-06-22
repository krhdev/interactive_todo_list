// ─────────────────────────────────────────────
//  KRHDev Todo App – json-io.js
//  Export all lists + tasks to JSON file
//  Import JSON file back, merging or replacing
// ─────────────────────────────────────────────

(function () {

    // ── Export ──────────────────────────────────
    function exportData() {
        const payload = {
            exportedAt: new Date().toISOString(),
            version: 1,
            lists: JSON.parse(localStorage.getItem('krhdev-lists') || '[]'),
            todos: JSON.parse(localStorage.getItem('krhdev-todos') || '[]')
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        a.href     = url;
        a.download = `krhdev-todo-backup-${date}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Import ──────────────────────────────────
    function importData(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            let payload;
            try {
                payload = JSON.parse(e.target.result);
            } catch {
                alert('Invalid file — could not read JSON.');
                return;
            }

            // Basic validation
            if (!Array.isArray(payload.lists) || !Array.isArray(payload.todos)) {
                alert('Invalid backup file — missing lists or todos.');
                return;
            }

            const mode = confirm(
                'How do you want to import?\n\n' +
                'OK  = Merge with existing data (keeps what you have, adds new lists)\n' +
                'Cancel = Replace everything (overwrites all current data)'
            ) ? 'merge' : 'replace';

            if (mode === 'replace') {
                // Wipe and restore exactly
                localStorage.setItem('krhdev-lists', JSON.stringify(payload.lists));
                localStorage.setItem('krhdev-todos', JSON.stringify(payload.todos));

            } else {
                // Merge: bring in lists/todos that don't already exist by id
                const existingLists = JSON.parse(localStorage.getItem('krhdev-lists') || '[]');
                const existingTodos = JSON.parse(localStorage.getItem('krhdev-todos') || '[]');

                const existingListIds = new Set(existingLists.map(l => l.id));
                const existingTodoIds = new Set(existingTodos.map(t => t.id));

                // Find highest existing IDs so we can remap imported IDs if needed
                const maxListId = existingLists.length ? Math.max(...existingLists.map(l => l.id)) : 0;
                const maxTodoId = existingTodos.length ? Math.max(...existingTodos.map(t => t.id)) : 0;

                // Remap imported IDs to avoid collisions
                const listIdMap = {};
                let listIdCounter = maxListId + 1;

                const newLists = payload.lists
                    .filter(l => !existingListIds.has(l.id))
                    .map(l => {
                        const newId = listIdCounter++;
                        listIdMap[l.id] = newId;
                        return { ...l, id: newId };
                    });

                let todoIdCounter = maxTodoId + 1;
                const newTodos = payload.todos
                    .filter(t => !existingTodoIds.has(t.id))
                    .map(t => ({
                        ...t,
                        id: todoIdCounter++,
                        // Update listId if its parent list was remapped
                        listId: listIdMap[t.listId] !== undefined ? listIdMap[t.listId] : t.listId
                    }));

                localStorage.setItem('krhdev-lists', JSON.stringify([...existingLists, ...newLists]));
                localStorage.setItem('krhdev-todos', JSON.stringify([...existingTodos, ...newTodos]));
            }

            // Reload in-memory state and re-render
            lists       = JSON.parse(localStorage.getItem('krhdev-lists') || '[]');
            todos       = JSON.parse(localStorage.getItem('krhdev-todos') || '[]');
            nextListId  = lists.length ? Math.max(...lists.map(l => l.id)) + 1 : 1;
            nextTodoId  = todos.length ? Math.max(...todos.map(t => t.id)) + 1 : 1;
            activeListId = lists.length ? lists[0].id : null;

            logChange('Data imported from backup file');
            render();
            alert('Import complete!');
        };

        reader.readAsText(file);
    }

    // ── Inject UI buttons ───────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        // Create the toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'io-toolbar';
        toolbar.innerHTML = `
            <button id="export-btn" class="btn-secondary" title="Download all your lists as a JSON backup file">
                ⬇ Export Lists
            </button>
            <label class="btn-secondary" id="import-label" title="Import a previously exported backup file">
                ⬆ Import Lists
                <input type="file" id="import-input" accept=".json" style="display:none;">
            </label>
        `;

        // Insert after the sidebar stats inside the sidebar
        const stats = document.querySelector('.sidebar-stats');
        if (stats) {
            stats.insertAdjacentElement('afterend', toolbar);
        } else {
            // Fallback: append to sidebar
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.appendChild(toolbar);
        }

        document.getElementById('export-btn').addEventListener('click', exportData);
        document.getElementById('import-input').addEventListener('change', function () {
            importData(this.files[0]);
            this.value = ''; // reset so same file can be re-imported
        });
    });

})();
