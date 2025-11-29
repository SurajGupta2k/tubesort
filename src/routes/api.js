import express from 'express';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

// Database configuration - backend version
const DB_CONFIG = {
    dbName: 'ytweb',
    collections: {
        channels: 'channels',
        videos: 'videos',
        categories: 'categories',
        playlists: 'playlists'
    },
    cacheExpiry: {
        channels: 24,    // hours
        videos: 12,      // hours
        categories: 48,  // hours
        playlists: 24   // hours
    }
};

const router = express.Router();

// Simple health check route that doesn't require database
router.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Mutex for thread-safe key rotation
let keyRotationLock = false;

// We have a bunch of YouTube API keys to avoid hitting our daily limits.
// This section handles automatically switching to a fresh key when one has been used too much.
const keyUsageTracking = {
    youtube: {
        currentKeyIndex: 0,
        quotaResets: new Map(),
        usageCount: new Map(),
    }
};

// Helper to get all YouTube API keys
function getYouTubeApiKeys() {
    return [
        process.env.YOUTUBE_API_KEY_1,
        process.env.YOUTUBE_API_KEY_2,
        process.env.YOUTUBE_API_KEY_3,
        process.env.YOUTUBE_API_KEY_4,
        process.env.YOUTUBE_API_KEY_5
    ].filter(Boolean);
}

function initializeKeyTracking() {
    const youtubeApiKeys = getYouTubeApiKeys();

    if (youtubeApiKeys.length === 0) {
        console.error('WARNING: No YouTube API keys configured!');
    }

    youtubeApiKeys.forEach((key, index) => {
        keyUsageTracking.youtube.quotaResets.set(index, new Date());
        keyUsageTracking.youtube.usageCount.set(index, 0);
    });
}

async function rotateYoutubeKey() {
    // Thread-safe key rotation with mutex
    while (keyRotationLock) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    keyRotationLock = true;
    
    try {
        const youtubeApiKeys = getYouTubeApiKeys();
        
        if (youtubeApiKeys.length === 0) {
            throw new Error('No YouTube API keys available');
        }

        keyUsageTracking.youtube.currentKeyIndex = 
            (keyUsageTracking.youtube.currentKeyIndex + 1) % youtubeApiKeys.length;
        
        const lastReset = keyUsageTracking.youtube.quotaResets.get(keyUsageTracking.youtube.currentKeyIndex);
        const now = new Date();
        if (lastReset && (now - lastReset) >= 24 * 60 * 60 * 1000) {
            keyUsageTracking.youtube.usageCount.set(keyUsageTracking.youtube.currentKeyIndex, 0);
            keyUsageTracking.youtube.quotaResets.set(keyUsageTracking.youtube.currentKeyIndex, now);
        }

        console.log(`[KEY ROTATION] Switched to key index ${keyUsageTracking.youtube.currentKeyIndex}`);
        return youtubeApiKeys[keyUsageTracking.youtube.currentKeyIndex];
    } finally {
        keyRotationLock = false;
    }
}

initializeKeyTracking();

let client;
let db;
let isConnecting = false;
let connectionPromise = null;

async function connectToDatabase() {
    if (isConnecting) {
        return connectionPromise;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error('FATAL ERROR: MONGODB_URI is not set in environment variables');
    }

    try {
        isConnecting = true;
        connectionPromise = new Promise(async (resolve, reject) => {
            try {
                if (!client) {
                    client = new MongoClient(process.env.MONGODB_URI, {
                        serverSelectionTimeoutMS: 3000, // Reduced for serverless
                        socketTimeoutMS: 5000, // Reduced for serverless
                        connectTimeoutMS: 3000, // Added for faster connection
                        maxPoolSize: 1, // Minimal pool for serverless
                        retryWrites: true,
                        w: 'majority'
                    });
                }
                
                await client.connect();
                db = client.db(DB_CONFIG.dbName);
                
                // Quick ping test with timeout
                const pingPromise = db.command({ ping: 1 });
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('MongoDB ping timeout')), 2000)
                );
                
                await Promise.race([pingPromise, timeoutPromise]);
                console.log('Successfully connected to MongoDB and database is ready.');
                
                // Skip index creation in serverless to save time
                // Indexes should be created manually in MongoDB Atlas
                resolve();
            } catch (error) {
                console.error('Failed to connect to MongoDB:', error);
                client = null;
                db = null;
                reject(error);
            } finally {
                isConnecting = false;
            }
        });
        
        return connectionPromise;
    } catch (error) {
        isConnecting = false;
        throw error;
    }
}

// Create database indexes for optimal performance
async function createIndexes() {
    try {
        const collections = Object.values(DB_CONFIG.collections);
        
        for (const collectionName of collections) {
            const collection = db.collection(collectionName);
            
            // Index on key for fast lookups
            await collection.createIndex({ key: 1 }, { unique: true });
            
            // Index on expiresAt for efficient cleanup
            await collection.createIndex({ expiresAt: 1 });
            
            // Compound index for common queries
            await collection.createIndex({ key: 1, expiresAt: 1 });
        }
        
        console.log('[DB] Indexes created successfully');
    } catch (error) {
        console.error('[DB] Error creating indexes:', error);
    }
}

// Graceful shutdown handler - closes database connection
export async function closeDatabase() {
    if (client) {
        try {
            await client.close();
            console.log('[DB] MongoDB connection closed gracefully');
        } catch (error) {
            console.error('[DB] Error closing MongoDB connection:', error);
        }
    }
}

// Ensure database connection
async function ensureConnection() {
    if (!db) {
        await connectToDatabase();
        return;
    }

    try {
        // Test if connection is still alive
        await db.command({ ping: 1 });
    } catch (error) {
        console.log('Database connection lost, reconnecting...');
        await connectToDatabase();
    }
}

// This is a helper that runs before our cache-related routes.
// It figures out which database collection to use based on the request
// and makes sure we're connected to the database.
const cacheMiddleware = async (req, res, next) => {
    try {
        await ensureConnection();
        
        const collectionName = req.body.collection;
        
        if (!collectionName || !DB_CONFIG.collections[collectionName]) {
            return res.status(400).json({ error: `Invalid or missing collection name: '${collectionName}'` });
        }

        req.dbCollection = db.collection(DB_CONFIG.collections[collectionName]);
        next();
    } catch (error) {
        console.error('[API] Critical error in cache middleware:', error);
        res.status(500).json({ error: 'Database connection error. Please try again.' });
    }
};

const getCacheMiddleware = async (req, res, next) => {
    try {
        await ensureConnection();
        
        const collectionName = req.query.collection || req.body.collection;
        
        if (!collectionName || !DB_CONFIG.collections[collectionName]) {
            return res.status(400).json({ error: `Invalid or missing collection name: '${collectionName}'` });
        }

        req.dbCollection = db.collection(DB_CONFIG.collections[collectionName]);
        next();
    } catch (error) {
        console.error('[API] Critical error in get-cache middleware:', error);
        res.status(500).json({ error: 'Database connection error. Please try again.' });
    }
};

// These routes are for basic cache operations: getting and saving items.
// We use the cache to avoid making the same API calls over and over again.
router.get('/cache', getCacheMiddleware, async (req, res) => {
    try {
        console.log('[API] Get cache request:', req.query);
        const { key } = req.query;
        if (!key) {
            console.error('[API] No key provided');
            return res.status(400).json({ error: 'Key is required' });
        }

        // Use atomic findOneAndDelete for expired cache to prevent race conditions
        const now = new Date();
        const data = await req.dbCollection.findOne({ 
            key,
            $or: [
                { expiresAt: { $exists: false } },
                { expiresAt: { $gt: now } }
            ]
        });
        
        console.log('[API] Found data:', data ? 'yes' : 'no');

        if (!data) {
            // Clean up any expired entry
            await req.dbCollection.deleteOne({ key, expiresAt: { $lt: now } });
            return res.status(404).json({ error: 'Cache not found' });
        }

        res.json({ data });
    } catch (error) {
        console.error('[API] Get cache error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// This is just like the GET route above, but uses POST. This is useful
// for when the cache 'key' is very long and might not fit in a URL.
router.post('/cache/get', getCacheMiddleware, async (req, res) => {
    try {
        const { key } = req.body;
        if (!key) {
            return res.status(400).json({ error: 'Key is required' });
        }

        // Use atomic query to prevent race conditions
        const now = new Date();
        const doc = await req.dbCollection.findOne({ 
            key,
            $or: [
                { expiresAt: { $exists: false } },
                { expiresAt: { $gt: now } }
            ]
        });

        if (!doc) {
            console.log('[API] ❌ Cache MISS:', key.substring(0, 50));
            // Clean up any expired entry
            await req.dbCollection.deleteOne({ key, expiresAt: { $lt: now } });
            return res.status(404).json({ error: 'Cache not found' });
        }

        console.log('[API] ✅ Cache HIT:', {
            key: key.substring(0, 50),
            hasVideos: !!doc.videos,
            videoCount: doc.videos?.length || 0,
            expiresAt: doc.expiresAt
        });

        // We only want to return the actual cached data, not the whole document.
        const dataToReturn = {};
        if (doc.videos) dataToReturn.videos = doc.videos;
        if (doc.channelId) dataToReturn.channelId = doc.channelId;
        if (doc.uploadsPlaylistId) dataToReturn.uploadsPlaylistId = doc.uploadsPlaylistId;
        if (doc.categories) dataToReturn.categories = doc.categories;

        res.json({ data: dataToReturn });
    } catch (error) {
        console.error('[API] POST Get cache error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/cache', cacheMiddleware, async (req, res) => {
    try {
        const { key, data, collection } = req.body;
        
        if (!key || !data || !collection) {
            return res.status(400).json({ error: 'Key, data, and collection are required' });
        }

        // Validate data size to prevent DoS
        const dataSize = JSON.stringify(data).length;
        const MAX_DATA_SIZE = 10 * 1024 * 1024; // 10MB limit
        
        if (dataSize > MAX_DATA_SIZE) {
            return res.status(413).json({ 
                error: 'Payload too large',
                maxSize: '10MB',
                actualSize: `${(dataSize / 1024 / 1024).toFixed(2)}MB`
            });
        }
        
        // Log the request but sanitize potentially large data
        console.log('[API] Store cache request:', {
            key: key.substring(0, 100),
            collection,
            dataSize: `${(dataSize / 1024).toFixed(2)}KB`,
            hasVideos: !!data.videos,
            videoCount: data.videos?.length || 0
        });

        const expiryHours = DB_CONFIG.cacheExpiry[collection] || 24;
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + expiryHours);

        // Prepare the cache document
        const cacheDoc = {
            key,
            collection,
            expiresAt,
            updatedAt: new Date(),
            cacheVersion: '1.0'
        };

        // Add the actual data based on what's provided
        if (data.videos) cacheDoc.videos = data.videos;
        if (data.channelId) cacheDoc.channelId = data.channelId;
        if (data.uploadsPlaylistId) cacheDoc.uploadsPlaylistId = data.uploadsPlaylistId;
        if (data.categories) cacheDoc.categories = data.categories;

        // Attempt to store with retries
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                const result = await req.dbCollection.updateOne(
                    { key },
                    { $set: cacheDoc },
                    { upsert: true }
                );

                console.log('[API] Store result:', {
                    matched: result.matchedCount,
                    modified: result.modifiedCount,
                    upserted: result.upsertedCount
                });

                return res.json({ 
                    message: 'Cache stored successfully',
                    expiresAt,
                    operation: result.upsertedCount > 0 ? 'inserted' : 'updated'
                });
            } catch (error) {
                attempts++;
                if (attempts === maxAttempts) {
                    throw error;
                }
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error('[API] Store cache error:', error);
        res.status(500).json({ 
            error: 'Failed to store cache',
            details: error.message
        });
    }
});

// A few routes for housekeeping and checking on the cache.
// We can see the overall status, get all items, or clean out old data.
router.get('/cache/all/:collection', async (req, res) => {
    try {
        const { collection } = req.params;
        if (!DB_CONFIG.collections[collection]) {
            return res.status(400).json({ error: 'Invalid collection' });
        }

        const cacheCollection = db.collection(DB_CONFIG.collections[collection]);
        const data = await cacheCollection
            .find({ 
                expiresAt: { $gt: new Date() } 
            })
            .project({ 
                key: 1, 
                updatedAt: 1, 
                expiresAt: 1,
                totalVideos: 1,
                playlistId: 1,
                channelId: 1
            })
            .toArray();

        res.json({ data });
    } catch (error) {
        console.error('Get all cache error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/cache/expired', async (req, res) => {
    try {
        const collections = Object.values(DB_CONFIG.collections);
        const results = await Promise.all(
            collections.map(async (collectionName) => {
                const collection = db.collection(collectionName);
                const result = await collection.deleteMany({
                    expiresAt: { $lt: new Date() }
                });
                return { collection: collectionName, deleted: result.deletedCount };
            })
        );

        res.json({ 
            message: 'Expired cache cleaned', 
            results,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Clean cache error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/cache/status', async (req, res) => {
    try {
        const collections = Object.values(DB_CONFIG.collections);
        const status = await Promise.all(
            collections.map(async (collectionName) => {
                const collection = db.collection(collectionName);
                const total = await collection.countDocuments();
                const expired = await collection.countDocuments({
                    expiresAt: { $lt: new Date() }
                });
                const active = await collection.countDocuments({
                    expiresAt: { $gt: new Date() }
                });
                return {
                    collection: collectionName,
                    total,
                    expired,
                    active
                };
            })
        );

        res.json({ 
            status,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Cache status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Config endpoint - sends API keys to frontend
// NOTE: Keys are visible in browser but restricted by domain in Google Cloud Console
router.get('/config', (req, res) => {
    const youtubeApiKeys = getYouTubeApiKeys();

    if (youtubeApiKeys.length === 0) {
        console.error('No YouTube API keys found in environment variables');
        return res.status(500).json({ error: 'YouTube API keys not configured' });
    }

    if (!process.env.GEMINI_API_KEY) {
        console.error('Gemini API key not found in environment variables');
        return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const currentKey = youtubeApiKeys[keyUsageTracking.youtube.currentKeyIndex];
    
    res.json({
        youtubeApiKeys: [currentKey, ...youtubeApiKeys.filter(k => k !== currentKey)],
        geminiApiKey: process.env.GEMINI_API_KEY,
        keyRotated: false
    });
});

// Some extra routes for managing and checking on our API keys.
router.post('/rotate-key', async (req, res) => {
    try {
        const newKey = await rotateYoutubeKey();
        const youtubeApiKeys = getYouTubeApiKeys();

        res.json({
            youtubeApiKeys: [newKey, ...youtubeApiKeys.filter(k => k !== newKey)],
            currentKeyIndex: keyUsageTracking.youtube.currentKeyIndex,
            availableKeys: youtubeApiKeys.length,
            keyRotated: true
        });
    } catch (error) {
        console.error('[API] Key rotation error:', error);
        res.status(500).json({ error: 'Failed to rotate key', details: error.message });
    }
});

router.get('/key-usage', (req, res) => {
    const stats = {
        currentKeyIndex: keyUsageTracking.youtube.currentKeyIndex,
        usage: Array.from(keyUsageTracking.youtube.usageCount.entries()).map(([index, count]) => ({
            keyIndex: index,
            usageCount: count,
            lastReset: keyUsageTracking.youtube.quotaResets.get(index)
        }))
    };
    res.json(stats);
});

// A neat little utility to find a YouTube channel's ID from its user-friendly handle (e.g., '@username').
// It works by fetching the channel's page and finding the ID in the HTML source code.
router.get('/resolve-handle', async (req, res) => {
    console.log('[API] Resolving handle:', req.query);
    const { handle } = req.query;
    
    if (!handle) {
        console.log('[API] No handle provided');
        return res.status(400).json({ error: 'Handle is required' });
    }
    
    // SECURITY: Validate handle format to prevent SSRF attacks
    const cleanHandle = handle.replace('@', '').trim();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(cleanHandle)) {
        return res.status(400).json({ 
            error: 'Invalid handle format',
            details: 'Handle must contain only letters, numbers, underscores, and hyphens'
        });
    }

    const url = `https://www.youtube.com/@${cleanHandle}`;
    console.log('[API] Fetching URL:', url);

    try {
        const request = https.get(url, (response) => {
            console.log('[API] YouTube response status:', response.statusCode);
            
            if (response.statusCode === 404) {
                return res.status(404).json({ error: 'Channel not found' });
            }
            
            if (response.statusCode !== 200) {
                return res.status(response.statusCode).json({ 
                    error: `YouTube returned status ${response.statusCode}` 
                });
            }

            let data = '';
            let dataSize = 0;
            const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB limit
            
            response.on('data', (chunk) => {
                dataSize += chunk.length;
                
                // Prevent memory exhaustion from large responses
                if (dataSize > MAX_RESPONSE_SIZE) {
                    request.destroy();
                    return res.status(413).json({ error: 'Response too large' });
                }
                
                data += chunk;
            });

            response.on('end', () => {
                console.log('[API] Received full response, searching for channel ID...');
                // Try multiple patterns to find the channel ID
                let channelId = null;
                
                // Pattern 1: Look for canonical URL
                const canonicalMatch = data.match(/"canonicalChannelUrl":"https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/);
                if (canonicalMatch && canonicalMatch[1]) {
                    channelId = canonicalMatch[1];
                }
                
                // Pattern 2: Look for browse ID
                if (!channelId) {
                    const browseMatch = data.match(/"browseId":"(UC[a-zA-Z0-9_-]{22})"/);
                    if (browseMatch && browseMatch[1]) {
                        channelId = browseMatch[1];
                    }
                }
                
                // Pattern 3: Look for externalId
                if (!channelId) {
                    const externalMatch = data.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/);
                    if (externalMatch && externalMatch[1]) {
                        channelId = externalMatch[1];
                    }
                }

                if (channelId) {
                    console.log('[API] Found channel ID:', channelId);
                    res.json({ channelId });
                } else {
                    console.log('[API] Could not find channel ID in response');
                    res.status(404).json({ error: 'Could not resolve handle' });
                }
            });
        });

        request.setTimeout(10000, () => {
            console.log('[API] Request timed out');
            request.destroy();
            res.status(504).json({ error: 'Request timed out' });
        });

        request.on('error', (err) => {
            console.error('[API] Error fetching channel page:', err);
            res.status(500).json({ error: 'Failed to fetch channel page', details: err.message });
        });
    } catch (err) {
        console.error('[API] Critical error in resolve-handle:', err);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

export default router;