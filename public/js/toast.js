// Toast notification system - better than alerts
class Toast {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        // Create toast container if it doesn't exist
        if (!document.getElementById('toast-container')) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'fixed top-4 right-4 z-50 space-y-2';
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('toast-container');
        }
    }

    show(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast-item transform transition-all duration-300 translate-x-full opacity-0`;
        
        const colors = {
            success: 'bg-green-500 border-green-700',
            error: 'bg-red-500 border-red-700',
            warning: 'bg-yellow-500 border-yellow-700',
            info: 'bg-blue-500 border-blue-700'
        };

        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };

        toast.innerHTML = `
            <div class="${colors[type]} text-white px-6 py-3 rounded-lg border-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] min-w-[300px] max-w-md">
                <div class="flex items-center gap-3">
                    <span class="text-2xl font-bold">${icons[type]}</span>
                    <p class="font-medium flex-1">${message}</p>
                    <button class="toast-close text-white hover:text-gray-200 font-bold text-xl" onclick="this.closest('.toast-item').remove()">×</button>
                </div>
            </div>
        `;

        this.container.appendChild(toast);

        // Trigger animation
        setTimeout(() => {
            toast.classList.remove('translate-x-full', 'opacity-0');
        }, 10);

        // Auto remove
        if (duration > 0) {
            setTimeout(() => {
                toast.classList.add('translate-x-full', 'opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }

        return toast;
    }

    success(message, duration = 3000) {
        return this.show(message, 'success', duration);
    }

    error(message, duration = 5000) {
        return this.show(message, 'error', duration);
    }

    warning(message, duration = 4000) {
        return this.show(message, 'warning', duration);
    }

    info(message, duration = 3000) {
        return this.show(message, 'info', duration);
    }
}

// Create global toast instance
window.toast = new Toast();
