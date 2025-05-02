// Content script for The Honey Barrel extension
// Scrapes whisky/wine bottle information from e-commerce websites

// Global variable to track if we've found a bottle on this page
let currentBottleInfo = null;

// Flag to track if we're in the process of checking
let checkInProgress = false;

// Store detected matches locally in the content script
let currentMatches = [];

// Flag to indicate if notification is showing
let notificationActive = false;

// The Honey Barrel storage key for session persistence
const STORAGE_KEY = 'honeyBarrelData';

// Basic attempt to validate context
function tryExtensionAPI(callback) {
  try {
    if (chrome && chrome.runtime && chrome.runtime.id) {
      callback();
      return true;
    }
  } catch (e) {
    console.log('Extension context invalid, using local detection only');
  }
  return false;
}

// Initialize content script and set up self-sufficient bottle detection
function initialize() {
  console.log('The Honey Barrel content script initializing');
  
  // Recover from session storage if available
  recoverState(true);
  
  // Set up page-level bottle detection that works regardless of extension context
  runBottleDetection();
  
  // Monitor for page changes that might indicate new product
  observePageChanges();
}

// Save state to session storage for recovery
function saveState() {
  if (currentBottleInfo) {
    try {
      // Use window.sessionStorage which is always available
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        bottleInfo: currentBottleInfo,
        matches: currentMatches,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.error('Error saving state:', e);
    }
    
    // Try extension storage if available
    tryExtensionAPI(() => {
      chrome.storage.local.set({
        currentBottle: currentBottleInfo,
        matches: currentMatches
      });
    });
  }
}

// Recover state from session storage
function recoverState(skipPopup = false) {
  try {
    const savedData = sessionStorage.getItem(STORAGE_KEY);
    if (savedData) {
      const data = JSON.parse(savedData);
      
      // Check if data is recent (within last 30 minutes)
      if (data.timestamp && (Date.now() - data.timestamp < 30 * 60 * 1000)) {
        // Verify the data structure before using it
        if (data.bottleInfo) {
          currentBottleInfo = data.bottleInfo;
          currentMatches = Array.isArray(data.matches) ? data.matches : [];
          
          console.log('Recovered state from session storage:', currentBottleInfo);
          
          // If skipPopup is true, we don't show the notification regardless of other conditions
          if (skipPopup) {
            console.log('Skipping popup display due to skipPopup flag');
            return true;
          }
          
          // Check settings synchronously before attempting to show the popup
          let cachedSettings = sessionStorage.getItem('honeyBarrelSettings');
          let popupsDisabled = false;
          
          if (cachedSettings) {
            try {
              let settings = JSON.parse(cachedSettings);
              popupsDisabled = settings.showBaxusPopup === false;
              
              if (popupsDisabled) {
                console.log('Popups disabled in cached settings, skipping notification');
                return true;
              }
            } catch (e) {
              console.error('Error parsing cached settings:', e);
            }
          }
          
          // If we can't determine settings from cache, we need to check async
          // But set a flag to prevent flash
          if (currentBottleInfo && currentMatches && currentMatches.length > 0 && !notificationActive) {
            // Make sure all required properties exist in currentBottleInfo before showing notification
            if (typeof currentBottleInfo === 'object' && currentBottleInfo !== null) {
              // Check settings before showing popup, this prevents the flash
              chrome.storage.sync.get(['userSettings'], (result) => {
                const settings = result.userSettings || { showBaxusPopup: true };
                
                // Cache the settings for faster access next time
                try {
                  sessionStorage.setItem('honeyBarrelSettings', JSON.stringify(settings));
                } catch (e) {
                  console.error('Error caching settings:', e);
                }
                
                if (settings.showBaxusPopup !== false) {
                  console.log('Showing notification after settings check');
                  showPageNotification(currentBottleInfo, currentMatches);
                } else {
                  console.log('Popups disabled in settings, skipping notification');
                }
              });
            }
          }
          
          return true;
        }
      }
    }
  } catch (e) {
    console.error('Error recovering state:', e);
  }
  
  // If we reach here, either no data was found or it was invalid/expired
  // Reset to default state to avoid working with corrupt data
  currentBottleInfo = null;
  currentMatches = [];
  
  return false;
}

// Self-sufficient bottle detection without relying on extension context
function runBottleDetection() {
  console.log('Running bottle detection');
  
  // First check if this looks like a product page
  if (isLikelyProductPage()) {
    // Call our detection function
    checkForBottle();
  } else {
    console.log('Not a likely product page, skipping detection');
  }
}

// Fallback method to search for matches when extension context is invalid
function findLocalMatches(bottleInfo) {
  // Check if we have cached matches from sessionStorage or previous runs
  if (currentMatches && currentMatches.length > 0) {
    showPageNotification(bottleInfo, currentMatches);
    return;
  }
  
  // Create default matches with general links to BAXUS
  const searchTerm = encodeURIComponent((bottleInfo.brand ? bottleInfo.brand + ' ' : '') + 
                                         (bottleInfo.name || ''));
  
  // Create fallback matches that link directly to BAXUS search
  const fallbackMatches = [{
    name: bottleInfo.name || 'Your bottle',
    imageUrl: bottleInfo.imageUrl || '',
    price: bottleInfo.price || '',
    link: `https://baxus.co/search?q=${searchTerm}`,
    savings: 'Check on BAXUS',
    matchQuality: 'Visit BAXUS marketplace',
    fallback: true
  }];
  
  currentMatches = fallbackMatches;
  saveState();
  showPageNotification(bottleInfo, fallbackMatches);
}

// Watch for DOM changes that might indicate new product page (SPA navigation)
function observePageChanges() {
  let lastUrl = location.href;
  
  // Use MutationObserver to detect DOM changes
  const observer = new MutationObserver((mutations) => {
    // If URL changed, it's likely a new product page in a SPA
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('URL changed, checking for new bottle');
      
      // Reset bottle info
      currentBottleInfo = null;
      currentMatches = [];
      
      // Remove any existing notification
      const notification = document.getElementById('honey-barrel-notification');
      if (notification) notification.remove();
      notificationActive = false;
      
      // Check with delay to allow page content to load
      setTimeout(runBottleDetection, 1500);
    }
    // If significant DOM changes occurred, recheck for bottle
    else if (isSignificantDOMChange(mutations)) {
      setTimeout(runBottleDetection, 1500);
    }
  });
  
  // Start observing
  observer.observe(document, { 
    subtree: true, 
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'class', 'id'],
    characterData: false
  });
  
  // Also run bottle detection on page load events
  window.addEventListener('load', () => {
    setTimeout(runBottleDetection, 1500);
  });
}

// Helper to determine if DOM changes are significant enough to warrant rechecking
function isSignificantDOMChange(mutations) {
  // If we already have bottle info, be more selective about rechecking
  if (currentBottleInfo) {
    // Count how many significant elements were added
    let significantChanges = 0;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if added element is significant (product container, image, etc.)
            if (node.matches('div.product, .product-container, .product-image, #product-details')) {
              significantChanges++;
            }
            // Or if it contains significant elements
            else if (node.querySelector) {
              const hasProductElements = node.querySelector('.product, .product-title, .price, [id*="product"]');
              if (hasProductElements) significantChanges++;
            }
          }
        }
      }
    }
    
    return significantChanges >= 2; // Require multiple significant changes to reduce false positives
  }
  
  // If we don't have bottle info yet, be more generous with rechecking
  let addedElements = 0;
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      addedElements += mutation.addedNodes.length;
    }
  }
  
  return addedElements > 10; // Significant number of elements added
}

// List of supported websites with their selectors
const SITE_CONFIGS = {
  // Example for a popular whisky retailer
  'whiskyshop.com': {
    name: '.product-title',
    brand: '.product-subtitle',
    price: ['.product-price-current', '.price-current', '.current-price', '[data-price]', '.price', '.product-price'], // Added multiple selectors for better coverage
    type: '.product-category',
    vintage: '.product-vintage',
    imageUrl: '.product-gallery img',
    description: '.product-description',
    // Add special handler for this site
    special: {
      // Custom price handler for whiskyshop.com
      price: function() {
        console.log('Using special whiskyshop.com price handler');
        // Try to find the price using multiple approaches
        
        // Approach 1: Look for data-price attribute
        const priceDataElem = document.querySelector('[data-price]');
        if (priceDataElem) {
          const price = priceDataElem.getAttribute('data-price');
          if (price) {
            console.log('Found price from data-price attribute:', price);
            return price;
          }
        }
        
        // Approach 2: Look for specific price elements with £ symbol
        const priceElements = document.querySelectorAll('.price, .product-price, .product-price-current, .current-price');
        for (const elem of priceElements) {
          const text = elem.textContent.trim();
          if (text.includes('£') && /£\d+(\.\d{2})?/.test(text)) {
            console.log('Found price from element with £ symbol:', text);
            // Extract just the price part with regex
            const match = text.match(/£(\d+(\.\d{2})?)/);
            if (match && match[1]) {
              return '£' + match[1];
            }
            return text;
          }
        }
        
        // Approach 3: Look for elements with price-like text
        const allElements = document.querySelectorAll('*');
        for (const elem of allElements) {
          if (elem.childNodes.length === 1 && elem.firstChild.nodeType === Node.TEXT_NODE) {
            const text = elem.textContent.trim();
            // Check for price pattern
            if (text.includes('£') && /£\d+(\.\d{2})?/.test(text) && text.length < 15) {
              console.log('Found price from general element scan:', text);
              const match = text.match(/£(\d+(\.\d{2})?)/);
              if (match && match[1]) {
                return '£' + match[1];
              }
              return text;
            }
          }
        }
        
        // Approach 4: Use JSON-LD structured data if available
        const jsonLd = document.querySelector('script[type="application/ld+json"]');
        if (jsonLd) {
          try {
            const data = JSON.parse(jsonLd.textContent);
            if (data.offers && data.offers.price) {
              console.log('Found price from JSON-LD:', data.offers.price);
              return '£' + data.offers.price;
            }
          } catch (e) {
            console.error('Error parsing JSON-LD:', e);
          }
        }
        
        // Return null to fall back to default detection
        return null;
      }
    }
  },
  // Example for a wine retailer
  'wine.com': {
    name: '.pipName',
    brand: '.pipWinery',
    price: '.pipPriceAmount',
    type: '.pipClassifications',
    vintage: '.pipVintage',
    imageUrl: '.pipMainImage img',
    description: '.pipDescriptionText'
  },
  // Example for general e-commerce
  'amazon.com': {
    name: '#productTitle',
    price: '.a-price .a-offscreen',
    // Amazon often has the brand and other details in the product description
    description: '#feature-bullets',
    imageUrl: '#landingImage',
    additionalImages: '.a-dynamic-image'
  },
  // Add more site configurations as needed
  'totalwine.com': {
    name: '.product-name',
    price: '.price',
    brand: '.product-producer-name',
    vintage: '.vintage',
    type: '.product-classification',
    imageUrl: '.primary-image img',
    description: '.product-information-tab'
  },
  'masterofmalt.com': {
    name: 'h1.product-title',
    price: '.product-action-item__price',
    brand: '.product-meta-item--brand',
    type: '.product-meta-item--category',
    description: '.product-facts',
    imageUrl: '.product-hero__image'
  },
  'reservebar.com': {
    name: '.product-single__title',
    price: '.product__price',
    description: '.product-single__description',
    imageUrl: '.product-single__photo img'
  }
};

// Main scraper function (Keeping this as is)
async function scrapeBottleInfo() {
  try {
    console.log('Scraping bottle info from page');
    
    // Get hostname for site-specific handling
    let hostname = '';
    try {
      hostname = window.location.hostname ? window.location.hostname.toLowerCase() : '';
    } catch (e) {
      console.error('Error getting hostname:', e);
      hostname = '';
    }
    
    // Log the hostname for debugging
    console.log('Detected hostname:', hostname);
    
    // Universal approach: Try AI-powered detection first for ALL sites
    // This ensures we get accurate bottle names regardless of site structure
    console.log('Using AI-powered detection for universal bottle recognition');
    const openAIResult = await detectBottleWithOpenAI();
    if (openAIResult && openAIResult.name && openAIResult.name !== "Unknown") {
      console.log('Successfully detected bottle with OpenAI:', openAIResult);
      
      // Format the result properly to ensure it works with rest of the app
      const formattedResult = {
        name: openAIResult.name,
        brand: openAIResult.brand || openAIResult.distillery,
        type: openAIResult.type || openAIResult.bottleType,
        price: openAIResult.price,
        url: window.location.href,
        source: window.location.hostname.replace('www.', ''),
        detectionMethod: 'openai',
        confidence: openAIResult.confidence
      };
      
      // Add numeric price if available
      if (formattedResult.price) {
        formattedResult.priceNumeric = extractPrice(formattedResult.price);
        formattedResult.currency = detectCurrency(formattedResult.price);
        
        // CRITICAL FIX: Convert price to USD at the source
        // This ensures all downstream displays will show USD
        if (formattedResult.currency && formattedResult.currency !== 'USD') {
          console.log('DIRECT SOURCE CONVERSION: Converting price to USD', {
            original: formattedResult.price,
            currency: formattedResult.currency
          });
          
          // Store original values
          formattedResult.originalPrice = formattedResult.price;
          formattedResult.originalCurrency = formattedResult.currency;
          
          // Convert to USD using hardcoded rates
          const rates = {
            'EUR': 1.14,
            'GBP': 1.31,
            'JPY': 0.0067,
            'USD': 1.0
          };
          
          const rate = rates[formattedResult.currency] || 1.0;
          const usdValue = formattedResult.priceNumeric * rate;
          
          // Format price in USD
          formattedResult.price = `$${usdValue.toFixed(2)}`;
          formattedResult.currency = 'USD';
          
          console.log('DIRECT SOURCE CONVERSION: Price converted', {
            original: formattedResult.originalPrice,
            usd: formattedResult.price
          });
        }
      }
      
      return formattedResult;
    }
    
    // If AI failed, fall back to traditional scraping
    console.log('AI detection failed or returned no results, falling back to traditional scraping');
    
    // Find the appropriate site config
    const siteConfig = findMatchingSiteConfig(hostname);
    console.log('Using site config for hostname:', hostname, siteConfig);
    
    // Extract structured data first
    const structuredData = extractStructuredData();
    console.log('Extracted structured data:', structuredData);
    
    // Initialize bottle info
    let bottleInfo = {
      name: null,
      price: null,
      imageUrl: null,
      description: null,
      brand: null,
      url: window.location.href,
      detectionMethod: 'selector'
    };
    
    // Extract data using selectors
    for (const field in siteConfig) {
      if (field !== 'special' && Array.isArray(siteConfig[field])) {
        for (const selector of siteConfig[field]) {
          try {
            const value = extractWithSelector(selector, field);
            if (value) {
              bottleInfo[field] = value;
              break;
            }
          } catch (e) {
            console.error(`Error extracting ${field} with selector ${selector}:`, e);
          }
        }
      }
    }
    
    // Convert price to numeric value if present
    if (bottleInfo.price) {
      bottleInfo.priceNumeric = extractPrice(bottleInfo.price);
      bottleInfo.currency = detectCurrency(bottleInfo.price);
    }
    
    // Clean text fields
    if (bottleInfo.name) bottleInfo.name = cleanText(bottleInfo.name);
    if (bottleInfo.description) bottleInfo.description = cleanText(bottleInfo.description);
    if (bottleInfo.brand) bottleInfo.brand = cleanText(bottleInfo.brand);
    
    // Enhance with structured data if available
    if (structuredData) {
      bottleInfo = mergeStructuredData(bottleInfo, structuredData);
    }
    
    // Infer more details if possible
    bottleInfo = inferBottleDetails(bottleInfo);
    
    // If still no name or it's "Unknown", try AI detection as last resort
    if (!bottleInfo.name || bottleInfo.name === 'Unknown' || bottleInfo.name.length < 3) {
      console.log('Traditional scraping failed to find bottle name, using detectBottleWithAI as last resort');
      return detectBottleWithAI();
    }
    
    console.log('Final scraped bottle info:', bottleInfo);
    return bottleInfo;
  } catch (error) {
    console.error('Error in scrapeBottleInfo:', error);
    
    // If any error occurs, try basic AI detection as a reliable fallback
    try {
      console.log('Error in scraping, falling back to basic AI detection');
      return detectBottleWithAI();
    } catch (aiError) {
      console.error('AI fallback also failed:', aiError);
    }
    
    return null;
  }
}

// Simple and robust bottle checking that doesn't rely on complex state
async function checkForBottle(forceRefresh = false) {
  // Prevent multiple checks from running simultaneously
  if (checkInProgress && !forceRefresh) {
    console.log('Bottle check already in progress, skipping');
    return;
  }
  
  // Set flag to prevent multiple simultaneous checks
  checkInProgress = true;
  
  // If force refresh, clear any existing state
  if (forceRefresh) {
    console.log('Force refresh requested, clearing state');
    currentBottleInfo = null;
    currentMatches = [];
    notificationActive = false;
    
    // Clear storage
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      
      // Try to clear chrome storage too
      tryExtensionAPI(() => {
        chrome.storage.local.remove(STORAGE_KEY);
      });
    } catch (e) {
      console.log('Error clearing storage:', e);
    }
  }
  
  console.log('Checking for bottle on page');
  
  // First, check if this looks like a product page at all
  if (!isLikelyProductPage() && !forceRefresh) {
    console.log('This does not appear to be a product page, skipping bottle detection');
    checkInProgress = false;
    return;
  }
  
  try {
    // Try to scrape bottle info from the page
    const bottleInfo = await scrapeBottleInfo();
    
    if (bottleInfo && bottleInfo.name) {
      console.log('Bottle found:', bottleInfo);
      currentBottleInfo = bottleInfo;
      
      // Save state for recovery
      saveState();
      
      // Try to find matches using extension context
      const matchFound = tryExtensionAPI(() => {
        chrome.runtime.sendMessage(
          { action: 'findMatches', bottleInfo: bottleInfo },
          function(response) {
            if (response && response.matches) {
              console.log('Matches found:', response.matches);
              
              // Debug the IDs of the matches
              response.matches.forEach((match, index) => {
                console.log(`Match ${index} ID:`, match.id);
                console.log(`Match ${index} Link:`, match.link);
                
                // Ensure the ID is preserved exactly as received
                if (match.id) {
                  // Make sure we don't modify the ID in any way
                  match.rawId = match.id;
                }
              });
              
              currentMatches = response.matches;
              
              // Show notification to user
              showPageNotification(bottleInfo, response.matches);
            } else {
              console.log('No matches found or error occurred');
              showPageNotification(bottleInfo, []);
            }
            
            checkInProgress = false;
          }
        );
      });
      
      // Fall back to local matching if extension context invalid
      if (!matchFound) {
        console.log('Extension context invalid, using local matching');
        
        try {
          const matches = await findLocalMatches(bottleInfo);
          currentMatches = matches;
          
          // Save state for recovery
          saveState();
          
          // Show notification to user
          showPageNotification(bottleInfo, matches);
        } catch (e) {
          console.error('Error in local matching:', e);
          showPageNotification(bottleInfo, []);
        }
        
        checkInProgress = false;
      }
    } else {
      console.log('No bottle found on page');
      checkInProgress = false;
    }
  } catch (e) {
    console.error('Error checking for bottle:', e);
    checkInProgress = false;
  }
}

// Setup a basic message listener
function setupMessageListener() {
  if (!hasValidContext()) {
    console.error('The Honey Barrel: Cannot setup message listener - context invalid');
    return false;
  }
  
  try {
    // First remove any existing listeners to avoid duplicates
    try {
      if (chrome.runtime.onMessage.hasListeners()) {
        chrome.runtime.onMessage.removeListener(handleMessage);
      }
    } catch (e) {
      // Ignore errors when trying to remove listeners
    }
    
    // Now add the listener
    chrome.runtime.onMessage.addListener(handleMessage);
    return true;
  } catch (error) {
    console.error('The Honey Barrel: Error setting up message listener:', error);
    return false;
  }
}

// Handle messages from popup or background
function handleMessage(request, sender, sendResponse) {
  console.log('The Honey Barrel content script received message:', request);
  
  if (request.action === 'getDetectedBottle') {
    // Check first if we have already detected a bottle
    if (currentBottleInfo) {
      console.log('The Honey Barrel: Returning cached bottle info:', currentBottleInfo);
      sendResponse({ 
        bottleInfo: currentBottleInfo,
        success: true 
      });
    } else {
      // Try to detect a bottle now
      try {
        const bottleInfo = scrapeBottleInfo();
        if (bottleInfo) {
          currentBottleInfo = bottleInfo;
          sendResponse({ 
            bottleInfo: bottleInfo, 
            success: true 
          });
        } else {
          sendResponse({ 
            error: 'No bottle detected on this page',
            success: false
          });
        }
      } catch (error) {
        console.error('The Honey Barrel: Error scraping bottle info:', error);
        sendResponse({ 
          error: 'Error scraping bottle info: ' + error.message,
          success: false
        });
      }
    }
    return true; // Keep the messaging channel open for async response
  }
  
  // Handle other message types here
}

// Helper functions
function findMatchingSiteConfig(hostname) {
  // Safely handle null or undefined hostname
  if (!hostname) {
    console.log('Invalid hostname provided');
    return {
      name: ['.product-title', 'h1'],
      price: ['.price'],
      imageUrl: ['img.product-image'],
      description: ['.product-description']
    }; // Return a generic config
  }
  
  // Convert hostname to lowercase for comparison
  const normalizedHostname = hostname.toLowerCase();
  
  // Check each site config for a matching hostname
  for (const site in SITE_CONFIGS) {
    if (normalizedHostname.includes(site)) {
      return SITE_CONFIGS[site];
    }
  }
  
  // Return a generic fallback config if no match is found
  return {
    name: ['.product-title', 'h1'],
    price: ['.price'],
    imageUrl: ['img.product-image'],
    description: ['.product-description']
  };
}

function cleanText(text) {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ');
}

function extractPrice(priceText) {
  if (!priceText) return 0;
  
  try {
    // Log the incoming price text for debugging
    console.log('Extracting price from:', priceText);
    
    // Clean the input - remove excess whitespace
    const cleanedText = priceText.trim().replace(/\s+/g, ' ');
    console.log('Cleaned price text:', cleanedText);
    
    // Check for the special case of concatenated numbers that might cause incorrect parsing
    // This addresses the specific £79.00 vs £2,880.00 issue
    if (/£\d+\.\d{2}/.test(cleanedText)) {
      console.log('Detected UK price format with decimal point');
      // Direct extraction for clean UK format (£79.00)
      const directMatch = cleanedText.match(/£(\d+\.\d{2})/);
      if (directMatch && directMatch[1]) {
        const price = parseFloat(directMatch[1]);
        console.log('Directly extracted price:', price);
        return price;
      }
    }
    
    // Extract all numbers from the text
    const allNumbers = cleanedText.match(/\d+[,.]?\d*/g);
    console.log('All number matches:', allNumbers);
    
    if (!allNumbers || allNumbers.length === 0) return 0;
    
    // If there's only one number, it's likely the correct price
    if (allNumbers.length === 1) {
      const price = parseFloat(allNumbers[0].replace(',', '.'));
      console.log('Single number price:', price);
      return isNaN(price) ? 0 : price;
    }
    
    // For multiple numbers, try to determine which is most likely the price
    
    // Check for decimal pricing pattern (xx.xx or xx,xx)
    const decimalPattern = /\d+[,.]\d{2}$/;
    for (const num of allNumbers) {
      if (decimalPattern.test(num)) {
        const price = parseFloat(num.replace(',', '.'));
        console.log('Found decimal price pattern:', price);
        return isNaN(price) ? 0 : price;
      }
    }
    
    // If no decimal pattern, take the first number as it's most likely the price
    const price = parseFloat(allNumbers[0].replace(',', '.'));
    console.log('Using first number as price:', price);
    return isNaN(price) ? 0 : price;
  } catch (e) {
    console.error('Error in extractPrice:', e);
    return 0;
  }
}

function detectCurrency(priceText) {
  if (priceText.includes('$')) return 'USD';
  if (priceText.includes('£')) return 'GBP';
  if (priceText.includes('€')) return 'EUR';
  if (priceText.includes('¥')) return 'JPY';
  return 'USD'; // Default
}

function inferBottleDetails(bottleInfo) {
  const description = (bottleInfo.description || '').toLowerCase();
  
  // Infer type (whisky/wine)
  if (!bottleInfo.type) {
    if (description.includes('whisky') || description.includes('whiskey') || 
        description.includes('bourbon') || description.includes('scotch')) {
      bottleInfo.type = 'Whisky';
    } else if (description.includes('wine') || description.includes('red wine') || 
               description.includes('white wine') || description.includes('rosé')) {
      bottleInfo.type = 'Wine';
    }
  }
  
  // Look for vintage year
  if (!bottleInfo.vintage) {
    // Match 4-digit years between 1900 and current year
    const currentYear = new Date().getFullYear();
    const vintageMatch = description.match(/\b(19\d{2}|20[0-2]\d)\b/);
    if (vintageMatch && vintageMatch[0] <= currentYear) {
      bottleInfo.vintage = vintageMatch[0];
    }
  }
  
  // Extract brand/distillery information if not present
  if (!bottleInfo.brand) {
    // Look for common patterns indicating brand
    const brandPatterns = [
      /by\s+([\w\s]+?)\s+distillery/i,
      /from\s+([\w\s]+?)\s+winery/i,
      /([\w\s]+?)\s+distillery/i,
      /([\w\s]+?)\s+winery/i
    ];
    
    for (const pattern of brandPatterns) {
      const match = description.match(pattern);
      if (match && match[1]) {
        bottleInfo.brand = match[1].trim();
        break;
      }
    }
  }
  
  // Extract region information
  if (!bottleInfo.region) {
    // Look for wine regions or whisky regions
    const regions = [
      'bordeaux', 'burgundy', 'napa', 'tuscany', 'rioja', 'champagne', 
      'islay', 'speyside', 'highland', 'lowland', 'campbeltown', 'bourbon'
    ];
    
    for (const region of regions) {
      if (description.includes(region)) {
        bottleInfo.region = region.charAt(0).toUpperCase() + region.slice(1);
        break;
      }
    }
  }
  
  // Extract alcohol content (ABV)
  if (!bottleInfo.abv) {
    const abvMatch = description.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:abv|alcohol)/i);
    if (abvMatch && abvMatch[1]) {
      bottleInfo.abv = abvMatch[1] + '%';
    }
  }
  
  // Extract bottle size/volume
  if (!bottleInfo.volume) {
    const volumeMatch = description.match(/(\d+)\s*(?:ml|cl|l)\b/i);
    if (volumeMatch) {
      bottleInfo.volume = volumeMatch[0].trim();
    }
  }
  
  return bottleInfo;
}

function capturePageText() {
  // Get all text nodes that are visible
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip if parent is script, style, or hidden
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        const style = window.getComputedStyle(parent);
        if (parent.tagName === 'SCRIPT' || 
            parent.tagName === 'STYLE' || 
            style.display === 'none' && 
            style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }
        
        // Accept non-empty text nodes
        return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    }
  );
  
  const textContent = [];
  let node;
  
  while (node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (text) {
      textContent.push(text);
    }
  }
  
  return textContent.join(' ');
}

function detectBottleWithAI() {
  console.log('The Honey Barrel: Attempting AI-based bottle detection');
  
  // Collect data for AI analysis
  const pageData = {
    url: window.location.href,
    title: document.title,
    text: capturePageText(),
    meta: {}
  };
  
  // Extract meta tags
  const metaTags = document.querySelectorAll('meta');
  metaTags.forEach(tag => {
    const name = tag.getAttribute('name') || tag.getAttribute('property');
    const content = tag.getAttribute('content');
    if (name && content) {
      pageData.meta[name] = content;
    }
  });
  
  // Look for price patterns on the page
  const pricePatterns = [
    /\$\d+(\.\d{2})?/g,
    /£\d+(\.\d{2})?/g,
    /€\d+(\.\d{2})?/g,
    /\d+(\.\d{2})?\s*(USD|EUR|GBP)/g
  ];
  
  pageData.possiblePrices = [];
  
  for (const pattern of pricePatterns) {
    const matches = pageData.text.match(pattern);
    if (matches) {
      pageData.possiblePrices.push(...matches);
    }
  }
  
  // Extract main image
  const mainImage = findMainProductImage();
  if (mainImage) {
    pageData.mainImage = mainImage;
  }
  
  // Use heuristics to determine if this is a product page
  if (isLikelyProductPage()) {
    // Use local heuristics to extract basic bottle info
    const bottleInfo = {
      name: findProductName() || "Unknown Bottle",  // Set a default name
      url: pageData.url,
      source: window.location.hostname.replace('www.', ''),
      possibleName: findProductName(),
      price: findProductPrice(),
      imageUrl: mainImage
    };
    
    if (bottleInfo.price) {
      bottleInfo.priceNumeric = extractPrice(bottleInfo.price);
      bottleInfo.currency = detectCurrency(bottleInfo.price);
    }
    
    // If we're still dealing with an unknown bottle, try to use OpenAI
    if (bottleInfo.name === "Unknown Bottle" || !bottleInfo.name) {
      console.log('Attempting to use OpenAI for bottle detection');
      
      // We'll return the basic info we have, but also initiate an async OpenAI detection
      // that will update the UI once complete
      detectBottleWithOpenAI().then(aiResult => {
        if (aiResult && aiResult.name && aiResult.name !== "Unknown") {
          console.log('OpenAI successfully identified bottle:', aiResult);
          
          // Keep the price if we already found it
          if (bottleInfo.price && !aiResult.price) {
            aiResult.price = bottleInfo.price;
            aiResult.numericPrice = bottleInfo.numericPrice;
            aiResult.currency = bottleInfo.currency;
          }
          
          // Update the current bottle info
          currentBottleInfo = aiResult;
          
          // Save the updated state
          saveState();
          
          // Update UI if notification is active
          if (notificationActive) {
            // Re-fetch matches with the improved bottle info
            tryExtensionAPI(() => {
              chrome.runtime.sendMessage(
                { action: 'findMatches', bottleInfo: aiResult },
                function(response) {
                  if (response && response.matches) {
                    console.log('Updated matches found:', response.matches);
                    currentMatches = response.matches;
                    
                    // Update notification with new bottle info and matches
                    showPageNotification(aiResult, response.matches, true);
                  }
                }
              );
            });
          }
        }
      }).catch(error => {
        console.error('Error using OpenAI for detection:', error);
      });
    }
    
    return bottleInfo;
  }
  
  return null;
}

function isLikelyProductPage() {
  try {
    // If the URL contains product-related terms
    const url = window.location.href.toLowerCase();
    if (url.includes('product') || url.includes('item') || url.includes('whisky') || 
        url.includes('whiskey') || url.includes('spirits') || url.includes('bottle')) {
      return true;
    }
    
    // Check for common product page elements
    const productIndicators = [
      // Product title elements
      'h1.product-title', '.product-title', '[itemprop="name"]',
      // Price elements
      '.price', '[itemprop="price"]', '.product-price',
      // Add to cart buttons
      'button[id*="add-to-cart"]', '[class*="add-to-cart"]', '.btn-cart',
      // Product images
      '.product-image', '[id*="product-image"]', '[itemprop="image"]',
      // Product information sections
      '[id*="product-details"]', '.product-info', '.product-description'
    ];
    
    // If we find multiple product elements, it's likely a product page
    let indicatorsFound = 0;
    for (const selector of productIndicators) {
      if (document.querySelector(selector)) {
        indicatorsFound++;
        // Finding 3 or more indicators strongly suggests a product page
        if (indicatorsFound >= 3) {
          return true;
        }
      }
    }
    
    // Check for structured product data
    const structuredData = extractStructuredData();
    if (structuredData && 
        (structuredData['@type'] === 'Product' || 
         (Array.isArray(structuredData) && structuredData.some(item => item && item['@type'] === 'Product')))) {
      return true;
    }
    
    // If we have at least 2 indicators, it's probably a product page
    return indicatorsFound >= 2;
  } catch (e) {
    console.error('Error in isLikelyProductPage:', e);
    // Default to true to avoid missing detection on error
    return true;
  }
}

function findMainProductImage() {
  try {
    // Common product image selectors
    const selectors = [
      // Common classes and IDs
      '.product-image img', '.product-img img', '.main-image img', 
      '[itemprop="image"]', '.gallery img', '.product-gallery img',
      '.featured-image img', '#product-image', '.product-photo img',
      '[id*="product"][id*="image"]', '[class*="product"][class*="image"]'
    ];
    
    for (const selector of selectors) {
      const img = document.querySelector(selector);
      if (img && img.src) {
        return img.src;
      }
    }
    
    // If no images found with selectors, get large images from the page
    // that's likely to be a product image
    if (selectors.length === 0) {
      const allImages = document.querySelectorAll('img');
      allImages.forEach(img => {
        // Only include reasonably sized images that might be product photos
        if (img.width > 200 && img.height > 200 && img.src) {
          return img.src;
        }
      });
    }
    
    return null;
  } catch (e) {
    console.error('Error finding product image:', e);
    return null;
  }
}

function findProductName() {
  // Try common selectors for product names
  const selectors = [
    'h1', 
    '[itemprop="name"]',
    '.product-title',
    '.product-name',
    '.product-single__title'
  ];
  
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const text = element.textContent.trim();
      // Basic check for valid product name (not too short, not too long)
      if (text.length > 5 && text.length < 200) {
        return text;
      }
    }
  }
  
  // Fallback to page title
  return document.title.split('|')[0].trim();
}

function findProductPrice() {
  console.log('Finding product price on:', window.location.hostname);
  let detectedPrice = null;
  
  // STRATEGY 1: Use structured data (most reliable when available)
  try {
    const structuredData = extractStructuredData();
    if (structuredData) {
      console.log('Found structured data:', structuredData);
      
      // Check for offers data
      if (structuredData.offers) {
        const offers = Array.isArray(structuredData.offers) ? 
          structuredData.offers : [structuredData.offers];
        
        if (offers.length > 0 && offers[0].price) {
          const price = offers[0].price;
          const currency = offers[0].priceCurrency || 'USD';
          detectedPrice = formatPrice(price, currency);
          console.log('Price found in structured data:', detectedPrice);
        }
      }
    }
  } catch (e) {
    console.error('Error extracting price from structured data:', e);
  }
  
  if (detectedPrice) return detectedPrice;
  
  // STRATEGY 2: Check for schema.org metadata in DOM
  try {
    const schemaElements = document.querySelectorAll('[itemprop="price"]');
    for (const element of schemaElements) {
      const price = element.getAttribute('content') || element.textContent.trim();
      if (price) {
        const currencyElement = document.querySelector('[itemprop="priceCurrency"]');
        const currency = currencyElement ? currencyElement.getAttribute('content') : 'USD';
        detectedPrice = formatPrice(price, currency);
        console.log('Price found in schema.org metadata:', detectedPrice);
        break;
      }
    }
  } catch (e) {
    console.error('Error extracting price from schema.org metadata:', e);
  }
  
  if (detectedPrice) return detectedPrice;
  
  // STRATEGY 3: Intelligent selector-based detection
  // First: Try common price selectors
  const priceSelectors = [
    // High-precision selectors (very likely to be prices)
    '[class*="price"]:not([class*="old"]):not([class*="regular"]):not([class*="was"]):not([class*="rrp"])',
    '.product-price-current',
    '.product-price .current-price',
    '.current-price:not(.was-price)',
    '.sale-price',
    '.price-final_price .price',
    '.product-info-price .price',
    '[data-price-type="finalPrice"] .price',
    // Specific retailer selectors
    '.pipPriceAmount', // wine.com
    '.product__price', // masterofmalt.com
    '.price-sales', // thewhiskyexchange.com
    '.product-price', // various sites
    '.offer-price', // various sites
    // More general selectors (may need additional verification)
    '[id*="price"]',
    '[class*="price"]'
  ];
  
  // Score-based price detection
  const priceCandidates = [];
  
  for (const selector of priceSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const text = el.textContent.trim();
        // Check if it looks like a price
        if (isPriceFormat(text)) {
          // Calculate score based on various heuristics
          let score = 0;
          
          // Higher score for elements with specific price-related classes
          if (el.className.toLowerCase().includes('price')) score += 3;
          if (el.className.toLowerCase().includes('current')) score += 2;
          if (el.className.toLowerCase().includes('sale')) score += 2;
          if (el.id && el.id.toLowerCase().includes('price')) score += 3;
          
          // Penalize elements that might be old prices
          if (el.className.toLowerCase().includes('was') || 
              el.className.toLowerCase().includes('rrp') ||
              el.className.toLowerCase().includes('old') ||
              el.className.toLowerCase().includes('regular')) {
            score -= 5;
          }
          
          // Check parent elements too
          let parent = el.parentElement;
          let depth = 0;
          while (parent && depth < 3) {
            if (parent.className.toLowerCase().includes('price')) score += 1;
            if (parent.className.toLowerCase().includes('product')) score += 1;
            if (parent.className.toLowerCase().includes('current')) score += 1;
            
            // Penalize if a parent indicates an old price
            if (parent.className.toLowerCase().includes('was') || 
                parent.className.toLowerCase().includes('rrp') ||
                parent.className.toLowerCase().includes('old') ||
                parent.className.toLowerCase().includes('regular')) {
              score -= 5;
            }
            
            parent = parent.parentElement;
            depth++;
          }
          
          // Higher score for prices in the main product area
          const productSection = document.querySelector('.product, [class*="product"], [id*="product"]');
          if (productSection && productSection.contains(el)) {
            score += 3;
          }
          
          // Extract numerical value for comparison
          const numericValue = extractNumericPrice(text);
          
          // Penalize very small values (might be sample sizes)
          if (numericValue < 10) {
            score -= 2;
          }
          
          // Add to candidates
          priceCandidates.push({
            text: text,
            element: el,
            score: score,
            numericValue: numericValue
          });
        }
      });
    } catch (e) {
      console.error('Error processing price selector:', selector, e);
    }
  }
  
  // Sort by score (highest first)
  priceCandidates.sort((a, b) => b.score - a.score);
  
  console.log('Price candidates with scores:', priceCandidates.map(c => ({
    text: c.text,
    score: c.score,
    value: c.numericValue
  })));
  
  // Return the highest-scoring valid price
  for (const candidate of priceCandidates) {
    if (candidate.score > 0) {
      detectedPrice = candidate.text;
      console.log('Selected price based on score:', detectedPrice, 'Score:', candidate.score);
      break;
    }
  }
  
  if (detectedPrice) return detectedPrice;
  
  // STRATEGY 4: Use AI detection if we have access to the OpenAI API
  // This is already implemented in the larger system through the OpenAI bottle detection
  
  console.log('No price detected using all strategies');
  return null;
}

// Helper function to format price with currency
function formatPrice(price, currency) {
  // Handle different input types
  if (typeof price === 'string') {
    price = price.replace(/[^\d.,]/g, '');
    price = parseFloat(price.replace(',', '.'));
  }
  
  if (isNaN(price)) return null;
  
  // Format based on currency
  switch(currency) {
    case 'GBP':
      return `£${price.toFixed(2)}`;
    case 'EUR':
      return `€${price.toFixed(2)}`;
    case 'USD':
      return `$${price.toFixed(2)}`;
    default:
      return `${price.toFixed(2)} ${currency}`;
  }
}

function extractNumericPrice(priceText) {
  return extractPrice(priceText);
}

function isPriceFormat(text) {
  if (!text) return false;
  
  // Match common price formats with currency symbols
  return /[\$£\€\¥\₹\₩\₽\₺\₦\₱\₲\฿\₫\원\₭\₼\₮\₪\៛]\s*\d+([.,]\d{2})?|\d+([.,]\d{2})?\s*(USD|EUR|GBP)/.test(text);
}

function isElementVisible(element) {
  if (!element) return false;
  
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         element.offsetWidth > 0 && 
         element.offsetHeight > 0;
}

function showPageNotification(bottleInfo, matches, update = false) {
  try {
    // Verify inputs to prevent errors
    if (!bottleInfo || typeof bottleInfo !== 'object' || !Array.isArray(matches)) {
      console.error('Invalid arguments to showPageNotification', { bottleInfo, matches });
      return;
    }
    
    // Check if we already have a notification showing
    if (notificationActive && !update) {
      console.log('Notification already active, skipping');
      return;
    }
    
    // If this is an update, find and remove the existing notification
    if (update) {
      const existingNotification = document.getElementById('honey-barrel-notification');
      if (existingNotification) {
        existingNotification.remove();
        console.log('Removed existing notification for update');
      }
    }
    
    // Set flag to indicate notification is active
    notificationActive = true;
    
    // Create notification container
    const notification = document.createElement('div');
    notification.id = 'honey-barrel-notification';
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 350px;
      max-height: 500px;
      background-color: #ffffff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      border-radius: 8px;
      z-index: 999999;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      overflow: hidden;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
    `;
    
    // Create header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background-color: #722F37;
      color: white;
      border-top-left-radius: 8px;
      border-top-right-radius: 8px;
    `;
    
    // Add title and logo
    const title = document.createElement('div');
    title.textContent = 'The Honey Barrel';
    title.style.fontWeight = 'bold';
    
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: white;
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      margin: 0;
    `;
    closeBtn.addEventListener('click', () => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateY(20px)';
      setTimeout(() => {
        notification.remove();
        notificationActive = false;
      }, 300);
    });
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    notification.appendChild(header);
    
    // Create content area
    const content = document.createElement('div');
    content.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      max-height: 400px;
    `;
    
    // Add detected bottle info
    const detectedBottle = document.createElement('div');
    detectedBottle.style.cssText = `
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e0e0e0;
    `;
    
    const detectedTitle = document.createElement('h3');
    detectedTitle.textContent = 'Detected Bottle';
    detectedTitle.style.cssText = `
      margin: 0 0 8px 0;
      font-size: 14px;
      color: #555;
    `;
    detectedBottle.appendChild(detectedTitle);
    
    // Get bottle name safely
    const bottleName = document.createElement('p');
    bottleName.textContent = bottleInfo.name || 'Unknown Bottle';
    bottleName.style.cssText = `
      margin: 0 0 4px 0;
      font-size: 16px;
      font-weight: bold;
    `;
    detectedBottle.appendChild(bottleName);
    
    // Safely add other bottle details
    if (bottleInfo.brand) {
      const brand = document.createElement('p');
      brand.textContent = bottleInfo.brand;
      brand.style.cssText = `
        margin: 0 0 4px 0;
        font-size: 14px;
      `;
      detectedBottle.appendChild(brand);
    }
    
    if (bottleInfo.price) {
      const price = document.createElement('p');
      let priceText = bottleInfo.price;
      if (bottleInfo.currency && bottleInfo.currency !== 'USD') {
        const rates = {
          'EUR': 1.14,
          'GBP': 1.31,
          'JPY': 0.0067,
          'USD': 1.0
        };
        const rate = rates[bottleInfo.currency] || 1.0;
        const usdValue = bottleInfo.priceNumeric * rate;
        
        priceText = `$${usdValue.toFixed(2)}`;
      }
      price.textContent = `Price: ${priceText}`;
      price.style.cssText = `
        margin: 0 0 4px 0;
        font-size: 14px;
        color: #722F37;
        font-weight: bold;
      `;
      detectedBottle.appendChild(price);
    }
    
    content.appendChild(detectedBottle);
    
    // Add BAXUS matches section
    const matchesSection = document.createElement('div');
    matchesSection.style.cssText = `
      margin-bottom: 16px;
    `;
    
    const matchesTitle = document.createElement('h3');
    matchesTitle.textContent = 'BAXUS Marketplace Alternatives';
    matchesTitle.style.cssText = `
      margin: 0 0 8px 0;
      font-size: 14px;
      color: #555;
    `;
    matchesSection.appendChild(matchesTitle);
    
    // Process matches
    const sortedMatches = [...matches].sort((a, b) => {
      // Ensure we have price data for comparison
      const aPrice = a.price !== undefined ? Number(a.price) : Number.MAX_VALUE;
      const bPrice = b.price !== undefined ? Number(b.price) : Number.MAX_VALUE;
      return aPrice - bPrice;
    });
    
    // Create a list of match elements
    sortedMatches.slice(0, 3).forEach(match => {
      if (!match) return; // Skip invalid matches
      
      try {
        const matchItem = document.createElement('div');
        matchItem.style.cssText = `
          display: flex;
          padding: 8px;
          margin-bottom: 8px;
          border-radius: 6px;
          background-color: #f9f9f9;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        `;
        
        // Calculate savings if possible
        let savingsText = '';
        let savingsClass = '';
        
        if (bottleInfo.priceNumeric && match.price !== undefined) {
          const bottlePrice = Number(bottleInfo.priceNumeric);
          const matchPrice = Number(match.price);
          
          if (!isNaN(bottlePrice) && !isNaN(matchPrice) && bottlePrice > 0 && matchPrice > 0) {
            const savings = bottlePrice - matchPrice;
            const savingsPercent = Math.round((savings / bottlePrice) * 100);
            
            if (savings > 0) {
              savingsText = `Save ${savings.toFixed(2)} (${savingsPercent}%)`;
              savingsClass = 'savings-positive';
              matchItem.style.backgroundColor = '#f0f9f0';
              matchItem.style.borderLeft = '3px solid #4CAF50';
            }
          }
        }
        
        // Create match content
        const matchContent = document.createElement('div');
        matchContent.style.cssText = `
          flex: 1;
          overflow: hidden;
        `;
        
        // Match name
        const matchName = document.createElement('p');
        matchName.textContent = match.name || 'BAXUS Alternative';
        matchName.style.cssText = `
          margin: 0 0 4px 0;
          font-size: 14px;
          font-weight: bold;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        `;
        matchContent.appendChild(matchName);
        
        // Match price
        if (match.price !== undefined) {
          const matchPrice = document.createElement('p');
          matchPrice.textContent = `$${Number(match.price).toFixed(2)}`;
          matchPrice.style.cssText = `
            margin: 0 0 4px 0;
            font-size: 14px;
            color: #722F37;
          `;
          matchContent.appendChild(matchPrice);
        }
        
        // Match savings
        if (savingsText) {
          const savingsElement = document.createElement('p');
          savingsElement.textContent = savingsText;
          savingsElement.style.cssText = `
            margin: 0;
            font-size: 12px;
            color: ${savingsClass === 'savings-positive' ? '#4CAF50' : '#666'};
            font-weight: ${savingsClass === 'savings-positive' ? 'bold' : 'normal'};
          `;
          matchContent.appendChild(savingsElement);
        }
        
        // Match quality indicator (if available)
        if (match.matchQuality || match.matchScore) {
          const qualityIndicator = document.createElement('div');
          qualityIndicator.style.cssText = `
            display: flex;
            align-items: center;
            margin-top: 4px;
          `;
          
          // Visual indicator
          const indicator = document.createElement('div');
          // Always show 4 filled stars as default
          let stars = '';
          for (let i = 0; i < 5; i++) {
            if (i < 4) {
              stars += '★'; // Filled star
            } else {
              stars += '☆'; // Empty star
            }
          }
          indicator.textContent = stars;
          indicator.style.cssText = `
            color: #FFD700;
            font-size: 12px;
            margin-right: 4px;
          `;
          
          qualityIndicator.appendChild(indicator);
          
          // Text indicator
          const qualityText = document.createElement('span');
          qualityText.textContent = 'Excellent Match';
          qualityText.style.cssText = `
            font-size: 11px;
            color: #666;
          `;
          
          qualityIndicator.appendChild(qualityText);
          matchContent.appendChild(qualityIndicator);
        }
        
        // Add match content to item
        matchItem.appendChild(matchContent);
        
        // Add view button that links to BAXUS
        const viewButton = document.createElement('a');
        
        // Debug the match ID to see what's happening
        console.log('Creating link with match ID:', match.id, 'Type:', typeof match.id);
        console.log('Raw match data:', JSON.stringify(match));
        
        // The link should not have undefined or null values
        if (match.id && match.id !== undefined && match.id !== null && match.id !== "") {
          // Use the raw id without any modifications
          viewButton.href = `https://baxus.co/asset/${match.id}`;
          console.log('Created asset link:', viewButton.href);
        } else if (match.rawId) {
          // Try using the preserved raw ID if available
          viewButton.href = `https://baxus.co/asset/${match.rawId}`;
          console.log('Created asset link from rawId:', viewButton.href);
        } else if (match.link && match.link.includes('baxus.co')) {
          viewButton.href = match.link;
          console.log('Using provided link:', viewButton.href);
        } else {
          viewButton.href = `https://baxus.co/search?q=${encodeURIComponent(match.name || bottleInfo.name || '')}`;
          console.log('Created search link:', viewButton.href);
        }
        
        viewButton.target = '_blank';
        viewButton.rel = 'noopener noreferrer';
        viewButton.textContent = 'View';
        viewButton.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: center;
          width: 60px;
          margin-left: 8px;
          background-color: #722F37;
          color: white;
          border: none;
          border-radius: 4px;
          text-decoration: none;
          font-size: 13px;
          cursor: pointer;
        `;
        
        viewButton.addEventListener('mouseover', () => {
          viewButton.style.backgroundColor = '#8B3340';
        });
        
        viewButton.addEventListener('mouseout', () => {
          viewButton.style.backgroundColor = '#722F37';
        });
        
        matchItem.appendChild(viewButton);
        matchesSection.appendChild(matchItem);
      } catch (matchError) {
        console.error('Error rendering match:', matchError);
      }
    });
    
    // Add "View More on BAXUS" button
    const viewMoreButton = document.createElement('a');
    viewMoreButton.href = `https://baxus.co/search?q=${encodeURIComponent(bottleInfo.name || '')}`;
    viewMoreButton.target = '_blank';
    viewMoreButton.rel = 'noopener noreferrer';
    viewMoreButton.textContent = 'View More on BAXUS';
    viewMoreButton.style.cssText = `
      display: block;
      text-align: center;
      padding: 8px;
      margin-top: 8px;
      background-color: #f0f0f0;
      color: #333;
      border-radius: 4px;
      text-decoration: none;
      font-size: 13px;
      cursor: pointer;
    `;
    
    viewMoreButton.addEventListener('mouseover', () => {
      viewMoreButton.style.backgroundColor = '#e0e0e0';
    });
    
    viewMoreButton.addEventListener('mouseout', () => {
      viewMoreButton.style.backgroundColor = '#f0f0f0';
    });
    
    matchesSection.appendChild(viewMoreButton);
    content.appendChild(matchesSection);
    
    // Add footer
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding: 8px 16px;
      font-size: 11px;
      color: #999;
      text-align: center;
      border-top: 1px solid #f0f0f0;
    `;
    footer.textContent = 'Prices and availability may vary. Powered by BAXUS.';
    
    // Add content and footer to notification
    notification.appendChild(content);
    notification.appendChild(footer);
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto-hide after 2 minutes
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(20px)';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.remove();
          }
          notificationActive = false;
        }, 300);
      }
    }, 120000); // 2 minutes
  } catch (error) {
    console.error('Error showing notification:', error);
    notificationActive = false;
  }
}

function extractStructuredData() {
  try {
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    if (!jsonLdScripts.length) return null;
    
    let structuredData = [];
    
    for (const script of jsonLdScripts) {
      try {
        const parsedData = JSON.parse(script.textContent);
        structuredData.push(parsedData);
        
        // Check if this is product data
        if (parsedData['@type'] === 'Product') {
          return parsedData;
        }
      } catch (e) {
        console.error('Error parsing JSON-LD:', e);
      }
    }
    
    // If we found any structured data but no specific product, return the first one
    return structuredData.length > 0 ? structuredData[0] : null;
  } catch (error) {
    console.error('Error extracting structured data:', error);
    return null;
  }
}

function mergeStructuredData(bottleInfo, structuredData) {
  try {
    let productData = structuredData;
    
    // Handle @graph structure
    if (structuredData['@graph']) {
      productData = structuredData['@graph'].find(item => item && item['@type'] === 'Product') || structuredData;
    }
    
    // Extract product information
    if (productData['@type'] === 'Product') {
      if (!bottleInfo.name && productData.name) {
        bottleInfo.name = productData.name;
      }
      
      if (!bottleInfo.brand && productData.brand) {
        if (typeof productData.brand === 'string') {
          bottleInfo.brand = productData.brand;
        } else if (productData.brand && productData.brand.name) {
          bottleInfo.brand = productData.brand.name;
        }
      }
      
      if (!bottleInfo.imageUrl && productData.image) {
        if (typeof productData.image === 'string') {
          bottleInfo.imageUrl = productData.image;
        } else if (Array.isArray(productData.image) && productData.image.length > 0) {
          bottleInfo.imageUrl = productData.image[0].url || productData.image[0];
        }
      }
      
      // Extract price information
      if (!bottleInfo.price && productData.offers) {
        const offers = Array.isArray(productData.offers) ? 
          productData.offers : [productData.offers];
        
        if (offers.length > 0) {
          const offer = offers[0];
          if (offer.price) {
            bottleInfo.priceNumeric = parseFloat(offer.price);
            bottleInfo.currency = offer.priceCurrency || 'USD';
            bottleInfo.price = bottleInfo.currency === 'USD' ? 
              `$${bottleInfo.priceNumeric}` : 
              `${bottleInfo.priceNumeric} ${bottleInfo.currency}`;
          }
        }
      }
      
      // Extract description if available
      if (!bottleInfo.description && productData.description) {
        bottleInfo.description = productData.description;
        // Re-infer details from the structured description
        inferBottleDetails(bottleInfo);
      }
    }
  } catch (error) {
    console.error('Error merging structured data:', error);
  }
  
  return bottleInfo;
}

// Enhanced OpenAI-powered bottle detection
async function detectBottleWithOpenAI() {
  console.log('Using enhanced OpenAI-powered bottle detection');
  
  // Check if we have a product page with reasonable chances of being a bottle
  if (!isLikelyProductPage()) {
    console.log('Not likely a product page, skipping OpenAI detection');
    return null;
  }
  
  // Get relevant page text for analysis
  const pageText = await extractRelevantText();
  if (!pageText) {
    console.log('No relevant page text found for OpenAI analysis');
    return null;
  }
  
  // Get product images
  const images = collectProductImages();
  console.log('Found product images:', images);
  
  // Get visible price elements for targeted price extraction
  const priceElements = captureVisiblePriceElements();
  console.log('Found price elements:', priceElements);
  
  // Prepare data for the AI request, adding the new price elements information
  const data = {
    url: window.location.href,
    hostname: window.location.hostname,
    title: document.title,
    text: pageText,
    images: images,
    priceElements: priceElements
  };
  
  // Send to background script for AI processing
  console.log('Sending data to OpenAI for bottle detection:', data);
  
  // Use promise-based messaging to background script
  const response = await sendToBackgroundWithPromise({
    action: 'detectBottleWithOpenAI',
    data: data
  });
  
  // Check for valid response
  if (response && response.bottleInfo) {
    console.log('OpenAI bottle detection result:', response.bottleInfo);
    
    // Enhance the AI result with additional page data
    const enhancedInfo = enhanceBottleInfoWithPageData(response.bottleInfo);
    
    // Add confidence flag to indicate AI-powered detection
    enhancedInfo.aiConfidence = response.confidence || 0.8;
    enhancedInfo.detectionMethod = 'openai';
    
    // Ensure we have a numeric price by using our numeric extraction
    if (enhancedInfo.price) {
      enhancedInfo.numericPrice = extractNumericPrice(enhancedInfo.price);
      enhancedInfo.priceNumeric = enhancedInfo.numericPrice; // For compatibility
      enhancedInfo.currency = detectCurrency(enhancedInfo.price);
    }
    
    // If we have price elements captured but no price in the bottleInfo,
    // try to find the most likely price element and use it
    if (!enhancedInfo.price && priceElements && priceElements.length > 0) {
      // First look for elements that clearly have currency symbols
      const currencyElements = priceElements.filter(el => 
        el.text.includes('£') || el.text.includes('$') || 
        el.text.includes('€') || el.text.includes('¥'));
      
      if (currencyElements.length > 0) {
        // Sort by visibility and simplicity of the price text
        const bestElement = currencyElements.sort((a, b) => {
          // Prefer elements that are clearly visible
          if (a.visibility !== b.visibility) {
            return b.visibility - a.visibility;
          }
          // Prefer elements with simpler, cleaner price formats
          return a.text.length - b.text.length;
        })[0];
        
        console.log('Using most visible currency element for price:', bestElement);
        enhancedInfo.price = bestElement.text;
        enhancedInfo.numericPrice = extractNumericPrice(bestElement.text);
        enhancedInfo.priceNumeric = enhancedInfo.numericPrice;
        enhancedInfo.currency = detectCurrency(bestElement.text);
      }
    }
    
    return enhancedInfo;
  } else {
    console.log('OpenAI detection failed or returned no results');
    return null;
  }
}

// Helper to get nearby text nodes for context
function getNearbyText(element) {
  if (!element) return '';
  
  // Get text content of the element itself
  let text = element.textContent || '';
  
  // Get parent element for more context
  const parent = element.parentElement;
  if (parent) {
    // Add labels or other context elements
    const labels = parent.querySelectorAll('label, .label, [data-label]');
    for (const label of labels) {
      text += ' ' + label.textContent;
    }
    
    // Add any preceding sibling's text for context
    const prevSibling = element.previousElementSibling;
    if (prevSibling && prevSibling.textContent) {
      text += ' ' + prevSibling.textContent;
    }
  }
  
  return text.trim();
}

// Helper function to extract relevant text from an element or its surroundings
function extractRelevantText(element) {
  if (!element) return '';
  
  // Get the element's own text content
  let text = element.textContent || '';
  
  // If the element has very little text, look at its parent and siblings
  if (text.trim().length < 10) {
    // Check parent
    if (element.parentElement) {
      text += ' ' + element.parentElement.textContent;
    }
    
    // Check siblings
    if (element.previousElementSibling) {
      text += ' ' + element.previousElementSibling.textContent;
    }
    
    if (element.nextElementSibling) {
      text += ' ' + element.nextElementSibling.textContent;
    }
  }
  
  // Clean up and normalize the text
  text = text.replace(/\s+/g, ' ').trim();
  
  // For non-English sites, try to handle special characters
  // This helps with French, German, etc.
  if (/[éèêëàâäôöùûüÿçñ]/i.test(text)) {
    // Keep special characters for non-English text
    return text;
  }
  
  // For English text, normalize further
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Helper function to extract field values using selectors
function extractWithSelector(selector, fieldName) {
  try {
    // For combined selectors (comma-separated), try each one
    const selectors = selector.split(',').map(s => s.trim());
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim().length > 3) {
        const text = element.textContent.trim();
        console.log(`Found ${fieldName} using selector "${selector}": "${text}"`);
        return text;
      }
      
      // Special handling for imageUrl field - extract src attribute
      if (fieldName === 'imageUrl' && element) {
        const src = element.src || element.getAttribute('src');
        if (src) {
          console.log(`Found ${fieldName} using selector "${selector}": "${src}"`);
          return src;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error extracting ${fieldName} with selector "${selector}":`, error);
    return null;
  }
}

// Helper to get a readable path to an element
function getElementPath(element, maxDepth = 3) {
  if (!element || !element.tagName) return [];
  
  const path = [];
  let current = element;
  let depth = 0;
  
  while (current && current.tagName && depth < maxDepth) {
    let selector = current.tagName.toLowerCase();
    
    if (current.id) {
      selector += `#${current.id}`;
    } else if (current.className) {
      const classes = current.className.split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        selector += `.${classes[0]}`;
      }
    }
    
    path.unshift(selector);
    current = current.parentElement;
    depth++;
  }
  
  return path;
}

// Helper to capture all visible price elements on the page
function captureVisiblePriceElements() {
  try {
    console.log('Capturing visible price elements');
    const priceElements = [];
    
    // Define patterns for prices
    const pricePatterns = [
      /£\s*\d+(\.\d{2})?/,  // UK pounds
      /\$\s*\d+(\.\d{2})?/, // US dollars
      /€\s*\d+(\.\d{2})?/,  // Euros
      /\d+(\.\d{2})?\s*€/,  // Euros (after number)
      /\d+(\.\d{2})?\s*£/,  // Pounds (after number)
      /\d+(\.\d{2})?\s*\$/  // Dollars (after number)
    ];
    
    // Check all elements for price-like text
    const allElements = document.querySelectorAll('*');
    allElements.forEach(element => {
      // Skip script, style, and other non-content elements
      if (element.tagName === 'SCRIPT' || 
          element.tagName === 'STYLE' || 
          element.tagName === 'META' || 
          element.tagName === 'LINK') {
        return;
      }
      
      // Skip elements with too many children (likely containers)
      if (element.children.length > 5) {
        return;
      }
      
      // Get the element's direct text content (not including children)
      let textContent = '';
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          textContent += node.textContent;
        }
      }
      
      textContent = textContent.trim();
      
      // Skip empty text
      if (!textContent) {
        return;
      }
      
      // Check if the text matches any price pattern
      let hasPrice = false;
      for (const pattern of pricePatterns) {
        if (pattern.test(textContent)) {
          hasPrice = true;
          break;
        }
      }
      
      // If it has a price pattern, add to our list
      if (hasPrice) {
        // Check if element is visible
        const visibility = isElementVisible(element) ? 1 : 0;
        
        // Only include visible elements
        if (visibility > 0) {
          // Get nearest text for context
          const nearbyText = getNearbyText(element);
          
          priceElements.push({
            text: textContent,
            nearbyText: nearbyText,
            selector: getElementPath(element),
            position: {
              x: element.getBoundingClientRect().left,
              y: element.getBoundingClientRect().top
            },
            visibility: visibility
          });
        }
      }
      
      // Also check for elements with price-related classes or IDs
      const elementIdentifier = (element.className || '') + ' ' + (element.id || '');
      if (elementIdentifier.toLowerCase().includes('price') && 
          textContent.match(/\d+/) && 
          textContent.length < 30) {
        
        const visibility = isElementVisible(element) ? 1 : 0;
        
        // Only include visible elements
        if (visibility > 0) {
          priceElements.push({
            text: textContent,
            nearbyText: getNearbyText(element),
            selector: getElementPath(element),
            position: {
              x: element.getBoundingClientRect().left,
              y: element.getBoundingClientRect().top
            },
            visibility: visibility,
            isPriceElement: true
          });
        }
      }
    });
    
    // Now check for structured data pricing
    try {
      const jsonLdElements = document.querySelectorAll('script[type="application/ld+json"]');
      jsonLdElements.forEach(script => {
        try {
          const data = JSON.parse(script.textContent);
          
          // Look for offers with price
          if (data.offers && data.offers.price) {
            const currency = data.offers.priceCurrency || '£';
            const price = data.offers.price;
            
            priceElements.push({
              text: `${currency}${price}`,
              nearbyText: "Structured data price",
              selector: "application/ld+json",
              visibility: 1,
              isStructuredData: true
            });
          }
          
          // Handle array of offers
          if (data.offers && Array.isArray(data.offers)) {
            data.offers.forEach(offer => {
              if (offer.price) {
                const currency = offer.priceCurrency || '£';
                const price = offer.price;
                
                priceElements.push({
                  text: `${currency}${price}`,
                  nearbyText: "Structured data price array",
                  selector: "application/ld+json",
                  visibility: 1,
                  isStructuredData: true
                });
              }
            });
          }
        } catch (e) {
          console.error('Error parsing JSON-LD:', e);
        }
      });
    } catch (e) {
      console.error('Error processing structured data prices:', e);
    }
    
    console.log('Found price elements:', priceElements);
    return priceElements;
  } catch (e) {
    console.error('Error capturing visible price elements:', e);
    return [];
  }
}

// Enhanced numeric price extraction
function extractNumericPrice(priceText) {
  if (!priceText) return 0;
  
  try {
    console.log('Enhanced extractNumericPrice from:', priceText);
    
    // If already a number, just return it
    if (typeof priceText === 'number') return priceText;
    
    // Convert to string if not already
    const text = String(priceText).trim();
    
    // Direct currency format detection - prioritize exact pattern matches
    // This ensures prices like £79.00 are properly extracted
    const currencyPattern = /([£$€¥])\s*(\d+(?:\.\d{1,2})?)/;
    const currencyMatch = text.match(currencyPattern);
    if (currencyMatch && currencyMatch[2]) {
      const price = parseFloat(currencyMatch[2]);
      console.log('Direct currency pattern match:', price);
      return price;
    }
    
    // Also check reverse pattern (price then currency)
    const reverseCurrencyPattern = /(\d+(?:\.\d{1,2})?)\s*([£$€¥])/;
    const reverseCurrencyMatch = text.match(reverseCurrencyPattern);
    if (reverseCurrencyMatch && reverseCurrencyMatch[1]) {
      const price = parseFloat(reverseCurrencyMatch[1]);
      console.log('Reverse currency pattern match:', price);
      return price;
    }
    
    // Remove all non-numeric characters except period and comma
    const cleaned = text.replace(/[^\d.,]/g, '');
    console.log('Cleaned numeric string:', cleaned);
    
    // Simple case - just one number
    if (!/[.,]/.test(cleaned)) {
      const price = parseInt(cleaned, 10);
      console.log('Simple integer price:', price);
      return price;
    }
    
    // Check for decimal pattern (xx.xx or xx,xx)
    const decimalPattern = /^(\d+)[.,](\d{2})$/;
    const decimalMatch = cleaned.match(decimalPattern);
    if (decimalMatch) {
      const price = parseFloat(decimalMatch[1] + '.' + decimalMatch[2]);
      console.log('Decimal pattern match:', price);
      return price;
    }
    
    // Handle different number formats with multiple separators
    let formattedPrice;
    
    // Count periods and commas
    const periodCount = (cleaned.match(/\./g) || []).length;
    const commaCount = (cleaned.match(/,/g) || []).length;
    
    // UK/US vs European format detection
    if (periodCount === 1 && commaCount === 0) {
      // Simple case: "79.00"
      formattedPrice = cleaned;
    } else if (commaCount === 1 && periodCount === 0) {
      // Simple case with comma: "79,00"
      formattedPrice = cleaned.replace(',', '.');
    } else if (periodCount > 0 && commaCount > 0) {
      // Mixed format - determine which is the decimal separator based on position
      const lastPeriodPos = cleaned.lastIndexOf('.');
      const lastCommaPos = cleaned.lastIndexOf(',');
      
      if (lastPeriodPos > lastCommaPos) {
        // Format like "1,234.56" (UK/US)
        formattedPrice = cleaned.replace(/,/g, '');
      } else {
        // Format like "1.234,56" (European)
        formattedPrice = cleaned.replace(/\./g, '').replace(',', '.');
      }
    } else if (periodCount > 1) {
      // Multiple periods - take the last as decimal: "1.234.56" → "1234.56"
      const parts = cleaned.split('.');
      const decimal = parts.pop();
      formattedPrice = parts.join('') + '.' + decimal;
    } else if (commaCount > 1) {
      // Multiple commas - take the last as decimal: "1,234,56" → "1234.56"
      const parts = cleaned.split(',');
      const decimal = parts.pop();
      formattedPrice = parts.join('') + '.' + decimal;
    } else {
      // Fallback - just remove all separators
      formattedPrice = cleaned.replace(/[.,]/g, '');
    }
    
    console.log('Formatted price string:', formattedPrice);
    
    // Parse as float and sanity check the result
    const price = parseFloat(formattedPrice);
    
    // Sanity check - if the price seems too high compared to the original text,
    // it might be a parsing error
    if (price > 1000 && text.match(/[£$€¥]\s*\d{1,3}\.\d{2}/)) {
      // This likely indicates a parsing error where we've incorrectly joined numbers
      console.log('Price sanity check failed - seems too high');
      
      // Try direct extraction again with more specific pattern
      const directMatch = text.match(/[£$€¥]\s*(\d{1,3}\.\d{2})/);
      if (directMatch && directMatch[1]) {
        const directPrice = parseFloat(directMatch[1]);
        console.log('Direct price extraction as fallback:', directPrice);
        return directPrice;
      }
    }
    
    console.log('Final extracted price:', price);
    return isNaN(price) ? 0 : price;
  } catch (e) {
    console.error('Error extracting numeric price:', e);
    return 0;
  }
}

// Helper function to collect product images
function collectProductImages() {
  try {
    // Common product image selectors
    const selectors = [
      // Common classes and IDs
      '.product-image img', '.product-img img', '.main-image img', 
      '[itemprop="image"]', '.gallery img', '.product-gallery img',
      '.featured-image img', '#product-image', '.product-photo img',
      '[id*="product"][id*="image"]', '[class*="product"][class*="image"]'
    ];
    
    const images = [];
    
    for (const selector of selectors) {
      const img = document.querySelector(selector);
      if (img && img.src) {
        images.push(img.src);
      }
    }
    
    // If no images found with selectors, get large images from the page
    // that's likely to be a product image
    if (selectors.length === 0) {
      const allImages = document.querySelectorAll('img');
      allImages.forEach(img => {
        // Only include reasonably sized images that might be product photos
        if (img.width > 200 && img.height > 200 && img.src) {
          images.push(img.src);
        }
      });
    }
    
    return images;
  } catch (e) {
    console.error('Error collecting product images:', e);
    return [];
  }
}

// Helper function to enhance bottle info with page data
function enhanceBottleInfoWithPageData(bottleInfo) {
  try {
    // Add page title if not already present
    if (!bottleInfo.title) {
      bottleInfo.title = document.title;
    }
    
    // Add page URL if not already present
    if (!bottleInfo.url) {
      bottleInfo.url = window.location.href;
    }
    
    // Add hostname if not already present
    if (!bottleInfo.source) {
      bottleInfo.source = window.location.hostname.replace('www.', '');
    }
    
    // Add product images if not already present
    if (!bottleInfo.images) {
      bottleInfo.images = collectProductImages();
    }
    
    return bottleInfo;
  } catch (e) {
    console.error('Error enhancing bottle info with page data:', e);
    return bottleInfo;
  }
}

// Helper function to send data to background script with promise
function sendToBackgroundWithPromise(data) {
  return new Promise((resolve, reject) => {
    tryExtensionAPI(() => {
      chrome.runtime.sendMessage(data, (response) => {
        resolve(response);
      });
    });
  });
}

// Initialize content script
initialize();
