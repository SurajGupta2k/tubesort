import {
    loadContent,
    handleChannelContentTypes,
    sortVideos,
    searchAndDisplayVideos,
    categorizeAndDisplayVideos,
    filterAndDisplayByDate
} from './app.js';

// This is where we hook up all the buttons and inputs to make the page interactive.
export function setupEventListeners() {
    // This handles the main "Load" button and pressing Enter in the URL bar.
    document.getElementById('load-content').addEventListener('click', loadContent);
    
    document.getElementById('playlist-url').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadContent();
    });

    // These buttons appear after a channel is loaded, letting you pick between videos or streams.
    document.getElementById('load-videos').addEventListener('click', () => handleChannelContentTypes('videos'));
    document.getElementById('load-streams').addEventListener('click', () => handleChannelContentTypes('streams'));

    // Hooking up all the sorting options.
    document.getElementById('sort-old-new').addEventListener('click', () => sortVideos('date_asc'));
    document.getElementById('sort-new-old').addEventListener('click', () => sortVideos('date_desc'));
    document.getElementById('sort-views').addEventListener('click', () => sortVideos('views_desc'));
    
    // Making the search bar work, both on click and with the Enter key.
    document.getElementById('search-video').addEventListener('click', searchAndDisplayVideos);
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchAndDisplayVideos();
    });

    // Debounced search - search as you type with 300ms delay
    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const value = e.target.value.trim();
        
        if (value.length === 0) {
            // Clear search immediately if input is empty
            searchAndDisplayVideos();
        } else if (value.length >= 2) {
            // Only search if 2+ characters
            searchTimeout = setTimeout(() => {
                searchAndDisplayVideos();
            }, 300);
        }
    });

    // Wire up the date filter buttons
    document.getElementById('filter-by-date').addEventListener('click', () => filterAndDisplayByDate());
    document.getElementById('clear-date-filter').addEventListener('click', () => filterAndDisplayByDate(true));

    // The button that tells the AI to categorize the videos.
    document.getElementById('categorize-videos').addEventListener('click', categorizeAndDisplayVideos);

    // Just a little quality-of-life thing to stop the browser from suggesting old URLs.
    document.getElementById('playlist-url').setAttribute('autocomplete', 'off');
}