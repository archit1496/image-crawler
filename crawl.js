const fs = require('fs');         // File system operations
const path = require('path');     // Path manipulation
const axios = require('axios');   // HTTP requests
const cheerio = require('cheerio');// HTML parsing
const crypto = require('crypto'); // For creating unique hashes
const { URL } = require('url');   // URL parsing and manipulation

// Set to keep track of visited pages
const visited = new Set();
// Array to store image information
const imagesInfo = [];

/**
 * Download an image from imgUrl, save it into the imagesFolder,
 * and record the image info.
 */
async function downloadImage(imgUrl, pageUrl, depth, imagesFolder) {
    try {
        const response = await axios.get(imgUrl, { 
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                // Add a realistic User-Agent header to make requests look more like they're coming from a real browser
            },
            timeout: 10000 // 10 second timeout
        });
        
        // Parse the image URL to extract a filename; fallback to 'image.jpg'
        const urlObj = new URL(imgUrl);
        let fileName = path.basename(urlObj.pathname) || 'image.jpg';

        // Create a unique filename by prefixing a hash
        const hash = crypto.createHash('md5').update(imgUrl).digest('hex');
        fileName = `${hash}_${fileName}`;

        const filePath = path.join(imagesFolder, fileName);
        fs.writeFileSync(filePath, response.data);
        console.log(`Downloaded: ${imgUrl} -> ${filePath}`);

        // Record the image's metadata
        imagesInfo.push({
            url: imgUrl,
            page: pageUrl,
            depth: depth
        });
    } catch (error) {
        console.error(`Failed to download image ${imgUrl}: ${error.message}`);
    }
}

/**
 * Helper function to delay execution
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Crawl a page at the given URL. Download images on the page,
 * and recursively follow links until the maximum depth is reached.
 */
async function crawlPage(url, maxDepth, currentDepth, imagesFolder, retries = 3) {
    // Stop conditions:
    // 1. If current depth exceeds maximum depth
    // 2. If URL was already visited
    if (currentDepth > maxDepth || visited.has(url)) {
        return;
    }
    console.log(`Crawling (depth ${currentDepth}): ${url}`);
    visited.add(url);

    let response;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    // Add a realistic User-Agent header to make requests look more like they're coming from a real browser
                },
                timeout: 10000 // 10 second timeout
            });
            break; // Success, exit retry loop
        } catch (error) {
            console.error(`Attempt ${attempt}/${retries} failed to fetch ${url}: ${error.message}`);
            if (attempt === retries) {
                return; // Give up after all retries
            }
            await delay(2000 * attempt); // Wait longer between each retry
        }
    }

    const contentType = response.headers['content-type'];
    if (!contentType || !contentType.includes('text/html')) {
        return;
    }

    const $ = cheerio.load(response.data);

    // Process and download all images on the current page.
    const imgPromises = [];
    $('img').each((i, elem) => {
        const src = $(elem).attr('src');
        if (src) {
            try {
                // Resolve relative URLs using the current page URL
                const imgUrl = new URL(src, url).href;
                imgPromises.push(downloadImage(imgUrl, url, currentDepth, imagesFolder));
            } catch (error) {
                console.error(`Invalid image URL: ${src} on page ${url}`);
            }
        }
    });
    await Promise.all(imgPromises);

    // If not at max depth, crawl each link on the page.
    if (currentDepth < maxDepth) {
        const linkPromises = [];
        $('a').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
                try {
                    const nextUrl = new URL(href, url).href;
                    // Only follow http(s) links
                    if (nextUrl.startsWith('http')) {
                        linkPromises.push(crawlPage(nextUrl, maxDepth, currentDepth + 1, imagesFolder));
                    }
                } catch (error) {
                    console.error(`Invalid URL: ${href} on page ${url}`);
                }
            }
        });
        await Promise.all(linkPromises);
    }
}

/**
 * Main entry point: Parse command line arguments, create the images folder,
 * start crawling, and write the index.json file.
 */
async function main() {
    if (process.argv.length !== 4) {
        console.log("Usage: crawl <start_url> <depth>");
        process.exit(1);
    }

    const startUrl = process.argv[2];
    const depth = parseInt(process.argv[3], 10);
    if (isNaN(depth)) {
        console.error("Depth must be an integer");
        process.exit(1);
    }

    // Create the images folder if it doesn't exist
    const imagesFolder = path.join(process.cwd(), 'images');
    if (!fs.existsSync(imagesFolder)) {
        fs.mkdirSync(imagesFolder);
    }

    await crawlPage(startUrl, depth, 1, imagesFolder);

    // Write the collected image metadata into index.json
    const indexFile = path.join(imagesFolder, 'index.json');
    fs.writeFileSync(indexFile, JSON.stringify({ images: imagesInfo }, null, 4));
    console.log(`\nSaved index.json with ${imagesInfo.length} images in the '${imagesFolder}' folder.`);
}
main();
