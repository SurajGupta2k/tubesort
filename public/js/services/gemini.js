import { getGeminiApiKey, API_ENDPOINTS } from '../config.js';
import { globalState } from '../state.js';
import { updateLoadingStatus, displayCategories } from '../ui/renderer.js';
import { getCachedData, cacheData } from './cache.js';

// This whole thing is for talking to Google's Gemini AI to sort videos into categories.
export async function categorizeVideos() {
    // First, make sure there are actually videos to work with.
    if (!globalState.videos || globalState.videos.length === 0) {
        if (window.toast) {
            window.toast.warning('No videos to categorize. Please load some videos first.');
        }
        return;
    }

    console.log('[Categorize] Starting video categorization');
    updateLoadingStatus('Preparing to categorize videos...', false, true);

    const videos = globalState.videos;
    const playlistId = videos[0]?.playlistId;
    // We create a unique key for this specific set of videos to use for caching.
    // This way, we don't have to ask the AI again for the same list.
    const categorizationKey = playlistId 
        ? `categorization_playlist_${playlistId}` 
        : `categorization_videos_${videos.map(v => v.id).sort().join(',')}`;

    try {
        // Let's check if we've already categorized this list before.
        const cachedCategories = await getCachedData(categorizationKey, 'categories');
        if (cachedCategories && cachedCategories.categories) {
            console.log('[Categorize] Using cached categories');
            updateLoadingStatus('Loading categories from cache...', true, false, true);
            // Sweet, we found it in the cache. Just show it and we're done.
            displayCategories(cachedCategories.categories);
            return;
        }

        // If it's not in the cache, we have to do the heavy lifting with the AI.
        updateLoadingStatus('Analyzing content with AI...', false, true);
        
        // Process larger batches in parallel for maximum speed
        const BATCH_SIZE = 200; // Increased from 50 for faster processing
        const totalBatches = Math.ceil(videos.length / BATCH_SIZE);
        const MAX_PARALLEL = 3; // Process up to 3 batches simultaneously
        let allCategories = {};

        // Create batch promises for parallel processing
        const batchPromises = [];
        
        for (let i = 0; i < totalBatches; i++) {
            const start = i * BATCH_SIZE;
            const end = start + BATCH_SIZE;
            const batchVideos = videos.slice(start, end);
            
            const batchPromise = (async () => {
                updateLoadingStatus(`Processing batch ${i + 1}/${totalBatches} (${batchVideos.length} videos)...`, false, true);

                const videoTitles = batchVideos.map((video, index) => `${start + index}. ${video.title}`).join('\n');
                
                // Simplified prompt for faster processing (no justifications needed)
                const analysisPrompt = `Analyze these video titles and group them into meaningful categories based on themes, topics, or content type.

Video titles:
${videoTitles}

Return JSON array format:
[{"category": "Category Name", "videos": [{"title": "Video Title"}]}]`;

                const geminiApiKey = getGeminiApiKey();
                if (!geminiApiKey) throw new Error('Gemini API key not available.');

                // Use Flash model for 10x faster processing
                const response = await fetch(`${API_ENDPOINTS.GEMINI_BASE}/models/gemini-2.0-flash-exp:generateContent?key=${geminiApiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: analysisPrompt }] }],
                        generationConfig: { 
                            temperature: 0.1,  // Lower for consistency
                            maxOutputTokens: 8192,
                            responseMimeType: "application/json"
                        }
                    })
                });

                if (!response.ok) {
                    const errorData = await response.text();
                    throw new Error(`Batch ${i + 1} failed: ${errorData}`);
                }

                const responseData = await response.json();
                const responseText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!responseText) throw new Error('Invalid response structure from API');

                // Clean and parse response
                let cleanedText = responseText.trim().replace(/^```json|```$/g, '');
                
                let parsedCategories;
                try {
                    if (cleanedText.startsWith('{')) {
                        cleanedText = `[${cleanedText}]`;
                    }
                    parsedCategories = JSON.parse(cleanedText);
                } catch (parseError) {
                    console.error(`[Categorize] Batch ${i + 1} parse error:`, parseError);
                    return {}; // Return empty if parse fails, don't break whole process
                }

                // Return categorized results for this batch
                const batchCategories = {};
                parsedCategories.forEach(categoryObj => {
                    const categoryName = categoryObj.category;
                    if (!categoryName || !Array.isArray(categoryObj.videos)) return;

                    if (!batchCategories[categoryName]) {
                        batchCategories[categoryName] = [];
                    }
                    
                    categoryObj.videos.forEach(videoInfo => {
                        const originalVideo = videos.find(v => v.title === videoInfo.title);
                        if (originalVideo) {
                            batchCategories[categoryName].push(originalVideo);
                        }
                    });
                });
                
                console.log(`[Categorize] Batch ${i + 1} completed: ${Object.keys(batchCategories).length} categories`);
                return batchCategories;
            })();
            
            batchPromises.push(batchPromise);
            
            // Process in parallel batches of MAX_PARALLEL
            if (batchPromises.length >= MAX_PARALLEL || i === totalBatches - 1) {
                const results = await Promise.all(batchPromises);
                
                // Merge all batch results
                results.forEach(batchCategories => {
                    Object.keys(batchCategories).forEach(categoryName => {
                        if (!allCategories[categoryName]) {
                            allCategories[categoryName] = [];
                        }
                        allCategories[categoryName].push(...batchCategories[categoryName]);
                    });
                });
                
                batchPromises.length = 0; // Clear for next parallel batch
            }
        }

        if (Object.keys(allCategories).length === 0) throw new Error('No categories were generated.');

        // All done! Let's save these results to the cache for next time.
        await cacheData(categorizationKey, { categories: allCategories }, 'categories');
        // And finally, show the categories on the screen.
        displayCategories(allCategories);

    } catch (error) {
        console.error('[Categorize] Error:', error);
        if (window.toast) {
            window.toast.error('Failed to categorize videos: ' + error.message);
        }
        updateLoadingStatus('Categorization failed.', false);
    } finally {
        // Always hide the loading spinner when we're finished, success or fail.
        updateLoadingStatus(null);
    }
} 