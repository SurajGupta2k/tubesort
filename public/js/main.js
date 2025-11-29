import { initConfig } from './config.js';
import { initYouTubeAPI } from './services/youtube.js';
import { setupEventListeners } from './events.js';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initConfig();
        await initYouTubeAPI();
        setupEventListeners();
        console.log('Application initialized successfully.');
    } catch (error) {
        console.error('Failed to initialize the application:', error);
        if (window.toast) {
            window.toast.error(`Failed to initialize: ${error.message}. Please refresh the page.`);
        }
    }
}); 