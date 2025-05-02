// Content bridge for The Honey Barrel
// Intercepts communication between background and content scripts to apply user settings

// Use an IIFE to create a contained scope
(function() {
  console.log('The Honey Barrel: Content bridge initializing');
  
  // Cached settings for synchronous access
  let cachedSettings = { showBaxusPopup: true };
  
  // Immediately load settings to avoid race conditions
  try {
    // First check sessionStorage for cached settings
    const cachedSettingsJson = sessionStorage.getItem('honeyBarrelSettings');
    if (cachedSettingsJson) {
      try {
        const parsedSettings = JSON.parse(cachedSettingsJson);
        if (parsedSettings && typeof parsedSettings === 'object') {
          cachedSettings = parsedSettings;
          console.log('Content bridge: Retrieved cached settings from session storage', cachedSettings);
        }
      } catch (e) {
        console.error('Content bridge: Error parsing cached settings', e);
      }
    }
    
    // Then load from sync storage to ensure we have the latest
    chrome.storage.sync.get(['userSettings'], (result) => {
      if (result.userSettings) {
        cachedSettings = result.userSettings;
        console.log('Content bridge: Updated settings from sync storage', cachedSettings);
        
        // Cache for future page loads
        try {
          sessionStorage.setItem('honeyBarrelSettings', JSON.stringify(cachedSettings));
        } catch (e) {
          console.error('Content bridge: Error caching settings', e);
        }
      }
    });
  } catch (e) {
    console.error('Content bridge: Error loading settings', e);
  }
  
  // Register an early-loading MutationObserver to catch any DOM modifications that 
  // might be attempts to create popups before our script fully loads
  const earlyDomObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check for any attempts to add a notification
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1 && (
              node.id === 'honey-barrel-notification' || 
              node.classList.contains('honey-barrel-notification'))) {
            
            // Use cached settings for immediate decision to prevent flashing
            if (cachedSettings.showBaxusPopup === false) {
              console.log('BAXUS popup blocked by early DOM observer (cached settings)');
              node.remove();
              return;
            }
            
            // Double-check with current settings (async)
            chrome.storage.sync.get(['userSettings'], (result) => {
              const settings = result.userSettings || { showBaxusPopup: true };
              cachedSettings = settings; // Update cached settings
              
              if (settings.showBaxusPopup === false) {
                console.log('BAXUS popup blocked by early DOM observer');
                node.remove();
              }
            });
          }
        });
      }
    });
  });
  
  // Start observing early
  earlyDomObserver.observe(document.documentElement, { 
    childList: true, 
    subtree: true 
  });
  
  // Override the global showPageNotification function 
  // This captures direct calls from content.js
  const originalShowPageNotification = window.showPageNotification;
  
  window.showPageNotification = function(bottleInfo, matches, update) {
    console.log('Content bridge: Intercepted direct showPageNotification call');
    
    // Check cached settings first for immediate decision
    if (cachedSettings.showBaxusPopup === false) {
      console.log('BAXUS popup disabled (cached settings) - direct function call blocked');
      return true;
    }
    
    // Double-check with current settings
    chrome.storage.sync.get(['userSettings'], (result) => {
      const settings = result.userSettings || { showBaxusPopup: true };
      cachedSettings = settings; // Update cache
      
      // Cache for future use
      try {
        sessionStorage.setItem('honeyBarrelSettings', JSON.stringify(settings));
      } catch (e) {
        console.error('Error caching settings:', e);
      }
      
      if (settings.showBaxusPopup === false) {
        console.log('BAXUS popup disabled - direct function call blocked');
        return;
      }
      
      //Process bottle info to ensure prices are in USD
      try {
        // Create deep copies of objects to avoid reference issues
        const processedBottleInfo = JSON.parse(JSON.stringify(bottleInfo));
        const processedMatches = JSON.parse(JSON.stringify(matches));
        
        console.log('Processing bottle info for currency conversion', {
          original: bottleInfo.price,
          currency: bottleInfo.currency || 'unknown'
        });
        
        // Process bottle price - Convert to USD
        if (processedBottleInfo && processedBottleInfo.price) {
          // Ensure currency is detected if not already present
          if (!processedBottleInfo.currency) {
            if (window.HBCurrency && window.HBCurrency.detectCurrency) {
              processedBottleInfo.currency = window.HBCurrency.detectCurrency(processedBottleInfo.price);
            } else {
              // Simple fallback currency detection
              processedBottleInfo.currency = detectCurrencyFallback(processedBottleInfo.price);
            }
          }
          
          // Convert price to USD
          if (processedBottleInfo.currency && processedBottleInfo.currency !== 'USD') {
            if (window.HBCurrency && window.HBCurrency.convertToUSD) {
              // Use the HBCurrency utility
              const originalPrice = processedBottleInfo.price;
              const numericPrice = typeof originalPrice === 'number' ? 
                originalPrice : 
                extractNumericPriceFallback(originalPrice);
              
              const usdPrice = window.HBCurrency.convertToUSD(numericPrice, processedBottleInfo.currency);
              processedBottleInfo.originalPrice = originalPrice;
              processedBottleInfo.originalCurrency = processedBottleInfo.currency;
              processedBottleInfo.price = formatPriceFallback(usdPrice, 'USD');
              processedBottleInfo.currency = 'USD';
              
              console.log('Converted bottle price to USD', {
                original: originalPrice,
                fromCurrency: processedBottleInfo.originalCurrency,
                toUSD: processedBottleInfo.price
              });
            } else {
              // Fallback conversion
              convertPriceFallback(processedBottleInfo);
            }
          }
        }
        
        // Process each match price - Convert to USD
        if (processedMatches && processedMatches.length > 0) {
          processedMatches.forEach(match => {
            if (match && match.price) {
              // Ensure currency is detected if not already present
              if (!match.currency) {
                if (window.HBCurrency && window.HBCurrency.detectCurrency) {
                  match.currency = window.HBCurrency.detectCurrency(match.price);
                } else {
                  // Simple fallback currency detection
                  match.currency = detectCurrencyFallback(match.price);
                }
              }
              
              // Convert price to USD
              if (match.currency && match.currency !== 'USD') {
                if (window.HBCurrency && window.HBCurrency.convertToUSD) {
                  // Use the HBCurrency utility
                  const originalPrice = match.price;
                  const numericPrice = typeof originalPrice === 'number' ? 
                    originalPrice : 
                    extractNumericPriceFallback(originalPrice);
                  
                  const usdPrice = window.HBCurrency.convertToUSD(numericPrice, match.currency);
                  match.originalPrice = originalPrice;
                  match.originalCurrency = match.currency;
                  match.price = formatPriceFallback(usdPrice, 'USD');
                  match.currency = 'USD';
                } else {
                  // Fallback conversion
                  convertPriceFallback(match);
                }
              }
            }
          });
        }
        
        // Now pass the processed data to the popup
        if (window.HoneyBarrelPopups && window.HoneyBarrelPopups.showPageNotification) {
          window.HoneyBarrelPopups.showPageNotification(processedBottleInfo, processedMatches, update);
        } else if (typeof originalShowPageNotification === 'function') {
          originalShowPageNotification(processedBottleInfo, processedMatches, update);
        }
      } catch (error) {
        console.error('Error processing bottle info for currency conversion:', error);
        
        // If there's an error, still try to show the popup with original data
        if (window.HoneyBarrelPopups && window.HoneyBarrelPopups.showPageNotification) {
          window.HoneyBarrelPopups.showPageNotification(bottleInfo, matches, update);
        } else if (typeof originalShowPageNotification === 'function') {
          originalShowPageNotification(bottleInfo, matches, update);
        }
      }
    });
  };
  
  // Fallback functions for when HBCurrency is not available
  function detectCurrencyFallback(price) {
    if (!price) return 'USD';
    const priceStr = String(price);
    if (priceStr.includes('€')) return 'EUR';
    if (priceStr.includes('£')) return 'GBP';
    if (priceStr.includes('¥')) return 'JPY';
    return 'USD';
  }
  
  function extractNumericPriceFallback(priceStr) {
    if (!priceStr) return 0;
    if (typeof priceStr === 'number') return priceStr;
    
    try {
      const text = String(priceStr).trim();
      const cleaned = text.replace(/[^\d.,]/g, '');
      
      // Simple case - just one number
      if (!/[.,]/.test(cleaned)) {
        return parseInt(cleaned, 10);
      }
      
      // For decimal values
      return parseFloat(cleaned.replace(',', '.'));
    } catch (e) {
      console.error('Error in fallback price extraction:', e);
      return 0;
    }
  }
  
  function formatPriceFallback(price, currency = 'USD') {
    if (currency === 'USD') {
      return '$' + parseFloat(price).toFixed(2);
    }
    return price;
  }
  
  function convertPriceFallback(itemWithPrice) {
    try {
      if (!itemWithPrice || !itemWithPrice.price) return;
      
      // Fallback exchange rates
      const rates = {
        'EUR': 1.14,
        'GBP': 1.31,
        'JPY': 0.0067,
        'USD': 1.0
      };
      
      // Extract numeric price
      const numericPrice = extractNumericPriceFallback(itemWithPrice.price);
      
      // Get exchange rate
      const rate = rates[itemWithPrice.currency] || 1.0;
      
      // Calculate USD price
      const usdPrice = numericPrice * rate;
      
      // Save original values
      itemWithPrice.originalPrice = itemWithPrice.price;
      itemWithPrice.originalCurrency = itemWithPrice.currency;
      
      // Update with USD values
      itemWithPrice.price = formatPriceFallback(usdPrice, 'USD');
      itemWithPrice.currency = 'USD';
      
      console.log('Fallback conversion', {
        original: itemWithPrice.originalPrice,
        fromCurrency: itemWithPrice.originalCurrency,
        toUSD: itemWithPrice.price
      });
    } catch (e) {
      console.error('Error in fallback price conversion:', e);
    }
  }
  
  // Keep track of the original message listener
  let originalMessageListener = null;
  
  // Create our own message handler that checks settings
  function settingsAwareMessageHandler(request, sender, sendResponse) {
    console.log('Content bridge intercepted message:', request.action);
    
    // Intercept all popup and match-related messages
    if (request.action === 'showMatches' || 
        request.action === 'displayResults' || 
        request.action === 'showBottleMatches' ||
        request.action === 'findMatches' ||
        request.action === 'displayPopup' ||
        request.action === 'updateNotification' ||
        (request.action && request.action.includes('matches')) ||
        (request.action && request.action.includes('popup'))) {
      
      // Use cached settings for immediate decision
      if (cachedSettings.showBaxusPopup === false) {
        console.log('BAXUS popups disabled (cached settings) - message intercepted:', request.action);
        sendResponse({ 
          success: true, 
          note: 'Popup disabled by user settings'
        });
        return;
      }
      
      // Double-check with current settings
      chrome.storage.sync.get(['userSettings'], (result) => {
        const settings = result.userSettings || { showBaxusPopup: true };
        cachedSettings = settings; // Update cache
        
        // Cache for future use
        try {
          sessionStorage.setItem('honeyBarrelSettings', JSON.stringify(settings));
        } catch (e) {
          console.error('Error caching settings:', e);
        }
        
        if (settings.showBaxusPopup === false) {
          console.log('BAXUS popups disabled in user settings - message intercepted:', request.action);
          sendResponse({ 
            success: true, 
            note: 'Popup disabled by user settings'
          });
          return;
        }
        
        // Otherwise, pass to original handler
        if (originalMessageListener) {
          return originalMessageListener(request, sender, sendResponse);
        }
      });
      
      return true; // Keep message channel open for async response
    }
    
    // For all other messages, just pass through to the original handler
    if (originalMessageListener) {
      return originalMessageListener(request, sender, sendResponse);
    }
  }
  
  // When the extension is loaded, hook into the message listener system
  const originalAddListener = chrome.runtime.onMessage.addListener;
  
  // Override with our version that captures the content.js listener
  chrome.runtime.onMessage.addListener = function(listener) {
    // Save the original listener so we can call it
    originalMessageListener = listener;
    
    // Return the result of adding our wrapper instead
    return originalAddListener.call(this, settingsAwareMessageHandler);
  };
  
  // Check for HoneyBarrelPopups object periodically and override if needed
  const checkForPopups = setInterval(() => {
    if (window.HoneyBarrelPopups && window.HoneyBarrelPopups.showPageNotification) {
      clearInterval(checkForPopups);
      
      console.log('Content bridge: Additional HoneyBarrelPopups interception established');
      
      // Save the original HoneyBarrelPopups.showPageNotification method
      const originalPopupCreatorMethod = window.HoneyBarrelPopups.showPageNotification;
      
      // Override with our settings-aware version
      window.HoneyBarrelPopups.showPageNotification = function(bottleInfo, matches, update) {
        // Always check settings before showing the popup
        if (cachedSettings.showBaxusPopup === false) {
          console.log('BAXUS popup disabled (cached settings) - HoneyBarrelPopups call blocked');
          return;
        }
        
        // Double-check with current settings
        chrome.storage.sync.get(['userSettings'], (result) => {
          const settings = result.userSettings || { showBaxusPopup: true };
          cachedSettings = settings; // Update cache
          
          // Cache for future use
          try {
            sessionStorage.setItem('honeyBarrelSettings', JSON.stringify(settings));
          } catch (e) {
            console.error('Error caching settings:', e);
          }
          
          if (settings.showBaxusPopup === false) {
            console.log('BAXUS popup disabled in user settings - HoneyBarrelPopups call blocked');
            return;
          }
          
          // Only call the original method if popups are enabled
          originalPopupCreatorMethod(bottleInfo, matches, update);
        });
      };
    }
  }, 50); // Check frequently
  
  // Create a patching function to patch any dynamically added methods
  function patchDynamicFunctions() {
    // Patch any methods that might be added by content.js
    if (window.findMatches && typeof window.findMatches === 'function') {
      const originalFindMatches = window.findMatches;
      window.findMatches = function() {
        if (cachedSettings.showBaxusPopup === false) {
          console.log('BAXUS popup disabled (cached settings) - findMatches call blocked');
          return;
        }
        
        // Double-check with current settings
        chrome.storage.sync.get(['userSettings'], (result) => {
          const settings = result.userSettings || { showBaxusPopup: true };
          cachedSettings = settings; // Update cache
          
          // Cache for future use
          try {
            sessionStorage.setItem('honeyBarrelSettings', JSON.stringify(settings));
          } catch (e) {
            console.error('Error caching settings:', e);
          }
          
          if (settings.showBaxusPopup === false) {
            console.log('BAXUS popup disabled in user settings - findMatches call blocked');
            return;
          }
          
          return originalFindMatches.apply(this, arguments);
        });
      };
    }
    
    // Patch recoverState function if it exists
    if (window.recoverState && typeof window.recoverState === 'function') {
      const originalRecoverState = window.recoverState;
      window.recoverState = function() {
        if (cachedSettings.showBaxusPopup === false) {
          console.log('BAXUS popup disabled (cached settings) - recoverState call modified to skip popup');
          // Call original but flag to skip popup recovery
          const result = originalRecoverState.apply(this, [true]);
          return result;
        }
        
        // Double-check with current settings
        chrome.storage.sync.get(['userSettings'], (result) => {
          const settings = result.userSettings || { showBaxusPopup: true };
          cachedSettings = settings; // Update cache
          
          // Cache for future use
          try {
            sessionStorage.setItem('honeyBarrelSettings', JSON.stringify(settings));
          } catch (e) {
            console.error('Error caching settings:', e);
          }
          
          if (settings.showBaxusPopup === false) {
            console.log('BAXUS popup disabled in user settings - recoverState call modified to skip popup');
            // Call original but flag to skip popup recovery
            const result = originalRecoverState.apply(this, [true]);
            return result;
          }
          
          return originalRecoverState.apply(this, arguments);
        });
      };
    }
  }
  
  // Run the patcher after a small delay
  setTimeout(patchDynamicFunctions, 500);
  
  console.log('The Honey Barrel: Content bridge active with comprehensive popup control');
})();
