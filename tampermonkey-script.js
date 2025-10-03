// ==UserScript==
// @name         Perplexity API By Browser Script
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://www.perplexity.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=perplexity.ai
// @grant        GM_webRequest
// @license      MIT
// ==/UserScript==

const log = (...args) => {
  console.log('perplexity-api-by-browser-script', ...args);
}
log('starting');

const WS_URL = `ws://localhost:8765`;

// Selector configurations for Perplexity
const SELECTORS = {
  input: '#ask-input',
  followUpInput: 'textarea[placeholder*="follow"]',
  submitButton: 'button[aria-label="Submit"]',
  stopButton: 'button[aria-label*="Stop"]',
  responseContainer: '.prose',
  newThreadButton: 'button[data-testid="sidebar-new-thread"]', // Updated selector
  searchMode: 'radio[aria-label="Search"]',
  researchMode: 'radio[aria-label="Research"]',
  labsMode: 'radio[aria-label="Labs"]'
};

function cleanText(inputText) {
  const invisibleCharsRegex =
    /[\u200B\u200C\u200D\uFEFF]|[\u0000-\u001F\u007F-\u009F]/g;
  const cleanedText = inputText.replace(invisibleCharsRegex, '');
  return cleanedText;
}

// Extract text from Perplexity response with citations
function extractResponseText() {
  // First try to find the prose container
  const proseElement = document.querySelector(SELECTORS.responseContainer);
  if (!proseElement) {
    log('No response container found');
    return { text: '', citations: [] };
  }

  let fullText = '';
  let citations = [];

  // Process all content elements (h2, p, ul, li, etc.)
  const contentElements = proseElement.querySelectorAll('h2, p, ul, li');

  contentElements.forEach(element => {
    // Clone the element to work with
    const clonedEl = element.cloneNode(true);

    // Extract citation links before removing them
    const citationElements = clonedEl.querySelectorAll('a.citation');
    citationElements.forEach(citation => {
      const href = citation.getAttribute('href');
      const label = citation.getAttribute('aria-label') || '';
      if (href && !citations.some(c => c.url === href)) {
        citations.push({ url: href, label: label });
      }
      // Replace citation with a marker
      const marker = ` [${citations.length}]`;
      citation.replaceWith(marker);
    });

    // Get the text content
    let elementText = clonedEl.textContent.trim();

    if (elementText) {
      // Add appropriate formatting based on element type
      if (element.tagName === 'H2') {
        fullText += '\n## ' + elementText + '\n';
      } else if (element.tagName === 'LI') {
        fullText += '• ' + elementText + '\n';
      } else {
        fullText += elementText + '\n';
      }
    }
  });

  // Format citations at the end
  if (citations.length > 0) {
    fullText += '\n\n--- References ---\n';
    citations.forEach((citation, index) => {
      fullText += `[${index + 1}] ${citation.label || citation.url}\n    ${citation.url}\n`;
    });
  }

  return {
    text: cleanText(fullText.trim()),
    citations: citations
  };
}

// Check if response is complete
function isResponseComplete() {
  // Check if stop button exists (means still generating)
  const stopButton = document.querySelector(SELECTORS.stopButton) ||
                       document.querySelector('button[aria-label*="Stop generating"]');
  if (stopButton && !stopButton.disabled) {
    return false;
  }

  // Check for action buttons in either English or Chinese
  const copyButton = document.querySelector('button[aria-label="Copy"]') ||
                     document.querySelector('button[aria-label="拷贝"]');
  const shareButton = document.querySelector('button[data-testid="share-button"]'); // Use data-testid for reliability
  const rewriteButton = document.querySelector('button[aria-label="Rewrite"]') ||
                        document.querySelector('button[aria-label="重写"]');
  const helpfulButton = document.querySelector('button[aria-label="Helpful"]') ||
                        document.querySelector('button[aria-label="有用"]');
  const notHelpfulButton = document.querySelector('button[aria-label="Not helpful"]') ||
                           document.querySelector('button[aria-label="没有帮助"]');

  return !!(copyButton || shareButton || rewriteButton || helpfulButton || notHelpfulButton);
}

function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

// Main app class
class PerplexityApp {
  constructor() {
    this.socket = null;
    this.observer = null;
    this.stop = false;
    this.dom = null;
    this.lastText = null;
    this.currentMode = 'Search'; // Default mode
  }

  async start({ text, mode }) {
    this.stop = false;
    log('Starting to send a message');

    // Set the mode if specified (Search, Research, or Labs)
    if (mode) {
      await this.setMode(mode);
    }

    // Always click new thread button for every request
    // This ensures each request starts fresh without context from previous queries
    const newThreadButton = document.querySelector(SELECTORS.newThreadButton);
    if (newThreadButton) {
      log('Starting new thread');
      newThreadButton.click();
      await sleep(1500); // Give it a bit more time to load
    } else {
      log('Warning: New thread button not found, continuing anyway');
    }

    // Find the input field (could be main input or follow-up input)
    let inputField = document.querySelector(SELECTORS.followUpInput) ||
                     document.querySelector(SELECTORS.input);

    if (!inputField) {
      log('Error: No input field found');
      return;
    }

    log('Found input field, setting text using execCommand...');

    // Split the text in half to check for duplication issues
    const halfLength = Math.floor(text.length / 2);
    const firstHalf = text.substring(0, halfLength);
    const secondHalf = text.substring(halfLength);

    log('Original text length:', text.length);
    log('First half:', firstHalf);
    log('Second half:', secondHalf);

    // Use only the first half to avoid duplication
    const textToInsert = firstHalf;

    // Clear and focus (works for contenteditable DIVs)
    inputField.focus();
    inputField.innerHTML = '';

    // Select all and delete to ensure clean state
    // Note: execCommand is deprecated but still works and is the most reliable method for contenteditable
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);

    // Insert text using execCommand (works with contenteditable)
    document.execCommand('insertText', false, textToInsert);

    log('Text inserted:', inputField.textContent);

    // Trigger input event for React
    inputField.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    }));

    // Wait for text to be processed
    await sleep(500);

    // Submit the query by pressing Enter
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      bubbles: true
    });

    log('Submitting query...');
    inputField.dispatchEvent(enterEvent);

    // If submit button exists, click it as backup
    const submitButton = document.querySelector(SELECTORS.submitButton);
    if (submitButton && !submitButton.disabled) {
      log('Backup: Clicking submit button');
      submitButton.click();
    }

    // Start observing mutations
    this.observeMutations();
  }

  async setMode(mode) {
    // mode can be 'Search', 'Research', or 'Labs'
    const modeSelectors = {
      'Search': SELECTORS.searchMode,
      'Research': SELECTORS.researchMode,
      'Labs': SELECTORS.labsMode
    };

    const selector = modeSelectors[mode];
    if (selector) {
      const modeButton = document.querySelector(selector);
      if (modeButton && !modeButton.checked) {
        log(`Switching to ${mode} mode`);
        modeButton.click();
        await sleep(500);
      }
    }
  }

  async observeMutations() {
    let checkAttempts = 0;
    let lastResponseLength = 0;

    this.observer = new MutationObserver(async () => {
      checkAttempts++;

      // Check if response is being generated
      const responseData = extractResponseText();
      const isComplete = isResponseComplete();

      if (!responseData || !responseData.text) {
        if (checkAttempts % 10 === 0) {
          log('Waiting for response...');
        }
        return;
      }

      // Check if text has changed
      if (responseData.text.length > lastResponseLength) {
        lastResponseLength = responseData.text.length;

        // Send partial update
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          log('Sending partial response', responseData.text.length, 'chars');
          this.socket.send(
            JSON.stringify({
              type: 'answer',
              text: responseData.text,
              citations: responseData.citations,
              complete: false
            })
          );
        }
      }

      // Check if response is complete
      if (isComplete && responseData.text && responseData.text !== this.lastText) {
        this.lastText = responseData.text;

        // Disconnect observer
        this.observer.disconnect();

        // Send final response
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          log('Sending complete response with', responseData.citations.length, 'citations');
          this.socket.send(
            JSON.stringify({
              type: 'answer',
              text: responseData.text,
              citations: responseData.citations,
              complete: true
            })
          );

          // Send stop signal
          if (!this.stop) {
            this.stop = true;
            this.socket.send(
              JSON.stringify({
                type: 'stop'
              })
            );
          }
        }
      }
    });

    const observerConfig = {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'disabled']
    };

    // Observe the main content area
    const targetNode = document.querySelector('main') || document.body;
    this.observer.observe(targetNode, observerConfig);
  }

  sendHeartbeat() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      log('Sending heartbeat');
      this.socket.send(JSON.stringify({ type: 'heartbeat' }));
    }
  }

  connect() {
    this.socket = new WebSocket(WS_URL);

    this.socket.onopen = () => {
      log('Server connected, can process requests now.');
      this.updateStatus('API Connected!', 'green');
    };

    this.socket.onclose = () => {
      log('Error: The server connection has been disconnected, the request cannot be processed.');
      this.updateStatus('API Disconnected!', 'red');

      setTimeout(() => {
        log('Attempting to reconnect...');
        this.connect();
      }, 2000);
    };

    this.socket.onerror = (error) => {
      log('Error: Server connection error, please check the server.', error);
      this.updateStatus('API Error!', 'red');
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        log('Received data from server', data);
        this.start(data);
      } catch (error) {
        log('Error: Failed to parse server message', error);
      }
    };
  }

  updateStatus(message, color) {
    if (this.dom) {
      this.dom.innerHTML = `<div style="color: ${color};">${message}</div>`;
    }
  }

  init() {
    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupUI());
    } else {
      this.setupUI();
    }
  }

  setupUI() {
    // Create status indicator
    this.dom = document.createElement('div');
    this.dom.style = 'position: fixed; top: 10px; right: 10px; z-index: 9999; ' +
                     'background: rgba(0,0,0,0.8); padding: 8px 12px; ' +
                     'border-radius: 8px; font-family: monospace; font-size: 12px;';
    document.body.appendChild(this.dom);

    // Connect to WebSocket server
    this.connect();

    // Setup heartbeat
    setInterval(() => this.sendHeartbeat(), 30000);
  }
}

// Debug utilities
window.PERPLEXITY_API_DEBUG = {
  getSelectors: () => SELECTORS,
  extractText: () => extractResponseText(),
  isComplete: () => isResponseComplete(),
  findElements: () => {
    const results = {};
    for (const [key, selector] of Object.entries(SELECTORS)) {
      const element = document.querySelector(selector);
      results[key] = !!element;
    }
    return results;
  },
  testQuery: async (text) => {
    const app = window.perplexityApp;
    if (app) {
      await app.start({ text, mode: 'Search' });
    }
  },
  // New helper to test response extraction
  getFullResponse: () => {
    const data = extractResponseText();
    console.log('Text:', data.text);
    console.log('Citations:', data.citations);
    return data;
  }
};

// Initialize app
(function () {
  'use strict';
  const app = new PerplexityApp();
  app.init();
  window.perplexityApp = app; // Expose for debugging
  log('Debug utilities available at window.PERPLEXITY_API_DEBUG');
})();