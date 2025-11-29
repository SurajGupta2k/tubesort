import { updateLoadingStatus } from '../ui/renderer.js';

export async function getCachedData(key, collection = 'videos') {
    try {
        console.log(`[Cache] Checking cache for key: ${key.substring(0, 100)}... in collection: ${collection}`);
        updateLoadingStatus('Checking cache...', true);
        
        const response = await fetch(`/api/cache/get`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, collection })
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                console.log('[Cache] Cache miss');
                updateLoadingStatus('Cache miss, fetching from YouTube API...');
                return null;
            }
            throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
        }

        const result = await response.json();
        
        if (!result.data) {
            console.log('[Cache] No data in response');
            updateLoadingStatus('Cache miss, fetching from YouTube API...');
            return null;
        }
        
        console.log('[Cache] Cache hit:', result.data);
        updateLoadingStatus('Found in cache!', true, false, true);
        return result.data;
    } catch (error) {
        console.error('[Cache] Error getting cached data:', error);
        updateLoadingStatus('Cache error, falling back to YouTube API...');
        return null;
    }
}

export async function cacheData(key, data, collection = 'videos') {
    try {
        if (!key || !data) {
            throw new Error('Key and data are required for caching');
        }

        console.log(`[Cache] Storing data for key: ${key} in collection: ${collection}`);
        updateLoadingStatus('Saving to database...', true);
        
        // Validate data structure before caching
        const validatedData = {};
        if (Array.isArray(data.videos)) {
            validatedData.videos = data.videos;
        }
        if (data.channelId) {
            validatedData.channelId = data.channelId;
        }
        if (data.uploadsPlaylistId) {
            validatedData.uploadsPlaylistId = data.uploadsPlaylistId;
        }
        if (data.categories && typeof data.categories === 'object') {
            validatedData.categories = data.categories;
        }

        if (Object.keys(validatedData).length === 0) {
            throw new Error('No valid data to cache');
        }

        // Retry logic with exponential backoff
        let attempts = 0;
        const maxAttempts = 3;
        let lastError = null;

        while (attempts < maxAttempts) {
            try {
                const response = await fetch('/api/cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        key,
                        data: validatedData,
                        collection
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Server responded with status ${response.status}`);
                }

                const result = await response.json();
                console.log('[Cache] Data cached successfully:', result);
                updateLoadingStatus('Saved successfully!', false, false, true);
                return result;

            } catch (error) {
                lastError = error;
                attempts++;
                if (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
                    console.log(`[Cache] Retry attempt ${attempts}/${maxAttempts}`);
                }
            }
        }

        console.error('[Cache] All retry attempts failed:', lastError);
        updateLoadingStatus('Failed to save data.', false);
        throw lastError;

    } catch (error) {
        console.error('[Cache] Critical error in cacheData:', error);
        updateLoadingStatus('Failed to save data.', false);
        throw error;
    }
}