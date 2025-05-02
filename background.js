// Background service worker for The Honey Barrel extension
// Handles API requests to BAXUS marketplace and AWS AI services

// Base URL for the BAXUS API
const BAXUS_API_BASE_URL = 'https://services.baxus.co/api';

// Default settings
const DEFAULT_SETTINGS = {
  showBaxusPopup: true, // Default to showing popup
  matchThreshold: 0.1   // Default match threshold
};

// Initialize settings when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  // Set default settings if not already set
  chrome.storage.sync.get(['userSettings'], (result) => {
    if (!result.userSettings) {
      chrome.storage.sync.set({ userSettings: DEFAULT_SETTINGS });
      console.log('Initialized default settings');
    }
  });
});

// AWS configuration
// SECURITY WARNING: NEVER store credentials in source code for production!
// Always use a secure credential management system in production environments
const AWS_CONFIG = {
  region: 'us-east-1',
  // Replace these placeholders with your actual AWS credentials during development
  // For production, use AWS IAM roles, Cognito Identity Pools, or a secure backend proxy
  accessKeyId: 'YOUR_AWS_ACCESS_KEY_ID', 
  secretAccessKey: 'YOUR_AWS_SECRET_ACCESS_KEY',
  // AWS service endpoints
  rekognitionEndpoint: 'https://rekognition.us-east-1.amazonaws.com',
  comprehendEndpoint: 'https://comprehend.us-east-1.amazonaws.com'
};

// Cache for storing API responses to reduce redundant calls
let bottleCache = {};

// Constants
const MATCH_THRESHOLD = 0.1;

// Currency conversion rates to USD (approximate as of May 2025)
const CURRENCY_TO_USD = {
  'GBP': 1.31, // British Pound to USD
  'EUR': 1.08, // Euro to USD
  'JPY': 0.0067, // Japanese Yen to USD
  'AUD': 0.66, // Australian Dollar to USD
  'CAD': 0.74, // Canadian Dollar to USD
  'CHF': 1.12, // Swiss Franc to USD
  'INR': 0.012, // Indian Rupee to USD
  'SGD': 0.75, // Singapore Dollar to USD
  'HKD': 0.13, // Hong Kong Dollar to USD
  'USD': 1.0,  // US Dollar to USD (no conversion)
};

// Function to convert prices to USD
function convertToUSD(price, currencyCode) {
  if (!price || isNaN(parseFloat(price))) {
    return price;
  }
  
  const numericPrice = parseFloat(price);
  const currency = String(currencyCode || 'USD').toUpperCase();
  
  if (CURRENCY_TO_USD[currency]) {
    return numericPrice * CURRENCY_TO_USD[currency];
  }
  
  // Default to no conversion if currency not recognized
  return numericPrice;
}

// Get a match quality label based on match score
function getMatchQualityLabel(score) {
  if (score >= 0.8) {
    return 'Excellent';
  } else if (score >= 0.6) {
    return 'Good';
  } else if (score >= 0.4) {
    return 'Fair';
  } else {
    // Renamed from "Poor" to "Basic" to avoid negative connotation
    return 'Basic';
  }
}

// Fetch listings from the BAXUS marketplace
async function fetchBaxusListings(params = {}) {
  try {
    // Using the exact API format provided by the user that works
    let apiUrl = 'https://services.baxus.co/api/search/listings';
    
    // Start with parameters we know work
    const queryParams = ['from=0', 'size=20', 'listed=true'];
    
    // If search term is provided, add it as a parameter - we'll test this after confirming base URL works
    if (params.search && params.search.trim()) {
      // Append the search term to existing parameters
      // Handle gently with encodeURIComponent to avoid special character issues
      queryParams.push(`query=${encodeURIComponent(params.search.trim())}`);
    }
    
    // Override pagination if specified
    if (params.from !== undefined) {
      // Replace the default 'from' parameter
      queryParams[0] = `from=${params.from}`;
    }
    if (params.size !== undefined) {
      // Replace the default 'size' parameter
      queryParams[1] = `size=${params.size}`;
    }
    
    // Build final URL with parameters
    apiUrl += `?${queryParams.join('&')}`;
    
    console.log('BAXUS API request URL:', apiUrl);
    
    // Make a simple GET request
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`BAXUS API error: ${response.status}`, errorText);
      throw new Error(`BAXUS API returned status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('BAXUS API response received:', data);
    
    if (!data) {
      console.error('BAXUS API returned empty response');
      return { results: [], total: 0 };
    }
    
    // Log the structure for debugging
    console.log('BAXUS response structure:', 
      Object.keys(data),
      'isArray:', Array.isArray(data),
      'hasHits:', data.hits !== undefined
    );
    
    // Handle various response formats
    let results = [];
    let total = 0;
    
    if (Array.isArray(data)) {
      // Handle array response
      results = data;
      total = data.length;
      console.log(`BAXUS returned ${results.length} results (array format)`);
    } else if (data.hits && Array.isArray(data.hits)) {
      // Handle hits response format
      results = data.hits;
      total = data.total || results.length;
      console.log(`BAXUS returned ${results.length} results (hits format)`);
    } else if (data.results && Array.isArray(data.results)) {
      // Handle results format
      results = data.results;
      total = data.total || results.length;
      console.log(`BAXUS returned ${results.length} results (results format)`);
    } else {
      // Handle any other structure by trying to find arrays
      console.warn('Unexpected BAXUS response structure, attempting to extract results');
      
      // Look for any array property that might contain results
      for (const key in data) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          results = data[key];
          total = results.length;
          console.log(`BAXUS results found in '${key}' property: ${results.length} items`);
          break;
        }
      }
    }
    
    // Add detailed logging of the first result for debugging
    if (results.length > 0) {
      console.log('First result sample:', {
        id: results[0].id,
        assetId: results[0].assetId,
        hasSource: !!results[0]._source,
        name: results[0]._source?.name || results[0].name || 'No name',
        price: results[0].price || results[0]._source?.price
      });
    }
    
    return {
      results: results,
      total: total
    };
  } catch (error) {
    console.error('Error fetching BAXUS listings:', error);
    
    // Proper error handling with fallback
    return { 
      results: [],
      total: 0,
      error: error.message
    };
  }
}

// Enhanced bottle recognition using AWS Rekognition 
// -- TEMPORARILY COMMENTED OUT DUE TO CORS ISSUES --
async function enhanceBottleInfoWithVision(bottleInfo) {
  try {
    // Temporarily return the unmodified bottleInfo
    // to avoid the CORS/fetch errors with AWS
    console.log('Skipping AWS Rekognition due to CORS restrictions');
    return bottleInfo;
    
    // ORIGINAL CODE COMMENTED OUT:
    /*
    // Only proceed if we have an image URL
    if (!bottleInfo.imageUrl) {
      return bottleInfo;
    }
    
    // Get image bytes from URL (in a real implementation you'd handle this more robustly)
    const imageResponse = await fetch(bottleInfo.imageUrl);
    const imageArrayBuffer = await imageResponse.arrayBuffer();
    const imageBytes = new Uint8Array(imageArrayBuffer);
    
    // Prepare the request to AWS Rekognition
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = timestamp.substring(0, 8);
    
    // AWS Signature v4 would be implemented here in a production app
    // This is a simplified version for demonstration
    const rekognitionRequest = {
      Image: {
        Bytes: btoa(String.fromCharCode.apply(null, imageBytes))
      },
      Features: ["TEXT", "LABELS"]
    };
    
    // Call AWS Rekognition
    const response = await fetch(AWS_CONFIG.rekognitionEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'RekognitionService.DetectLabels',
        'X-Amz-Date': timestamp,
        'Authorization': `AWS4-HMAC-SHA256 Credential=${AWS_CONFIG.accessKeyId}/${date}/${AWS_CONFIG.region}/rekognition/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=SIGNATURE_WOULD_BE_GENERATED_HERE`
      },
      body: JSON.stringify(rekognitionRequest)
    });
    
    if (!response.ok) {
      throw new Error(`AWS Rekognition request failed with status: ${response.status}`);
    }
    
    const rekognitionData = await response.json();
    
    // Process the Rekognition results
    const enhancedInfo = processRekognitionResults(rekognitionData, bottleInfo);
    */
    
    // Return the unenhanced bottle info
    return {
      ...bottleInfo,
      aiEnhanced: false // Set to false since we're not enhancing
    };
  } catch (error) {
    console.error('Error enhancing bottle info with AWS Rekognition:', error);
    // Return original bottle info if enhancement fails
    return bottleInfo;
  }
}

// Process results from AWS Rekognition
function processRekognitionResults(rekognitionData, originalBottleInfo) {
  // Implementing a minimal version that returns unmodified info
  return {};
}

// Enhanced bottle info extraction using AWS Comprehend
// -- TEMPORARILY COMMENTED OUT DUE TO CORS ISSUES --
async function enhanceBottleInfoWithNLP(bottleInfo) {
  try {
    // Temporarily return the unmodified bottleInfo
    // to avoid the CORS/fetch errors with AWS
    console.log('Skipping AWS Comprehend due to CORS restrictions');
    return bottleInfo;
  } catch (error) {
    console.error('Error enhancing bottle info with AWS Comprehend:', error);
    // Return the original bottle info if enhancement fails
    return bottleInfo;
  }
}

// Enhanced AI-powered bottle recognition using both Rekognition and Comprehend
// -- Now skipping AWS calls due to CORS issues --
async function enhanceBottleInfo(bottleInfo) {
  try {
    // Return original bottle info without enhancements
    console.log('Skipping AWS enhancement due to CORS restrictions');
    
    // Add a confidence score so the rest of the code still works
    bottleInfo.aiConfidence = 0.5; // Medium confidence by default
    
    return bottleInfo;
  } catch (error) {
    console.error('Error enhancing bottle info with AI:', error);
    // Return original bottle info if AI enhancement fails
    return bottleInfo;
  }
}

// Search for matching bottles in the BAXUS marketplace
async function findMatchingBottles(bottleInfo) {
  console.log('Finding matches for bottle:', bottleInfo);
  
  // Validate bottle info
  if (!bottleInfo || !bottleInfo.name) {
    console.error('Invalid bottle info, cannot find matches');
    return [];
  }
  
  // Create a cache key based on the bottle information
  const cacheKey = `${bottleInfo.name}-${bottleInfo.brand || ''}-${bottleInfo.type || ''}`;
  
  // Check if we have cached results for this bottle
  if (bottleCache[cacheKey] && bottleCache[cacheKey].length > 0) {
    console.log('Returning cached matches for:', cacheKey);
    return bottleCache[cacheKey];
  }
  
  // Construct search parameters
  const searchParams = {
    search: bottleInfo.name,
    size: 40 // Request more results to get better matches
  };
  
  // If we have a brand, add it to improve search precision
  if (bottleInfo.brand) {
    // Use a modified search that doesn't restrict too much
    // This allows finding similar products from the same brand
    const brandSearch = bottleInfo.brand.split(' ')[0]; // Use just the first word of brand
    searchParams.search = `${brandSearch} ${bottleInfo.name}`;
  }
  
  // Call the BAXUS API to get potential matches
  const baxusResponse = await fetchBaxusListings(searchParams);
  const baxusListings = baxusResponse.results || [];
  console.log('BAXUS returned', baxusListings.length, 'potential matches');
  
  // If we got too few results, try a broader search
  if (baxusListings.length < 5) {
    console.log('Too few results, trying broader search');
    
    // Construct a more generic search
    let broaderSearchParams = {
      search: bottleInfo.name.split(' ').slice(0, 2).join(' '), // Use first two words of name
      size: 40
    };
    
    const broaderResponse = await fetchBaxusListings(broaderSearchParams);
    const broaderListings = broaderResponse.results || [];
    
    // Combine results, avoiding duplicates
    const existingIds = new Set(baxusListings.map(l => l.id || l._id || (l._source && l._source.id)));
    for (const listing of broaderListings) {
      const listingId = listing.id || listing._id || (listing._source && listing._source.id);
      if (!existingIds.has(listingId)) {
        baxusListings.push(listing);
        existingIds.add(listingId);
      }
    }
    
    console.log('After broader search, have', baxusListings.length, 'potential matches');
  }
  
  // For specific brands like Weller, implement special handling
  const isWellerBottle = (bottleInfo.name && bottleInfo.name.toLowerCase().includes('weller')) || 
                        (bottleInfo.brand && bottleInfo.brand.toLowerCase().includes('weller'));
  
  if (isWellerBottle) {
    console.log('Special handling for Weller bottle');
    
    // Try to find all Weller bottles on BAXUS
    const wellerSearchParams = {
      search: "weller",
      size: 40
    };
    
    const wellerResponse = await fetchBaxusListings(wellerSearchParams);
    const wellerListings = wellerResponse.results || [];
    
    // Combine results, avoiding duplicates
    const existingIds = new Set(baxusListings.map(l => l.id || l._id || (l._source && l._source.id)));
    for (const listing of wellerListings) {
      const listingId = listing.id || listing._id || (listing._source && listing._source.id);
      if (!existingIds.has(listingId)) {
        baxusListings.push(listing);
        existingIds.add(listingId);
      }
    }
    
    console.log('After Weller search, have', baxusListings.length, 'potential matches');
  }
  
  // Do special handling for Japanese whiskies as well
  const isJapaneseWhisky = (bottleInfo.type && bottleInfo.type.toLowerCase().includes('japanese')) ||
                          (bottleInfo.name && /yamazaki|hibiki|hakushu|nikka|suntory/i.test(bottleInfo.name)) ||
                          (bottleInfo.brand && /yamazaki|hibiki|hakushu|nikka|suntory/i.test(bottleInfo.brand));
                          
  if (isJapaneseWhisky) {
    console.log('Special handling for Japanese whisky');
    
    // Try to find Japanese whiskies
    const japaneseSearchParams = {
      search: "japanese whisky",
      size: 40
    };
    
    const japaneseResponse = await fetchBaxusListings(japaneseSearchParams);
    const japaneseListings = japaneseResponse.results || [];
    
    // Combine results, avoiding duplicates
    const existingIds = new Set(baxusListings.map(l => l.id || l._id || (l._source && l._source.id)));
    for (const listing of japaneseListings) {
      const listingId = listing.id || listing._id || (listing._source && listing._source.id);
      if (!existingIds.has(listingId)) {
        baxusListings.push(listing);
        existingIds.add(listingId);
      }
    }
    
    console.log('After Japanese whisky search, have', baxusListings.length, 'potential matches');
  }
  
  // Transform listings and calculate match scores
  const matches = [];
  for (const listing of baxusListings) {
    try {
      // Calculate match score (0-1)
      const matchScore = calculateMatchScore(bottleInfo, listing);
      
      // Quality score for filtering better quality bottles
      let qualityScore = calculateQualityScore(bottleInfo, listing);
      
      // Calculate price savings
      const listingPrice = parseFloat(listing.price || listing._source?.price);
      const bottlePrice = bottleInfo.numericPrice;
      let priceSavings = 0;
      let priceDiff = '';
      let savingsPercent = 0;
      
      if (bottlePrice && listingPrice) {
        const diff = bottlePrice - listingPrice;
        priceSavings = diff;
        
        if (diff > 0) {
          // Positive diff means the BAXUS bottle is cheaper
          savingsPercent = Math.round((diff / bottlePrice) * 100);
          priceDiff = `Save ${bottleInfo.currency || '$'}${diff.toFixed(2)} (${savingsPercent}%)`;
        } else if (diff < 0) {
          // Negative diff means the BAXUS bottle is more expensive
          savingsPercent = Math.round((Math.abs(diff) / bottlePrice) * 100);
          priceDiff = `${bottleInfo.currency || '$'}${Math.abs(diff).toFixed(2)} more (${savingsPercent}%)`;
        } else {
          priceDiff = 'Same price';
        }
      }
      
      // Adjust match score based on price factors - boost score for lower prices
      if (priceSavings > 0) {
        // Bottle is cheaper, boost score
        const priceBoost = Math.min(0.2, (priceSavings / (bottlePrice || 100)) * 0.5);
        matchScore += priceBoost;
      }
      
      // Give bonus score if both quality is higher and price is lower
      if (qualityScore > 0.6 && priceSavings > 0) {
        matchScore += 0.15; // Significant bonus for better value bottles
      }
      
      // Special bonus for Weller bottles
      if (isWellerBottle && (listing._source?.name?.toLowerCase().includes('weller') || 
                            listing.name?.toLowerCase().includes('weller'))) {
        matchScore += 0.1;
        qualityScore += 0.1;
      }
      
      // Special bonus for Japanese whiskies if detected
      if (isJapaneseWhisky && (listing._source?.attributes?.Type?.toLowerCase().includes('japanese') || 
                              listing._source?.spiritType?.toLowerCase().includes('japanese'))) {
        matchScore += 0.1;
      }
      
      // Create easy-to-understand deal tag
      let dealTag = '';
      if (qualityScore > 0.7 && priceSavings > 0) {
        dealTag = 'BETTER VALUE';
      } else if (qualityScore > 0.7) {
        dealTag = 'HIGHER QUALITY';
      } else if (priceSavings > 0 && savingsPercent > 10) {
        dealTag = 'GREAT PRICE';
      } else if (matchScore > 0.7) {
        dealTag = 'CLOSE MATCH';
      }
      
      // Prepare match details
      const matchDetails = generateMatchDetails(bottleInfo, listing, matchScore);
      
      // Determine the asset ID - this is a critical part for BAXUS links
      // Handle different response formats from BAXUS API
      const assetId = (
        // Try several possible fields where the ID might be stored
        listing.assetId || 
        listing.asset_id || 
        listing.id || 
        listing._id || 
        (listing._source && (listing._source.id || listing._source.assetId))
      );
      
      // Source for name and other fields may be in different places
      const source = listing._source || listing;
      const name = source.name || listing.name || "Unknown Whisky";
      
      console.log(`Creating match with asset ID: ${assetId} for ${name}`);
      
      // Create match object with all relevant information
      const matchObj = {
        id: assetId, // Use the found asset ID
        name: name,
        price: listingPrice,
        currency: source.currency || 'USD',
        link: `https://baxus.co/asset/${assetId}`, // Use the same asset ID for link
        imageUrl: source.imageUrl,
        matchScore: matchScore,
        qualityScore: qualityScore,
        type: source.spiritType || source.type,
        better: qualityScore > 0.6 && priceSavings > 0,
        dealTag: dealTag,
        age: source.attributes?.Age,
        region: source.attributes?.Region,
        abv: source.attributes?.ABV
      };
      
      // Convert all prices to USD for consistent handling
      matchObj.priceUSD = convertToUSD(listingPrice, matchObj.currency);
      matchObj.originalPriceUSD = convertToUSD(source.originalPrice, matchObj.currency);
      
      // Calculate savings compared to the detected bottle price
      if (bottleInfo.numericPrice && matchObj.priceUSD) {
        // Always calculate using USD values for consistency
        const bottlePriceUSD = convertToUSD(bottleInfo.numericPrice, bottleInfo.currency || 'USD');
        
        const diff = bottlePriceUSD - matchObj.priceUSD;
        matchObj.priceSavings = diff;
        
        if (diff > 0) {
          // Positive diff means the BAXUS bottle is cheaper
          const savingsPercent = Math.round((diff / bottlePriceUSD) * 100);
          matchObj.savingsPercent = savingsPercent;
          matchObj.savings = `Save $${diff.toFixed(2)} (${savingsPercent}%)`;
        } else if (diff < 0) {
          // Negative diff means the BAXUS bottle is more expensive
          const savingsPercent = Math.round((Math.abs(diff) / bottlePriceUSD) * 100);
          matchObj.savingsPercent = savingsPercent;
          matchObj.savings = `$${Math.abs(diff).toFixed(2)} more (${savingsPercent}%)`;
        } else {
          matchObj.savingsPercent = 0;
          matchObj.savings = 'Same price';
        }
      }
      
      matches.push(matchObj);
    } catch (err) {
      console.error('Error processing BAXUS listing:', err);
    }
  }
  
  // Sort results with an improved algorithm that prioritizes valuable options
  const sortedMatches = matches
    .filter(match => match.matchScore >= 0.1) // Lower threshold to ensure we get matches
    .sort((a, b) => {
      // First priority: always sort by price (low to high)
      if (a.price !== b.price) {
        return a.price - b.price;
      }
      
      // Second priority: bottles that are both better quality AND cheaper
      if (a.better && !b.better) return -1;
      if (!a.better && b.better) return 1;
      
      // Third priority: match score for relevance
      return b.matchScore - a.matchScore;
    })
    .slice(0, 15); // Show more matches (up to 15)
  
  // If we still found no matches above our threshold but have valid API results,
  // return the top matches anyway with a special flag
  if (sortedMatches.length === 0 && matches.length > 0) {
    // Find the best matches even if they're below our threshold
    const bestMatches = matches.sort((a, b) => b.matchScore - a.matchScore).slice(0, 10);
    
    console.log('Returning best matches despite being below threshold');
    bestMatches.forEach(match => {
      match.belowThreshold = true; // Flag to indicate this was below threshold
    });
    
    return bestMatches;
  }
  
  // Cache the results
  bottleCache[cacheKey] = sortedMatches;
  return sortedMatches;
}

// Calculate a match score between bottle info and a potential match
function calculateMatchScore(bottleInfo, listing) {
  try {
    // Extract source data from the listing
    const source = listing._source || {};
    const attributes = source.attributes || {};
    
    // Initialize score with a small base value to ensure all bottles get some matching
    let score = 0.1;
    
    // Extract potential data points for matching
    const listingName = source.name || "";
    const listingBrand = attributes.Producer || attributes.Brand || "";
    const listingType = source.type || source.spiritType || attributes.Type || "";
    const listingVintage = attributes["Year Distilled"] || attributes.Vintage || "";
    const listingAge = attributes.Age || "";
    const listingVolume = attributes.Volume || "";
    const listingABV = attributes.ABV || "";
    
    // Extract bottle info properties safely
    const bottleName = bottleInfo.name || "";
    const bottleBrand = bottleInfo.brand || "";
    const bottleType = bottleInfo.type || "";
    const bottleVintage = bottleInfo.vintage || "";
    const bottleAge = bottleInfo.age || "";
    const bottleVolume = bottleInfo.volume || "";
    const bottleABV = bottleInfo.abv || "";
    
    // Name similarity is the most important factor
    // Use fuzzy matching for better results
    const nameSimilarity = calculateStringSimilarity(bottleName, listingName);
    score += nameSimilarity * 0.6; // Name is 60% of the total score
    
    // Brand matching
    if (bottleBrand && listingBrand) {
      const brandSimilarity = calculateStringSimilarity(bottleBrand, listingBrand);
      score += brandSimilarity * 0.15; // Brand is 15% of the total score
    }
    
    // Type matching
    if (bottleType && listingType) {
      const typeSimilarity = calculateStringSimilarity(bottleType, listingType);
      score += typeSimilarity * 0.1; // Type is 10% of the total score
    }
    
    // Exact matches for brand words (to catch partial brand matches)
    if (bottleBrand && listingName) {
      const brandWords = bottleBrand.toLowerCase().split(/\s+/);
      for (const word of brandWords) {
        if (word.length > 2 && listingName.toLowerCase().includes(word)) {
          score += 0.05; // Bonus for each brand word found in the name
        }
      }
    }
    
    // Age matching
    if (bottleAge && listingAge) {
      const bottleAgeNum = extractAgeValue(bottleAge);
      const listingAgeNum = extractAgeValue(listingAge);
      
      if (bottleAgeNum > 0 && listingAgeNum > 0) {
        // Ages within 2 years are considered similar
        if (Math.abs(bottleAgeNum - listingAgeNum) <= 2) {
          score += 0.1;
        }
      }
    }
    
    // ABV matching
    if (bottleABV && listingABV) {
      const bottleABVNum = extractNumericValue(bottleABV);
      const listingABVNum = extractNumericValue(listingABV);
      
      if (bottleABVNum > 0 && listingABVNum > 0) {
        // ABVs within 5% are considered similar
        if (Math.abs(bottleABVNum - listingABVNum) <= 5) {
          score += 0.05;
        }
      }
    }
    
    // Volume matching
    if (bottleVolume && listingVolume) {
      const bottleVolumeNum = extractNumericValue(bottleVolume);
      const listingVolumeNum = extractNumericValue(listingVolume);
      
      if (bottleVolumeNum > 0 && listingVolumeNum > 0) {
        // Volumes within 100ml are considered similar
        if (Math.abs(bottleVolumeNum - listingVolumeNum) <= 100) {
          score += 0.05;
        }
      }
    }
    
    // Cap score at 1.0
    return Math.min(1.0, score);
  } catch (error) {
    console.error('Error calculating match score:', error);
    return 0.1; // Return a small base score on error
  }
}

// Calculate a quality score between the detected bottle and a potential match
// Higher score means the BAXUS bottle is better quality
function calculateQualityScore(bottleInfo, listing) {
  try {
    // Extract source data from the listing
    const source = listing._source || {};
    const attributes = source.attributes || {};
    
    // Initialize quality score
    let qualityScore = 0.5; // Start at neutral
    
    // Compare age statements (older is generally better)
    const bottleAge = extractAgeValue(bottleInfo.age || '');
    const listingAge = extractAgeValue(attributes.Age || '');
    
    if (bottleAge && listingAge) {
      // Age comparison: Award points if listing is older
      if (listingAge > bottleAge) {
        const ageDiff = listingAge - bottleAge;
        qualityScore += Math.min(0.3, ageDiff * 0.03); // Up to 0.3 points for age
      } else if (listingAge < bottleAge) {
        const ageDiff = bottleAge - listingAge;
        qualityScore -= Math.min(0.3, ageDiff * 0.03);
      }
    }
    
    // Check for indicators of premium quality
    const premiumIndicators = [
      'limited edition', 'special release', 'single cask', 'cask strength', 
      'limited', 'rare', 'exceptional', 'premium', 'reserve', 'single barrel',
      'vintage', 'collector', 'exclusive'
    ];
    
    // Check listing name and attributes for premium indicators
    const listingNameLower = (source.name || '').toLowerCase();
    let premiumPoints = 0;
    
    premiumIndicators.forEach(indicator => {
      if (listingNameLower.includes(indicator)) {
        premiumPoints += 0.05;
      }
    });
    
    // Check each attribute for premium indicators
    for (const key in attributes) {
      const value = String(attributes[key]).toLowerCase();
      premiumIndicators.forEach(indicator => {
        if (value.includes(indicator)) {
          premiumPoints += 0.05;
        }
      });
    }
    
    // Cap premium points and add to quality score
    qualityScore += Math.min(0.3, premiumPoints);
    
    // Check bottle type - single malts and special types get higher score
    const types = {
      'single malt': 0.1,
      'single barrel': 0.1,
      'small batch': 0.05,
      'reserve': 0.05
    };
    
    const bottleType = (bottleInfo.type || '').toLowerCase();
    const listingType = (source.spiritType || source.type || '').toLowerCase();
    
    // Give points if listing has a premium type that the detected bottle doesn't
    for (const [type, points] of Object.entries(types)) {
      if (!bottleType.includes(type) && listingType.includes(type)) {
        qualityScore += points;
      }
    }
    
    // Check ABV - higher is often better quality
    const bottleABV = extractNumericValue(bottleInfo.abv || '');
    const listingABV = extractNumericValue(attributes.ABV || '');
    
    if (bottleABV && listingABV && listingABV > bottleABV) {
      const abvDiff = listingABV - bottleABV;
      qualityScore += Math.min(0.2, abvDiff * 0.02); // Up to 0.2 points for higher ABV
    }
    
    // Cap the final score between 0 and 1
    return Math.max(0, Math.min(1, qualityScore));
  } catch (error) {
    console.error('Error calculating quality score:', error);
    return 0.5; // Return neutral score on error
  }
}

// Helper function to calculate string similarity
function calculateStringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  // Convert to lowercase
  str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();
  
  // Calculate Levenshtein distance
  const levenshteinDistance = calculateLevenshteinDistance(str1, str2);
  
  // Calculate similarity based on distance
  const maxLength = Math.max(str1.length, str2.length);
  const similarity = 1 - (levenshteinDistance / maxLength);
  
  return similarity;
}

// Helper function to calculate Levenshtein distance
function calculateLevenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  
  // Create a matrix to store distances
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(null));
  
  // Initialize the first row and column
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }
  
  // Fill in the rest of the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  
  // The Levenshtein distance is the value in the bottom-right corner
  return dp[m][n];
}

// Generate human-readable explanation of why items matched
function generateMatchDetails(bottleInfo, listing, score) {
  try {
    // Extract source data from the listing
    const source = listing._source || {};
    const attributes = source.attributes || {};
    
    // Extract data points
    const listingName = source.name || "";
    const listingBrand = attributes.Producer || attributes.Brand || "";
    const listingType = source.type || source.spiritType || attributes.Type || "";
    const listingVintage = attributes["Year Distilled"] || attributes.Vintage || "";
    const listingAge = attributes.Age || "";
    const listingRegion = attributes.Region || "";
    const listingCountry = attributes.Country || "";
    
    // Create an array of match reasons
    const matchReasons = [];
    
    // Name match
    if (bottleInfo.name && listingName) {
      const bottleNameLower = bottleInfo.name.toLowerCase();
      const listingNameLower = listingName.toLowerCase();
      
      if (bottleNameLower === listingNameLower) {
        matchReasons.push(`Exact name match: "${bottleInfo.name}"`);
      } else if (listingNameLower.includes(bottleNameLower) || bottleNameLower.includes(listingNameLower)) {
        matchReasons.push(`Similar name: "${bottleInfo.name}" matches parts of "${listingName}"`);
      }
    }
    
    // Brand match
    if (bottleInfo.brand && listingBrand) {
      const bottleBrandLower = bottleInfo.brand.toLowerCase();
      const listingBrandLower = listingBrand.toLowerCase();
      
      if (bottleBrandLower === listingBrandLower) {
        matchReasons.push(`Exact brand match: "${bottleInfo.brand}"`);
      } else if (listingBrandLower.includes(bottleBrandLower) || bottleBrandLower.includes(listingBrandLower)) {
        matchReasons.push(`Similar brand: "${bottleInfo.brand}" is related to "${listingBrand}"`);
      }
    }
    
    // Type match
    if (bottleInfo.type && listingType) {
      const bottleTypeLower = bottleInfo.type.toLowerCase();
      const listingTypeLower = listingType.toLowerCase();
      
      if (bottleTypeLower === listingTypeLower) {
        matchReasons.push(`Exact type match: "${bottleInfo.type}"`);
      } else if (listingTypeLower.includes(bottleTypeLower) || bottleTypeLower.includes(listingTypeLower)) {
        matchReasons.push(`Similar type: "${bottleInfo.type}" is related to "${listingType}"`);
      }
    }
    
    // Vintage/age match
    if (bottleInfo.vintage && (listingVintage || listingAge)) {
      const bottleYear = parseInt(bottleInfo.vintage, 10);
      const listingYear = parseInt(listingVintage, 10);
      
      if (!isNaN(bottleYear) && !isNaN(listingYear) && bottleYear === listingYear) {
        matchReasons.push(`Exact vintage match: "${bottleInfo.vintage}"`);
      } else if (listingAge && bottleInfo.vintage.includes(listingAge)) {
        // Check if vintage information contains age
        matchReasons.push(`Age information matched: "${bottleInfo.vintage}" contains age "${listingAge}"`);
      }
    }
    
    // Add region/country if available (these weren't factored into score but are good context)
    if ((bottleInfo.region || bottleInfo.location) && (listingRegion || listingCountry)) {
      const bottleLocation = (bottleInfo.region || bottleInfo.location || "").toLowerCase();
      const listingLocation = (listingRegion || listingCountry || "").toLowerCase();
      
      if (bottleLocation && listingLocation && 
          (listingLocation.includes(bottleLocation) || bottleLocation.includes(listingLocation))) {
        matchReasons.push(`Location match: Found in "${listingRegion || listingCountry}"`);
      }
    }
    
    // Add overall match score
    matchReasons.push(`Overall match score: ${(score * 100).toFixed(0)}%`);
    
    // If no specific reasons, add generic explanation
    if (matchReasons.length <= 1) {
      matchReasons.unshift("Some bottle characteristics match");
    }
    
    return matchReasons;
  } catch (error) {
    console.error('Error generating match details:', error);
    return [`Match score: ${(score * 100).toFixed(0)}%`];
  }
}

// Helper function to extract numeric age value from text
function extractAgeValue(ageText) {
  if (!ageText) return null;
  
  // Try to extract a number from the text
  const match = ageText.toString().match(/(\d+)/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}

// Helper to extract numeric value from text (for ABV etc.)
function extractNumericValue(text) {
  if (!text) return null;
  
  try {
    // Try to extract a decimal number
    const match = String(text).match(/(\d+(?:\.\d+)?)/);
    if (match && match[1]) {
      return parseFloat(match[1]);
    }
    return null;
  } catch (error) {
    console.error('Error extracting numeric value from text:', error, text);
    return null;
  }
}

// Set up proper error handling for all Chrome API calls
function chromeAPIWrapper(apiCall, fallback = null) {
  try {
    return apiCall();
  } catch (error) {
    console.error('Chrome API error:', error);
    return fallback;
  }
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('Background received message:', request.action);
  
  // Process request based on action
  switch (request.action) {
    case 'getBottleMatches':
      // Get bottle matches from the BAXUS marketplace
      if (!request.data || !request.data.bottleInfo) {
        sendResponse({ 
          success: false, 
          error: 'Invalid bottle info in request' 
        });
        return true;
      }
      
      findMatchingBottles(request.data.bottleInfo)
        .then(matches => {
          // Update the UI with the matches
          console.log('Found matches:', matches);
          
          // Highlight bottles that are better quality and better value
          matches.forEach(match => {
            // Add visual indicators for better quality/value bottles
            if (match.better) {
              match.bestValue = true;
              match.label = 'BETTER VALUE';
            }
          });
          
          sendResponse({ 
            success: true, 
            matches: matches
          });
        })
        .catch(error => {
          console.error('Error getting bottle matches:', error);
          sendResponse({ 
            success: false, 
            error: `Failed to get matches: ${error.message}`
          });
        });
      
      // Return true to indicate we'll send response asynchronously
      return true;
    case 'bottleDetected':
      // Store the detected bottle info
      currentPageBottleInfo = request.bottleInfo;
      
      // Also store by tab ID for better organization
      if (sender.tab && sender.tab.id) {
        tabIdToBottleInfo.set(sender.tab.id, request.bottleInfo);
        
        // Set badge on tab
        chromeAPIWrapper(() => {
          chrome.action.setBadgeText({
            text: "🍷",
            tabId: sender.tab.id
          });
        });
      }
      
      // Store in local storage for persistence
      chromeAPIWrapper(() => {
        chrome.storage.local.set({
          currentBottle: request.bottleInfo
        });
      });
      
      sendResponse({ success: true });
    case 'findMatches':
      // This needs to be async
      findMatchingBottles(request.bottleInfo)
        .then(matches => {
          // Add debugging to see what data we're passing
          console.log('Sending matches to content script:', JSON.stringify(matches));
          
          // Store matches in storage for persistence
          chromeAPIWrapper(() => {
            chrome.storage.local.set({
              currentMatches: matches
            });
          });
          
          sendResponse({ 
            success: true, 
            matches: matches 
          });
        })
        .catch(error => {
          console.error('Error finding matches:', error);
          sendResponse({ 
            success: false, 
            error: error.message 
          });
        });
      
      return true; // Keep the messaging channel open for async response
    case 'analyzeWithOpenAI':
      // Handle OpenAI analysis requests from content script
      if (!request.data) {
        sendResponse({ success: false, error: 'No data provided for OpenAI analysis' });
        return false;
      }
      
      analyzeBottleWithOpenAI(request.data)
        .then(bottleInfo => {
          console.log('OpenAI analysis result:', bottleInfo);
          sendResponse({ success: true, bottleInfo: bottleInfo });
        })
        .catch(error => {
          console.error('Error analyzing with OpenAI:', error);
          sendResponse({ success: false, error: error.message });
        });
      
      return true; // Keep the messaging channel open for async response
    case 'enhanceWithAWS':
      // Handle AWS enhancement requests from content script
      if (!request.bottleInfo) {
        sendResponse({ success: false, error: 'No bottle info provided for AWS enhancement' });
        return false;
      }
      
      enhanceBottleInfo(request.bottleInfo)
        .then(enhancedInfo => {
          console.log('AWS enhancement result:', enhancedInfo);
          sendResponse({ success: true, bottleInfo: enhancedInfo });
        })
        .catch(error => {
          console.error('Error enhancing with AWS:', error);
          sendResponse({ success: false, error: error.message });
        });
      
      return true; // Keep the messaging channel open for async response
    case 'getBottleInfo':
      console.log('Returning bottle info:', currentPageBottleInfo);
      // This action is used by the popup script
      
      // First try to get bottle info for the active tab
      if (sender.tab && sender.tab.id && tabIdToBottleInfo.has(sender.tab.id)) {
        sendResponse({ 
          success: true, 
          bottleInfo: tabIdToBottleInfo.get(sender.tab.id) 
        });
      }
      // Fall back to the last detected bottle
      else if (currentPageBottleInfo) {
        sendResponse({ 
          success: true, 
          bottleInfo: currentPageBottleInfo 
        });
      }
      // Nothing found
      else {
        sendResponse({ 
          success: false, 
          error: 'No bottle detected' 
        });
      }
    case 'getDetectedBottle':
      // Legacy handler for popup.js
      sendResponse({ 
        success: true, 
        bottleInfo: currentPageBottleInfo 
      });
  }
  
  return true; // Keep messaging channel open
});

// Reset extension state when a tab is closed to free up memory
chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
  // Clear any bottle info associated with this tab
  if (tabIdToBottleInfo.has(tabId)) {
    tabIdToBottleInfo.delete(tabId);
  }
});

// Keep a map of tabs to their bottle info
const tabIdToBottleInfo = new Map();

// Make sure we have a variable to store the current bottle info
let currentPageBottleInfo = null;

// OpenAI API integration for accurate bottle detection
async function analyzeBottleWithOpenAI(data) {
  console.log('Analyzing bottle with OpenAI:', data);
  
  // Extract structured data first if available
  let structuredDataInfo = "No structured data available.";
  if (data.structuredData) {
    structuredDataInfo = "STRUCTURED DATA:\n" + JSON.stringify(data.structuredData, null, 2);
  }
  
  // Prepare price information for the prompt - with much more detailed context
  let priceInfo = "No price information detected.";
  if (data.priceElements && data.priceElements.length > 0) {
    priceInfo = "PRICE ELEMENTS FOUND ON PAGE (most likely current price first):\n";
    data.priceElements.forEach((price, index) => {
      const priceType = price.type || 'unknown';
      const context = price.context ? `\n    Context: ${price.context}` : '';
      const structuredData = price.matchesStructuredData ? 
        `\n    MATCHES STRUCTURED DATA: ${price.structuredPrice} ${price.structuredCurrency}` : '';
      
      priceInfo += `${index + 1}. ${price.text} (Type: ${priceType}, Priority: ${index === 0 ? 'HIGH' : 'Medium'})${context}${structuredData}\n`;
    });
    
    // If we have structured data price, highlight it specifically
    if (data.structuredData && data.structuredData.offers && data.structuredData.offers.price) {
      priceInfo += `\nSTRUCTURED DATA PRICE: ${data.structuredData.offers.price} ${data.structuredData.offers.priceCurrency || 'USD'}\n`;
    }
  }
  
  // Get visible text from the page to help with context
  let visibleTextInfo = "No visible text available.";
  if (data.visibleText) {
    visibleTextInfo = "RELEVANT PAGE TEXT:\n" + data.visibleText;
  }
  
  // Construct a detailed prompt for accurate bottle detection
  const prompt = `
You are analyzing an e-commerce product page for a whisky/spirits bottle. 
Extract accurate information about the exact bottle and its CURRENT selling price.

URL: ${data.url || 'Not provided'}

PAGE TITLE: ${data.title || 'Not provided'}

${structuredDataInfo}

PAGE ELEMENTS (Product Name, Brand, Details):
${data.elements ? data.elements.join('\n') : 'No element data available'}

${priceInfo}

${visibleTextInfo}

IMAGES: ${data.images ? data.images.join(', ') : 'No image data available'}

I need you to identify:

1. The EXACT bottle name (include age statement, special editions, cask types, etc.)
2. The CURRENT selling price (not any old/RRP/was prices)
3. Any distillery/brand information
4. Bottle type/category
5. Age statement if present
6. ABV percentage if available

For the PRICE specifically:
- Look at the structured data price if available (most reliable source)
- The FIRST price element in the list above is usually the current price
- Elements marked as "Type: current" are likely the current price
- Elements near "add to cart" buttons are usually current prices
- Ignore prices marked as "Type: old" as they are usually crossed-out or original prices
- Be wary of secondary prices that might be for samples or different bottle sizes
- Pay attention to context words around the price

IMPORTANT: Return a valid JSON object with these fields:
- name (string, required): full bottle name
- brand (string): distillery or producer
- type (string): whisky type (Single Malt, Bourbon, etc.)
- age (number or null): age statement in years
- price (string, required): current selling price with currency symbol
- price_currency (string): USD, GBP, EUR, etc.
- numericPrice (number): just the number portion of the price
- abv (string): alcohol percentage
- confidence (string): "High", "Medium", or "Low" based on certainty
- price_confidence (string): "High", "Medium", or "Low" for price
`;

  try {
    // IMPORTANT: For production deployment, NEVER store API keys in code!
    // Use secure environment variables or a secrets management service instead
    const apiKey = 'YOUR_OPENAI_API_KEY_HERE'; // REPLACE WITH YOUR API KEY
    
    const endpoint = 'https://api.openai.com/v1/chat/completions';
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: 'gpt-3.5-turbo-16k', // Use a larger context model for better analysis
        messages: [
          {
            role: 'system',
            content: 'You are a world-class expert in whisky identification and e-commerce analysis. Your specialty is extracting precise product information from any type of website, regardless of structure or complexity. You have extensive knowledge of whisky brands, terminology, and pricing patterns across global markets. You consistently deliver accurate data in perfect JSON format, focusing especially on extracting exact current prices from complex e-commerce pages.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Lower temperature for more consistent results
        max_tokens: 800,  // Increased token limit for thorough analysis
        top_p: 0.95
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API returned status ${response.status}: ${await response.text()}`);
    }

    const responseData = await response.json();
    console.log('OpenAI raw response:', responseData);

    // Extract the content from the response
    if (!responseData.choices || responseData.choices.length === 0) {
      throw new Error('Empty response from OpenAI API');
    }

    const content = responseData.choices[0].message.content;
    console.log('OpenAI content response:', content);

    // Extract JSON from the response
    let bottleInfo = extractJSONFromText(content);
    
    if (!bottleInfo) {
      throw new Error('Failed to extract valid JSON from OpenAI response');
    }

    // Post-process the data to handle edge cases
    bottleInfo = postProcessBottleInfo(bottleInfo, data);
    
    // Add additional fields needed for the application
    bottleInfo.detectionMethod = 'openai';
    bottleInfo.url = data.url;
    bottleInfo.source = extractDomainFromUrl(data.url);
    
    // Use fallback values if needed
    if (!bottleInfo.name || bottleInfo.name === "Unknown") {
      bottleInfo.name = extractTitleFromData(data);
    }
    
    // Directly use the first price element if price is still missing and we have price elements
    if ((!bottleInfo.price || bottleInfo.price === "Unknown") && data.priceElements && data.priceElements.length > 0) {
      const firstPrice = data.priceElements[0].text;
      bottleInfo.price = firstPrice.trim();
      
      // Try to infer the currency
      if (firstPrice.includes('$')) bottleInfo.price_currency = 'USD';
      else if (firstPrice.includes('£')) bottleInfo.price_currency = 'GBP';
      else if (firstPrice.includes('€')) bottleInfo.price_currency = 'EUR';
      
      bottleInfo.numericPrice = extractNumericValue(firstPrice);
      bottleInfo.price_confidence = "Medium";
    }
    
    // If we still don't have a price and have structured data
    if ((!bottleInfo.price || bottleInfo.price === "Unknown") && 
        data.structuredData && data.structuredData.offers && data.structuredData.offers.price) {
      const structuredPrice = data.structuredData.offers.price;
      const structuredCurrency = data.structuredData.offers.priceCurrency || 'USD';
      
      bottleInfo.price = `${getCurrencySymbol(structuredCurrency)}${structuredPrice}`;
      bottleInfo.price_currency = structuredCurrency;
      bottleInfo.numericPrice = parseFloat(structuredPrice);
      bottleInfo.price_confidence = "High";
    }
    
    console.log('Final processed bottle info:', bottleInfo);
    return bottleInfo;
    
  } catch (error) {
    console.error('Error in OpenAI analysis:', error);
    
    // Provide a fallback response using basic data extraction
    // First try to get price from price elements
    let price = null;
    let priceCurrency = 'USD';
    
    if (data.priceElements && data.priceElements.length > 0) {
      price = data.priceElements[0].text;
      // Detect currency
      if (price.includes('$')) priceCurrency = 'USD';
      else if (price.includes('£')) priceCurrency = 'GBP';
      else if (price.includes('€')) priceCurrency = 'EUR';
    } 
    // If no price from elements, try structured data
    else if (data.structuredData && data.structuredData.offers && data.structuredData.offers.price) {
      const structuredPrice = data.structuredData.offers.price;
      const structuredCurrency = data.structuredData.offers.priceCurrency || 'USD';
      price = `${getCurrencySymbol(structuredCurrency)}${structuredPrice}`;
      priceCurrency = structuredCurrency;
    }
    
    return {
      name: extractTitleFromData(data),
      price: price,
      price_currency: priceCurrency,
      brand: extractBrandFromData(data),
      type: "Whisky",
      confidence: "Low",
      price_confidence: "Low",
      detectionMethod: "fallback",
      url: data.url,
      source: extractDomainFromUrl(data.url)
    };
  }
}

// Helper function to extract JSON from OpenAI text response
function extractJSONFromText(text) {
  try {
    // First, try parsing the text directly (in case it's just JSON)
    try {
      return JSON.parse(text);
    } catch (e) {
      // Not a direct JSON response
    }
    
    // Try to find JSON within markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        return JSON.parse(codeBlockMatch[1]);
      } catch (e) {
        console.error('Error parsing JSON from code block:', e);
      }
    }
    
    // Try to find JSON with curly braces
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('Error parsing JSON from braces:', e);
      }
    }
    
    // If all else fails, extract key fields manually
    const fields = {
      name: extractField(text, 'name'),
      brand: extractField(text, 'brand'),
      type: extractField(text, 'type'),
      age: extractField(text, 'age'),
      price: extractField(text, 'price'),
      price_currency: extractField(text, 'price_currency'),
      abv: extractField(text, 'abv'),
      confidence: extractField(text, 'confidence'),
      price_confidence: extractField(text, 'price_confidence')
    };
    
    return fields;
  } catch (error) {
    console.error('Error extracting JSON from text:', error);
    return null;
  }
}

// Helper function to extract a field value from text
function extractField(text, fieldName) {
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*"?([^",\n}]*)"?`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

// Post-process bottle information to handle edge cases
function postProcessBottleInfo(bottleInfo, data) {
  // Make a copy to avoid modifying the original
  const processed = { ...bottleInfo };
  
  // Process price field
  if (processed.price) {
    // Extract numeric price for comparison
    processed.numericPrice = extractNumericValue(processed.price);
    
    // Ensure proper currency formatting with symbol
    const hasCurrencySymbol = /^[\$\£\€\¥]/.test(processed.price);
    if (!hasCurrencySymbol) {
      // Add currency symbol if missing
      const currency = processed.price_currency || 'USD';
      const symbol = getCurrencySymbol(currency);
      
      // Only call toFixed if numericPrice is not null
      if (processed.numericPrice !== null && processed.numericPrice !== undefined) {
        processed.price = `${symbol}${processed.numericPrice.toFixed(2)}`;
      } else {
        // Handle case where we couldn't extract numeric value
        processed.price = `${symbol}${processed.price}`;
      }
    }
  } else if (data.priceElements && data.priceElements.length > 0) {
    // Fallback to the first price element if AI couldn't detect one
    // Extract just the price with currency symbol if possible
    let firstPrice = data.priceElements[0].text;
    // Make sure we prioritize exactly extracted prices with currency symbols
    if (data.priceElements[0].originalText && data.priceElements[0].text) {
      firstPrice = data.priceElements[0].text; // This should already contain the currency
    }
    processed.price = firstPrice.trim();
    
    // Try to infer the currency
    if (firstPrice.includes('$')) processed.price_currency = 'USD';
    else if (firstPrice.includes('£')) processed.price_currency = 'GBP';
    else if (firstPrice.includes('€')) processed.price_currency = 'EUR';
    else if (firstPrice.includes('¥')) processed.price_currency = 'JPY';
    
    processed.numericPrice = extractNumericValue(firstPrice);
    processed.price_confidence = "Medium";
  }
  
  // Process name field
  if (processed.name) {
    // Remove any quotation marks from the name
    processed.name = processed.name.replace(/^["']|["']$/g, '');
    
    // Standardize spacing
    processed.name = processed.name.replace(/\s+/g, ' ').trim();
  }
  
  // Convert age to numeric if possible
  if (processed.age && typeof processed.age === 'string') {
    const ageMatch = processed.age.match(/\d+/);
    if (ageMatch) {
      processed.age = parseInt(ageMatch[0], 10);
    } else {
      processed.age = null;
    }
  }
  
  return processed;
}

// Helper function to get currency symbol from currency code
function getCurrencySymbol(currency) {
  const symbols = {
    'USD': '$',
    'GBP': '£',
    'EUR': '€',
    'JPY': '¥',
    'AUD': 'A$',
    'CAD': 'C$'
  };
  
  return symbols[currency] || '$';
}

// Extract domain from URL
function extractDomainFromUrl(url) {
  try {
    if (!url) return '';
    const domain = url.replace(/^https?:\/\//, '').split('/')[0];
    return domain.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

// Extract title from data
function extractTitleFromData(data) {
  if (!data) return 'Unknown Whisky';
  
  // Try page title first
  if (data.title) {
    // Remove site name typically after pipe or dash
    const title = data.title.split(/\s[|\-–—]\s/)[0].trim();
    return title;
  }
  
  // Try the first product element
  if (data.elements && data.elements.length > 0) {
    return data.elements[0];
  }
  
  return 'Unknown Whisky';
}

// Extract basic price from data
function extractPriceFromData(data) {
  if (!data) return null;
  
  // Try price elements
  if (data.priceElements && data.priceElements.length > 0) {
    return data.priceElements[0].text;
  }
  
  // Try structured data
  if (data.structuredData && data.structuredData.offers && data.structuredData.offers.price) {
    const price = data.structuredData.offers.price;
    const currency = data.structuredData.offers.priceCurrency || 'USD';
    return `${getCurrencySymbol(currency)}${price}`;
  }
  
  return null;
}

// Extract brand from data
function extractBrandFromData(data) {
  if (!data) return null;
  
  // Try structured data
  if (data.structuredData && data.structuredData.brand && data.structuredData.brand.name) {
    return data.structuredData.brand.name;
  }
  
  // Try title for common brand names
  if (data.title) {
    const commonBrands = ['Macallan', 'Glenfiddich', 'Glenlivet', 'Lagavulin', 'Suntory', 'Yamazaki', 'Hibiki', 'Nikka', 'Johnnie Walker', 'Jack Daniel', 'Maker', 'Buffalo Trace', 'Woodford', 'Balvenie'];
    
    for (const brand of commonBrands) {
      if (data.title.includes(brand)) {
        return brand;
      }
    }
  }
  
  return null;
}
