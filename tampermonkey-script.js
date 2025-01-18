// ==UserScript==
// @name         ChatGPT API By Browser Script
// @namespace    http://tampermonkey.net/
// @version      1
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        GM_webRequest
// @license MIT
// ==/UserScript==

const log = (...args) => {
  console.log('chatgpt-api-by-browser-script', ...args);
}
log('starting');

const WS_URL = `ws://localhost:8765`;

function cleanText(inputText) {
  const invisibleCharsRegex =
    /[\u200B\u200C\u200D\uFEFF]|[\u0000-\u001F\u007F-\u009F]/g;
  const cleanedText = inputText.replace(invisibleCharsRegex, '');
  return cleanedText;
}
function getTextFromNode(node) {

  let result = '';

  if (!node) return result;

  if (
    node.classList.contains('text-token-text-secondary') &&
    node.classList.contains('bg-token-main-surface-secondary')
  ) {
    return result;
  }

  const childNodes = node.childNodes;

  for (let i = 0; i < childNodes.length; i++) {
    let childNode = childNodes[i];
    if (childNode.nodeType === Node.TEXT_NODE) {
      result += childNode.textContent;
    } else if (childNode.nodeType === Node.ELEMENT_NODE) {
      let tag = childNode.tagName.toLowerCase();
      if (tag === 'code') {
        result += getTextFromNode(childNode);
      } else {
        result += getTextFromNode(childNode);
      }
    }
  }

  return cleanText(result);
}

function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

// Main app class
class App {
  constructor() {
    this.socket = null;
    this.observer = null;
    this.stop = false;
    this.dom = null;
    this.lastText = null; // Track the last message text
  }

  async start({ text, model, newChat }) {
    this.stop = false;
    log('Starting to send a message');

    // Click new chat button if needed
    const newChatButton = document.querySelector('button[data-testid="create-new-chat-button"]');
    if (newChatButton) {
      log('New chat button found, clicking it');
      newChatButton.click();
      // Wait for the new chat to initialize
      await sleep(1000);
    }

    // Handle image upload if present
    const imageMatch = text.match(/\[Image: (data:image\/[^[\]]+)\]/);
    if (imageMatch) {
      log('Found image data in text');
      const base64Image = imageMatch[1];
      log('Extracted base64 image data:', base64Image.substring(0, 50) + '...');
      
      // Convert base64 to blob
      log('Converting base64 to blob...');
      const response = await fetch(base64Image);
      const blob = await response.blob();
      log('Blob created:', blob.size, 'bytes,', blob.type);
      const file = new File([blob], "small.png", { type: "image/png" });
      log('File created:', file.name, file.size, 'bytes,', file.type);

      // Create DataTransfer and add file
      log('Creating DataTransfer object...');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      log('File added to DataTransfer, items:', dataTransfer.items.length);

      // Get file input and set files
      log('Looking for file input element...');
      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) {
        log('File input found, setting files');
        fileInput.files = dataTransfer.files;
        log('Files set, count:', fileInput.files.length);
      } else {
        log('Error: File input not found');
      }

      // Trigger change event
      log('Triggering change event...');
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('Change event triggered');

      // Wait for file upload to complete
      await this.waitForFileUpload();

      // Update text to remove the image data
      text = text.replace(/\[Image: data:image\/[^[\]]+\]/, '').trim();
      log('Image data removed from text, remaining text:', text);
    }

    // Update text in placeholder elements
    document.querySelectorAll('p.placeholder').forEach(element => {
      element.textContent = text || ' '; // Use space if text is empty
    });

    // Wait a moment for the text to be properly set
    await sleep(1000);

    // Click the send button using the data-testid attribute
    const sendButton = document.querySelector('[data-testid="send-button"]');
    if (sendButton) {
      log('Send button found, clicking it');
      sendButton.click();
    } else {
      log('Error: Send button not found');
    }

    this.observeMutations();
  }

  async waitForFileUpload() {
    log('Waiting for file upload to complete...');
    while (true) {
      // Check for the upload progress indicator
      const uploadProgress = document.querySelector('div[role="progressbar"]');
      // Check for any loading spinners that might indicate upload in progress
      const loadingSpinner = document.querySelector('.text-token-text-secondary.animate-spin');
      
      if (!uploadProgress && !loadingSpinner) {
        log('File upload completed');
        break;
      }
      await sleep(500);
    }
    // Add a small delay to ensure UI is fully updated
    await sleep(1000);
  }

  async observeMutations() {
    let isStart = false;
    this.observer = new MutationObserver(async (mutations) => {
      let stopButton = document.querySelector('button.bg-black .icon-lg');
      if (stopButton) {
        isStart = true;
      }

      if (!isStart) {
        log('Not start, there is no stop button');
        return;
      }

      const list = [...document.querySelectorAll('div.agent-turn')];
      const last = list[list.length - 1];
      if (!last && stopButton) {
        log('Error: No last message found');
        return;
      }

      let lastText = getTextFromNode(
        last.querySelector('div[data-message-author-role="assistant"]')
      );

      if ((!lastText || lastText === this.lastText) && stopButton) {
        log('Error: Last message text not found or unchanged');
        return;
      }

      // Wait for 1 second and get the text again to ensure it's complete
      await sleep(1000);
      const finalText = getTextFromNode(
        last.querySelector('div[data-message-author-role="assistant"]')
      );

      this.lastText = finalText;
      log('send', {
        text: finalText,
      });
      this.socket.send(
        JSON.stringify({
          type: 'answer',
          text: finalText,
        })
      );

      if (!stopButton) {
        this.observer.disconnect();

        if (this.stop) return;
        this.stop = true;
        log('send', {
          type: 'stop',
        });
        this.socket.send(
          JSON.stringify({
            type: 'stop',
          })
        );

      }
    });

    const observerConfig = {
      childList: true,
      subtree: true,
      characterData: true,
    };
    this.observer.observe(document.body, observerConfig);
  }

  sendHeartbeat() {
    if (this.socket.readyState === WebSocket.OPEN) {
      log('Sending heartbeat');
      this.socket.send(JSON.stringify({ type: 'heartbeat' }));
    }
  }

  connect() {
    this.socket = new WebSocket(WS_URL);
    this.socket.onopen = () => {
      log('Server connected, can process requests now.');
      this.dom.innerHTML = '<div style="color: green;">API Connected!</div>';
    };
    this.socket.onclose = () => {
      log(
        'Error: The server connection has been disconnected, the request cannot be processed.'
      );
      this.dom.innerHTML = '<div style="color: red;">API Disconnected!</div>';

      setTimeout(() => {
        log('Attempting to reconnect...');
        this.connect();
      }, 2000);
    };
    this.socket.onerror = (error) => {
      log(
        'Error: Server connection error, please check the server.',
        error
      );
      this.dom.innerHTML = '<div style="color: red;">API Error!</div>';
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

  init() {
    window.addEventListener('load', () => {
      this.dom = document.createElement('div');
      this.dom.style =
        'position: fixed; top: 10px; right: 10px; z-index: 9999; display: flex; justify-content: center; align-items: center;';
      document.body.appendChild(this.dom);

      this.connect();

      setInterval(() => this.sendHeartbeat(), 30000);
    });
  }
}

(function () {
  'use strict';
  const app = new App();
  app.init();
})();