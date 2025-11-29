// Export functionality - save your organized videos
import { globalState } from './state.js';

class DataExporter {
    constructor() {
        this.setupExportButton();
    }

    setupExportButton() {
        // Add export button to the UI
        const exportButton = document.createElement('button');
        exportButton.id = 'export-data';
        exportButton.className = 'nb-button success flex items-center gap-2';
        exportButton.innerHTML = `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            Export
        `;
        exportButton.addEventListener('click', () => this.showExportMenu());

        // Add to search/actions row
        const searchRow = document.querySelector('#search-video').parentElement;
        if (searchRow) {
            searchRow.appendChild(exportButton);
        }
    }

    showExportMenu() {
        const menuHtml = `
            <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" id="export-modal">
                <div class="bg-white dark:bg-gray-800 rounded-lg border-4 border-black dark:border-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] max-w-md w-full">
                    <div class="p-6">
                        <div class="flex justify-between items-center mb-4">
                            <h2 class="text-2xl font-bold">📥 Export Data</h2>
                            <button onclick="document.getElementById('export-modal').remove()" class="text-2xl font-bold hover:text-red-500">×</button>
                        </div>
                        <div class="space-y-3">
                            <button onclick="window.exporter.exportJSON()" class="w-full nb-button info">
                                Export as JSON
                            </button>
                            <button onclick="window.exporter.exportCSV()" class="w-full nb-button success">
                                Export as CSV
                            </button>
                            <button onclick="window.exporter.exportMarkdown()" class="w-full nb-button secondary">
                                Export as Markdown
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.innerHTML = menuHtml;
        document.body.appendChild(modal.firstElementChild);

        // Close on click outside
        document.getElementById('export-modal').addEventListener('click', (e) => {
            if (e.target.id === 'export-modal') {
                e.target.remove();
            }
        });
    }

    exportJSON() {
        if (!globalState.videos || globalState.videos.length === 0) {
            if (window.toast) {
                window.toast.warning('No videos to export. Load some videos first!');
            }
            return;
        }

        const data = {
            exportDate: new Date().toISOString(),
            totalVideos: globalState.videos.length,
            channelId: globalState.channelId,
            videos: globalState.videos.map(v => ({
                id: v.id,
                title: v.title,
                description: v.description,
                publishedAt: v.publishedAt,
                viewCount: v.viewCount,
                likeCount: v.likeCount,
                commentCount: v.commentCount,
                duration: v.duration,
                thumbnailUrl: v.thumbnailUrl,
                url: `https://www.youtube.com/watch?v=${v.id}`
            }))
        };

        this.downloadFile(
            JSON.stringify(data, null, 2),
            `tubesort-export-${Date.now()}.json`,
            'application/json'
        );

        if (window.toast) {
            window.toast.success(`Exported ${data.totalVideos} videos as JSON`);
        }
        document.getElementById('export-modal')?.remove();
    }

    exportCSV() {
        if (!globalState.videos || globalState.videos.length === 0) {
            if (window.toast) {
                window.toast.warning('No videos to export. Load some videos first!');
            }
            return;
        }

        const headers = ['Title', 'URL', 'Published Date', 'Views', 'Likes', 'Comments', 'Duration'];
        const rows = globalState.videos.map(v => [
            this.escapeCSV(v.title),
            `https://www.youtube.com/watch?v=${v.id}`,
            v.publishedAt,
            v.viewCount || 0,
            v.likeCount || 0,
            v.commentCount || 0,
            v.duration || 'N/A'
        ]);

        const csv = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        this.downloadFile(
            csv,
            `tubesort-export-${Date.now()}.csv`,
            'text/csv'
        );

        if (window.toast) {
            window.toast.success(`Exported ${rows.length} videos as CSV`);
        }
        document.getElementById('export-modal')?.remove();
    }

    exportMarkdown() {
        if (!globalState.videos || globalState.videos.length === 0) {
            if (window.toast) {
                window.toast.warning('No videos to export. Load some videos first!');
            }
            return;
        }

        const markdown = [
            `# TubeSort Export`,
            ``,
            `**Export Date:** ${new Date().toLocaleString()}`,
            `**Total Videos:** ${globalState.videos.length}`,
            ``,
            `---`,
            ``,
            ...globalState.videos.map((v, i) => [
                `## ${i + 1}. ${v.title}`,
                ``,
                `- **URL:** https://www.youtube.com/watch?v=${v.id}`,
                `- **Published:** ${new Date(v.publishedAt).toLocaleDateString()}`,
                `- **Views:** ${(v.viewCount || 0).toLocaleString()}`,
                `- **Likes:** ${(v.likeCount || 0).toLocaleString()}`,
                `- **Duration:** ${v.duration || 'N/A'}`,
                ``,
                v.description ? `> ${v.description.substring(0, 200)}${v.description.length > 200 ? '...' : ''}` : '',
                ``,
                `---`,
                ``
            ].join('\n'))
        ].join('\n');

        this.downloadFile(
            markdown,
            `tubesort-export-${Date.now()}.md`,
            'text/markdown'
        );

        if (window.toast) {
            window.toast.success(`Exported ${globalState.videos.length} videos as Markdown`);
        }
        document.getElementById('export-modal')?.remove();
    }

    escapeCSV(str) {
        if (!str) return '';
        str = String(str);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize exporter
window.exporter = new DataExporter();
