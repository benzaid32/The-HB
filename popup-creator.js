// Popup notification creator for The Honey Barrel extension
// Handles creating and managing popup notifications on web pages

// Use an IIFE to create a closure and avoid global variable conflicts
(function() {
  // State tracking - now scoped inside the closure instead of global
  let notificationActive = false;
  
  // Store the original content.js function if it exists (for compatibility)
  const originalContentJsShowPageNotification = window.showPageNotification;

  // Fallback currency conversions in case HBCurrency isn't loaded yet
  const FALLBACK_RATES = {
    'EUR': 1.14, // Updated EUR to USD rate
    'GBP': 1.31,
    'JPY': 0.0067,
    'USD': 1.0
  };
  
  // Fallback currency formatter function
  function fallbackFormatPrice(price, currency = 'USD') {
    if (!price) return 'Price unavailable';
    
    try {
      // Extract numeric value
      let numericPrice = typeof price === 'number' ? price : parseFloat(price.replace(/[^\d.,]/g, '').replace(',', '.'));
      
      if (isNaN(numericPrice)) return price;
      
      // Convert to USD if needed
      if (currency && currency !== 'USD' && FALLBACK_RATES[currency]) {
        numericPrice = numericPrice * FALLBACK_RATES[currency];
      }
      
      // Format as USD
      return `$${numericPrice.toFixed(2)}`;
    } catch (e) {
      console.error('Error in fallback price formatting:', e);
      return price;
    }
  }

  // Fallback currency detection function
  function fallbackDetectCurrency(price) {
    // Basic detection based on currency symbols
    if (price.includes('€')) return 'EUR';
    if (price.includes('£')) return 'GBP';
    if (price.includes('¥')) return 'JPY';
    return 'USD';
  }

  // Create and show popup notification on the page
  function showPageNotification(bottleInfo, matches, update = false) {
    try {
      // Verify inputs to prevent errors
      if (!bottleInfo || typeof bottleInfo !== 'object' || !Array.isArray(matches)) {
        console.error('Invalid arguments to showPageNotification', { bottleInfo, matches });
        return;
      }
      
      // Check with settings handler before proceeding
      chrome.storage.sync.get(['userSettings'], (result) => {
        const settings = result.userSettings || { showBaxusPopup: true };
        if (settings.showBaxusPopup === false) {
          return;
        }
        
        // Ensure we have proper currency detection for the bottle
        if (bottleInfo.price && !bottleInfo.currency) {
          // Detect currency if not already set
          bottleInfo.currency = window.HBCurrency ? 
            window.HBCurrency.detectCurrency(bottleInfo.price) : 
            fallbackDetectCurrency(bottleInfo.price);
        }
        
        // Create a deep copy of the bottle info to avoid reference issues
        const processedBottleInfo = JSON.parse(JSON.stringify(bottleInfo));
        
        // Process matches for display
        const processedMatches = matches.map(match => {
          // Create a deep copy to avoid reference issues
          const processedMatch = JSON.parse(JSON.stringify(match));
          
          // Ensure match has currency info
          if (processedMatch.price && !processedMatch.currency) {
            processedMatch.currency = window.HBCurrency ? 
              window.HBCurrency.detectCurrency(processedMatch.price) : 
              fallbackDetectCurrency(processedMatch.price);
          }
          
          return processedMatch;
        });
        
        createPopupElement(processedBottleInfo, processedMatches, update);
        
        // Add a final forced check to convert any remaining non-USD prices after rendering
        setTimeout(forcePriceConversion, 100);
      });
    } catch (error) {
      console.error('Error showing page notification:', error);
    }
  }
  
  // Post-render check to ensure all prices are correctly displayed in USD
  function forcePriceConversion() {
    try {
      // Find the notification element
      const notification = document.getElementById('honey-barrel-notification');
      if (!notification) return;
      
      // Fix main bottle price
      const bottlePriceElement = notification.querySelector('.bottle-price');
      if (bottlePriceElement) {
        const priceText = bottlePriceElement.textContent || '';
        
        // Check if the price contains a non-USD currency symbol or doesn't start with $
        if (priceText.includes('€') || priceText.includes('£') || priceText.includes('¥') || !priceText.includes('$')) {
          console.log('Found non-USD format in bottle price, forcing conversion:', priceText);
          
          // Extract the currency and numeric value
          let currency = 'USD';
          if (priceText.includes('€')) currency = 'EUR';
          else if (priceText.includes('£')) currency = 'GBP';
          else if (priceText.includes('¥')) currency = 'JPY';
          
          // Extract numeric value
          const numMatch = priceText.match(/[\d.,]+/);
          if (numMatch && numMatch[0]) {
            const numericValue = parseFloat(numMatch[0].replace(',', '.'));
            
            // Convert to USD using accurate 2025 rates
            const rates = {
              'EUR': 1.14,
              'GBP': 1.31,
              'JPY': 0.0067,
              'USD': 1.0
            };
            
            const usdValue = numericValue * (rates[currency] || 1.0);
            
            // Replace the text with properly formatted USD
            bottlePriceElement.textContent = `$${usdValue.toFixed(2)}`;
            console.log('Forced price conversion:', {
              from: priceText,
              to: bottlePriceElement.textContent
            });
          }
        }
      }
      
      // Fix match prices
      const matchPriceElements = notification.querySelectorAll('.match-price');
      matchPriceElements.forEach(elem => {
        const priceText = elem.textContent || '';
        
        // Check if the price contains a non-USD currency symbol or doesn't start with $
        if (priceText.includes('€') || priceText.includes('£') || priceText.includes('¥') || !priceText.includes('$')) {
          console.log('Found non-USD format in match price, forcing conversion:', priceText);
          
          // Extract the currency and numeric value
          let currency = 'USD';
          if (priceText.includes('€')) currency = 'EUR';
          else if (priceText.includes('£')) currency = 'GBP';
          else if (priceText.includes('¥')) currency = 'JPY';
          
          // Extract numeric value
          const numMatch = priceText.match(/[\d.,]+/);
          if (numMatch && numMatch[0]) {
            const numericValue = parseFloat(numMatch[0].replace(',', '.'));
            
            // Convert to USD using accurate 2025 rates
            const rates = {
              'EUR': 1.14,
              'GBP': 1.31,
              'JPY': 0.0067,
              'USD': 1.0
            };
            
            const usdValue = numericValue * (rates[currency] || 1.0);
            
            // Replace the text with properly formatted USD
            elem.textContent = `$${usdValue.toFixed(2)}`;
            console.log('Forced match price conversion:', {
              from: priceText,
              to: elem.textContent
            });
          }
        }
      });
    } catch (e) {
      console.error('Error in forcePriceConversion:', e);
    }
  }

  // Create the actual popup element
  function createPopupElement(bottleInfo, matches, update = false) {
    try {
      // Prevent multiple notifications
      if (notificationActive && !update) {
        console.log('Notification already active, not creating another one');
        return;
      }
      
      // Clean up any existing notifications if this is an update
      if (update) {
        const existingNotification = document.getElementById('honey-barrel-notification');
        if (existingNotification) {
          existingNotification.remove();
        }
      }
      
      // Create notification container
      const notification = document.createElement('div');
      notification.id = 'honey-barrel-notification';
      notification.className = 'honey-barrel-notification';
      notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 300px;
        background-color: white;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        z-index: 2147483647;
        font-family: Arial, sans-serif;
        transition: opacity 0.3s, transform 0.3s;
        opacity: 0;
        transform: translateY(20px);
      `;
      
      // Create header
      const header = document.createElement('div');
      header.className = 'notification-header';
      header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 15px;
        background-color: #f8f8f8;
        border-top-left-radius: 8px;
        border-top-right-radius: 8px;
        border-bottom: 1px solid #eee;
      `;
      
      // Create title
      const title = document.createElement('div');
      title.className = 'notification-title';
      title.textContent = 'The Honey Barrel';
      title.style.cssText = `
        font-weight: bold;
        font-size: 16px;
      `;
      
      // Create close button
      const closeButton = document.createElement('button');
      closeButton.className = 'notification-close';
      closeButton.innerHTML = '&times;';
      closeButton.style.cssText = `
        background: none;
        border: none;
        font-size: 18px;
        color: #333;
        cursor: pointer;
        padding: 0 5px;
      `;
      
      // Add close button event listener
      closeButton.addEventListener('click', () => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(20px)';
        setTimeout(() => {
          notification.remove();
          notificationActive = false;
        }, 300);
      });
      
      // Add title and close button to header
      header.appendChild(title);
      header.appendChild(closeButton);
      
      // Create content
      const content = document.createElement('div');
      content.className = 'notification-content';
      content.style.cssText = `
        padding: 15px;
      `;
      
      // Add bottle info
      const bottleInfoElement = document.createElement('div');
      bottleInfoElement.className = 'bottle-info';
      bottleInfoElement.style.cssText = `
        margin-bottom: 15px;
      `;
      
      // Create Web Detection section title
      const detectionTitle = document.createElement('div');
      detectionTitle.className = 'detection-title';
      detectionTitle.textContent = 'Web Detection';
      detectionTitle.style.cssText = `
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 8px;
        color: #666;
      `;
      
      // Add Name label
      const nameLabel = document.createElement('div');
      nameLabel.className = 'name-label';
      nameLabel.textContent = 'Name';
      nameLabel.style.cssText = `
        font-size: 12px;
        color: #888;
        margin-bottom: 2px;
      `;
      
      // Add bottle name
      const bottleName = document.createElement('div');
      bottleName.className = 'bottle-name';
      bottleName.textContent = bottleInfo.name || 'Unknown Bottle';
      bottleName.style.cssText = `
        font-weight: bold;
        font-size: 16px;
        margin-bottom: 10px;
      `;
      
      // Add Price label
      const priceLabel = document.createElement('div');
      priceLabel.className = 'price-label';
      priceLabel.textContent = 'Price';
      priceLabel.style.cssText = `
        font-size: 12px;
        color: #888;
        margin-bottom: 2px;
      `;
      
      // Add bottle price
      const bottlePrice = document.createElement('div');
      bottlePrice.className = 'bottle-price';
      
      // *** CRITICAL USD CONVERSION ***
      // Always convert to USD to match extension popup behavior
      let priceDisplay = 'Price unavailable';
      let originalPrice = '';
      
      if (bottleInfo && bottleInfo.price) {
        // Store original price for reference if needed
        originalPrice = bottleInfo.price;
        
        // Force currency detection if not present
        const priceCurrency = bottleInfo.currency || 
                             (typeof bottleInfo.price === 'string' && bottleInfo.price.includes('€') ? 'EUR' : 
                             (typeof bottleInfo.price === 'string' && bottleInfo.price.includes('£') ? 'GBP' : 
                             (typeof bottleInfo.price === 'string' && bottleInfo.price.includes('¥') ? 'JPY' : 'USD')));
        
        // Get the numeric price value
        let numericValue = 0;
        if (typeof bottleInfo.price === 'number') {
          numericValue = bottleInfo.price;
        } else {
          // Extract numeric price from string
          const priceStr = bottleInfo.price.toString();
          const matches = priceStr.match(/[\d,.]+/);
          if (matches && matches[0]) {
            numericValue = parseFloat(matches[0].replace(',', '.'));
          }
        }
        
        // ALWAYS convert to USD using fixed conversion rates
        if (!isNaN(numericValue)) {
          const rates = {
            'EUR': 1.14,
            'GBP': 1.31,
            'JPY': 0.0067,
            'USD': 1.0
          };
          
          const rate = rates[priceCurrency] || 1.0;
          numericValue = numericValue * rate;
          
          // Format as USD with 2 decimal places
          priceDisplay = `$${numericValue.toFixed(2)}`;
          
          console.log('FINAL CONVERSION', {
            original: bottleInfo.price,
            detected: priceCurrency,
            converted: priceDisplay
          });
        } else {
          // As a fallback, just format as USD if possible
          priceDisplay = '$0.00';
        }
      }
      
      // Always set the text directly with our processed value
      bottlePrice.textContent = priceDisplay;
      
      bottlePrice.style.cssText = `
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 10px;
      `;
      
      // Add Source label
      const sourceLabel = document.createElement('div');
      sourceLabel.className = 'source-label';
      sourceLabel.textContent = 'Source';
      sourceLabel.style.cssText = `
        font-size: 12px;
        color: #888;
        margin-bottom: 2px;
      `;
      
      // Extract website name from URL if available
      let sourceName = 'Unknown source';
      if (bottleInfo.url) {
        try {
          const url = new URL(bottleInfo.url);
          sourceName = url.hostname.replace('www.', '');
        } catch (e) {
          // If URL parsing fails, just use what we have
          if (typeof bottleInfo.url === 'string') {
            sourceName = bottleInfo.url.split('/')[2] || bottleInfo.url;
          }
        }
      }
      
      // Add source website
      const bottleSource = document.createElement('div');
      bottleSource.className = 'bottle-source';
      bottleSource.textContent = sourceName;
      bottleSource.style.cssText = `
        font-size: 14px;
        margin-bottom: 15px;
      `;
      
      // Add all elements to bottle info
      bottleInfoElement.appendChild(detectionTitle);
      bottleInfoElement.appendChild(nameLabel);
      bottleInfoElement.appendChild(bottleName);
      bottleInfoElement.appendChild(priceLabel);
      bottleInfoElement.appendChild(bottlePrice);
      bottleInfoElement.appendChild(sourceLabel);
      bottleInfoElement.appendChild(bottleSource);
      
      // Add bottle info to content
      content.appendChild(bottleInfoElement);
      
      // If we have matches, show them in a list
      if (matches && matches.length > 0) {
        const matchesTitle = document.createElement('div');
        matchesTitle.className = 'matches-title';
        matchesTitle.textContent = 'BAXUS Marketplace Matches';
        matchesTitle.style.cssText = `
          font-weight: bold;
          font-size: 14px;
          margin-bottom: 10px;
        `;
        
        content.appendChild(matchesTitle);
        
        // Create matches list
        const matchesList = document.createElement('div');
        matchesList.className = 'matches-list';
        matchesList.style.cssText = `
          max-height: 200px;
          overflow-y: auto;
        `;
        
        // Add matches to the list
        matches.forEach((match, index) => {
          if (index < 3) { // Limit to top 3 matches
            const matchItem = document.createElement('div');
            matchItem.className = 'match-item';
            matchItem.style.cssText = `
              display: flex;
              justify-content: space-between;
              margin-bottom: 10px;
              padding-bottom: 10px;
              border-bottom: 1px solid #eee;
            `;
            
            // Create match content
            const matchContent = document.createElement('div');
            matchContent.className = 'match-content';
            matchContent.style.cssText = `
              flex: 1;
            `;
            
            // Add match name
            const matchName = document.createElement('div');
            matchName.className = 'match-name';
            matchName.textContent = match.name || 'BAXUS Match';
            matchName.style.cssText = `
              font-weight: bold;
              font-size: 14px;
              margin-bottom: 3px;
            `;
            
            // Add match price
            const matchPrice = document.createElement('div');
            matchPrice.className = 'match-price';
            
            // *** CRITICAL USD CONVERSION FOR MATCH PRICES ***
            // Implement fail-proof USD conversion at the final rendering point
            let matchPriceDisplay = 'Price unavailable';
            
            if (match && match.price) {
              // Force currency detection if not present
              const matchCurrency = match.currency || 
                                 (typeof match.price === 'string' && match.price.includes('€') ? 'EUR' : 
                                 (typeof match.price === 'string' && match.price.includes('£') ? 'GBP' : 
                                 (typeof match.price === 'string' && match.price.includes('¥') ? 'JPY' : 'USD')));
              
              // Get the numeric price value
              let matchNumericValue = 0;
              if (typeof match.price === 'number') {
                matchNumericValue = match.price;
              } else {
                // Extract numeric price from string
                const matchPriceStr = match.price.toString();
                const matchNumMatches = matchPriceStr.match(/[\d,.]+/);
                if (matchNumMatches && matchNumMatches[0]) {
                  matchNumericValue = parseFloat(matchNumMatches[0].replace(',', '.'));
                }
              }
              
              // ALWAYS convert to USD using fixed conversion rates
              if (!isNaN(matchNumericValue)) {
                const rates = {
                  'EUR': 1.14,
                  'GBP': 1.31,
                  'JPY': 0.0067,
                  'USD': 1.0
                };
                
                const rate = rates[matchCurrency] || 1.0;
                matchNumericValue = matchNumericValue * rate;
                
                // Format as USD with 2 decimal places
                matchPriceDisplay = `$${matchNumericValue.toFixed(2)}`;
                
                console.log('MATCH FINAL CONVERSION', {
                  original: match.price,
                  detected: matchCurrency,
                  converted: matchPriceDisplay
                });
              } else {
                // If conversion failed, just use $0.00
                matchPriceDisplay = '$0.00';
              }
            }
            
            // Always set the text directly with our processed value
            matchPrice.textContent = matchPriceDisplay;
            
            matchPrice.style.cssText = `
              font-size: 13px;
              color: #555;
            `;
            
            // Add match content to match item
            matchContent.appendChild(matchName);
            matchContent.appendChild(matchPrice);
            matchItem.appendChild(matchContent);
            
            // Create view button
            const viewButton = document.createElement('a');
            viewButton.className = 'view-button';
            viewButton.textContent = 'View';
            viewButton.href = match.id ? `https://baxus.co/asset/${match.id}` : `https://baxus.co/search?q=${encodeURIComponent(match.name || '')}`;
            viewButton.target = '_blank';
            viewButton.style.cssText = `
              display: inline-block;
              padding: 5px 10px;
              background-color: #f9c846;
              color: #333;
              border-radius: 4px;
              text-decoration: none;
              font-size: 12px;
              white-space: nowrap;
              align-self: center;
            `;
            
            // Add view button to match item
            matchItem.appendChild(viewButton);
            
            // Add match item to matches list
            matchesList.appendChild(matchItem);
          }
        });
        
        // Add matches list to content
        content.appendChild(matchesList);
        
        // Add "View all on BAXUS" button
        const viewAllButton = document.createElement('a');
        viewAllButton.className = 'view-all-button';
        viewAllButton.textContent = 'View all on BAXUS';
        viewAllButton.href = `https://baxus.co/search?q=${encodeURIComponent(bottleInfo.name || '')}`;
        viewAllButton.target = '_blank';
        viewAllButton.style.cssText = `
          display: block;
          padding: 8px;
          margin-top: 10px;
          background-color: #eee;
          color: #333;
          border-radius: 4px;
          text-align: center;
          text-decoration: none;
          font-size: 13px;
        `;
        
        // Add view all button to content
        content.appendChild(viewAllButton);
      } else {
        // No matches found
        const noMatches = document.createElement('div');
        noMatches.className = 'no-matches';
        noMatches.textContent = 'No matches found on BAXUS marketplace.';
        noMatches.style.cssText = `
          color: #888;
          text-align: center;
          margin: 15px 0;
        `;
        
        // Add no matches to content
        content.appendChild(noMatches);
        
        // Add "Search on BAXUS" button
        const searchButton = document.createElement('a');
        searchButton.className = 'search-button';
        searchButton.textContent = 'Search on BAXUS';
        searchButton.href = `https://baxus.co/search?q=${encodeURIComponent(bottleInfo.name || '')}`;
        searchButton.target = '_blank';
        searchButton.style.cssText = `
          display: block;
          padding: 8px;
          margin-top: 10px;
          background-color: #f9c846;
          color: #333;
          border-radius: 4px;
          text-align: center;
          text-decoration: none;
          font-size: 13px;
        `;
        
        // Add search button to content
        content.appendChild(searchButton);
      }
      
      // Create footer
      const footer = document.createElement('div');
      footer.className = 'notification-footer';
      footer.style.cssText = `
        padding: 8px 15px;
        background-color: #f5f5f5;
        font-size: 11px;
        color: #888;
        text-align: center;
      `;
      footer.textContent = 'Powered by The Honey Barrel';
      
      // Add header, content, and footer to notification
      notification.appendChild(header);
      notification.appendChild(content);
      notification.appendChild(footer);
      
      // Add notification to page
      document.body.appendChild(notification);
      
      // Show notification with animation
      setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
      }, 10);
      
      // Auto-hide notification after 2 minutes
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
      console.error('Error creating popup element:', error);
    }
  }

  // CRITICAL: Override the global showPageNotification function from content.js
  // This ensures any direct calls to showPageNotification will go through our settings check
  window.showPageNotification = showPageNotification;

  // Export functions for use in content.js
  window.HoneyBarrelPopups = {
    showPageNotification: showPageNotification,
    isActive: () => notificationActive
  };
  
  // Log that we've successfully initialized
  console.log('The Honey Barrel: Popup Creator initialized and global functions overridden');
})();
