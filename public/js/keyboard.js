// Keyboard shortcuts for power users
class KeyboardShortcuts {
    constructor() {
        this.shortcuts = new Map();
        this.init();
    }

    init() {
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
        this.registerDefaultShortcuts();
        console.log('[Keyboard] Shortcuts initialized');
    }

    register(key, callback, description, ctrl = false, shift = false) {
        const shortcutKey = `${ctrl ? 'ctrl+' : ''}${shift ? 'shift+' : ''}${key.toLowerCase()}`;
        this.shortcuts.set(shortcutKey, { callback, description });
    }

    handleKeyPress(e) {
        // Don't trigger if user is typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            // Allow Escape to blur input
            if (e.key === 'Escape') {
                e.target.blur();
            }
            return;
        }

        const key = e.key.toLowerCase();
        const shortcutKey = `${e.ctrlKey ? 'ctrl+' : ''}${e.shiftKey ? 'shift+' : ''}${key}`;
        
        const shortcut = this.shortcuts.get(shortcutKey);
        if (shortcut) {
            e.preventDefault();
            shortcut.callback(e);
        }
    }

    registerDefaultShortcuts() {
        // Ctrl+K - Focus search
        this.register('k', () => {
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
                if (window.toast) {
                    window.toast.info('Search focused (Ctrl+K)');
                }
            }
        }, 'Focus search', true);

        // Ctrl+L - Focus URL input
        this.register('l', () => {
            const urlInput = document.getElementById('playlist-url');
            if (urlInput) {
                urlInput.focus();
                urlInput.select();
                if (window.toast) {
                    window.toast.info('URL input focused (Ctrl+L)');
                }
            }
        }, 'Focus URL input', true);

        // Ctrl+Enter - Load content
        this.register('enter', () => {
            const loadButton = document.getElementById('load-content');
            if (loadButton) {
                loadButton.click();
            }
        }, 'Load content', true);

        // Ctrl+E - Export data
        this.register('e', () => {
            const exportButton = document.getElementById('export-data');
            if (exportButton) {
                exportButton.click();
            } else if (window.toast) {
                window.toast.warning('Export feature coming soon!');
            }
        }, 'Export data', true);

        // Ctrl+R - Refresh (prevent default browser refresh)
        this.register('r', (e) => {
            e.preventDefault();
            window.location.reload();
        }, 'Refresh page', true);

        // / - Quick search (like GitHub)
        this.register('/', () => {
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.focus();
            }
        }, 'Quick search');

        // ? - Show keyboard shortcuts help
        this.register('?', () => {
            this.showHelp();
        }, 'Show keyboard shortcuts', false, true);

        // Escape - Clear search/close modals
        this.register('escape', () => {
            const searchInput = document.getElementById('search-input');
            if (searchInput && searchInput.value) {
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input'));
                if (window.toast) {
                    window.toast.info('Search cleared');
                }
            }
        }, 'Clear search/close modals');
    }

    showHelp() {
        const shortcuts = Array.from(this.shortcuts.entries())
            .map(([key, data]) => `<li><kbd class="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded border-2 border-black dark:border-white font-mono text-sm">${key}</kbd> - ${data.description}</li>`)
            .join('');

        const helpHtml = `
            <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" id="keyboard-help-modal">
                <div class="bg-white dark:bg-gray-800 rounded-lg border-4 border-black dark:border-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-w-2xl w-full max-h-[80vh] overflow-y-auto">
                    <div class="p-6">
                        <div class="flex justify-between items-center mb-4">
                            <h2 class="text-2xl font-bold">⌨️ Keyboard Shortcuts</h2>
                            <button onclick="document.getElementById('keyboard-help-modal').remove()" class="text-2xl font-bold hover:text-red-500">×</button>
                        </div>
                        <ul class="space-y-2">
                            ${shortcuts}
                        </ul>
                        <p class="mt-4 text-sm text-gray-600 dark:text-gray-400">Press <kbd class="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded border-2 border-black dark:border-white font-mono text-sm">Esc</kbd> or click outside to close</p>
                    </div>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.innerHTML = helpHtml;
        document.body.appendChild(modal.firstElementChild);

        // Close on click outside
        document.getElementById('keyboard-help-modal').addEventListener('click', (e) => {
            if (e.target.id === 'keyboard-help-modal') {
                e.target.remove();
            }
        });

        // Close on Escape
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                document.getElementById('keyboard-help-modal')?.remove();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }
}

// Initialize keyboard shortcuts
window.keyboard = new KeyboardShortcuts();
