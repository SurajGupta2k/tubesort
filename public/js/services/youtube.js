import { getYouTubeApiKeys } from '../config.js';
import { globalState, setVideos, setChannelInfo } from '../state.js';
import { renderPaginatedView, showChannelOptions, updateLoadingStatus } from '../ui/renderer.js';
import { getCachedData, cacheData } from './cache.js';
import { normalizeVideoObject, isStreamVideo } from '../utils.js';
import { applySortAndRender } from '../app.js';

let currentApiKeys = [];

// This whole file is for talking to the YouTube API.

// If we hit our daily API limit, this function asks our server for a new key.
// This lets us keep fetching data even if one key runs out of requests.
async function rotateApiKey() {
    try {
        const response = await fetch('/api/rotate-key', { method: 'POST' });
        const data = await response.json();
        
        if (data.keyRotated) {
            currentApiKeys = data.youtubeApiKeys;
            console.log('API key rotated successfully');
            return getCurrentApiKey();
        } else {
            throw new Error('Failed to rotate API key');
        }
    } catch (error) {
        console.error('Error rotating API key:', error);
        throw error;
    }
}

// Just a simple way to get the current API key we're using.
export function getCurrentApiKey() {
    if (currentApiKeys.length === 0) {
        console.error("API keys not initialized");
        return null;
    }
    return currentApiKeys[0];
}

// This sets up the official Google API client. It's what lets us talk to YouTube.
// If the first key we try is bad, it'll automatically try to rotate it and try again.
export async function initYouTubeAPI() {
    return new Promise((resolve, reject) => {
        currentApiKeys = getYouTubeApiKeys();
        if (!getCurrentApiKey()) {
            return reject(new Error("YouTube API keys are not loaded in config."));
        }

        gapi.load('client', () => {
            gapi.client.init({
                apiKey: getCurrentApiKey(),
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest']
            }).then(() => {
                console.log('YouTube API initialized');
                resolve();
            }).catch(async (error) => {
                console.error('Error initializing YouTube API:', error);
                if (error.result?.error?.message.includes('API key not valid')) {
                    console.log('Initial API key is invalid. Attempting to rotate...');
                    try {
                        await rotateApiKey();
                        await gapi.client.setApiKey(getCurrentApiKey());
                        console.log('Retrying API initialization with new key.');
                        await gapi.client.init({
                            apiKey: getCurrentApiKey(),
                            discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest']
                        });
                        resolve();
                    } catch (rotationError) {
                        reject(new Error('Failed to initialize YouTube API after key rotation.'));
                    }
                } else {
                    reject(error);
                }
            });
        });
    });
}

// Grabs basic channel info using its ID. The most important thing we need
// is the special "uploads" playlist ID, which contains all of the channel's videos.
export async function getChannelDetails(channelId) {
    try {
        const channelResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${getCurrentApiKey()}`);
        const channelData = await channelResponse.json();
        
        if (!channelResponse.ok) {
            if (channelData.error && channelData.error.message && channelData.error.message.includes('quota')) throw new Error('quota exceeded');
            throw new Error(channelData.error?.message || 'Failed to fetch channel details');
        }

        const channelItem = channelData.items?.[0];
        if (!channelItem?.contentDetails?.relatedPlaylists?.uploads) {
            throw new Error('Channel uploads playlist not found');
        }

        setChannelInfo(channelItem.id, channelItem.contentDetails.relatedPlaylists.uploads);
        showChannelOptions();
    } catch (error) {
        console.error('Error getting channel details:', error);
        if (error.message.includes('quota')) {
            await rotateApiKey();
            return getChannelDetails(channelId);
        }
        throw new Error('Failed to load channel details. Please try again.');
    }
}

// This is for when a user enters a channel handle like "@MrBeast" instead of the weird ID.
// We first check if we've seen this handle before to save an API call.
// If not, we ask our server to find the real channel ID, then we fetch its details.
export async function getChannelIdByHandle(channelHandle) {
    const cleanHandle = channelHandle.startsWith('@') ? channelHandle.substring(1) : channelHandle;
    const cacheKey = `channel_handle_${cleanHandle}_resolved`;

    const cachedData = await getCachedData(cacheKey, 'channels');
    if (cachedData) {
        console.log('Using cached resolved handle data:', cleanHandle);
        setChannelInfo(cachedData.channelId, cachedData.uploadsPlaylistId);
        showChannelOptions();
        return;
    }

    try {
        const resolveResponse = await fetch(`/api/resolve-handle?handle=${encodeURIComponent(cleanHandle)}`);
        const resolveData = await resolveResponse.json();

        if (!resolveResponse.ok) {
            throw new Error(resolveData.error || `Failed to resolve handle '@${cleanHandle}'.`);
        }
        const { channelId } = resolveData;

        const detailsUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${getCurrentApiKey()}`;
        const detailsResponse = await fetch(detailsUrl);
        const detailsData = await detailsResponse.json();

        if (!detailsResponse.ok) {
            if (detailsData.error && detailsData.error.message && detailsData.error.message.includes('quota')) throw new Error('quota exceeded');
            throw new Error('Could not retrieve channel details after resolving handle.');
        }

        const uploadsPlaylistId = detailsData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (!uploadsPlaylistId) {
            throw new Error('Channel uploads playlist not found.');
        }
        
        setChannelInfo(channelId, uploadsPlaylistId);
        showChannelOptions();

        await cacheData(cacheKey, { 
            channelId, 
            uploadsPlaylistId 
        }, 'channels');

    } catch (error) {
        console.error('Error finding channel by handle:', error.message);
        if (error.message.includes('quota')) {
            await rotateApiKey();
            return getChannelIdByHandle(channelHandle);
        }
        throw error;
    }
}

// Fetches all videos from a given playlist.
// It checks for a cached version first. If not available, it fetches from YouTube
// in batches of 50 to handle very large playlists without timing out.
export async function loadPlaylistData(playlistId) {
    updateLoadingStatus('Checking cache for playlist...');
    const cachedData = await getCachedData(`playlist_${playlistId}`, 'playlists');

    if (cachedData && cachedData.videos) {
        console.log('[Playlist] Using cached playlist data');
        updateLoadingStatus('Loading playlist from cache...', true);
        setVideos(cachedData.videos.map(normalizeVideoObject));
        renderPaginatedView();
        return;
    }
    
    let allVideos = [];
    let nextPageToken = '';
    updateLoadingStatus('Fetching playlist data from YouTube API...');

    try {
        do {
            updateLoadingStatus(`Fetching videos... (${allVideos.length} loaded)`);
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${getCurrentApiKey()}&pageToken=${nextPageToken}`
            );
            const data = await response.json();

            if (!response.ok) {
                if (data.error && data.error.message && data.error.message.includes('quota')) throw new Error('quota exceeded');
                throw new Error(data.error?.message || 'Failed to fetch playlist items');
            }

            if (!data.items?.length) break;

            const videoIds = data.items
                .map(item => item.snippet?.resourceId?.videoId)
                .filter(Boolean)
                .join(',');
            
            if (videoIds) {
                const statsResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails,liveStreamingDetails,status&id=${videoIds}&key=${getCurrentApiKey()}`);
                const statsData = await statsResponse.json();
                if (!statsResponse.ok) {
                    if (statsData.error && statsData.error.message && statsData.error.message.includes('quota')) throw new Error('quota exceeded');
                } else {
                     allVideos = allVideos.concat(statsData.items || []);
                }
            }

            nextPageToken = data.nextPageToken;
        } while (nextPageToken);

        if (allVideos.length === 0) throw new Error('No videos found in this playlist');

        // Immediately render the videos for the user
        setVideos(allVideos.map(normalizeVideoObject));
        applySortAndRender();
        updateLoadingStatus('Playlist loaded successfully!', false, false, true);

        // Automatically cache the result in the background
        cacheData(`playlist_${playlistId}`, { videos: allVideos }, 'playlists')
            .then(() => console.log('[Cache] Playlist automatically cached in background.'))
            .catch(err => console.error('[Cache] Background playlist caching failed:', err));

    } catch (error) {
        console.error('[Playlist] Error:', error);
        if (error.message.includes('quota')) {
            await rotateApiKey();
            return loadPlaylistData(playlistId);
        }
        throw new Error(error.message || 'Failed to load playlist data');
    }
}

// This loads content from a channel's main uploads playlist.
// It's smart enough to filter between regular videos and live streams based on the 'type' parameter.
// Like other functions here, it uses caching and will retry with a new API key if it hits a quota limit.
export async function loadChannelData(type) {
    if (!globalState.channelId) return;
    
    updateLoadingStatus(`Checking cache for channel ${type}...`);
    const cacheKey = `channel_${globalState.channelId}_${type}`;
    const cachedData = await getCachedData(cacheKey, 'channels');

    if (cachedData && cachedData.videos) {
        console.log(`[Channel] Using cached ${type} data`);
        updateLoadingStatus(`Loading ${type} from cache...`, true);
        setVideos(cachedData.videos.map(normalizeVideoObject));
        renderPaginatedView();
        return;
    }

    let allVideos = [];
    let nextPageToken = '';
    updateLoadingStatus(`Fetching ${type} from YouTube API...`);
    
    try {
        do {
            updateLoadingStatus(`Fetching ${type}... (${allVideos.length} loaded)`);
            const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${globalState.uploadsPlaylistId}&key=${getCurrentApiKey()}&pageToken=${nextPageToken}`);
            const data = await response.json();

            if (!response.ok) {
                if (data.error && data.error.message && data.error.message.includes('quota')) throw new Error('quota exceeded');
                throw new Error(data.error?.message || response.statusText);
            }

            if (!data.items?.length) break;

            const videoIds = data.items
                .map(item => item.snippet?.resourceId?.videoId)
                .filter(Boolean)
                .join(',');

            if (videoIds) {
                const detailsResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails,liveStreamingDetails,status&id=${videoIds}&key=${getCurrentApiKey()}`);
                const detailsData = await detailsResponse.json();

                if (!detailsResponse.ok) {
                     if (detailsData.error && detailsData.error.message && detailsData.error.message.includes('quota')) throw new Error('quota exceeded');
                } else if (detailsData.items) {
                    const filtered = detailsData.items.filter(videoItem => {
                        const isVideoStream = isStreamVideo(videoItem);
                        return type === 'streams' ? isVideoStream : !isVideoStream;
                    });
                    allVideos = allVideos.concat(filtered);
                }
            }
            nextPageToken = data.nextPageToken;
        } while (nextPageToken);

        if (allVideos.length === 0) {
            if (window.toast) {
                window.toast.info(`No ${type === 'streams' ? 'streams' : 'videos'} found for this channel`);
            }
            updateLoadingStatus(null);
        } else {
             setVideos(allVideos.map(normalizeVideoObject));
             applySortAndRender();
             updateLoadingStatus('Channel content loaded!', false, false, true);
             
             // Start caching in the background
             cacheData(cacheKey, { videos: allVideos }, 'channels')
                .catch(err => {
                    console.error('[Cache] Background caching failed:', err);
                });
        }

    } catch (error) {
        console.error('Error loading channel data:', error);
        if (error.message.includes('quota')) {
            await rotateApiKey();
            return loadChannelData(type);
        }
        throw new Error(`Failed to load channel ${type}`);
    }
} 