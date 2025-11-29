export function isStreamVideo(videoItem) {
    if (!videoItem) return false;

    // Standard check for video details
    if (videoItem.liveStreamingDetails) {
    const hasActualStartTime = !!videoItem.liveStreamingDetails.actualStartTime;
    const hasScheduledStartTime = !!videoItem.liveStreamingDetails.scheduledStartTime;
    return hasActualStartTime || hasScheduledStartTime;
    }
    
    // Fallback for search results or older cached objects
    if (videoItem.snippet && videoItem.snippet.liveBroadcastContent) {
        return videoItem.snippet.liveBroadcastContent === 'live' || videoItem.snippet.liveBroadcastContent === 'upcoming';
    }

    return false;
}

export function formatViewCount(count) {
    if (count >= 1000000) {
        return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
}

export function formatDate(date) {
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) {
        return `${years}y ago`;
    } else if (months > 0) {
        return `${months}mo ago`;
    } else if (days > 0) {
        return `${days}d ago`;
    } else if (hours > 0) {
        return `${hours}h ago`;
    } else if (minutes > 0) {
        return `${minutes}m ago`;
    } else {
        return 'Just now';
    }
}

export function formatFullDate(date) {
    if (!(date instanceof Date) || isNaN(date)) {
        return 'Date unavailable';
    }
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    });
}

// SECURITY: Escape HTML to prevent XSS attacks
export function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Sanitize URL to prevent javascript: protocol injection
export function sanitizeUrl(url) {
    if (!url) return '';
    const urlStr = String(url).trim();
    // Block javascript: and data: protocols
    if (urlStr.match(/^(javascript|data|vbscript):/i)) {
        return '';
    }
    return urlStr;
}

export function normalizeVideoObject(video) {
    if (!video) return null;

    const id = video.id || video.videoId;
    if (!id) return null;

    let thumbnail = video.thumbnail;
    if (!thumbnail && video.snippet && video.snippet.thumbnails) {
        thumbnail = video.snippet.thumbnails.high?.url || video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url;
    }
    if (!thumbnail) {
        thumbnail = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    }

    return {
        id: id,
        title: escapeHtml(video.title || video.snippet?.title || 'Untitled Video'),
        thumbnail: sanitizeUrl(thumbnail),
        publishedAt: new Date(video.publishedAt || video.snippet?.publishedAt || Date.now()),
        viewCount: parseInt(video.viewCount || video.statistics?.viewCount || '0', 10),
        isStream: isStreamVideo(video)
    };
}