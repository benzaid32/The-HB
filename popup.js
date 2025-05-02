// The Honey Barrel - Modern Popup Script
// Handles the extension popup UI and communication with background script

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Main States
  const loadingState = document.getElementById('loading');
  const noBottleState = document.getElementById('no-bottle');
  const bottleFoundState = document.getElementById('bottle-found');
  
  // Bottle Details Elements
  const bottleNameElement = document.getElementById('bottle-name').querySelector('span');
  const bottlePriceElement = document.getElementById('bottle-price').querySelector('span');
  const bottleSourceElement = document.getElementById('bottle-source').querySelector('span');
  
  // Matches Elements
  const matchesListContainer = document.getElementById('matches-list-container');
  const matchesCountElement = document.getElementById('matches-count');
  const noMatchesElement = document.getElementById('no-matches');
  
  // Settings Elements
  const settingsPanel = document.getElementById('settings-panel');
  const settingsToggle = document.getElementById('settingsToggle');
  const closeSettings = document.getElementById('closeSettings');
  const showBaxusPopupToggle = document.getElementById('showBaxusPopup');
  const settingsFeedback = document.getElementById('settings-feedback');
  
  // Keep track of current data
  let currentBottle = null;
  let currentMatches = [];
  let userSettings = null;
  
  // Initialize the popup
  function initialize() {
    console.log('Initializing The Honey Barrel popup...');
    
    // Set up event listeners
    setupEventListeners();
    
    // Load user settings
    loadUserSettings();
    
    // Retrieve bottle information
    retrieveBottleInfo();
  }
  
  // Set up event listeners
  function setupEventListeners() {
    // Settings toggle
    settingsToggle.addEventListener('click', () => {
      settingsPanel.classList.toggle('hidden');
    });
    
    // Close settings
    closeSettings.addEventListener('click', () => {
      settingsPanel.classList.add('hidden');
    });
    
    // Show BAXUS popup toggle
    if (showBaxusPopupToggle) {
      // First ensure the initial state matches the stored settings
      console.log('Initial showBaxusPopup state:', showBaxusPopupToggle.checked);
      
      // Use click event instead of change for better compatibility
      showBaxusPopupToggle.addEventListener('click', function() {
        console.log('Toggle clicked, new state:', this.checked);
        
        // Update settings object
        userSettings.showBaxusPopup = this.checked;
        
        // Save settings to storage
        saveUserSettings();
        
        // Notify content scripts about the setting change
        notifyContentScriptsSettingsChanged();
        
        // Show feedback to user
        showSettingsFeedback(this.checked ? 
          'BAXUS popups enabled on websites' : 
          'BAXUS popups disabled on websites');
      });
    } else {
      console.error('Toggle element not found!');
    }
  }
  
  // Notify content scripts about settings changes
  function notifyContentScriptsSettingsChanged() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0] && tabs[0].id) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'settingsChanged',
            settings: userSettings
          }, function(response) {
            // Check for error - this prevents unchecked runtime.lastError
            if (chrome.runtime.lastError) {
              console.log('Note: Content script not ready or not available on this page:', 
                chrome.runtime.lastError.message);
              // No need to show an error - this is normal on pages without our content script
              return;
            }
            console.log('Settings notification sent to content script:', response);
          });
        } catch (e) {
          console.log('Error sending message to content script:', e);
        }
      }
    });
  }
  
  // Show settings feedback message
  function showSettingsFeedback(message) {
    settingsFeedback.textContent = message;
    settingsFeedback.classList.remove('hidden');
    
    // Fade out after 3 seconds
    setTimeout(() => {
      settingsFeedback.classList.add('fade-out');
      setTimeout(() => {
        settingsFeedback.classList.add('hidden');
        settingsFeedback.classList.remove('fade-out');
      }, 1000);
    }, 2000);
  }
  
  // Load user settings
  function loadUserSettings() {
    chrome.storage.sync.get(['userSettings'], (result) => {
      if (result.userSettings) {
        userSettings = result.userSettings;
        
        // Update UI to reflect current settings
        if (showBaxusPopupToggle) {
          showBaxusPopupToggle.checked = userSettings.showBaxusPopup;
        }
      } else {
        // Use defaults if no settings exist
        userSettings = {
          showBaxusPopup: true,
          matchThreshold: 0.4
        };
        
        // Save default settings
        saveUserSettings();
      }
      
      console.log('Loaded user settings:', userSettings);
    });
  }
  
  // Save user settings
  function saveUserSettings() {
    chrome.storage.sync.set({ userSettings }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving settings:', chrome.runtime.lastError);
      } else {
        console.log('Settings saved successfully:', userSettings);
      }
    });
  }
  
  // Retrieve bottle information
  function retrieveBottleInfo() {
    // Show loading state
    showState('loading');
    
    // Check storage first
    chrome.storage.local.get(['currentBottle', 'currentMatches'], (result) => {
      if (result.currentBottle) {
        currentBottle = result.currentBottle;
        currentMatches = result.currentMatches || [];
        
        // Update UI with stored data
        updateUI();
        
        // Still try to get fresh data
        requestBottleInfoFromTab();
      } else {
        // No stored data, request from current tab
        requestBottleInfoFromTab();
      }
    });
  }
  
  // Request bottle information from current tab
  function requestBottleInfoFromTab() {
    try {
      getCurrentTab().then(tab => {
        // Skip chrome:// URLs and other restricted URLs
        if (tab.url.startsWith('chrome://') || 
            tab.url.startsWith('chrome-extension://') || 
            tab.url.startsWith('about:') || 
            tab.url.startsWith('edge://') || 
            tab.url.startsWith('firefox://') || 
            tab.url.startsWith('opera://')) {
          
          console.log('Cannot access restricted URL:', tab.url);
          handleError("Can't analyze this page. Please navigate to a wine or whisky retailer website.");
          return;
        }
        
        // Try to execute script in the tab to get bottle info from sessionStorage
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: getBottleInfoFromPage
        }).then(results => {
          if (results && results[0] && results[0].result) {
            const data = results[0].result;
            if (data && data.bottleInfo) {
              console.log('Got bottle info from page session storage:', data);
              currentBottle = data.bottleInfo;
              currentMatches = data.matches || [];
              updateUI();
              return;
            }
          }
          
          // If no data from page, request from background
          requestBottleInfoFromBackground();
        }).catch(error => {
          console.error('Error executing script in tab:', error);
          requestBottleInfoFromBackground();
        });
      }).catch(error => {
        console.error('Error getting current tab:', error);
        requestBottleInfoFromBackground();
      });
    } catch (error) {
      console.error('Error in requestBottleInfoFromTab:', error);
      requestBottleInfoFromBackground();
    }
  }
  
  // Get bottle info from page's session storage
  function getBottleInfoFromPage() {
    try {
      const STORAGE_KEY = 'honeyBarrelData';
      const savedData = sessionStorage.getItem(STORAGE_KEY);
      if (savedData) {
        return JSON.parse(savedData);
      }
    } catch (e) {
      console.error('Error getting data from session storage:', e);
    }
    return null;
  }
  
  // Request bottle information from background script
  function requestBottleInfoFromBackground() {
    chrome.runtime.sendMessage({
      action: 'getBottleInfo'
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('Error requesting bottle info:', chrome.runtime.lastError);
        handleError('Could not retrieve bottle information');
        return;
      }
      
      if (response && response.bottleInfo) {
        currentBottle = response.bottleInfo;
        currentMatches = response.matches || [];
        
        // Standardize price format across both popup and in-page displays
        if (currentBottle.price) {
          // Ensure we have numeric prices for both
          if (currentBottle.numericPrice === undefined) {
            currentBottle.numericPrice = extractNumericPrice(currentBottle.price);
          }
          
          if (currentBottle.priceNumeric === undefined) {
            currentBottle.priceNumeric = currentBottle.numericPrice;
          }
          
          // Standardize currency
          if (!currentBottle.currency) {
            currentBottle.currency = detectCurrency(currentBottle.price);
          }
        }
        
        // Standardize match prices
        if (Array.isArray(currentMatches)) {
          currentMatches.forEach(match => {
            if (match.price) {
              // Ensure numeric price is available
              if (match.numericPrice === undefined && match.priceNumeric === undefined) {
                const extractedPrice = extractNumericPrice(match.price);
                match.numericPrice = extractedPrice;
                match.priceNumeric = extractedPrice;
              } else if (match.numericPrice !== undefined && match.priceNumeric === undefined) {
                match.priceNumeric = match.numericPrice;
              } else if (match.priceNumeric !== undefined && match.numericPrice === undefined) {
                match.numericPrice = match.priceNumeric;
              }
            }
          });
        }
        
        // Update UI with the standardized data
        updateUI();
      } else {
        console.log('No bottle found on this page');
        showState('no-bottle');
      }
    });
  }
  
  // Helper functions for price consistency with content.js
  function extractNumericPrice(priceText) {
    if (!priceText) return null;
    if (typeof priceText === 'number') return priceText;
    
    // Convert to string if it's not already
    const text = String(priceText);
    
    // Remove all non-numeric characters except for decimal points and commas
    const cleanedText = text.replace(/[^\d.,]/g, '');
    
    // Handle European vs American decimal notation
    let price;
    if (cleanedText.includes(',') && !cleanedText.includes('.')) {
      // European format: 1.234,56
      price = parseFloat(cleanedText.replace(/\./g, '').replace(',', '.'));
    } else if (cleanedText.includes(',') && cleanedText.includes('.')) {
      // Format with both . and , -> determine which is the decimal separator
      const lastCommaIndex = cleanedText.lastIndexOf(',');
      const lastDotIndex = cleanedText.lastIndexOf('.');
      
      if (lastCommaIndex > lastDotIndex) {
        // European format: 1.234,56
        price = parseFloat(cleanedText.replace(/\./g, '').replace(',', '.'));
      } else {
        // American format with thousands separator: 1,234.56
        price = parseFloat(cleanedText.replace(/,/g, ''));
      }
    } else {
      // Simple format with just a decimal point or no decimal
      price = parseFloat(cleanedText);
    }
    
    return isNaN(price) ? null : price;
  }
  
  function detectCurrency(priceText) {
    if (!priceText) return 'USD';
    const text = String(priceText);
    
    // Check for common currency symbols
    if (text.includes('$')) return 'USD';
    if (text.includes('€')) return 'EUR';
    if (text.includes('£')) return 'GBP';
    if (text.includes('¥')) return 'JPY';
    
    // Default fallback
    return 'USD';
  }
  
  // Format currency for display
  function formatCurrency(price, currencyCode) {
    if (!price || isNaN(parseFloat(price))) {
      return 'Price unavailable';
    }
    
    // Always use USD for display
    const numericPrice = parseFloat(price);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numericPrice);
  }
  
  // Detect currency symbol from price string
  function detectCurrency(priceStr) {
    if (!priceStr) return 'USD';
    
    const currencyMap = {
      '£': 'GBP',
      '€': 'EUR',
      '¥': 'JPY',
      '$': 'USD',
      'A$': 'AUD',
      'C$': 'CAD',
      'CHF': 'CHF',
      '₹': 'INR',
      'S$': 'SGD',
      'HK$': 'HKD'
    };
    
    for (const [symbol, code] of Object.entries(currencyMap)) {
      if (priceStr.includes(symbol)) {
        return code;
      }
    }
    
    // Default to USD if no currency symbol is found
    return 'USD';
  }
  
  // Extract numeric price from price string
  function extractNumericPrice(priceStr) {
    if (!priceStr) return 0;
    
    // Remove all non-numeric characters except period and comma
    const cleaned = priceStr.replace(/[^\d.,]/g, '');
    
    // Handle different number formats
    let formattedPrice = cleaned;
    
    // UK format: 1,234.56
    if (cleaned.includes(',') && cleaned.includes('.')) {
      formattedPrice = cleaned.replace(/,/g, '');
    } 
    // European format: 1.234,56
    else if (cleaned.includes(',') && cleaned.includes('.') && cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      formattedPrice = cleaned.replace(/\./g, '').replace(',', '.');
    }
    // Single comma as decimal: 1234,56
    else if (cleaned.includes(',') && !cleaned.includes('.')) {
      formattedPrice = cleaned.replace(',', '.');
    }
    
    const price = parseFloat(formattedPrice);
    return isNaN(price) ? 0 : price;
  }
  
  // Update UI based on current data
  function updateUI() {
    // If we have bottle info, show the bottle found state
    if (currentBottle) {
      bottleNameElement.textContent = currentBottle.name || 'Unknown bottle';
      
      // Make sure we use the numeric price value when available
      const priceToDisplay = currentBottle.priceNumeric !== undefined ? 
        currentBottle.priceNumeric : currentBottle.price;
      
      // Use currency handler for consistent USD display
      if (window.HBCurrency) {
        bottlePriceElement.textContent = window.HBCurrency.formatPrice(priceToDisplay, currentBottle.currency);
      } else {
        bottlePriceElement.textContent = formatCurrency(priceToDisplay, currentBottle.currency);
      }
      
      bottleSourceElement.textContent = currentBottle.source || 'Unknown retailer';
      
      // Check for AI enhancements
      const hasAiEnhancements = currentBottle.aiEnhanced || currentBottle.nlpEnhanced;
      const aiBadge = document.querySelector('.ai-badge');
      
      if (hasAiEnhancements && aiBadge) {
        aiBadge.classList.remove('hidden');
        addEnhancedDetails();
      }
      
      // Update matches
      updateMatchesList();
      
      // Show the bottle found state
      showState('bottle-found');
    } else {
      // No bottle found
      showState('no-bottle');
    }
  }
  
  // Add enhanced bottle details
  function addEnhancedDetails() {
    const enhancedDetailsContainer = document.getElementById('enhanced-details-container');
    if (!enhancedDetailsContainer) return;
    
    // Check if we have any enhanced details to show
    const hasDetails = currentBottle.vintage || currentBottle.region || 
                       currentBottle.type || currentBottle.abv || 
                       currentBottle.volume;
    
    if (!hasDetails) return;
    
    // Build enhanced details HTML
    let detailsHTML = `
      <h3 class="enhanced-details-title">Enhanced Details</h3>
      <div class="enhanced-detail-grid">
    `;
    
    // Add details
    if (currentBottle.vintage && !currentBottle.vintage.includes('Unknown')) {
      detailsHTML += `
        <div class="enhanced-detail-item">
          <div class="enhanced-detail-label">Vintage</div>
          <div>${currentBottle.vintage}</div>
        </div>
      `;
    }
    
    if (currentBottle.region) {
      detailsHTML += `
        <div class="enhanced-detail-item">
          <div class="enhanced-detail-label">Region</div>
          <div>${currentBottle.region}</div>
        </div>
      `;
    }
    
    if (currentBottle.type) {
      detailsHTML += `
        <div class="enhanced-detail-item">
          <div class="enhanced-detail-label">Type</div>
          <div>${currentBottle.type}</div>
        </div>
      `;
    }
    
    if (currentBottle.abv) {
      detailsHTML += `
        <div class="enhanced-detail-item">
          <div class="enhanced-detail-label">ABV</div>
          <div>${currentBottle.abv}</div>
        </div>
      `;
    }
    
    if (currentBottle.volume) {
      detailsHTML += `
        <div class="enhanced-detail-item">
          <div class="enhanced-detail-label">Volume</div>
          <div>${currentBottle.volume}</div>
        </div>
      `;
    }
    
    detailsHTML += '</div>';
    
    // Add confidence indicator if available
    if (currentBottle.aiConfidence) {
      const confidencePercent = Math.round((currentBottle.aiConfidence || 0.5) * 100);
      
      detailsHTML += `
        <div class="confidence-indicator" title="Match confidence score: ${confidencePercent}%">
          <div class="confidence-bar">
            <div class="confidence-level" style="width: ${confidencePercent}%"></div>
          </div>
          <div class="confidence-label">Confidence</div>
        </div>
      `;
    }
    
    // Update the container
    enhancedDetailsContainer.innerHTML = detailsHTML;
    enhancedDetailsContainer.classList.remove('hidden');
  }
  
  // Update matches list
  function updateMatchesList() {
    matchesCountElement.textContent = currentMatches.length;
    if (currentMatches && currentMatches.length > 0) {
      // Make sure matches are sorted by price (low to high) for display
      // Use currency handler to convert all prices to USD for accurate sorting
      const sortedMatches = [...currentMatches].sort((a, b) => {
        const priceA = window.HBCurrency ? 
          window.HBCurrency.convertToUSD(a.price, a.currency) : 
          (parseFloat(a.priceUSD || a.price) || 0);
        
        const priceB = window.HBCurrency ? 
          window.HBCurrency.convertToUSD(b.price, b.currency) : 
          (parseFloat(b.priceUSD || b.price) || 0);
        
        return priceA - priceB;
      });
      
      // Clear the current matches list
      matchesListContainer.innerHTML = '';
      
      // Generate match items
      sortedMatches.forEach((match, index) => {
        try {
          // Create match card
          const matchElement = document.createElement('div');
          matchElement.className = 'match-item';
          
          // Only add deal tag for GREAT PRICE or BETTER VALUE
          // Remove the subjective HIGHER QUALITY tag as requested
          if (match.dealTag && (match.dealTag === 'GREAT PRICE' || match.dealTag === 'BETTER VALUE')) {
            const dealTagElement = document.createElement('div');
            dealTagElement.className = 'deal-tag';
            
            // Apply special styling based on deal type
            if (match.dealTag === 'BETTER VALUE') {
              dealTagElement.classList.add('better-value');
            } else if (match.dealTag === 'GREAT PRICE') {
              dealTagElement.classList.add('great-price');
            }
            
            dealTagElement.textContent = match.dealTag;
            matchElement.appendChild(dealTagElement);
          }
          
          // Create content container
          const contentContainer = document.createElement('div');
          contentContainer.className = 'match-content';
          
          // Add name
          const nameElement = document.createElement('div');
          nameElement.className = 'match-name';
          nameElement.textContent = match.name;
          contentContainer.appendChild(nameElement);
          
          // Add type if available
          if (match.type) {
            const typeElement = document.createElement('div');
            typeElement.className = 'match-type';
            typeElement.textContent = match.type;
            contentContainer.appendChild(typeElement);
          }
          
          // Add age and ABV if available
          if (match.age || match.abv) {
            const detailsElement = document.createElement('div');
            detailsElement.className = 'match-details';
            
            if (match.age) {
              detailsElement.textContent += `${match.age}`;
            }
            
            if (match.age && match.abv) {
              detailsElement.textContent += ' | ';
            }
            
            if (match.abv) {
              detailsElement.textContent += `${match.abv}`;
            }
            
            contentContainer.appendChild(detailsElement);
          }
          
          // Add price and savings
          const priceElement = document.createElement('div');
          priceElement.className = 'match-price';
          
          // Always use USD for price display with currency handler
          let formattedPrice;
          if (window.HBCurrency) {
            formattedPrice = window.HBCurrency.formatPrice(match.price, match.currency);
          } else {
            // Fallback to old method if currency handler not available
            formattedPrice = formatCurrency(match.priceUSD || match.price, 'USD');
          }
          priceElement.textContent = formattedPrice;
          
          // Add price comparison to original
          if (match.priceSavings !== 0) {
            const savingsElement = document.createElement('div');
            savingsElement.className = 'match-savings';
            
            // Generate savings text using currency handler
            let savingsText;
            if (window.HBCurrency && currentBottle.price) {
              // Calculate savings between original bottle and match
              const savings = window.HBCurrency.calculateSavings(
                currentBottle.price, 
                currentBottle.currency, 
                match.price, 
                match.currency
              );
              savingsText = savings.text;
              match.priceSavings = savings.amount; // Update for consistency
            } else {
              // Fallback to existing savings text
              savingsText = match.savings || '';
            }
            
            // Add special styling for savings vs extra cost
            if (match.priceSavings > 0) {
              savingsElement.classList.add('positive-savings');
              savingsElement.innerHTML = `<span class="savings-icon">↓</span> ${savingsText}`;
            } else {
              savingsElement.classList.add('negative-savings');
              savingsElement.innerHTML = `<span class="savings-icon">↑</span> ${savingsText}`;
            }
            
            priceElement.appendChild(savingsElement);
          }
          
          contentContainer.appendChild(priceElement);
          
          // Add view button
          const viewButton = document.createElement('button');
          viewButton.className = 'view-match-btn';
          viewButton.textContent = 'View on BAXUS';
          viewButton.onclick = function() {
            window.open(match.link, '_blank');
            // Track the click for analytics
            chrome.runtime.sendMessage({
              action: 'trackEvent',
              category: 'Matches',
              action: 'Click',
              label: match.name
            });
          };
          contentContainer.appendChild(viewButton);
          
          // Add content container to match element
          matchElement.appendChild(contentContainer);
          
          // Add match element to list
          matchesListContainer.appendChild(matchElement);
        } catch (error) {
          console.error('Error rendering match item:', error);
        }
      });
    } else {
      // No matches found
      matchesListContainer.innerHTML = `
        <div class="no-matches">
          <p>No matches found on BAXUS.</p>
        </div>
      `;
    }
  }
  
  // Show specified state, hide others
  function showState(stateId) {
    // Hide all states
    loadingState.classList.add('hidden');
    noBottleState.classList.add('hidden');
    bottleFoundState.classList.add('hidden');
    
    // Show specified state
    if (stateId === 'loading') {
      loadingState.classList.remove('hidden');
    } else if (stateId === 'no-bottle') {
      noBottleState.classList.remove('hidden');
    } else if (stateId === 'bottle-found') {
      bottleFoundState.classList.remove('hidden');
    }
  }
  
  // Handle errors
  function handleError(message) {
    console.error('Error:', message);
    
    // Update error message in no-bottle state
    const errorMessageElement = noBottleState.querySelector('.state-description');
    if (errorMessageElement) {
      errorMessageElement.textContent = message;
    }
    
    // Show no-bottle state
    showState('no-bottle');
  }
  
  // Get current active tab
  function getCurrentTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) {
          resolve(tabs[0]);
        } else {
          reject(new Error('No active tab found'));
        }
      });
    });
  }
  
  // Initialize popup
  initialize();
});
