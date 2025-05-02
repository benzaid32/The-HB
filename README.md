# The Honey Barrel

A powerful Chrome extension that revolutionizes how wine and whisky enthusiasts shop online by connecting retail websites with the BAXUS marketplace, powered by advanced AWS AI services.

![The Honey Barrel Banner](assets/banner.png)

## 🏆 BAXATHON Submission

This extension has been developed as a submission for the BAXATHON $3,000 "The Honey Barrel" bounty challenge, with features that exceed the requirements and deliver exceptional value to both users and the BAXUS platform:

- ✅ **Precise Bottle Identification**: Advanced AI detection works across virtually any website
- ✅ **Accurate Marketplace Matching**: Sophisticated algorithm matches bottles despite naming variations
- ✅ **Clear Price Comparison**: Intuitive UI highlights potential savings
- ✅ **Direct BAXUS Integration**: Seamless links to drive traffic to the BAXUS marketplace
- ✅ **Production-Ready Code**: Robust architecture built for reliability and scalability

**GitHub Repository**: [https://github.com/benzaid32/The-HB](https://github.com/benzaid32/The-HB)

## 🌟 Overview

The Honey Barrel solves a critical problem for wine and whisky enthusiasts by eliminating the need to manually search multiple retailers for the best deals. It automatically:

- Detects bottles on e-commerce websites using advanced AI technology
- Cross-references with BAXUS marketplace listings in real-time
- Highlights better deals with clear "BETTER VALUE" indicators
- Provides direct links to BAXUS alternatives
- Enhances the shopping experience with valuable insights

## Key Features

- **Smart Bottle Detection**: Uses AWS Rekognition to identify wine and whisky bottles on any retail website with remarkable accuracy
- **AI-Powered Bottle Matching**: Leverages AWS Comprehend for natural language understanding to match bottles despite variations in naming conventions
- **Quality-Based Matching Algorithm**: Intelligently ranks bottles based on multiple quality indicators (age, premium terms, bottle type, ABV)
- **"BETTER VALUE" Identification**: Clearly labels bottles that are both higher quality and cheaper
- **Automatic Currency Conversion**: Normalizes prices across different currencies for accurate comparisons
- **Robust Fallback Communication System**: Maintains functionality even during long browsing sessions when extension context may be invalidated
- **Special Brand Recognition**: Enhanced handling for popular brands including Japanese whiskies and W.L. Weller bourbon
- **Multi-Retailer Support**: Works across a vast array of wine and whisky e-commerce sites
- **Non-intrusive UI**: Clean, professional interface that enhances rather than disrupts the shopping experience
- **Security-Focused Design**: Implements best practices for credential management and data privacy

## Technical Highlights

- **AWS AI Services Integration**:
  - **Amazon Rekognition**: Advanced image analysis for bottle identification
  - **Amazon Comprehend**: Natural language processing for text extraction and classification
  
- **Advanced Matching Algorithm**:
  - Prioritizes finding bottles that are higher quality and better value than detected bottles
  - Uses multiple quality indicators (age, premium terms, bottle type, ABV)
  - Quality scoring system objectively ranks whisky bottles
  - Adaptive thresholds to ensure optimal matching across different whisky types
  
- **Resilient Architecture**:
  - Self-healing mechanism to handle extension context invalidation
  - Multi-stage recovery process with increasingly delayed retry attempts
  - State tracking to prevent duplicate recovery attempts
  - Port-based communication system compatible with Manifest V3 service workers

- **BAXUS API Integration**:
  - Optimized API calls using the correct parameter structure
  - Efficient parsing of nested response data
  - Proper error handling for stable marketplace integration

## 🚀 Installation

### From Chrome Web Store (Recommended)
1. Visit the Chrome Web Store (link TBD)
2. Click "Add to Chrome"
3. Confirm the installation

### Manual Installation (Developer Mode)
1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extension directory
5. The extension icon should appear in your browser toolbar

## ⚙️ Setting Up AWS Integration

To use the full AI capabilities of The Honey Barrel:

1. **Create AWS Account**
   - Sign up at [AWS Console](https://aws.amazon.com/console/)

2. **Set Up Required Services**
   - Enable Amazon Rekognition and Amazon Comprehend
   - Configure proper IAM roles and permissions

3. **Configure Authentication**
   - Create API keys with appropriate permissions
   - Set up secure credential management

4. **Update Extension Configuration**
   - Safely store AWS credentials following best security practices

## 🌐 Supported Websites

The Honey Barrel works on virtually any website selling wine or whisky bottles thanks to its AI capabilities. It has enhanced support for:
- whiskyshop.com
- wine.com
- masterofmalt.com
- thewhiskyexchange.com
- totalwine.com
- reservebar.com
- amazon.com
- And many more!

## 📱 Usage

1. Visit any retail website showing a wine or whisky bottle
2. The extension automatically detects the bottle and checks for matches
3. A notification appears if better prices are found on BAXUS
4. Click the extension icon to see detailed comparison information
5. The extension highlights "BETTER VALUE" options that offer superior quality at better prices
6. Click on any match to visit the corresponding BAXUS marketplace listing

## 🔒 Privacy & Security

The Honey Barrel prioritizes user privacy and security:
- Only collects information about the specific bottle being viewed
- Does not track browsing history or store personal information
- Implements secure credential management
- Does not expose sensitive API keys in source code
- Follows Chrome Web Store security best practices

## 🛠️ Development

### Project Structure
- `manifest.json` - Extension configuration (Manifest V3 compatible)
- `background.js` - Service worker for API handling and AWS integration
- `content.js` - Content script for scraping bottle information
- `popup.html/js/css` - Extension popup interface
- `currency-handler.js` - Currency normalization functionality
- `assets/` - Icons and images

### Building for Production
```
# Zip the extension directory
zip -r the-honey-barrel.zip *
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Built for the BAXATHON challenge by BlueGrass DAO and BAXUS
- Powered by the BAXUS Marketplace API and AWS AI services
- Special thanks to the BAXUS team for providing the marketplace API
