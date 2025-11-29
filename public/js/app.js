import { globalState, setVideos, clearChannelInfo } from './state.js';
import { renderPaginatedView, clearContent, updateLoadingStatus } from './ui/renderer.js';
import { getChannelDetails, getChannelIdByHandle, loadPlaylistData, loadChannelData } from './services/youtube.js';
import { categorizeVideos } from './services/gemini.js';

// This is the main function that kicks things off. It grabs the URL the user
// entered, figures out what kind of link it is (playlist, channel, etc.),
// and then fetches the videos.
export async function loadContent() {
    updateLoadingStatus('Starting...', true);
    clearContent();
    clearChannelInfo();
    
    const url = document.getElementById('playlist-url').value.trim();

    try {
        if (!url) throw new Error('Please enter a YouTube channel or playlist URL.');

        const playlistIdMatch = url.match(/list=([^&]+)/);
        if (playlistIdMatch) {
            await loadPlaylistData(playlistIdMatch[1]);
            return;
        }

        const channelHandleMatch = url.match(/^https?:\/\/(www\.)?youtube\.com\/@([\w-]+)/);
        if (channelHandleMatch) {
            await getChannelIdByHandle(channelHandleMatch[2]);
            return;
        }

        const channelIdMatch = url.match(/channel\/([A-Za-z0-9_-]{24})/);
        if (channelIdMatch) {
            await getChannelDetails(channelIdMatch[1]);
            return;
        }
        
        throw new Error('Please enter a valid YouTube channel URL (e.g., https://youtube.com/@username) or playlist URL.');

    } catch (error) {
        console.error('Error loading content:', error);
        if (window.toast) {
            window.toast.error(error.message || 'An unexpected error occurred.');
        }
        updateLoadingStatus(null);
    }
}

// The manualCache function has been removed in favor of automatic caching.

// Once a channel is loaded, this handles switching between viewing
// regular videos and live streams.
export function handleChannelContentTypes(type) {
    loadChannelData(type);
}

// This is our workhorse for updating the view. It takes the full list of videos
// and applies any active sorting or search filters before displaying them.
export function applySortAndRender() {
    let filteredVideos = [...globalState.masterVideoList];

    // 1. Filter by search term
    if (globalState.currentSearchTerm) {
        const searchTerm = globalState.currentSearchTerm.toLowerCase();
        filteredVideos = filteredVideos.filter(video =>
            (video.title || '').toLowerCase().includes(searchTerm)
        );
    }

    // 2. Filter by date range
    if (globalState.currentStartDate) {
        const startDate = new Date(globalState.currentStartDate);
        // Set to the beginning of the day
        startDate.setHours(0, 0, 0, 0); 
        filteredVideos = filteredVideos.filter(video => {
            const videoDate = new Date(video.publishedAt);
            return videoDate >= startDate;
        });
    }
    if (globalState.currentEndDate) {
        const endDate = new Date(globalState.currentEndDate);
        // Set to the end of the day to include all videos on that day
        endDate.setHours(23, 59, 59, 999); 
        filteredVideos = filteredVideos.filter(video => {
            const videoDate = new Date(video.publishedAt);
            return videoDate <= endDate;
        });
    }

    // 3. Apply sorting
    switch (globalState.currentSort) {
        case 'date_asc':
            filteredVideos.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
            break;
        case 'date_desc':
            filteredVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
            break;
        case 'views_desc':
            filteredVideos.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
            break;
    }

    globalState.videos = filteredVideos;
    renderPaginatedView();
}

// New function to handle date filtering from the UI
export function filterAndDisplayByDate(clear = false) {
    if (clear) {
        globalState.currentStartDate = null;
        globalState.currentEndDate = null;
        document.getElementById('start-date').value = '';
        document.getElementById('end-date').value = '';
    } else {
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        
        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
            if (window.toast) {
                window.toast.warning('Start date cannot be after the end date.');
            }
            return;
        }

        globalState.currentStartDate = startDate || null;
        globalState.currentEndDate = endDate || null;
    }
    applySortAndRender();
}

// When the user picks a new way to sort the videos, this function gets called.
export function sortVideos(sortBy) {
    if (globalState.masterVideoList.length === 0) return;
    globalState.currentSort = sortBy;
    applySortAndRender();
}

// This runs whenever the user types something in the search bar.
export function searchAndDisplayVideos() {
    globalState.currentSearchTerm = document.getElementById('search-input').value.trim();
    applySortAndRender();
}

// This function starts the magic AI categorization process.
export function categorizeAndDisplayVideos() {
    categorizeVideos();
}

// Event listeners are now handled in events.js