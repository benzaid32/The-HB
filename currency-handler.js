// The Honey Barrel - Currency Handling Utilities
// Provides standardized currency conversion and formatting across the extension

// IIFE to avoid polluting global namespace
(function() {
  // Exchange rates (as of May 2025)
  const EXCHANGE_RATES = {
    'USD': 1.0,     // US Dollar (base currency)
    'EUR': 1.14,    // Euro
    'GBP': 1.33,    // British Pound
    'JPY': 0.0067,  // Japanese Yen
    'CAD': 0.74,    // Canadian Dollar
    'AUD': 0.66,    // Australian Dollar
    'CHF': 1.12,    // Swiss Franc
    'NZD': 0.61,    // New Zealand Dollar
    'HKD': 0.13,    // Hong Kong Dollar
    'SGD': 0.75,    // Singapore Dollar
    'INR': 0.012,   // Indian Rupee
    'CNY': 0.14,    // Chinese Yuan
    'MXN': 0.049    // Mexican Peso
  };

  // Currency symbol mapping
  const CURRENCY_SYMBOLS = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'JPY': '¥',
    'CAD': 'C$',
    'AUD': 'A$',
    'CHF': 'CHF',
    'NZD': 'NZ$',
    'HKD': 'HK$',
    'SGD': 'S$',
    'INR': '₹',
    'CNY': '¥',
    'MXN': 'Mex$'
  };

  /**
   * Detect currency from a price string
   * @param {string} priceStr - The price string (e.g. "$10.99", "£20", "10.99 €")
   * @returns {string} - The currency code (e.g. "USD", "GBP", "EUR")
   */
  function detectCurrency(priceStr) {
    if (!priceStr || typeof priceStr !== 'string') {
      return 'USD'; // Default to USD
    }
    
    const priceLower = priceStr.toLowerCase().trim();
    
    // Check for currency symbols at start or end
    for (const [code, symbol] of Object.entries(CURRENCY_SYMBOLS)) {
      const symbolLower = symbol.toLowerCase();
      if (priceLower.includes(symbolLower)) {
        return code;
      }
    }
    
    // Special cases for commonly confused currencies
    if (priceLower.includes('dollar')) {
      if (priceLower.includes('us') || priceLower.includes('usd')) {
        return 'USD';
      } else if (priceLower.includes('australian') || priceLower.includes('aud')) {
        return 'AUD';
      } else if (priceLower.includes('canadian') || priceLower.includes('cad')) {
        return 'CAD';
      }
      return 'USD'; // Default to USD for generic "dollar"
    }
    
    if (priceLower.includes('euro') || priceLower.includes('eur')) {
      return 'EUR';
    }
    
    if (priceLower.includes('pound') || priceLower.includes('gbp')) {
      return 'GBP';
    }
    
    // Default to USD if no currency identified
    return 'USD';
  }

  /**
   * Extract numeric value from a price string
   * @param {string} priceStr - The price string to extract from
   * @returns {number} - The numeric price value
   */
  function extractNumericPrice(priceStr) {
    if (!priceStr) {
      return 0;
    }
    
    // Handle when price is already a number
    if (typeof priceStr === 'number') {
      return priceStr;
    }
    
    // Convert to string if it's not already
    const priceString = String(priceStr);
    
    // Remove all non-numeric characters except period and comma
    const cleaned = priceString.replace(/[^\d.,]/g, '');
    
    // Handle different number formats
    let formattedPrice = cleaned;
    
    // UK/US format: 1,234.56
    if (cleaned.includes(',') && cleaned.includes('.') && 
        cleaned.lastIndexOf(',') < cleaned.lastIndexOf('.')) {
      formattedPrice = cleaned.replace(/,/g, '');
    } 
    // European format: 1.234,56
    else if (cleaned.includes(',') && cleaned.includes('.') && 
             cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      formattedPrice = cleaned.replace(/\./g, '').replace(',', '.');
    }
    // Format with comma as decimal: 1234,56
    else if (cleaned.includes(',') && !cleaned.includes('.')) {
      formattedPrice = cleaned.replace(',', '.');
    }
    
    const price = parseFloat(formattedPrice);
    return isNaN(price) ? 0 : price;
  }

  /**
   * Convert a price from one currency to USD
   * @param {number|string} price - The price to convert
   * @param {string} fromCurrency - The currency code to convert from
   * @returns {number} - The price in USD
   */
  function convertToUSD(price, fromCurrency = 'USD') {
    if (!price) return 0;
    
    // Extract numeric value if price is a string
    const numericPrice = typeof price === 'number' ? 
                         price : 
                         extractNumericPrice(price);
    
    if (isNaN(numericPrice) || numericPrice === 0) {
      return 0;
    }
    
    // Normalize currency code
    const currency = (fromCurrency || 'USD').toUpperCase();
    
    // Apply exchange rate if available
    const exchangeRate = EXCHANGE_RATES[currency] || 1;
    return numericPrice * exchangeRate;
  }

  /**
   * Format a price for display, always in USD
   * @param {number|string} price - The price to format
   * @param {string} fromCurrency - The source currency code
   * @returns {string} - Formatted price string in USD
   */
  function formatPrice(price, fromCurrency = 'USD') {
    if (!price) {
      return 'Price unavailable';
    }
    
    try {
      // Detect currency if string was passed
      const currency = typeof price === 'string' ? 
                      detectCurrency(price) : 
                      (fromCurrency || 'USD');
      
      // Convert to USD
      const usdPrice = convertToUSD(price, currency);
      
      // Format with USD symbol
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(usdPrice);
    } catch (error) {
      console.error('Error formatting price:', error);
      // Fallback
      return `$${parseFloat(price).toFixed(2)}`;
    }
  }

  /**
   * Calculate savings between two prices
   * @param {number|string} originalPrice - The original price
   * @param {string} originalCurrency - Currency of original price
   * @param {number|string} newPrice - The new price to compare
   * @param {string} newCurrency - Currency of new price
   * @returns {object} - Object with savings amount, percentage and formatted text
   */
  function calculateSavings(originalPrice, originalCurrency, newPrice, newCurrency) {
    const originalUSD = convertToUSD(originalPrice, originalCurrency);
    const newUSD = convertToUSD(newPrice, newCurrency);
    
    if (!originalUSD || !newUSD) {
      return {
        amount: 0,
        percent: 0,
        text: ''
      };
    }
    
    const savingsAmount = originalUSD - newUSD;
    const savingsPercent = originalUSD > 0 ? 
                          Math.round((Math.abs(savingsAmount) / originalUSD) * 100) : 
                          0;
    
    let savingsText = '';
    if (savingsAmount > 0) {
      savingsText = `Save ${formatPrice(savingsAmount)} (${savingsPercent}%)`;
    } else if (savingsAmount < 0) {
      savingsText = `${formatPrice(Math.abs(savingsAmount))} more (${savingsPercent}%)`;
    } else {
      savingsText = 'Same price';
    }
    
    return {
      amount: savingsAmount,
      percent: savingsPercent,
      text: savingsText,
      isPositive: savingsAmount > 0
    };
  }

  // Expose the currency utilities globally
  window.HBCurrency = {
    detectCurrency,
    extractNumericPrice,
    convertToUSD,
    formatPrice,
    calculateSavings
  };
  
  console.log('The Honey Barrel: Currency Handler initialized');
})();
