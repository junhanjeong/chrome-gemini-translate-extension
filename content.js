// (정리: 잘못 삽입됐던 상단 임시 코드 제거됨)
// Listen for screenshot actions from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'screenshot_full_translate') {
        captureAndTranslatePdf();
    } else if (request.action === 'screenshot_area_translate') {
        startAreaSelection();
    } else if (request.action === 'inplace_full_page_translate') {
        toggleInplaceFullPageTranslation();
    }
});

// Function to add context menu
let isMouseDown = false;
let selectionTimer = null;
const SELECTION_DELAY = 250; // ms (조금 더 빠르게 반응)
let lastSelectedText = ''; // Store the last selected text
let lastSelectionTimestamp = 0; // selectionchange 중복 방지
let pendingSelectionCheck = null; // selectionchange 딜레이 처리

// Helper: 현재 selection의 bounding rect 계산 (멀티 라인 대응)
function getSelectionBoundingRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    try {
        const range = sel.getRangeAt(0);
        let rect = range.getBoundingClientRect();
        if (rect && rect.width === 0 && rect.height === 0) {
            // getClientRects() 중 마지막 라인 rect 사용
            const rects = range.getClientRects();
            if (rects && rects.length) {
                rect = rects[rects.length - 1];
            }
        }
        if (rect && (rect.width || rect.height)) return rect;
    } catch (e) {
        // ignore
    }
    return null;
}

// selectionchange 리스너: GitHub README 등에서 mouseup 지연 전에 selection이 사라지는 케이스 대응
document.addEventListener('selectionchange', () => {
    const now = Date.now();
    // 드래그 중이거나 너무 빈번한 이벤트는 무시
    if (isMouseDown) return;
    if (now - lastSelectionTimestamp < 120) return;
    lastSelectionTimestamp = now;
    if (pendingSelectionCheck) {
        clearTimeout(pendingSelectionCheck);
    }
    pendingSelectionCheck = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel) return;
        const text = sel.toString().trim();
        if (!text) return;
        // 이미 같은 텍스트에 버튼이 떠 있다면 무시
        if (text === lastSelectedText && document.getElementById('translate-selected-text')) return;
        // 입력 필드 내부 제외
        const anchorNode = sel.anchorNode && sel.anchorNode.parentElement;
        if (anchorNode && ['INPUT','TEXTAREA'].includes(anchorNode.tagName)) return;
        lastSelectedText = text;
        showTranslationButton(null, text); // event 대신 selection rect 기반
    }, 140); // selection 안정화 딜레이
});

// Store the last position of the translation box
let lastTranslationBoxPosition = {
    top: null,
    left: null,
    positionSet: false
};

// 마지막 번역 내용을 복원하기 위한 저장소
let lastTranslationData = { translation: null, originalText: null };
// 선택 번역 중복 실행 방지 플래그
let isSelectionTranslating = false;

// Cmd+Shift+E (또는 Ctrl+Shift+E) 단축키:
// 1) 텍스트 선택이 있으면 즉시 선택 번역 수행
// 2) 선택이 없고 이전 번역이 사라진 상태면 마지막 번역 박스 복원
document.addEventListener('keydown', (e) => {
    // macOS: metaKey (⌘) + Shift + E, 기타 OS: Ctrl + Shift + E
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        const sel = window.getSelection();
        const selected = sel ? sel.toString().trim() : '';
        if (selected) {
            if (!isSelectionTranslating) {
                performSelectionTranslation(selected, { invokedByHotkey: true });
            }
        } else {
            if (!document.getElementById('translation-box') && lastTranslationData.translation) {
                // 박스가 닫혀 있고 저장된 최근 번역 존재 -> 복원
                displayTranslation(lastTranslationData.translation, lastTranslationData.originalText);
            }
        }
        e.preventDefault();
    }
    // Cmd + B : 페이지 인플레이스 전체 번역 토글 (입력 필드/컨텐츠 편집중이면 패스)
    if (e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
            return; // 에디팅 중 Bold 단축키 등 기본 동작 존중
        }
        e.preventDefault();
        toggleInplaceFullPageTranslation();
    }
}, true);

// Track mouse down state
document.addEventListener('mousedown', function(event) {
    // Don't remove the button if clicking on it
    if (event.target.id === 'translate-selected-text') {
        return;
    }
    
    isMouseDown = true;
    
    // Clear any existing selection timer
    if (selectionTimer) {
        clearTimeout(selectionTimer);
        selectionTimer = null;
    }
    
    // Remove any existing translate button when starting a new selection
    let translateButton = document.getElementById('translate-selected-text');
    if (translateButton) {
        translateButton.remove();
    }
});

// Handle mouse up - this is when we'll check for selection
document.addEventListener('mouseup', function(event) {
    // Don't process if clicking on the translate button
    if (event.target.id === 'translate-selected-text') {
        return;
    }
    
    isMouseDown = false;
    
    // Wait a moment after mouse up to allow browser to complete selection
    selectionTimer = setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (selectedText) {
            // Store selected text for later use
            lastSelectedText = selectedText;
            
            // Show the translation button
            showTranslationButton(event, selectedText);
        }
    }, SELECTION_DELAY);
});

// Function to show the translation button
function showTranslationButton(event, selectedText) {
    if (!selectedText) return;

    // Remove any existing button first
    let existingButton = document.getElementById('translate-selected-text');
    if (existingButton) {
        existingButton.remove();
    }

    // 위치 계산: selection bounding rect 우선, fallback = event 좌표
    let top, left;
    const OFFSET = 8; // selection 끝 지점과 약간 떨어뜨림
    const rect = getSelectionBoundingRect();
    if (rect) {
        top = rect.bottom + OFFSET;
        left = rect.right + OFFSET;
    } else if (event) {
        top = event.clientY + 70;
        left = event.clientX + 70;
    } else {
        // 최종 fallback: 화면 중앙
        top = window.innerHeight / 2;
        left = window.innerWidth / 2;
    }

    // Viewport 경계 보정
    if (top > window.innerHeight - 40) top = window.innerHeight - 50;
    if (left > window.innerWidth - 100) left = window.innerWidth - 120;
    if (top < 0) top = 10;
    if (left < 0) left = 10;

    // Create a new button
    let translateButton = document.createElement('button');
    translateButton.id = 'translate-selected-text';
    translateButton.textContent = '번역';
    translateButton.style.position = 'fixed';
    translateButton.style.top = top + 'px';
    translateButton.style.left = left + 'px';
    translateButton.style.zIndex = '2147483647'; // 최상위에 가깝게
    translateButton.style.backgroundColor = '#4CAF50';
    translateButton.style.color = 'white';
    translateButton.style.padding = '5px 10px';
    translateButton.style.border = 'none';
    translateButton.style.borderRadius = '5px';
    translateButton.style.cursor = 'pointer';
    translateButton.style.fontSize = '12px';
    translateButton.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';

    // Prevent the button from being removed when clicked
    translateButton.addEventListener('mousedown', function(e) {
        e.stopPropagation();
    });

    translateButton.addEventListener('click', function(e) {
        e.stopPropagation();
        performSelectionTranslation(selectedText);
        translateButton.remove();
    });

    document.body.appendChild(translateButton);

    // 외부 클릭 시 제거
    setTimeout(() => {
        const clickOutsideHandler = function(e) {
            if (e.target.id !== 'translate-selected-text') {
                let button = document.getElementById('translate-selected-text');
                if (button) {
                    button.remove();
                }
                document.removeEventListener('click', clickOutsideHandler);
            }
        };
        document.addEventListener('click', clickOutsideHandler);
    }, 50);
}

// Function to perform translation of selected text
async function performSelectionTranslation(selectedText, opts = {}) {
    if (!selectedText || isSelectionTranslating) return;
    isSelectionTranslating = true;
    try {
        showLoadingIndicator();
        const translation = await translateText(selectedText);
        hideLoadingIndicator();
        if (translation) {
            displayTranslation(translation, selectedText);
        } else {
            alert('Translation failed.');
        }
    } finally {
        isSelectionTranslating = false;
    }
}

// Function to display translation in a new box
function displayTranslation(translation, originalText = null) {
    // 최근 번역 저장 (복원 기능용)
    if (translation) {
        lastTranslationData.translation = translation;
        lastTranslationData.originalText = originalText;
    }
    // Check if there's already a translation box
    const existingBox = document.getElementById('translation-box');
    
    // Create a new floating tooltip-style box or reuse existing one
    let translationBox;
    if (existingBox) {
        translationBox = existingBox;
        // Clear existing content
        while (translationBox.firstChild) {
            translationBox.removeChild(translationBox.firstChild);
        }
    } else {
        translationBox = getTranslationBoxElement();
    }
    
    // Create a container for the translation text
    const translationText = document.createElement('div');
    // Replace newline characters with <br> tags to preserve paragraph formatting
    const formattedTranslation = translation.replace(/\n/g, '<br>');
    translationText.innerHTML = formattedTranslation;
    
    // Set text direction based on target language (RTL for certain languages)
    chrome.storage.sync.get(['targetLanguage'], ({ targetLanguage }) => {
        const rtlLangs = ['arabic', 'persian', 'farsi', 'urdu', 'hebrew'];
        const lang = (targetLanguage || '').toLowerCase();
        if (rtlLangs.includes(lang)) {
            translationText.style.direction = 'rtl';
            translationText.style.textAlign = 'right';
        } else {
            translationText.style.direction = 'ltr';
            translationText.style.textAlign = 'left';
        }
    });
    
    // Add re-translate button
    const retranslateButton = document.createElement('button');
    retranslateButton.textContent = '재번역';
    retranslateButton.style.marginTop = '10px';
    retranslateButton.style.padding = '5px 10px';
    retranslateButton.style.backgroundColor = '#1d9bf0'; // Twitter blue color
    retranslateButton.style.color = 'white';
    retranslateButton.style.border = 'none';
    retranslateButton.style.borderRadius = '5px';
    retranslateButton.style.cursor = 'pointer';
    retranslateButton.style.fontSize = '13px';
    retranslateButton.style.fontFamily = 'Vazirmatn, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    
    // Only enable retranslate button if we have the original text
    if (originalText) {
        retranslateButton.addEventListener('click', async () => {
            retranslateButton.disabled = true;
            retranslateButton.textContent = '번역 중...';
            
            try {
                // Clear translation cache for this text to get a fresh translation
                translationCache.delete(originalText);
                const newTranslation = await translateText(originalText);
                if (newTranslation) {
                    // Replace newline characters with <br> tags for updated translation
                    const formattedNewTranslation = newTranslation.replace(/\n/g, '<br>');
                    translationText.innerHTML = formattedNewTranslation;
                }
            } catch (error) {
                console.error('Translation error:', error);
                alert('Translation error.');
            } finally {
                retranslateButton.disabled = false;
                retranslateButton.textContent = '재번역';
            }
        });
    } else {
        retranslateButton.disabled = true;
        retranslateButton.style.opacity = '0.5';
    retranslateButton.title = '원문이 없어 재번역 불가';
    }
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.className = 'translation-close-btn';
    
    closeButton.addEventListener('click', () => {
        document.body.removeChild(translationBox);
    });
    
    // Add copy button
    const copyButton = document.createElement('button');
    copyButton.textContent = '복사';
    copyButton.style.marginTop = '10px';
    copyButton.style.marginRight = '10px';
    copyButton.style.padding = '5px 10px';
    copyButton.style.backgroundColor = '#1d9bf0'; // Twitter blue color
    copyButton.style.color = 'white';
    copyButton.style.border = 'none';
    copyButton.style.borderRadius = '5px';
    copyButton.style.cursor = 'pointer';
    copyButton.style.fontSize = '13px';
    copyButton.style.fontFamily = 'Vazirmatn, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    
    copyButton.addEventListener('click', () => {
        // Get all text content from the translation box except for buttons
        let textToCopy = '';
        const walker = document.createTreeWalker(translationBox, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
                // Exclude text nodes that are children of buttons
                return (node.parentNode && node.parentNode.tagName === 'BUTTON') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            }
        });
        let node;
        while (node = walker.nextNode()) {
            textToCopy += node.textContent + '\n';
        }
        textToCopy = textToCopy.trim();
        
        // Use the Clipboard API to copy the text
        navigator.clipboard.writeText(textToCopy).then(() => {
            // Provide visual feedback that text was copied
            const originalText = copyButton.textContent;
            copyButton.textContent = '복사됨!';
            copyButton.style.backgroundColor = '#28a745'; // Green color for success
            
            // Reset button after a short delay
            setTimeout(() => {
                copyButton.textContent = originalText;
                copyButton.style.backgroundColor = '#1d9bf0';
            }, 2000);
        }).catch(err => {
            console.error('Copy error:', err);
            alert('Copy error.');
        });
    });
    
    // Create a container for the buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-start';
    buttonContainer.style.width = '100%';
    
    // Add buttons to the container
    buttonContainer.appendChild(retranslateButton);
    buttonContainer.appendChild(copyButton);
    
    // Add elements to the box
    translationBox.appendChild(closeButton);
    translationBox.appendChild(translationText);
    translationBox.appendChild(buttonContainer);
    
    // Add to the page if it's not already there
    if (!document.body.contains(translationBox)) {
        document.body.appendChild(translationBox);
    }
    
    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Get box dimensions
    const boxRect = translationBox.getBoundingClientRect();
    
    // Use last position if available, otherwise center the box
    let top, left;
    
    if (lastTranslationBoxPosition.positionSet) {
        // Use the last position
        top = lastTranslationBoxPosition.top;
        left = lastTranslationBoxPosition.left;
    } else {
        // Center the box in the viewport
        top = (viewportHeight - boxRect.height) / 2;
        left = (viewportWidth - boxRect.width) / 2;
    }
    
    // Make sure it doesn't go off-screen
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    if (left + boxRect.width > viewportWidth - 10) {
        left = viewportWidth - boxRect.width - 10;
    }
    if (top + boxRect.height > viewportHeight - 10) {
        top = viewportHeight - boxRect.height - 10;
    }
    
    // Apply the position
    translationBox.style.top = `${top}px`;
    translationBox.style.left = `${left}px`;
    
    // Make the box draggable and update position when dragged
    makeDraggable(translationBox, true);
    
    // Add event listener to close on Escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape' && document.body.contains(translationBox)) {
            document.body.removeChild(translationBox);
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Add event listener to close when clicking outside
    const clickOutsideHandler = (e) => {
        if (!translationBox.contains(e.target)) {
            if (document.body.contains(translationBox)) {
                document.body.removeChild(translationBox);
                document.removeEventListener('click', clickOutsideHandler);
            }
        }
    };
    // Delay adding the click handler to prevent immediate closing
    setTimeout(() => {
        document.addEventListener('click', clickOutsideHandler);
    }, 100);
}

// Helper function to create or get existing translation box
function getTranslationBoxElement() {
    injectGlobalStyles(); // Ensure styles are present

    let translationBox = document.getElementById('translation-box');
    if (!translationBox) {
        translationBox = document.createElement('div');
        translationBox.id = 'translation-box';
        document.body.appendChild(translationBox);
        // Add event listeners only when the box is first created
        addTranslationBoxEventListeners(translationBox);
        makeDraggable(translationBox, true); // Enable dragging and save position
    }
    // Clear previous content when reusing
    translationBox.innerHTML = '';
    return translationBox;
}

// Helper function to add event listeners
function addTranslationBoxEventListeners(translationBox) {
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('translation-box')) {
            document.body.removeChild(translationBox);
        }
    });
    
    // Close button click
    const closeButton = translationBox.querySelector('button');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            document.body.removeChild(translationBox);
        });
    }
    
    // Click outside to close
    document.addEventListener('click', (e) => {
        if (translationBox && !translationBox.contains(e.target) && 
            e.target.id !== 'translate-selected-text') {
            if (document.body.contains(translationBox)) {
                document.body.removeChild(translationBox);
            }
        }
    });
    
    // Make box draggable
    makeDraggable(translationBox);
}

// Helper function to adjust translation box position
function adjustTranslationBoxPosition(translationBox) {
    const box = translationBox.getBoundingClientRect();
    const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
    };
    
    let left = (viewport.width - box.width) / 2;
    let top = (viewport.height - box.height) / 2;
    
    if (left < 20) left = 20;
    if (top < 20) top = 20;
    if (left + box.width > viewport.width - 20) {
        left = viewport.width - box.width - 20;
    }
    if (top + box.height > viewport.height - 20) {
        top = viewport.height - box.height - 20;
    }
    
    Object.assign(translationBox.style, {
        left: `${left}px`,
        top: `${top}px`
    });
}

// Helper function to make element draggable
function makeDraggable(element, savePosition = false) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    element.style.cursor = 'move';
    
    element.onmousedown = dragMouseDown;
    
    function dragMouseDown(e) {
        if (e.target.tagName.toLowerCase() === 'button') return;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }
    
    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        const newTop = element.offsetTop - pos2;
        const newLeft = element.offsetLeft - pos1;
        
        if (newTop >= 0 && newTop <= window.innerHeight - element.offsetHeight) {
            element.style.top = newTop + "px";
        }
        if (newLeft >= 0 && newLeft <= window.innerWidth - element.offsetWidth) {
            element.style.left = newLeft + "px";
        }
    }
    
    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        
        // Save the position for future boxes if requested
        if (savePosition) {
            lastTranslationBoxPosition.top = parseInt(element.style.top);
            lastTranslationBoxPosition.left = parseInt(element.style.left);
            lastTranslationBoxPosition.positionSet = true;
        }
    }
}

// Centralized Styles and Box Management
let stylesInjected = false;
const XT_STYLE_ID = 'xtranslator-global-styles';
const XT_FONT_STYLE_ID = 'xtranslator-vazirmatn-font-style';

// Function to inject all necessary CSS styles once
function injectGlobalStyles() {
    if (stylesInjected || document.getElementById(XT_STYLE_ID)) {
        stylesInjected = true;
        return;
    }

    // Add @font-face declaration for Vazirmatn font if not already added
    if (!document.getElementById(XT_FONT_STYLE_ID)) {
        const fontStyle = document.createElement('style');
        fontStyle.id = XT_FONT_STYLE_ID;
        try {
            // Try fetching the font URL via chrome.runtime.getURL
            fontStyle.textContent = `
                /* ========== Vazirmatn ========== */
                @font-face {
                    font-family: "Vazirmatn";
                    src: url("${chrome.runtime.getURL('fonts/Vazirmatn[wght].ttf')}") format("truetype");
                    font-weight: 100 900;
                    font-style: normal;
                    font-display: swap;
                    unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFF;
                }
            `;
            document.head.appendChild(fontStyle);
        } catch (error) {
            console.warn('XTranslator: Could not get font URL via chrome.runtime.getURL. Font may not load.', error);
            // Fallback or alternative handling if needed
        }
    }

    const style = document.createElement('style');
    style.id = XT_STYLE_ID;
    style.textContent = `
        #translation-box {
            position: fixed !important;
            z-index: 999999 !important;
            border-radius: 12px !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22) !important;
            padding: 16px !important;
            max-height: 80vh !important;
            width: 350px !important; /* Default width, adjust as needed */
            max-width: 90vw !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            direction: rtl !important;
            font-family: "Vazirmatn", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
            font-size: 15px !important; /* Base font size */
            line-height: 1.7 !important;
            text-align: right !important;
            animation: translationBoxFadeIn 0.2s ease-out !important;
            box-sizing: border-box !important; /* Include padding/border in width/height */
            background-color: #23272f !important;
            color: #e7e9ea !important;
            border: 1px solid #38444d !important;
        }



        /* Scrollbar */
        #translation-box::-webkit-scrollbar {
            width: 8px !important;
        }
        #translation-box::-webkit-scrollbar-thumb {
             border-radius: 4px !important;
        }

        /* Content Area */
        #translation-box .translation-content {
            font-size: 16px !important; /* Slightly larger for readability */
            line-height: 1.8 !important;
            margin-bottom: 12px !important; /* Space before buttons */
            white-space: pre-wrap !important;
            word-wrap: break-word !important;
            font-family: "Vazirmatn", Tahoma, Arial, sans-serif !important; /* Ensure font */
            direction: rtl !important;
            text-align: right !important;
        }

        /* Close Button */
        #translation-box .translation-close-btn {
            position: absolute !important;
            top: 0px !important;
            left: 0px !important;
            background: none !important;
            border: none !important;
            font-size: 24px !important; /* Larger target */
            cursor: pointer !important;
            padding: 0 !important;
            margin: 0 !important;
            line-height: 1 !important;
            width: 28px !important; /* Slightly larger tap target */
            height: 28px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            border-radius: 50% !important; /* Make it round on hover bg */
            transition: background-color 0.2s ease;
            color: #e7e9ea !important;
        }
        #translation-box .translation-close-btn:hover {
            color: #fff !important;
            background-color: rgba(231, 233, 234, 0.08) !important;
        }

        /* Button Container */
        #translation-box .translation-button-container {
            display: flex !important;
            justify-content: flex-start !important; /* Align buttons to the start (right in RTL) */
            gap: 8px !important; /* Space between buttons */
            margin-top: 8px !important;
        }

        /* General Button Styles */
        #translation-box .translation-button {
            padding: 6px 12px !important;
            border: none !important;
            border-radius: 15px !important; /* Pill shape like Twitter */
            cursor: pointer !important;
            font-size: 13px !important;
            font-weight: bold !important;
            font-family: "Vazirmatn", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
            transition: background-color 0.2s ease;
        }
         #translation-box .translation-button:disabled {
             cursor: default !important;
        }


        /* Fade-in Animation */
        @keyframes translationBoxFadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    document.head.appendChild(style);
    stylesInjected = true;
}

// Function to translate text using Gemini API
const translationCache = new Map();

async function translateText(text) {
    if (translationCache.has(text)) {
        return translationCache.get(text);
    }

    try {
        // Get API key, prompt, and target language from storage
        const { apiKey, translationPrompt, targetLanguage } = await chrome.storage.sync.get(['apiKey', 'translationPrompt', 'targetLanguage']);
        
        if (!apiKey) {
            console.error('API key not found. Please set it in the extension settings.');
            return null;
        }

        if (!translationPrompt) {
            console.error('Translation prompt not found in storage');
            return null;
        }

        let prompt = translationPrompt;
        prompt = prompt.replace('<TEXT>', text);
    prompt = prompt.replace(/<LANGUAGE>/g, targetLanguage || 'Korean');

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{
                parts: [{ text: prompt }]
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.status === 429) {
            // Rate limit hit - wait and retry
            await new Promise(resolve => setTimeout(resolve, 2000));
            return translateText(text);
        }

        if (!response.ok) {
            throw new Error(`Translation failed: ${response.status}`);
        }

        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (error) {
        console.warn('Error translating:', error.message);
        return null;
    }
}

async function performTranslation(tweet, textContent, lang, button) {
    // Store original text to restore it later
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '번역 중...';

    try {
        const translation = await translateText(textContent);
        if (translation) {
            // Use our unified displayTranslation function
            displayTranslation(translation, textContent);
        } else {
                alert('Translation failed.');
        }
    } catch (error) {
        console.error('Translation error:', error);
            alert('Translation error.');
    } finally {
        button.disabled = false;
        button.textContent = originalText; // Restore the original button text
    }
}

// Function to check if we're on Twitter/X
function isTwitterSite() {
    return window.location.hostname === 'twitter.com' || window.location.hostname === 'x.com';
}

// Function to add translation buttons below non-Persian tweets
async function addTranslateButtons() {
    // Only add tweet translation buttons on Twitter/X
    if (!isTwitterSite()) {
        return;
    }

    // Get the user-selected language to exclude
    const { excludeTweetLang } = await chrome.storage.sync.get(['excludeTweetLang']);
    
    const tweets = Array.from(document.querySelectorAll('article')).map(article => {
        // Build selector: if excludeTweetLang, exclude that lang; otherwise, select all
        let selector = 'div[dir="auto"]';
        if (excludeTweetLang) {
            selector += `:not([lang="${excludeTweetLang}"])`;
        }
        const candidates = Array.from(article.querySelectorAll(selector));
        // Exclude divs that are inside a quoted tweet (which are nested articles)
        const mainCandidates = candidates.filter(div => !div.closest('article article'));
        // Only pick the first one, which is the main tweet text
        return mainCandidates[0];
    }).filter(Boolean);

    for (const tweet of tweets) {
        // Find the tweet action bar
        let tweetActionsEl = tweet.closest('article')?.querySelector('[role="group"]');
        if (!tweetActionsEl) continue;

        // Prevent duplicate: check if a translate button already exists in this action bar
        if (tweetActionsEl.querySelector('.translate-button')) continue;

        // Try to find the timestamp element to position our button near it
        let timestampEl = tweet.closest('article')?.querySelector('time');
        
        // Create the button with a more button-like appearance
        const button = document.createElement('button');
        button.className = 'translate-button';
        button.style.display = 'inline-flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.backgroundColor = 'transparent';
        button.style.color = '#1d9bf0'; // Twitter blue
        button.style.border = '1px solid #1d9bf0'; // Add border back for button-like appearance
        button.style.borderRadius = '4px';
        button.style.cursor = 'pointer';
        button.style.textAlign = 'center';
        button.style.lineHeight = '1';
        button.style.transition = 'all 0.2s';
        button.style.margin = '0 4px 0 0';
        button.style.padding = '1px 4px';
        button.style.height = '18px';
        button.style.fontSize = '11px';
        button.style.fontWeight = 'bold';

        // Responsive: icon-only and compact on small screens
        function setButtonStyle() {
            if (window.innerWidth < 600) {
                // Icon only: Use bold T for Translate
                button.innerHTML = '<span style="font-weight:bold;font-size:11px;line-height:1;color:#1d9bf0;">번</span>';
                button.title = '번역';
                button.style.padding = '1px 4px';
                button.style.margin = '0 4px 0 0';
                button.style.fontSize = '0px'; // Hide text
                button.style.width = '16px';
                button.style.height = '16px';
                button.style.border = '1px solid #1d9bf0';
                button.style.borderRadius = '4px';
                button.style.display = 'inline-flex';
                button.style.alignItems = 'center';
                button.style.justifyContent = 'center';
            } else {
                button.innerHTML = '번역';
                button.title = '번역';
                button.style.padding = '1px 4px';
                button.style.margin = '0 4px 0 0';
                button.style.fontSize = '11px';
                button.style.fontWeight = 'bold';
                button.style.height = '18px';
                button.style.width = 'auto';
                button.style.border = '1px solid #1d9bf0';
                button.style.borderRadius = '4px';
                button.style.display = 'inline-flex';
                button.style.alignItems = 'center';
                button.style.justifyContent = 'center';
            }
        }
        setButtonStyle();
        window.addEventListener('resize', setButtonStyle);
        // Add hover effect
        button.addEventListener('mouseover', () => {
            button.style.backgroundColor = 'rgba(29, 155, 240, 0.1)';
        });
        
        button.addEventListener('mouseout', () => {
            button.style.backgroundColor = 'transparent';
        });
        
        // Add a data attribute to the tweet
        tweet.dataset.tweetIndex = tweet.dataset.tweetIndex || Math.random().toString(36).substring(2, 9);

        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            
            // Find the specific tweet text element to avoid capturing UI elements
            const tweetTextEl = tweet.closest('article').querySelector('[data-testid="tweetText"]');
            let textContent = '';
            
            if (tweetTextEl) {
                // Use the dedicated tweet text element if found
                textContent = tweetTextEl.textContent.trim();
            } else {
                // Fallback to the tweet element but try to avoid capturing UI text
                textContent = tweet.textContent.trim();
            }
            
            const lang = tweet.getAttribute('lang');
            await performTranslation(tweet, textContent, lang, button);
            // Restore button content after translation completes
            setButtonStyle();
        });
        
        // Add event listeners to prevent event propagation
        button.addEventListener('mousedown', (e) => e.stopPropagation());
        button.addEventListener('mouseup', (e) => e.stopPropagation());
        button.addEventListener('touchstart', (e) => e.stopPropagation());
        button.addEventListener('touchend', (e) => e.stopPropagation());
        
        // Create a container for the button that prevents event bubbling
        const container = document.createElement('div');
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center'; // Center vertically
        container.style.height = '100%'; // Match height of parent
        container.style.justifyContent = 'center'; // Center horizontally
        container.appendChild(button);
        
        // Stop propagation on the container too
        container.addEventListener('click', (e) => e.stopPropagation());
        container.addEventListener('mousedown', (e) => e.stopPropagation());
        container.addEventListener('mouseup', (e) => e.stopPropagation());
        
        // Insert the button in a suitable location
        if (tweetActionsEl) {
            // Create a wrapper div that matches Twitter's action button containers
            const actionWrapper = document.createElement('div');
            actionWrapper.className = 'translate-action-wrapper';
            actionWrapper.style.display = 'flex';
            actionWrapper.style.alignItems = 'center';
            actionWrapper.style.height = '100%';
            actionWrapper.style.marginRight = '4px';
            
            // Add the container to the wrapper
            actionWrapper.appendChild(container);
            
            // Place with tweet actions to avoid link conflicts
            tweetActionsEl.insertBefore(actionWrapper, tweetActionsEl.firstChild);
        } else {
            // Fallback: append to the tweet in an unobtrusive way
            const fallbackContainer = document.createElement('div');
            fallbackContainer.style.display = 'flex';
            fallbackContainer.style.alignItems = 'center';
            fallbackContainer.style.justifyContent = 'flex-start';
            fallbackContainer.style.marginTop = '4px';
            fallbackContainer.appendChild(button);
            
            // Find a good place to insert it
            const contentContainer = tweet.closest('article')?.querySelector('[data-testid="tweetText"]') || tweet;
            contentContainer.parentNode.insertBefore(fallbackContainer, contentContainer.nextSibling);
        }
    }
}

// Only observe DOM changes for tweet buttons on Twitter/X
if (isTwitterSite()) {
    const observer = new MutationObserver(debounce((mutations) => {
        addTranslateButtons();
    }, 250));

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Function to check if the current page is a PDF
function isPdfPage() {
    return window.location.href.toLowerCase().endsWith('.pdf') || 
           document.contentType === 'application/pdf' ||
           document.querySelector('embed[type="application/pdf"]') !== null ||
           document.querySelector('object[type="application/pdf"]') !== null ||
           document.querySelector('iframe[src*=".pdf"]') !== null;
}

// Function to add PDF translation button
function addPdfTranslationButton() {
    // Remove existing button if any
    const existingButton = document.getElementById('pdf-translate-button');
    if (existingButton) existingButton.remove();
    
    // Create the button
    const translateButton = document.createElement('button');
    translateButton.id = 'pdf-translate-button';
    translateButton.textContent = 'PDF 번역';
    translateButton.style.position = 'fixed';
    translateButton.style.top = '20px';
    translateButton.style.right = '180px';
    translateButton.style.zIndex = '999999';
    translateButton.style.padding = '8px 16px';
    translateButton.style.backgroundColor = '#01afbe';
    translateButton.style.color = 'white';
    translateButton.style.border = 'none';
    translateButton.style.borderRadius = '4px';
    translateButton.style.cursor = 'pointer';
    translateButton.style.fontFamily = 'Tahoma, Arial, sans-serif';
    translateButton.style.fontSize = '14px';
    translateButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    
    // Add hover effect
    translateButton.addEventListener('mouseover', () => {
        translateButton.style.backgroundColor = '#13cbe0';
    });
    
    translateButton.addEventListener('mouseout', () => {
        translateButton.style.backgroundColor = '#01afbe';
    });
    
    // Add click event - show menu to choose mode
    // Helper to remove menu and its outside click listener
    function removeMenuAndListener() {
        const existingMenu = document.getElementById('pdf-translate-menu');
        if (existingMenu) existingMenu.remove();
        document.removeEventListener('pointerdown', outsideClickListener, true);
    }

    function outsideClickListener(event) {
        const menu = document.getElementById('pdf-translate-menu');
        // If no menu or click inside menu or on button, do nothing
        if (!menu || menu.contains(event.target) || event.target === translateButton) return;
        removeMenuAndListener();
    }

    translateButton.addEventListener('click', function(e) {
        e.stopPropagation();
        const existingMenu = document.getElementById('pdf-translate-menu');
        if (existingMenu) {
            removeMenuAndListener();
            return;
        }
        // Otherwise, open the menu
        const menu = document.createElement('div');
        menu.id = 'pdf-translate-menu';
        menu.style.position = 'fixed';
        menu.style.top = (translateButton.offsetTop + translateButton.offsetHeight + 8) + 'px';
        menu.style.right = (parseInt(translateButton.style.right, 10)) + 'px';
        menu.style.background = '#fff';
        menu.style.border = '1px solid #ccc';
        menu.style.borderRadius = '6px';
        menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        // Prevent clicks inside menu from closing it
        menu.addEventListener('pointerdown', function(ev) { ev.stopPropagation(); }, true);
        // Add menu to DOM
        document.body.appendChild(menu);
        // Delay outside click activation to avoid immediate close
        setTimeout(() => {
            document.addEventListener('pointerdown', outsideClickListener, true);
        }, 0);
        // If menu is removed by any means, clean up listener
        const observer = new MutationObserver(() => {
            if (!document.body.contains(menu)) {
                document.removeEventListener('pointerdown', outsideClickListener, true);
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true });

        menu.style.right = (parseInt(translateButton.style.right, 10)) + 'px';
        menu.style.background = '#fff';
        menu.style.border = '1px solid #ccc';
        menu.style.borderRadius = '6px';
        menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        menu.style.zIndex = '1000000';
        menu.style.minWidth = '170px';
        menu.style.fontFamily = 'Tahoma, Arial, sans-serif';
        menu.style.padding = '0.5em 0';

        // Option 1: Translate visible page
        const pageOption = document.createElement('div');
    pageOption.textContent = '현재 보이는 페이지 번역';
        pageOption.style.padding = '8px 16px';
        pageOption.style.cursor = 'pointer';
        pageOption.addEventListener('mouseover', () => pageOption.style.background = '#f0f0f0');
        pageOption.addEventListener('mouseout', () => pageOption.style.background = '');
        pageOption.onclick = function() {
            menu.remove();
            captureAndTranslatePdf();
        };
        menu.appendChild(pageOption);

        // Option 2: Area selection
        const areaOption = document.createElement('div');
    areaOption.textContent = '영역 선택 후 번역';
        areaOption.style.padding = '8px 16px';
        areaOption.style.cursor = 'pointer';
        areaOption.addEventListener('mouseover', () => areaOption.style.background = '#f0f0f0');
        areaOption.addEventListener('mouseout', () => areaOption.style.background = '');
        areaOption.onclick = function() {
            menu.remove();
            startAreaSelection();
        };
        menu.appendChild(areaOption);

        // Remove menu when clicking outside
        setTimeout(() => {
            document.addEventListener('mousedown', function handler(ev) {
                if (!menu.contains(ev.target) && ev.target !== translateButton) {
                    menu.remove();
                    document.removeEventListener('mousedown', handler);
                }
            });
        }, 0);

        document.body.appendChild(menu);
    });
    
    // Add to the page
    document.body.appendChild(translateButton);
}

// Check for PDF and add translation button
function checkForPdfAndAddButton() {
    if (isPdfPage()) {
        console.log('PDF detected, adding translation button');
        addPdfTranslationButton();
    }
}

// Initial check when the script loads
checkForPdfAndAddButton();

// Check when the page loads
document.addEventListener('DOMContentLoaded', checkForPdfAndAddButton);

// Re-check periodically (some PDFs might load dynamically)
setInterval(checkForPdfAndAddButton, 2000);

// Re-check when the URL changes (for SPA)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(checkForPdfAndAddButton, 1000);
    }
}).observe(document, { subtree: true, childList: true });

// Function to capture and translate PDF (visible page)
async function captureAndTranslatePdf() {
    console.log('Starting PDF translation process');
    showLoadingIndicator();
    
    try {
        chrome.runtime.sendMessage({
            action: 'captureVisibleTab'
        }, async function(response) {
            if (response && response.imageDataUrl) {
                console.log('Screenshot captured, starting translation');
                const translation = await translateImage(response.imageDataUrl);
                hideLoadingIndicator();
                    if (translation) {
                        displayTranslation(translation);
                    } else {
                        alert('번역에 실패했습니다.');
                }
            } else {
                hideLoadingIndicator();
                console.error('Failed to capture screenshot:', response?.error);
                alert('이미지 캡처 실패.');
            }
        });
    } catch (error) {
        hideLoadingIndicator();
        console.error('Error capturing full page:', error);
    alert('페이지 캡처 오류: ' + error.message);
    }
}

// Function to start area selection
function startAreaSelection() {
    console.log('Starting area selection');
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'selection-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
    overlay.style.zIndex = '999998';
    overlay.style.cursor = 'crosshair';
    
    // Create selection box
    const selectionBox = document.createElement('div');
    selectionBox.id = 'selection-box';
    selectionBox.style.position = 'fixed';
    selectionBox.style.border = '2px dashed #fff';
    selectionBox.style.backgroundColor = 'rgba(117, 158, 0, 0.2)';
    selectionBox.style.display = 'none';
    selectionBox.style.zIndex = '999999';
    
    // Create instruction text
    const instruction = document.createElement('div');
        instruction.textContent = 'Select the area to translate by dragging. Cancel with ESC.';
    instruction.style.position = 'fixed';
    instruction.style.top = '10px';
    instruction.style.left = '50%';
    instruction.style.transform = 'translateX(-50%)';
    instruction.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    instruction.style.color = 'white';
    instruction.style.padding = '10px 15px';
    instruction.style.borderRadius = '5px';
    instruction.style.zIndex = '1000000';
    instruction.style.fontFamily = 'Tahoma, Arial, sans-serif';
    
    // Add elements to page
    document.body.appendChild(overlay);
    document.body.appendChild(selectionBox);
    document.body.appendChild(instruction);
    
    let isSelecting = false;
    let startX = 0;
    let startY = 0;
    
    function cleanup() {
        // Remove event listeners
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('keydown', handleKeyDown);
        
        // Remove elements
        overlay.remove();
        selectionBox.remove();
        instruction.remove();
    }
    
    function handleKeyDown(e) {
        if (e.key === 'Escape') {
            cleanup();
        }
    }
    
    function handleMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();
        
        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;
        
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        selectionBox.style.width = '0';
        selectionBox.style.height = '0';
        selectionBox.style.display = 'block';
    }
    
    function handleMouseMove(e) {
        if (!isSelecting) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        const currentX = e.clientX;
        const currentY = e.clientY;
        
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        
        const left = Math.min(currentX, startX);
        const top = Math.min(currentY, startY);
        
        selectionBox.style.left = left + 'px';
        selectionBox.style.top = top + 'px';
        selectionBox.style.width = width + 'px';
        selectionBox.style.height = height + 'px';
    }
    
    function handleMouseUp(e) {
        if (!isSelecting) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        isSelecting = false;
        
        const width = parseInt(selectionBox.style.width);
        const height = parseInt(selectionBox.style.height);
        
        if (width >= 10 && height >= 10) {
            const rect = {
                left: parseInt(selectionBox.style.left),
                top: parseInt(selectionBox.style.top),
                width: width,
                height: height
            };
            
            cleanup();
            captureSelectedArea(rect);
        } else {
            cleanup();
        }
    }
    
    // Add event listeners
    document.addEventListener('keydown', handleKeyDown);
    overlay.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Prevent text selection
    overlay.addEventListener('selectstart', e => e.preventDefault());
}

// Function to capture selected area
async function captureSelectedArea(rect) {
    console.log('Capturing selected area:', rect);
    showLoadingIndicator();
    
    try {
        chrome.runtime.sendMessage({
            action: 'captureVisibleTab',
            area: rect
        }, async function(response) {
            if (chrome.runtime.lastError) {
                console.error('Chrome runtime error:', chrome.runtime.lastError);
                hideLoadingIndicator();
                alert('Error capturing image: ' + chrome.runtime.lastError.message);
                return;
            }
            
            if (response && response.imageDataUrl) {
                console.log('Area captured, starting translation');
                const translation = await translateImage(response.imageDataUrl);
                hideLoadingIndicator();
                if (translation) {
                    displayTranslation(translation);
                } else {
                    alert('Translation failed.');
                }
            } else {
                hideLoadingIndicator();
                console.error('Failed to capture area:', response?.error);
                alert('Failed to capture image.');
            }
        });
    } catch (error) {
        hideLoadingIndicator();
        console.error('Error capturing selected area:', error);
        alert('Error capturing area: ' + error.message);
    }
}

// Function to translate image using Gemini API
async function translateImage(imageDataUrl) {
    console.log('Starting image translation');
    const { apiKey, translationPrompt, targetLanguage } = await chrome.storage.sync.get(['apiKey', 'translationPrompt', 'targetLanguage']);
    const selectedLanguage = targetLanguage || 'Korean';

    if (!apiKey) {
        console.error('API key not found');
        alert('Please enter your API Key in the extension settings.');
        return null;
    }
    
    let prompt = translationPrompt || DEFAULT_IMAGE_TRANSLATION_PROMPT;
    prompt = prompt.replace(/<LANGUAGE>/g, targetLanguage);

    const base64Image = imageDataUrl.split(',')[1];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    try {
        console.log('Sending request to Gemini API');
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: "image/png",
                                data: base64Image
                            }
                        }
                    ]
                }]
            })
        });

        if (response.status === 429) {
            console.log('Rate limit hit, retrying...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            return translateImage(imageDataUrl);
        }

        if (!response.ok) {
            throw new Error(`Translation failed: ${response.status}`);
        }

        const result = await response.json();
        console.log('Translation completed successfully');
        return result.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (error) {
        console.error('Translation error:', error);
        return null;
    }
}

// Function to show loading indicator (with progress span)
function showLoadingIndicator() {
    const existingIndicator = document.getElementById('translation-loading');
    if (existingIndicator) existingIndicator.remove();

    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'translation-loading';
    loadingIndicator.style.position = 'fixed';
    loadingIndicator.style.top = '50%';
    loadingIndicator.style.left = '50%';
    loadingIndicator.style.transform = 'translate(-50%, -50%)';
    loadingIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    loadingIndicator.style.color = 'white';
    loadingIndicator.style.padding = '20px';
    loadingIndicator.style.borderRadius = '10px';
    loadingIndicator.style.zIndex = '1000000';
    loadingIndicator.style.textAlign = 'center';
    loadingIndicator.style.fontFamily = 'Tahoma, Arial, sans-serif';
    loadingIndicator.style.transition = 'opacity 0.4s ease';

    const spinner = document.createElement('div');
    spinner.style.border = '4px solid rgba(255, 255, 255, 0.3)';
    spinner.style.borderTop = '4px solid #fff';
    spinner.style.borderRadius = '50%';
    spinner.style.width = '30px';
    spinner.style.height = '30px';
    spinner.style.animation = 'spin 1s linear infinite';
    spinner.style.margin = '0 auto 10px auto';

    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

    const text = document.createElement('div');
    text.id = 'translation-loading-text';
    text.textContent = 'Translating...';
    const progress = document.createElement('div');
    progress.id = 'translation-loading-progress';
    progress.style.marginTop = '4px';
    progress.style.fontSize = '12px';
    progress.style.opacity = '0.85';
    progress.textContent = '';

    loadingIndicator.appendChild(spinner);
    loadingIndicator.appendChild(text);
    loadingIndicator.appendChild(progress);
    document.body.appendChild(loadingIndicator);
}

function updateLoadingIndicatorProgress(done, total) {
    const progressEl = document.getElementById('translation-loading-progress');
    if (!progressEl) return;
    if (total) {
        progressEl.textContent = `${done}/${total}`;
    } else {
        progressEl.textContent = '';
    }
}

function finishAndFadeLoadingIndicator(success, total, failureCount=0) {
    const root = document.getElementById('translation-loading');
    if (!root) return;
    const spinner = root.querySelector('div');
    if (spinner) spinner.style.animation = 'none';
    const mainText = document.getElementById('translation-loading-text');
    if (mainText) mainText.textContent = `완료 ${success}/${total}` + (failureCount?` (실패 ${failureCount})`: '');
    updateLoadingIndicatorProgress(success, total);
    setTimeout(()=>{ if(root){ root.style.opacity='0'; setTimeout(()=>hideLoadingIndicator(),400);} }, 300);
}

// Function to hide loading indicator
function hideLoadingIndicator() {
    const loadingIndicator = document.getElementById('translation-loading');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }
}

// ================= In-place Full Page Translation =================
let inplaceTranslationState = {
    active: false,
    // Array of {node, originalText, translatedText}
    entries: [],
    translating: false,
    processedNodes: null // WeakSet 저장 (초기/백필 구분)
};
// 화면 내 + 추가로 아래쪽 일부만 번역하기 위한 배수 (필요시 조정 가능)
const INPLACE_MAX_VIEWPORT_MULTIPLIER = 8; // 뷰포트 높이의 8배 지점까지 (사용자 설정)
const INPLACE_TOP_BUFFER = 150; // 뷰포트 위로 이 정도까지는 포함 (스크롤로 살짝 올린 영역)
// 텍스트 노드 1개 == 1 API 호출 (사용자 요구). 과도한 비용/429 방지를 위해 안전 동시성 제한 적용.
const CONCURRENCY_LIMIT = 60; // 안전한 기본 동시성 (이 값을 올려도 내부 가드 적용)
// getCachedTranslation: 상단 기존 translationCache 활용
async function getCachedTranslation(text){
    if (translationCache.has(text)) return translationCache.get(text);
    const p = translateText(text).then(r=>{ if(r==null) translationCache.delete(text); return r; });
    translationCache.set(text,p);
    return p;
}

// 가시성 판별 헬퍼 (display/visibility/opacity/aria-hidden/hidden)
function isElementVisible(el) {
    if (!el) return false;
    let cur = el;
    while (cur && cur !== document.documentElement) {
        if (cur.nodeType !== 1) { cur = cur.parentElement; continue; }
        if (cur.hasAttribute('hidden')) return false;
        if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(cur);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        cur = cur.parentElement;
    }
    return true;
}

async function toggleInplaceFullPageTranslation() {
    if (inplaceTranslationState.translating) return;
    if (inplaceTranslationState.active) {
        // 이미 활성: 추가 보이는 노드만 번역
        await translateMoreVisibleNodes();
        return;
    }
    inplaceTranslationState.translating = true;
    inplaceTranslationState.active = true;
    showLoadingIndicator();
    let watchdogTimer = null;
    try {
        // 처리 루트 결정 (Twitter / Reddit은 본문/댓글 영역만)
        const roots = getInplaceRootNodes();
        const lowerLimitPx = window.innerHeight * INPLACE_MAX_VIEWPORT_MULTIPLIER; // 아래 한계
    const textNodeSet = new Set();
    const textNodes = [];
    // Reddit 은 먼저 canonical 컨테이너에서 수집(중복 감소)
    if (isRedditSite()) {
        const redditCanon = collectCanonicalRedditTextNodes(new WeakSet());
        redditCanon.forEach(n=>{ if(!textNodeSet.has(n)){ textNodeSet.add(n); textNodes.push(n);} });
    }
        for (const root of roots) {
            if (!root) continue;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
                    const text = node.nodeValue.trim();
                    if (!text) return NodeFilter.FILTER_REJECT;
                    const parentEl = node.parentElement;
                    const parentTag = parentEl?.tagName;
                    if (parentEl && (parentEl.closest('#inplace-toggle-restore-btn') || parentEl.closest('#inplace-load-more-btn') || parentEl.closest('#translate-selected-text'))) return NodeFilter.FILTER_REJECT;
                    // --- Twitter 전용: 본문(tweetText) 안의 텍스트만 허용 (닉네임/메뉴/버튼 등 전부 제외) ---
                    if (isTwitterSite()) {
                        if (!parentEl || !parentEl.closest('[data-testid="tweetText"]')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                    }
                    if (['SCRIPT','STYLE','NOSCRIPT','IFRAME','CANVAS','CODE','PRE'].includes(parentTag)) return NodeFilter.FILTER_REJECT;
                    if (parentEl?.id === 'translation-box' || parentEl?.id === 'translate-selected-text') return NodeFilter.FILTER_REJECT;
                    if (text.length < 2) return NodeFilter.FILTER_REJECT;
                    // Reddit/Twitter 사이드바(aside, role=complementary) 포함 영역 제외
                    if (parentEl && (parentEl.closest('aside') || parentEl.closest('[role="complementary"]'))) return NodeFilter.FILTER_REJECT;
                    // Reddit 본문은 깊은 shadow/wrapper 구조로 rect 0 나올 수 있어 예외 허용
                    let allowIfRectZero = false;
                    if (isRedditSite() && parentEl && parentEl.closest('[data-test-id="post-content"], shreddit-post, [data-testid="post-container"], shreddit-comment')) {
                        allowIfRectZero = true;
                    }
                    try {
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        const rect = range.getBoundingClientRect();
                        if (rect.bottom < -INPLACE_TOP_BUFFER) return NodeFilter.FILTER_REJECT;
                        if (rect.top > lowerLimitPx) return NodeFilter.FILTER_REJECT;
                        if (rect.width === 0 && rect.height === 0 && !allowIfRectZero) return NodeFilter.FILTER_REJECT;
                    } catch (e) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            while (walker.nextNode()) {
                const n = walker.currentNode;
                if (!textNodeSet.has(n)) {
                    textNodeSet.add(n);
                    textNodes.push(n);
                }
            }
        }
    // Single batch 여부 판단
    const totalChars = textNodes.reduce((sum,n)=>sum + (n.nodeValue?.length||0),0);

        const { translationPrompt, targetLanguage, apiKey } = await chrome.storage.sync.get(['translationPrompt','targetLanguage','apiKey']);
        if (!apiKey || !translationPrompt) {
            alert('API Key 또는 번역 프롬프트가 설정되지 않았습니다.');
            hideLoadingIndicator();
            inplaceTranslationState.translating = false;
            return;
        }

        const allEntries = [];
        const processedNodeSet = new WeakSet();

        // ========== 블록 단위 그룹핑 ========== //
        const BLOCK_TAGS = new Set(['P','DIV','LI','ARTICLE','SECTION','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','DD','DT','FIGCAPTION']);
        function findBlockContainer(el){
            let cur = el;
            while (cur && cur !== document.body) {
                if (cur.getAttribute && (cur.getAttribute('data-testid')==='tweetText')) return cur; // 트위터 본문
                if (isRedditSite()) {
                    if (cur.matches('[data-testid="comment"], shreddit-comment, [data-test-id="comment"], [data-testid="post-container"], [data-test-id="post-content"], shreddit-post')) return cur;
                }
                if (BLOCK_TAGS.has(cur.tagName)) return cur;
                cur = cur.parentElement;
            }
            return el || document.body;
        }
        let groups = [];
        if (isRedditSite()) {
            // Reddit: canonical 컨테이너 단위 1그룹씩만 (과다 그룹/호출 감소)
            const containerSelectors = '[data-test-id="post-content"], [data-testid="post-container"], shreddit-post, shreddit-comment, [data-test-id="comment"], [data-testid="comment"]';
            const containers = Array.from(new Set(Array.from(document.querySelectorAll(containerSelectors))));
            let orderSeq = 0;
            containers.forEach(c=>{
                // 사이드바/광고 제외
                if (c.closest('aside,[role="complementary"], nav')) return;
                const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
                const nodes=[];
                while (walker.nextNode()) {
                    const n=walker.currentNode; if(!n.nodeValue) continue; const t=n.nodeValue.trim(); if(t.length<2) continue; if (processedNodeSet.has(n)) continue;
                    // 코드/버튼 등 제외
                    const pe=n.parentElement; if(!pe) continue; if(pe.closest('code,pre,script,style,button,textarea,input')) continue;
                    nodes.push(n);
                }
                if(!nodes.length) return;
                groups.push({nodes, order: orderSeq++});
            });
            groups.sort((a,b)=>a.order-b.order);
        } else {
            const groupMap = new Map(); // containerEl -> {nodes:[], order:index}
            let orderSeq = 0;
            for (const tn of textNodes){
                const parentEl = tn.parentElement;
                const container = findBlockContainer(parentEl);
                if (!groupMap.has(container)) groupMap.set(container,{nodes:[], order:orderSeq++});
                groupMap.get(container).nodes.push(tn);
            }
            groups = Array.from(groupMap.values()).sort((a,b)=>a.order-b.order);
        }
        const MARKER = '<<<§§§>>>';
        const groupTasks = [];
        for (const g of groups){
            const useful = g.nodes.filter(n=>{ const t=n.nodeValue.trim(); return t.length>1; });
            if (!useful.length) continue;
            const filtered = useful.filter(n=>!processedNodeSet.has(n));
            if (!filtered.length) continue;
            // Reddit: 컨테이너 전체를 1 그룹으로 그대로 번역 (내부 중복 텍스트도 같이 처리)
            const originalTexts = filtered.map(n=>n.nodeValue);
            const concat = originalTexts.join(MARKER);
            if (concat.trim().length<2) continue;
            groupTasks.push({nodes: filtered, concat});
        }
        let successCount = 0;
        let finishedCount = 0;
        updateLoadingIndicatorProgress(0, groupTasks.length);

        // per-task timeout helper
        async function translateWithTimeout(text, ms) {
            return await Promise.race([
                translateText(text),
                new Promise(resolve => setTimeout(() => resolve(null), ms))
            ]);
        }
        // 모든 노드 즉시 병렬 실행 (사용자 요구) - 매우 많을 경우 429/과금 급증 가능
        watchdogTimer = setTimeout(() => {
            if (inplaceTranslationState.translating) {
                console.warn('Watchdog: forcing translation finalize');
                hideLoadingIndicator();
                inplaceTranslationState.translating = false;
                inplaceTranslationState.active = true;
                inplaceTranslationState.entries = allEntries;
                inplaceTranslationState.processedNodes = processedNodeSet;
                addInplaceToggleButton();
                ensureLoadMoreScrollListener();
                maybeShowLoadMoreButton();
            }
        }, 90000); // 90초 안전 타임아웃
        await Promise.all(groupTasks.map(async (g, idx) => {
            const rawTranslation = await translateWithTimeout(g.concat, 15000);
            finishedCount++;
            if (!rawTranslation){
                if (finishedCount % 10 === 0 || finishedCount === groupTasks.length) updateLoadingIndicatorProgress(successCount, groupTasks.length);
                return;
            }
            // 마커 분해 시도
            let distributed = false;
            if (rawTranslation.includes(MARKER)) {
                const parts = rawTranslation.split(MARKER);
                if (parts.length === g.nodes.length) {
                    for (let i=0;i<g.nodes.length;i++) {
                        const node = g.nodes[i];
            if (!node) continue;
                        const originalText = node.nodeValue;
                        node.nodeValue = parts[i];
                        allEntries.push({ node, originalText, translatedText: node.nodeValue });
                        processedNodeSet.add(node);
                    }
                    distributed = true;
                }
            }
            if (!distributed) {
                // 그룹 전체 번역을 첫 노드에만 반영, 나머지는 공백 처리 (중복 출력 방지)
                const first = g.nodes[0];
        if (!first) return;
                const originalFirst = first.nodeValue;
                first.nodeValue = rawTranslation;
                allEntries.push({ node:first, originalText: originalFirst, translatedText: first.nodeValue });
                processedNodeSet.add(first);

                // 활성 상태인데 버튼이 우연히 제거(사이트 SPA 업데이트 등)된 경우 자동 복원
                setInterval(()=>{
                    try {
                        if (inplaceTranslationState.active && !inplaceTranslationState.translating) {
                            if (!document.getElementById('inplace-toggle-restore-btn')) {
                                addInplaceToggleButton();
                            }
                        }
                    } catch(e) { /* ignore */ }
                }, 3000);
                for (let i=1;i<g.nodes.length;i++) {
                    const node = g.nodes[i];
                    const originalText = node.nodeValue;
                    node.nodeValue = '';
                    allEntries.push({ node, originalText, translatedText: node.nodeValue });
                    processedNodeSet.add(node);
                }
            }
            successCount++;
            if (finishedCount % 10 === 0 || finishedCount === groupTasks.length) updateLoadingIndicatorProgress(successCount, groupTasks.length);
        }));
        // 표시: 완료 상태
    try { finishAndFadeLoadingIndicator(successCount, groupTasks.length, groupTasks.length - successCount); } catch(e) {}
        // ====== 후처리: 트위터 메인 트윗 & GitHub README 누락 보강 ======
        try {
            await postProcessEnsureTwitterAndGithub(processedNodeSet, apiKey, translationPrompt, targetLanguage || 'Korean');
        } catch (ppErr) {
            console.warn('Post-process ensure failed', ppErr);
        }
    inplaceTranslationState.entries = allEntries;
    inplaceTranslationState.active = true;
    inplaceTranslationState.processedNodes = processedNodeSet;
    // no toggle button (removed)
        ensureLoadMoreScrollListener();
        maybeShowLoadMoreButton();
    } catch (e) {
        console.error('In-place translation error', e);
        alert('페이지 번역 중 오류: '+ e.message);
    } finally {
        if (watchdogTimer) clearTimeout(watchdogTimer);
    // 약간의 지연 후 로딩 인디케이터 제거 (사용자가 완료 숫자 인지할 시간)
    // fade 처리가 이미 진행됐을 수 있음 (이중 제거 방지)
    setTimeout(()=>hideLoadingIndicator(), 800);
        inplaceTranslationState.translating = false;
    updateLoadingIndicatorProgress(0, 0);
    }
}

// (원본 토글 기능 제거됨)

// URL 변경(SPA) 감지하여 번역 상태 초기화 (필요시 재번역 가능)
let __xt_last_url = location.href;
new MutationObserver(()=>{
    if (location.href !== __xt_last_url) {
        const prev = __xt_last_url;
        __xt_last_url = location.href;
        // 페이지 바뀌면 기존 번역 복원 후 상태 초기화
        if (inplaceTranslationState.active) {
            inplaceTranslationState.entries.forEach(entry=>{
                if (entry.node && entry.node.isConnected && typeof entry.originalText === 'string') entry.node.nodeValue = entry.originalText;
            });
        }
        inplaceTranslationState.active = false;
        inplaceTranslationState.entries = [];
        inplaceTranslationState.processedNodes = null;
    }
}).observe(document, {subtree:true, childList:true});

// History API hook (pushState/replaceState/popstate) to reset translation state on SPA navigations
['pushState','replaceState'].forEach(fn=>{
    const orig = history[fn];
    history[fn] = function(...args){
        const ret = orig.apply(this,args);
        window.dispatchEvent(new Event('xt-route-change')); return ret;
    };
});
window.addEventListener('popstate', ()=>window.dispatchEvent(new Event('xt-route-change')));
window.addEventListener('xt-route-change', ()=>{
    if (location.href !== __xt_last_url) {
        __xt_last_url = location.href;
        if (inplaceTranslationState.active) {
            inplaceTranslationState.entries.forEach(entry=>{
                if (entry.node && entry.node.isConnected && typeof entry.originalText === 'string') entry.node.nodeValue = entry.originalText;
            });
        }
        inplaceTranslationState.active = false;
        inplaceTranslationState.entries = [];
        inplaceTranslationState.processedNodes = null;
    // state reset (no original toggle)
    }
});
// (이전 postProcess 잔여 제거됨)

function isRedditSite() {
    return /(^|\.)reddit\.com$/.test(window.location.hostname);
}

// Reddit 본문/댓글 컨테이너에서 중복 없이 핵심 텍스트 노드만 수집 (트위터 방식 유사)
function collectCanonicalRedditTextNodes(processedNodeSet) {
    if (!isRedditSite()) return [];
    const nodes = [];
    const postSelectors = [
        '[data-test-id="post-content"]',
        '[data-testid="post-container"]',
        'shreddit-post'
    ];
    const commentSelectors = [
        'shreddit-comment',
        '[data-test-id="comment"]',
        '[data-testid="comment"]'
    ];
    const containers = new Set();
    [...postSelectors, ...commentSelectors].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => containers.add(el));
    });
    containers.forEach(container => {
        // 사이드바나 광고 영역 제외
        if (container.closest('aside,[role="complementary"], nav')) return;
        // 코드 블록/버튼/폴 등 비본문 요소 제외
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
                if (processedNodeSet.has(node)) return NodeFilter.FILTER_REJECT;
                const txt = node.nodeValue.trim();
                if (txt.length < 2) return NodeFilter.FILTER_REJECT;
                const pe = node.parentElement;
                if (!pe) return NodeFilter.FILTER_REJECT;
                if (pe.closest('code, pre, textarea, input, button, style, script')) return NodeFilter.FILTER_REJECT;
                if (pe.closest('#translation-loading, #translate-selected-text')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const local = [];
        while (walker.nextNode()) local.push(walker.currentNode);
        // 컨테이너별로 너무 많은 분절을 줄이기 위해 연속 텍스트들을 하나의 배열로 추가 (나중 grouping 단계서 하나로 합쳐 사용)
        if (local.length) nodes.push(...local);
    });
    return nodes;
}

function getInplaceRootNodes() {
    if (isTwitterSite()) {
        const primary = document.querySelector('[data-testid="primaryColumn"]');
        return primary ? [primary] : [document.body];
    }
    if (isRedditSite()) {
        const postSelectors = [
            '[data-testid="post-container"]',
            '[data-test-id="post-content"]',
            'shreddit-post',
            'div[data-test-id="post-content"]',
            'article[data-test-id="post-content"]'
        ];
        const postContainers = Array.from(document.querySelectorAll(postSelectors.join(',')));
        const commentContainers = Array.from(document.querySelectorAll('shreddit-comment, [data-test-id="comment"], [data-testid="comment"]'));
        const combined = [...postContainers, ...commentContainers];
        if (combined.length) return combined;
        const main = document.querySelector('main');
        if (main) return [main];
        return [document.body];
    }
    return [document.body];
}

// ====== 추가 번역 (스크롤 하단 근접 시 '더 번역하기' 버튼) ======
let loadMoreScrollBound = false;
function ensureLoadMoreScrollListener() {
    if (loadMoreScrollBound) return;
    loadMoreScrollBound = true;
    window.addEventListener('scroll', maybeShowLoadMoreButton, { passive: true });
}

function maybeShowLoadMoreButton() {
    if (!inplaceTranslationState.active) return;
    if (inplaceTranslationState.translating) return;
    if (document.getElementById('inplace-load-more-btn')) return;
    const scrollBottom = window.scrollY + window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;
    const THRESHOLD = 1200; // 바닥 근처 판단
    if (docHeight - scrollBottom < THRESHOLD) {
        showLoadMoreButton();
    }
}

function showLoadMoreButton() {
    if (document.getElementById('inplace-load-more-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'inplace-load-more-btn';
    btn.textContent = '더 번역하기';
    Object.assign(btn.style, {
        position:'fixed', bottom:'24px', right:'24px', zIndex:'1000002', background:'#1976d2', color:'#fff', border:'none', padding:'10px 16px', borderRadius:'24px', cursor:'pointer', fontSize:'14px', fontWeight:'bold', boxShadow:'0 3px 10px rgba(0,0,0,0.25)'
    });
    btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = '번역 중...';
        translateMoreVisibleNodes().finally(()=>{
            if (btn.parentNode) btn.parentNode.removeChild(btn);
        });
    });
    document.body.appendChild(btn);
}

async function translateMoreVisibleNodes() {
    if (!inplaceTranslationState.active) return;
    const processed = inplaceTranslationState.processedNodes || new WeakSet();
    const roots = getInplaceRootNodes();
    const seen = new Set();
    const candidates = [];
    for (const root of roots) {
        if (!root) continue;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (processed.has(node)) return NodeFilter.FILTER_REJECT;
                if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
                const text = node.nodeValue.trim();
                if (text.length < 2) return NodeFilter.FILTER_REJECT;
                const parentEl = node.parentElement;
                const parentTag = parentEl?.tagName;
                if (parentEl && (parentEl.closest('#inplace-toggle-restore-btn') || parentEl.closest('#inplace-load-more-btn') || parentEl.closest('#translate-selected-text'))) return NodeFilter.FILTER_REJECT;
                if (isTwitterSite()) {
                    if (!parentEl || !parentEl.closest('[data-testid="tweetText"]')) return NodeFilter.FILTER_REJECT;
                }
                if (['SCRIPT','STYLE','NOSCRIPT','IFRAME','CANVAS','CODE','PRE'].includes(parentTag)) return NodeFilter.FILTER_REJECT;
                if (parentEl && (parentEl.closest('aside') || parentEl.closest('[role="complementary"]'))) return NodeFilter.FILTER_REJECT;
                let allowIfRectZero = false;
                if (isRedditSite() && parentEl && parentEl.closest('[data-test-id="post-content"], shreddit-post, [data-testid="post-container"], shreddit-comment')) allowIfRectZero = true;
                try {
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    const rect = range.getBoundingClientRect();
                    // 새로 보이는(또는 바로 아래) 영역: 뷰포트 상/하 + 1.5배
                    if (rect.bottom < -INPLACE_TOP_BUFFER) return NodeFilter.FILTER_REJECT;
                    if (rect.top > window.innerHeight * 1.5) return NodeFilter.FILTER_REJECT;
                    if (rect.width === 0 && rect.height === 0 && !allowIfRectZero) return NodeFilter.FILTER_REJECT;
                } catch { return NodeFilter.FILTER_REJECT; }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        while (walker.nextNode()) {
            const n = walker.currentNode;
            if (!seen.has(n)) { seen.add(n); candidates.push(n); }
        }
    }
    if (!candidates.length) return;
    // 동시 번역
    inplaceTranslationState.translating = true;
    // 임시 로딩 표시 (기존 메인 인디케이터 없을 때만)
    if (!document.getElementById('translation-loading')) {
        showLoadingIndicator();
        updateLoadingIndicatorProgress(0, candidates.length);
    }
    // 그룹핑 재사용
    const BLOCK_TAGS = new Set(['P','DIV','LI','ARTICLE','SECTION','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','DD','DT','FIGCAPTION']);
    function findBlockContainer(el){
        let cur = el;
        while (cur && cur !== document.body) {
            if (cur.getAttribute && (cur.getAttribute('data-testid')==='tweetText')) return cur;
            if (isRedditSite()) {
                if (cur.matches('[data-testid="comment"], shreddit-comment, [data-test-id="comment"], [data-testid="post-container"], [data-test-id="post-content"], shreddit-post')) return cur;
            }
            if (BLOCK_TAGS.has(cur.tagName)) return cur;
            cur = cur.parentElement;
        }
        return el || document.body;
    }
    let groups = [];
    if (isRedditSite()) {
        const containerSelectors = '[data-test-id="post-content"], [data-testid="post-container"], shreddit-post, shreddit-comment, [data-test-id="comment"], [data-testid="comment"]';
        const containers = Array.from(new Set(Array.from(document.querySelectorAll(containerSelectors))));
        let seq = 0;
        containers.forEach(c=>{
            if (c.closest('aside,[role="complementary"], nav')) return;
            const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
            const nodes=[];
            while (walker.nextNode()) {
                const n=walker.currentNode; if(!n.nodeValue) continue; const t=n.nodeValue.trim(); if(t.length<2) continue; if (processed.has(n)) continue;
                const pe=n.parentElement; if(!pe) continue; if(pe.closest('code,pre,script,style,button,textarea,input')) continue;
                nodes.push(n);
            }
            if(!nodes.length) return; groups.push({nodes, order: seq++});
        });
        groups.sort((a,b)=>a.order-b.order);
    } else {
        const groupMap = new Map();
        let seq = 0;
        for (const tn of candidates){
            const c = findBlockContainer(tn.parentElement);
            if (!groupMap.has(c)) groupMap.set(c,{nodes:[], order:seq++});
            groupMap.get(c).nodes.push(tn);
        }
        groups = Array.from(groupMap.values()).sort((a,b)=>a.order-b.order);
    }
    const MARKER = '<<<§§§>>>';
    const groupTasks = [];
    for (const g of groups){
        const useful = g.nodes.filter(n=>{const t=n.nodeValue.trim(); return t.length>1 && !processed.has(n);});
        if (!useful.length) continue;
        const originalTexts = useful.map(n=>n.nodeValue);
        const concat = originalTexts.join(MARKER);
        if (concat.trim().length<2) continue;
        groupTasks.push({nodes: useful, concat});
    }
    let successCount = 0, finishedCount = 0;
    if (groupTasks.length) updateLoadingIndicatorProgress(0, groupTasks.length);
    await Promise.all(groupTasks.map(async (g)=>{
    const needsCache = isRedditSite() && g.nodes.length===1 && !g.concat.includes(MARKER);
        const translatePromise = needsCache ? getCachedTranslation(g.concat) : translateText(g.concat);
        const raw = await Promise.race([
            translatePromise,
            new Promise(r=>setTimeout(()=>r(null),15000))
        ]);
        finishedCount++;
        if (!raw){ if (finishedCount % 10 ===0 || finishedCount===groupTasks.length) updateLoadingIndicatorProgress(successCount, groupTasks.length); return; }
    if (g.nodes.length === 1) {
            // Reddit dedup task: 동일 텍스트 여러 노드
            for (const node of g.nodes){
                const originalText = node.nodeValue;
                node.nodeValue = raw;
                inplaceTranslationState.entries.push({ node, originalText, translatedText: node.nodeValue });
                processed.add(node);
            }
        } else {
            let distributed = false;
            if (raw.includes(MARKER)) {
                const parts = raw.split(MARKER);
                if (parts.length === g.nodes.length) {
                    for (let i=0;i<g.nodes.length;i++) {
                        const node = g.nodes[i];
                        const originalText = node.nodeValue;
                        node.nodeValue = parts[i];
                        inplaceTranslationState.entries.push({ node, originalText, translatedText: node.nodeValue });
                        processed.add(node);
                    }
                    distributed = true;
                }
            }
            if (!distributed) {
                const first = g.nodes[0];
                const originalFirst = first.nodeValue;
                first.nodeValue = raw;
                inplaceTranslationState.entries.push({ node:first, originalText: originalFirst, translatedText: first.nodeValue });
                processed.add(first);
                // Reddit 이면 나머지 노드 원문 유지 (깨짐 방지), 그 외 공백 처리 유지
                if (!isRedditSite()) {
                    for (let i=1;i<g.nodes.length;i++) {
                        const node = g.nodes[i];
                        const originalText = node.nodeValue;
                        node.nodeValue = '';
                        inplaceTranslationState.entries.push({ node, originalText, translatedText: node.nodeValue });
                        processed.add(node);
                    }
                }
            }
        }
        successCount++;
        if (finishedCount % 10 ===0 || finishedCount===groupTasks.length) updateLoadingIndicatorProgress(successCount, groupTasks.length);
    }));
    inplaceTranslationState.processedNodes = processed;
    inplaceTranslationState.translating = false;
    // 추가 번역 후 다시 스크롤 근접 시 버튼 재등장 가능
    maybeShowLoadMoreButton();
    if (document.getElementById('translation-loading')) finishAndFadeLoadingIndicator(successCount, groupTasks.length, groupTasks.length-successCount);
}

// (패치) Reddit/Twitter 번역 시 사이드바(aside / role=complementary) 제외 위해 acceptNode 내부에서 closest 검사 필요 →
// 기존 acceptNode 로직은 함수 내부에 inline 되어 있어 재사용 어려우므로 상위 주석만 추가 (이미 patch 적용됨)

