import { globalState, paginationState, setCurrentPage } from '../state.js';
import { formatFullDate, formatViewCount, normalizeVideoObject } from '../utils.js';

// This keeps track of the currently playing YouTube video so we can manage it.
let activePlayer = null;
let activeEscapeHandler = null;

// A helper to close the video popup. It stops the video and removes the overlay.
function closeVideoOverlay(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (!overlay) return;

    if (activePlayer) {
        try {
            activePlayer.destroy();
        } catch (e) {
            console.error('[PLAYER] Error destroying player:', e);
        }
        activePlayer = null;
    }
    
    // MEMORY LEAK FIX: Always remove escape handler
    if (activeEscapeHandler) {
        document.removeEventListener('keydown', activeEscapeHandler);
        activeEscapeHandler = null;
    }
    
    overlay.remove();
}

window.closeVideoOverlay = closeVideoOverlay;

// This function takes a list of videos and puts them on the screen as a grid of cards.
export function displayVideos(videosToDisplay) {
    const videoList = document.getElementById('video-list');
    videoList.innerHTML = '';

    const normalizedVideos = videosToDisplay.map(normalizeVideoObject).filter(v => v !== null);

    if (normalizedVideos.length === 0) {
        return;
    }

    normalizedVideos.forEach(video => {
        const videoItem = document.createElement('li');
        videoItem.className = 'nb-video-card';
        videoItem.dataset.videoId = video.id;

        const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;

        videoItem.innerHTML = `
            <div class="thumbnail-container">
                <img src="${video.thumbnail}" alt="${video.title}" loading="lazy">
            </div>
            <div class="video-info">
                <a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="video-title-link">
                    <p class="video-title">${video.title}</p>
                </a>
                <div class="video-details">
                    <span class="detail-badge ${video.isStream ? 'stream' : 'video'}">${video.isStream ? 'Live Stream' : 'Video'}</span>
                    <p class="detail-text">${formatFullDate(video.publishedAt)}</p>
                    <p class="detail-text">${formatViewCount(video.viewCount)} views</p>
                </div>
            </div>
        `;

        // When a thumbnail is clicked, we open a video player right on the page.
        const thumbnail = videoItem.querySelector('.thumbnail-container');
        thumbnail.addEventListener('click', () => {
            const overlayId = `video-overlay-${video.id}`;
            let overlay = document.getElementById(overlayId);
            if (overlay) {
                overlay.remove();
            }

            overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.className = 'video-overlay';
            overlay.innerHTML = `
                <div class="video-overlay-content">
                    <button class="video-overlay-close">&times;</button>
                    <div class="video-player-container">
                        <div id="player-${video.id}"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
                
            overlay.querySelector('.video-overlay-close').addEventListener('click', () => closeVideoOverlay(overlayId));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    closeVideoOverlay(overlayId);
                }
            });

            // MEMORY LEAK FIX: Store handler reference for proper cleanup
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    closeVideoOverlay(overlayId);
                }
            };
            activeEscapeHandler = handleEscape;
            document.addEventListener('keydown', handleEscape);

            activePlayer = new YT.Player(`player-${video.id}`, {
                height: '100%',
                width: '100%',
                videoId: video.id,
                playerVars: { 'autoplay': 1, 'controls': 1, 'modestbranding': 1, 'rel': 0 },
                events: { 'onReady': (event) => event.target.playVideo() }
            });
        });

        videoList.appendChild(videoItem);
    });
}

// This builds the page number buttons so you can navigate through all the videos.
function renderPaginationControls() {
    const topContainer = document.getElementById('pagination-top');
    const bottomContainer = document.getElementById('pagination-bottom');
    topContainer.innerHTML = '';
    bottomContainer.innerHTML = '';

    const totalItems = globalState.videos.length;
    const totalPages = Math.ceil(totalItems / paginationState.itemsPerPage);

    if (totalPages <= 1) return;

    const createButton = (text, page, isDisabled = false, isActive = false) => {
        const button = document.createElement('button');
        button.className = 'pagination-button';
        button.innerHTML = text;
        if (isDisabled) button.classList.add('disabled');
        if (isActive) button.classList.add('active');
        button.addEventListener('click', () => {
            if (!isDisabled) {
                setCurrentPage(page);
                renderPaginatedView();
                window.scrollTo(0, 0);
            }
        });
        return button;
    };
    
    const createEllipsis = () => {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'pagination-ellipsis';
        ellipsis.innerHTML = '...';
        return ellipsis;
    };

    const addButtons = (container) => {
        container.appendChild(createButton('Prev', paginationState.currentPage - 1, paginationState.currentPage === 1));

        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) {
                container.appendChild(createButton(i, i, false, i === paginationState.currentPage));
            }
        } else {
            container.appendChild(createButton(1, 1, false, 1 === paginationState.currentPage));
            if (paginationState.currentPage > 3) {
                container.appendChild(createEllipsis());
            }
            let startPage = Math.max(2, paginationState.currentPage - 1);
            let endPage = Math.min(totalPages - 1, paginationState.currentPage + 1);
            for (let i = startPage; i <= endPage; i++) {
                container.appendChild(createButton(i, i, false, i === paginationState.currentPage));
            }
            if (paginationState.currentPage < totalPages - 2) {
                container.appendChild(createEllipsis());
            }
            container.appendChild(createButton(totalPages, totalPages, false, totalPages === paginationState.currentPage));
        }
        container.appendChild(createButton('Next', paginationState.currentPage + 1, paginationState.currentPage === totalPages));
    };

    addButtons(topContainer);
    addButtons(bottomContainer);
}

// This function figures out which videos to show for the current page and then displays them.
export function renderPaginatedView() {
    const totalPages = Math.ceil(globalState.videos.length / paginationState.itemsPerPage);
    if (paginationState.currentPage > totalPages && totalPages > 0) {
        setCurrentPage(totalPages);
    }

    const startIndex = (paginationState.currentPage - 1) * paginationState.itemsPerPage;
    const endIndex = startIndex + paginationState.itemsPerPage;
    const videosForPage = globalState.videos.slice(startIndex, endIndex);

    displayVideos(videosForPage);
    renderPaginationControls();
}

// Shows extra options for a channel, like sorting or categorizing.
export function showChannelOptions() {
    const optionsContainer = document.getElementById('channel-options');
    optionsContainer.style.display = 'block';

    // The playlist controls container is left for potential future use.
}

// This handles the loading message and spinner that you see when the app is working.
export function updateLoadingStatus(message, isCache = false, isGemini = false, isSuccess = false) {
    const loadingEl = document.getElementById('loading');
    if (!loadingEl) return;

    const loadingText = loadingEl.querySelector('span');
    const spinner = loadingEl.querySelector('.animate-spin');
    const successAnimation = loadingEl.querySelector('.success-animation');

    if (message) {
        loadingEl.classList.remove('hidden');
        if (loadingText) loadingText.textContent = message;
    } else {
        loadingEl.classList.add('hidden');
    }

    loadingEl.classList.toggle('cache', isCache);
    loadingEl.classList.toggle('api', !isCache && !isGemini);
    loadingEl.classList.toggle('gemini', isGemini);
    loadingEl.classList.toggle('success', isSuccess);

    if (isSuccess) {
        if (spinner) spinner.style.display = 'none';
        if (successAnimation) {
            successAnimation.style.display = 'block';
            const checkmark = successAnimation.querySelector('.checkmark');
            if (checkmark) checkmark.style.display = 'block';
        }
        setTimeout(() => {
            loadingEl.classList.add('hidden');
            if (spinner) spinner.style.display = '';
            if (successAnimation) successAnimation.style.display = 'none';
        }, 2000);
    } else {
        if (spinner) spinner.style.display = '';
        if (successAnimation) successAnimation.style.display = 'none';
    }
}

// This function clears everything off the screen to get ready for new content.
export function clearContent() {
    const videoList = document.getElementById('video-list');
    const categoriesView = document.getElementById('categories-view');
    const categoriesContainer = categoriesView.querySelector('div');
    
    videoList.innerHTML = '';
    videoList.style.display = 'grid';
    
    categoriesView.style.display = 'none';
    if(categoriesContainer) categoriesContainer.innerHTML = '';
    
    const existingReturnButton = document.querySelector('button.fixed.bottom-4.right-4');
    if (existingReturnButton) {
        existingReturnButton.remove();
    }
    
    document.getElementById('channel-options').style.display = 'none';
    
    document.getElementById('pagination-top').innerHTML = '';
    document.getElementById('pagination-bottom').innerHTML = '';
}

// This function displays videos grouped into categories that you can expand and collapse.
export function displayCategories(categories) {
    const videoList = document.getElementById('video-list');
    const categoriesView = document.getElementById('categories-view');
    const categoriesContainer = categoriesView.querySelector('div');

    videoList.style.display = 'none';
    categoriesView.style.display = 'block';
    categoriesContainer.innerHTML = '';

    for (const category in categories) {
        const categoryVideos = categories[category];

        if (categoryVideos.length === 0) {
            continue;
        }
        
        const categoryId = `category-${category.replace(/\s+/g, '-')}`;

        const categoryHeader = document.createElement('button');
        categoryHeader.className = 'category-header';
        categoryHeader.innerHTML = `
            <span>${category} - ${categoryVideos.length} videos</span>
            <span class="arrow">▼</span>
        `;
        
        const categoryVideosContainer = document.createElement('div');
        categoryVideosContainer.className = 'category-videos';
        categoryVideosContainer.id = categoryId;
        
        categoryVideos.forEach(video => {
             const videoItem = document.createElement('div');
             videoItem.className = 'nb-video-card-small';
             videoItem.dataset.videoId = video.id;
             const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
             videoItem.innerHTML = `
                <div class="thumbnail-container">
                    <img src="${video.thumbnail}" alt="${video.title}" loading="lazy">
                </div>
                <div class="video-info">
                     <a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="video-title-link">
                        <p class="video-title">${video.title}</p>
                    </a>
                </div>
             `;
             categoryVideosContainer.appendChild(videoItem);
        });

        categoriesContainer.appendChild(categoryHeader);
        categoriesContainer.appendChild(categoryVideosContainer);
        
        categoryHeader.addEventListener('click', function() {
            this.classList.toggle('active');
            const content = this.nextElementSibling;
            if (content.style.maxHeight) {
                content.style.maxHeight = null;
                content.style.padding = "0 18px";
            } else {
                content.style.padding = "1rem 18px";
                content.style.maxHeight = content.scrollHeight + "px";
            }
        });
    }

    // We add a button so the user can get back to the normal grid view.
    const returnButton = document.createElement('button');
    returnButton.className = 'return-to-grid';
    returnButton.textContent = 'Return to Grid View';
    returnButton.onclick = () => {
        categoriesView.style.display = 'none';
        videoList.style.display = 'grid';
        returnButton.remove();
    };
    document.body.appendChild(returnButton);
} 