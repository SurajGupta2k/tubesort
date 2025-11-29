// NOTE: Due to Google's client library architecture, API keys must be in frontend
// This is a limitation of using gapi.client - it requires browser-side keys
// The keys are restricted by domain/IP in Google Cloud Console for security
let GEMINI_API_KEY = null;
let youtubeApiKeys = [];

export const API_ENDPOINTS = {
    YOUTUBE_BASE: 'https://www.googleapis.com/youtube/v3',
    GEMINI_BASE: 'https://generativelanguage.googleapis.com/v1beta'
};

export const DB_CONFIG = {
    dbName: 'ytweb',
    collections: {
        channels: 'channels',
        videos: 'videos',
        categories: 'categories',
        playlists: 'playlists'
    },
    cacheExpiry: {
        channels: 24,
        videos: 12,
        categories: 48,
        playlists: 24
    }
};

export async function initConfig() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        GEMINI_API_KEY = config.geminiApiKey;
        youtubeApiKeys = config.youtubeApiKeys || [];
        console.log('[CONFIG] Configuration loaded successfully');
        return config;
    } catch (error) {
        console.error('[CONFIG] Error loading configuration:', error);
        throw error;
    }
}

export function getGeminiApiKey() {
    return GEMINI_API_KEY;
}

export function getYouTubeApiKeys() {
    return youtubeApiKeys;
}
