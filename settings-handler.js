// Helper functions for handling user settings
// This file ensures proper access to settings across content and background scripts

// Check if popups are enabled according to user settings
function isPopupEnabled(callback) {
  // Default to true if setting isn't found
  chrome.storage.sync.get(['userSettings'], (result) => {
    const settings = result.userSettings || { showBaxusPopup: true };
    callback(settings.showBaxusPopup !== false);
  });
}

// Export the function so it can be used by other scripts
window.HoneyBarrelSettings = {
  isPopupEnabled
};
