// ==========================================================================
// Thoughts & Values - Client Application Logic with Sidebar Filters & Supabase
// ==========================================================================

// Global state
let decryptedPosts = [];
let activeFeedPosts = []; // Merged static + dynamic posts
let sheetDynamicPosts = []; // Loaded dynamic thoughts from backend
let activeTheme = 'dark';
let activePost = null;
let isAdminLogged = false;
let activeDecryptionPassword = ''; // Remembers "thoughts" for admin session dynamic encrypt
let activeUserPasswordHash = ''; // Custom regular user password hash fetched from Sheets
let startupFetchPromise = null; // Backend data fetch promise for startup synchronization
let allLikes = [];
let allViews = [];
let allFeedback = [];

// Compute SHA-256 Hash of string
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Supabase API Headers helper
function getSupabaseHeaders() {
  if (!BLOG_CONFIG.supabaseUrl || !BLOG_CONFIG.supabaseAnonKey) return null;
  return {
    'apikey': BLOG_CONFIG.supabaseAnonKey,
    'Authorization': `Bearer ${BLOG_CONFIG.supabaseAnonKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

// Detect the active data storage backend
function getBackendType() {
  if (typeof BLOG_CONFIG !== 'undefined') {
    if (BLOG_CONFIG.supabaseUrl && BLOG_CONFIG.supabaseAnonKey) {
      return 'supabase';
    } else if (BLOG_CONFIG.googleSheetsUrl) {
      return 'sheets';
    }
  }
  return 'standalone';
}

// Log actions (visitor analytics)
async function writeAccessLog(action, status) {
  const backend = getBackendType();
  const userAgent = navigator.userAgent;
  const currentUser = localStorage.getItem('visitor_name') || 'Guest';
  const activityStr = action + (status ? ' (' + status + ')' : '');
  const sessionId = getSessionId();

  if (backend === 'standalone') {
    try {
      const localLogs = JSON.parse(localStorage.getItem('local_access_logs') || '[]');
      localLogs.unshift({
        timestamp: new Date().toISOString(),
        user: currentUser,
        activity: activityStr,
        session_id: sessionId,
        browser_traceback: userAgent
      });
      localStorage.setItem('local_access_logs', JSON.stringify(localLogs.slice(0, 100)));
    } catch (e) {
      console.error('Failed to write local logs:', e);
    }
    return;
  }

  if (backend === 'sheets') {
    try {
      await fetch(BLOG_CONFIG.googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          type: 'access_logs',
          user: currentUser,
          activity: activityStr,
          session_id: sessionId,
          browser_traceback: userAgent
        })
      });
    } catch (err) {
      console.error('Failed to send access log to Google Sheets:', err);
    }
    return;
  }

  // Supabase mode
  const headers = getSupabaseHeaders();
  if (headers) {
    try {
      await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/access_logs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: activityStr,
          status: status || 'Success',
          user_agent: userAgent
        })
      });
    } catch (err) {
      console.error('Failed to send access log to database:', err);
    }
  }
}

// Visitor Tracking ID
function getVisitorId() {
  let visitorId = localStorage.getItem('journal_visitor_id');
  if (!visitorId) {
    visitorId = 'visitor_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('journal_visitor_id', visitorId);
  }
  return visitorId;
}

// Session Tracking ID (resets when tab is closed)
function getSessionId() {
  let sessionId = sessionStorage.getItem('journal_session_id');
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 10);
    sessionStorage.setItem('journal_session_id', sessionId);
  }
  return sessionId;
}


// Track landing (once per browser tab session)
function trackVisitorLanding() {
  const visitorId = getVisitorId();
  const savedName = localStorage.getItem('visitor_name');
  let isNew = !localStorage.getItem('has_visited_before');
  if (isNew) {
    localStorage.setItem('has_visited_before', 'true');
  }

  const landingLogged = sessionStorage.getItem('landing_logged');
  if (!landingLogged) {
    sessionStorage.setItem('landing_logged', 'true');
    const status = isNew ? 'New User' : 'Returning User';
    const nameStr = savedName ? `, Name: ${savedName}` : '';
    writeAccessLog('Page Landed', `${status} (ID: ${visitorId}${nameStr})`);
  }
}

// DOM Elements
const lockScreen = document.getElementById('lockScreen');
const blogApp = document.getElementById('blogApp');
const loginForm = document.getElementById('loginForm');
const visitorNameInput = document.getElementById('visitorNameInput');
const passwordInput = document.getElementById('passwordInput');
const loginError = document.getElementById('loginError');
const unlockBtn = document.getElementById('unlockBtn');
const logoutBtn = document.getElementById('logoutBtn');
const themeToggle = document.getElementById('themeToggle');
const sunIcon = document.querySelector('.sun-icon');
const moonIcon = document.querySelector('.moon-icon');
const searchInput = document.getElementById('searchInput');
const postsContainer = document.getElementById('postsContainer');
const currentYearSpan = document.getElementById('currentYear');
const footerAuthorSpan = document.getElementById('footerAuthor');
const blogTitleEl = document.getElementById('blogTitle');
const blogSubtitleEl = document.getElementById('blogSubtitle');
const standaloneBanner = document.getElementById('standaloneBanner');
const statPostCount = document.getElementById('statPostCount');
const postCount = document.getElementById('postCount');

// Left Navigation & SPA Views Elements
const navFeedBtn = document.getElementById('navFeedBtn');
const navFeedbackBtn = document.getElementById('navFeedbackBtn');
const navAdminBtn = document.getElementById('navAdminBtn');

const feedView = document.getElementById('feedView');
const feedbackView = document.getElementById('feedbackView');
const adminView = document.getElementById('adminView');

// Admin Elements
const adminLogsTableBody = document.getElementById('adminLogsTableBody');
const adminCommentsTableBody = document.getElementById('adminCommentsTableBody');
const adminPostViewsTableBody = document.getElementById('adminPostViewsTableBody');

// Admin Stats
const statTotalLogs = document.getElementById('statTotalLogs');
const statSuccessLogins = document.getElementById('statSuccessLogins');
const statBlockedLogins = document.getElementById('statBlockedLogins');
const statTotalComments = document.getElementById('statTotalComments');

// Modal Elements
const readingModal = document.getElementById('readingModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalTitle = document.getElementById('modalTitle');
const modalDate = document.getElementById('modalDate');
const modalReadTime = document.getElementById('modalReadTime');
const modalContent = document.getElementById('modalContent');
const progressBar = document.getElementById('progressBar');

// Comment Elements
const commentsList = document.getElementById('commentsList');
const commentForm = document.getElementById('commentForm');
const commentAuthor = document.getElementById('commentAuthor');
const commentText = document.getElementById('commentText');
const commentCount = document.getElementById('commentCount');

// Admin Password Management Elements (Obsolete)
// const adminPasswordForm = document.getElementById('adminPasswordForm');
// const newRegularPasswordInput = document.getElementById('newRegularPasswordInput');

// Detect and update admin buttons display based on access mode
function updateAdminVisibility() {
  const isAdminMode = localStorage.getItem('admin_mode') === 'true';
  if (isAdminMode) {
    if (navAdminBtn) navAdminBtn.classList.remove('hidden');
  } else {
    if (navAdminBtn) navAdminBtn.classList.add('hidden');
  }
}

// SPA single page navigation tab toggling
function switchView(viewId) {
  if (feedView) feedView.classList.add('hidden');
  if (feedbackView) feedbackView.classList.add('hidden');
  if (adminView) adminView.classList.add('hidden');

  const targetView = document.getElementById(viewId);
  if (targetView) targetView.classList.remove('hidden');

  if (navFeedBtn) navFeedBtn.classList.remove('active');
  if (navFeedbackBtn) navFeedbackBtn.classList.remove('active');
  if (navAdminBtn) navAdminBtn.classList.remove('active');

  if (viewId === 'feedView' && navFeedBtn) navFeedBtn.classList.add('active');
  if (viewId === 'feedbackView' && navFeedbackBtn) navFeedbackBtn.classList.add('active');
  if (viewId === 'adminView' && navAdminBtn) navAdminBtn.classList.add('active');
}

// // Global state variable for interactive star ratings
let selectedRating = 5;

document.addEventListener('DOMContentLoaded', () => {
  // Start loading backend data immediately so we have the custom regular user password hash ready
  startupFetchPromise = fetchBackendData();

  // Track visitor landing immediately
  trackVisitorLanding();

  // Hide admin section if not activated
  updateAdminVisibility();

  // Apply Config
  applyConfig();

  // Set current year in footer
  currentYearSpan.textContent = new Date().getFullYear();

  // Set theme from localStorage or fallback to dark
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    setTheme(savedTheme);
  } else {
    setTheme('dark');
  }

  // Pre-fill visitor name
  const savedName = localStorage.getItem('visitor_name');
  if (savedName && visitorNameInput) {
    visitorNameInput.value = savedName;
  }

  // Check saved session
  checkSavedSession();

  // Left Sidebar Navigation Button Listeners
  if (navFeedBtn) navFeedBtn.addEventListener('click', () => switchView('feedView'));
  if (navFeedbackBtn) navFeedbackBtn.addEventListener('click', () => {
    switchView('feedbackView');
    renderFeedbackList();
  });
  if (navAdminBtn) navAdminBtn.addEventListener('click', () => {
    switchView('adminView');
    loadAdminAnalytics();
  });

  // Event Listeners
  loginForm.addEventListener('submit', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);
  themeToggle.addEventListener('click', toggleTheme);

  // Admin password reveal toggle logic
  const adminToggleBtn = document.getElementById('adminToggleBtn');
  const passwordGroup = document.getElementById('passwordGroup');
  if (adminToggleBtn && passwordGroup && passwordInput) {
    adminToggleBtn.addEventListener('click', () => {
      const isCollapsed = passwordGroup.classList.contains('collapsed');
      if (isCollapsed) {
        passwordGroup.classList.remove('collapsed');
        adminToggleBtn.classList.add('active');
        passwordInput.focus();
      } else {
        passwordGroup.classList.add('collapsed');
        adminToggleBtn.classList.remove('active');
        passwordInput.value = '';
      }
    });
  }

  searchInput.addEventListener('input', handleSearch);

  // Modal Close Events
  modalCloseBtn.addEventListener('click', closeReader);
  readingModal.addEventListener('click', (e) => {
    if (e.target === readingModal) closeReader();
  });

  // Feedback Form submit
  const feedbackForm = document.getElementById('feedbackForm');
  if (feedbackForm) {
    feedbackForm.addEventListener('submit', handleFeedbackSubmit);
  }

  // Star Rating Interactive Selection
  const stars = document.querySelectorAll('#feedbackStars .star');
  stars.forEach(star => {
    star.addEventListener('click', () => {
      selectedRating = Number(star.getAttribute('data-value'));
      stars.forEach(s => {
        if (Number(s.getAttribute('data-value')) <= selectedRating) {
          s.classList.add('selected');
        } else {
          s.classList.remove('selected');
        }
      });
    });
  });

  // Exit Admin Mode button event
  const exitAdminModeBtn = document.getElementById('exitAdminModeBtn');
  if (exitAdminModeBtn) {
    exitAdminModeBtn.addEventListener('click', () => {
      localStorage.removeItem('admin_mode');
      localStorage.removeItem('admin_logged');
      isAdminLogged = false;
      updateAdminVisibility();
      switchView('feedView');
      alert('Admin mode deactivated. Admin dashboard links are now hidden.');
    });
  }

  // Comments form event
  commentForm.addEventListener('submit', handleCommentSubmit);

  // Admin publish form event
  const adminPublishForm = document.getElementById('adminPublishForm');
  if (adminPublishForm) {
    adminPublishForm.addEventListener('submit', handleAdminPublishSubmit);
  }

  // Admin password change form event (Obsolete)
  // if (adminPasswordForm) {
  //   adminPasswordForm.addEventListener('submit', handleAdminPasswordSubmit);
  // }

  // Modal like button event (Top & Bottom)
  const modalLikeBtn = document.getElementById('modalLikeBtn');
  if (modalLikeBtn) {
    modalLikeBtn.addEventListener('click', () => {
      if (activePost) {
        toggleLike(activePost.id);
      }
    });
  }
  const modalLikeBtnBottom = document.getElementById('modalLikeBtnBottom');
  if (modalLikeBtnBottom) {
    modalLikeBtnBottom.addEventListener('click', () => {
      if (activePost) {
        toggleLike(activePost.id);
      }
    });
  }

  // Tag pills navigation setup
  setupTagFilters();

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeReader();
    }
  });

  // Track scroll inside modal for reading progress bar
  readingModal.addEventListener('scroll', updateReadingProgress);
});

// Apply config.js configurations
function applyConfig() {
  if (typeof BLOG_CONFIG !== 'undefined') {
    document.title = BLOG_CONFIG.title;
    blogTitleEl.innerHTML = `${BLOG_CONFIG.title} <span class="title-separator">|</span> <span class="title-tagline">Trace the Source</span>`;
    blogSubtitleEl.textContent = BLOG_CONFIG.description;
    footerAuthorSpan.textContent = BLOG_CONFIG.author;
    if (BLOG_CONFIG.defaultPasswordPlaceholder) {
      passwordInput.placeholder = BLOG_CONFIG.defaultPasswordPlaceholder;
    }
    // Hide/show admin portal buttons
    updateAdminVisibility();

    // Check if database configs are set
    if (getBackendType() === 'standalone') {
      standaloneBanner.classList.remove('hidden');
    } else {
      standaloneBanner.classList.add('hidden');
    }
  }
}

// Set Theme (light-mode or dark-mode)
function setTheme(theme) {
  activeTheme = theme;
  if (theme === 'light') {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
    sunIcon.classList.remove('hidden');
    moonIcon.classList.add('hidden');
  } else {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
    sunIcon.classList.add('hidden');
    moonIcon.classList.remove('hidden');
  }
  localStorage.setItem('theme', theme);
}

// Toggle Theme
function toggleTheme() {
  setTheme(activeTheme === 'dark' ? 'light' : 'dark');
}

// Check if session exists in local storage
async function checkSavedSession() {
  if (startupFetchPromise) {
    await startupFetchPromise;
  }

  const savedName = localStorage.getItem('visitor_name');
  if (savedName) {
    try {
      const savedPassword = localStorage.getItem('journal_password') || '';
      if (savedPassword && passwordInput) {
        passwordInput.value = savedPassword;
      }
      unlockBtn.disabled = true;
      unlockBtn.querySelector('span').textContent = 'Decrypting...';

      // Check if saved password is admin
      let isSuperAdmin = false;
      if (savedPassword) {
        const hash = await sha256(savedPassword);
        isSuperAdmin = (hash === BLOG_CONFIG.adminPasswordHash);
      }
      const decryptPassword = "thoughts";

      const decrypted = await fetchAndDecrypt(decryptPassword);
      if (decrypted) {
        activeDecryptionPassword = decryptPassword;
        decryptedPosts = decrypted;
        if (isSuperAdmin) {
          isAdminLogged = true;
          localStorage.setItem('admin_mode', 'true');
          localStorage.setItem('admin_logged', 'true');
        } else {
          isAdminLogged = false;
          localStorage.removeItem('admin_mode');
          localStorage.removeItem('admin_logged');
        }
        updateAdminVisibility();
        mergeAndRenderFeeds();
        showApp();
      }
    } catch (err) {
      console.warn('Saved session expired or invalid.');
      localStorage.removeItem('journal_password');
      localStorage.removeItem('visitor_name');
      passwordInput.value = '';
    } finally {
      unlockBtn.disabled = false;
      unlockBtn.querySelector('span').textContent = 'Enter';
    }
  }
}

// Handle Login submit
async function handleLogin(e) {
  e.preventDefault();

  if (startupFetchPromise) {
    await startupFetchPromise;
  }

  const password = passwordInput.value;
  const name = visitorNameInput ? visitorNameInput.value.trim() : '';

  if (!name) return;

  loginError.classList.remove('show');
  unlockBtn.disabled = true;
  unlockBtn.querySelector('span').textContent = 'Decrypting...';

  try {
    let isSuperAdmin = false;
    if (password) {
      const hash = await sha256(password);
      isSuperAdmin = (hash === BLOG_CONFIG.adminPasswordHash);
      if (!isSuperAdmin) {
        showLoginError('Incorrect admin password. Leave it blank if you are a normal user.');
        writeAccessLog('Visitor Login', `Blocked (Invalid Admin Password, Name: ${name})`);
        return;
      }
    }

    const decryptPassword = "thoughts";
    const decrypted = await fetchAndDecrypt(decryptPassword);
    if (decrypted) {
      activeDecryptionPassword = decryptPassword;
      decryptedPosts = decrypted;
      localStorage.setItem('journal_password', password);
      localStorage.setItem('visitor_name', name);

      if (isSuperAdmin) {
        isAdminLogged = true;
        localStorage.setItem('admin_mode', 'true');
        localStorage.setItem('admin_logged', 'true');
      } else {
        isAdminLogged = false;
        localStorage.removeItem('admin_mode');
        localStorage.removeItem('admin_logged');
      }

      updateAdminVisibility();
      mergeAndRenderFeeds();
      showApp();

      const logType = isSuperAdmin ? 'Admin Login' : 'Visitor Login';
      writeAccessLog(logType, `Success (Name: ${name})`);
    } else {
      showLoginError('System Error: Unable to decrypt with key.');
      writeAccessLog('Visitor Login', `Blocked (Decryption Failure, Name: ${name})`);
    }
  } catch (err) {
    console.error(err);
    if (err.name === 'TypeError' || err.message.includes('fetch')) {
      showLoginError('System Error: Unable to access or load posts.json.enc. If you are opening index.html directly from a local file path, please run a local web server (e.g. python -m http.server 3000) due to browser CORS policies.');
    } else if (err.name === 'OperationError' || err.message.includes('decrypt') || err.message.includes('decryption')) {
      showLoginError('Incorrect password. Please try again.');
    } else {
      showLoginError('System Error: Unable to decrypt the archive. Make sure to run the python encrypt.py script.');
    }
    writeAccessLog('Visitor Login', `Blocked (System Decryption Failure, Name: ${name})`);
  } finally {
    unlockBtn.disabled = false;
    unlockBtn.querySelector('span').textContent = 'Enter';
  }
}

function showLoginError(msg) {
  if (msg) {
    loginError.textContent = msg;
  } else {
    loginError.textContent = 'Incorrect password. Please try again.';
  }
  loginError.classList.add('show');
  const card = document.querySelector('.lock-card');
  card.classList.add('shake');
  setTimeout(() => {
    card.classList.remove('shake');
  }, 400);
  passwordInput.focus();
  passwordInput.select();
}

// Handle Logout (Lock)
function handleLogout() {
  writeAccessLog('Visitor Logout', 'Success');
  localStorage.removeItem('journal_password');
  decryptedPosts = [];
  passwordInput.value = '';
  loginError.classList.remove('show');

  // Reset admin toggle elements
  const adminToggleBtn = document.getElementById('adminToggleBtn');
  const passwordGroup = document.getElementById('passwordGroup');
  if (adminToggleBtn) adminToggleBtn.classList.remove('active');
  if (passwordGroup) passwordGroup.classList.add('collapsed');

  // Clear welcome greeting
  const welcomeUserEl = document.getElementById('welcomeUser');
  if (welcomeUserEl) {
    welcomeUserEl.textContent = '';
  }

  blogApp.classList.add('hidden');
  lockScreen.classList.remove('hidden');
}

// Show the app UI and render posts
async function showApp() {
  lockScreen.classList.add('hidden');
  blogApp.classList.remove('hidden');

  // Set welcome user greeting
  const name = localStorage.getItem('visitor_name') || 'Guest';
  const isAdmin = localStorage.getItem('admin_mode') === 'true';
  const welcomeUserEl = document.getElementById('welcomeUser');
  if (welcomeUserEl) {
    welcomeUserEl.textContent = `Welcome, ${name}${isAdmin ? ' (Admin)' : ''}`;
  }

  // Pre-fill and hide comment/feedback author inputs
  if (commentAuthor) {
    commentAuthor.value = name;
    const row = commentAuthor.closest('.form-row');
    if (row) row.style.display = 'none';
  }
  const feedbackAuthor = document.getElementById('feedbackAuthor');
  if (feedbackAuthor) {
    feedbackAuthor.value = name;
    const row = feedbackAuthor.closest('.form-row');
    if (row) row.style.display = 'none';
  }

  if (startupFetchPromise) {
    await startupFetchPromise;
  } else {
    await fetchBackendData();
  }

  switchView('feedView');   // Default to Feed SPA view
  searchInput.focus();
  checkHashAndOpenPost();   // Open deep-linked inquiry if requested
}

// Fetch encrypted JSON and decrypt it
async function fetchAndDecrypt(password) {
  try {
    // Add cache-buster to prevent browser from loading cached archives
    const response = await fetch('posts.json.enc?cb=' + Date.now());
    if (!response.ok) {
      throw new Error('Encrypted post archive (posts.json.enc) not found. Make sure to run python encrypt.py locally.');
    }
    const encryptedData = await response.json();
    return await decryptPayload(password, encryptedData);
  } catch (err) {
    console.error('Decryption failed:', err);
    throw err;
  }
}

// AES-GCM Decryption (using native SubtleCrypto)
async function decryptPayload(password, encryptedData) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Convert base64 fields back to ArrayBuffers
  const saltBytes = base64ToArrayBuffer(encryptedData.salt);
  const ivBytes = base64ToArrayBuffer(encryptedData.iv);
  const ciphertextBytes = base64ToArrayBuffer(encryptedData.ciphertext);

  // 1. Import raw password key
  const rawKey = await window.crypto.subtle.importKey(
    'raw',
    passwordBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // 2. Derive decryption key using PBKDF2
  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: encryptedData.iterations || 100000,
      hash: 'SHA-256'
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 3. Decrypt payload
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      tagLength: 128 // 16 bytes auth tag
    },
    aesKey,
    ciphertextBytes
  );

  // Convert buffer to string
  const decoder = new TextDecoder('utf-8');
  const decryptedText = decoder.decode(decryptedBuffer);

  return JSON.parse(decryptedText);
}

// Convert Base64 string to Uint8Array
function base64ToArrayBuffer(base64Str) {
  const binaryString = window.atob(base64Str);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// AES-GCM Encryption (using native SubtleCrypto)
async function encryptPayload(password, payload) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Generate random salt and IV
  const saltBytes = window.crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = window.crypto.getRandomValues(new Uint8Array(12));

  // 1. Import raw password key
  const rawKey = await window.crypto.subtle.importKey(
    'raw',
    passwordBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // 2. Derive key using PBKDF2
  const iterations = 100000;
  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iterations,
      hash: 'SHA-256'
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // 3. Encrypt payload
  const plaintextBytes = encoder.encode(JSON.stringify(payload));
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      tagLength: 128
    },
    aesKey,
    plaintextBytes
  );

  return {
    salt: arrayBufferToBase64(saltBytes),
    iv: arrayBufferToBase64(ivBytes),
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iterations: iterations
  };
}

// Convert ArrayBuffer to Base64 string
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Formatting posts: parse custom WhatsApp markup to HTML
function formatPostContent(text) {
  if (!text) return '';

  // Escape HTML entities to prevent rendering arbitrary HTML tags (XSS safety)
  let safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Format bold lines: *bold text* -> <strong>bold text</strong>
  safe = safe.replace(/\*([^\*]+)\*/g, '<strong>$1</strong>');

  // Format italics lines: _italic text_ -> <em>italic text</em>
  safe = safe.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Process block by block
  const lines = safe.split('\n');
  let html = '';
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === '') {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      continue;
    }

    // Check for inline images: &lt;attached: image.jpg&gt;
    const imgMatch = line.match(/&lt;attached:\s*([^&]+)&gt;/i);
    if (imgMatch) {
      const imgFilename = imgMatch[1].trim();
      html += `
        <div class="embedded-img-container">
          <img class="embedded-img" src="${imgFilename}" alt="Journal Image" onerror="this.closest('.embedded-img-container').style.display='none'">
        </div>
      `;
      continue;
    }

    // Check for bullet lists (starts with bullet character, asterisks or dash)
    const listMatch = line.match(/^(?:&bull;|•|\*|-)\s+(.*)$/);
    if (listMatch) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${listMatch[1]}</li>`;
    } else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }

      // Check for blockquotes (starts with > or &gt;)
      if (line.startsWith('&gt;') || line.startsWith('>')) {
        const quoteText = line.replace(/^(&gt;|>)\s*/, '');
        html += `<blockquote>${quoteText}</blockquote>`;
      } else {
        html += `<p>${line}</p>`;
      }
    }
  }

  if (inList) {
    html += '</ul>';
  }

  return html;
}

// Calculate reading time (200 words per minute average)
function calculateReadTime(text) {
  if (!text) return '1 min read';
  const words = text.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min read`;
}

// Format dates nicely (e.g. "25/03/25" to "Mar 25, 2025")
function formatDate(dateStr) {
  try {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return dateStr;

    // Parse Day, Month, Year (handling 2-digit years or 4-digit years)
    let day = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10) - 1;
    let year = parts[2];
    if (year.length === 2) {
      year = '20' + year;
    }
    year = parseInt(year, 10);

    const date = new Date(year, month, day);
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  } catch (e) {
    return dateStr;
  }
}

// Merge static decrypted posts and dynamic posts from backend, then render them
function mergeAndRenderFeeds() {
  const combined = [...decryptedPosts, ...sheetDynamicPosts];

  // Remove duplicates just in case
  const seenIds = new Set();
  const uniqueCombined = [];
  combined.forEach(p => {
    if (!seenIds.has(p.id)) {
      seenIds.add(p.id);
      uniqueCombined.push(p);
    }
  });

  uniqueCombined.sort((a, b) => b.id - a.id);
  activeFeedPosts = uniqueCombined;

  renderPosts(activeFeedPosts);

  if (statPostCount) {
    statPostCount.textContent = activeFeedPosts.length;
  }
}

// Render post cards
function renderPosts(postsToRender) {
  postsContainer.innerHTML = '';

  if (postsToRender.length === 0) {
    postsContainer.innerHTML = `
      <div class="no-results">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <h3>No posts found</h3>
        <p>Try searching for other keywords or terms.</p>
      </div>
    `;
    if (postCount) {
      postCount.textContent = '0 posts found';
    }
    return;
  }

  // Clone to avoid mutating inputs
  const sortedPosts = [...postsToRender];
  const sortSelect = document.getElementById('postSortSelect');
  const sortVal = sortSelect ? sortSelect.value : 'newest';

  // Group views by post_id
  const viewsCountMap = {};
  allViews.forEach(v => {
    viewsCountMap[v.post_id] = (viewsCountMap[v.post_id] || 0) + 1;
  });

  // Group likes by post_id
  const likesCountMap = {};
  allLikes.forEach(l => {
    likesCountMap[l.post_id] = (likesCountMap[l.post_id] || 0) + 1;
  });

  if (sortVal === 'newest') {
    sortedPosts.sort((a, b) => b.id - a.id);
  } else if (sortVal === 'oldest') {
    sortedPosts.sort((a, b) => a.id - b.id);
  } else if (sortVal === 'views') {
    sortedPosts.sort((a, b) => (viewsCountMap[b.id] || 0) - (viewsCountMap[a.id] || 0));
  } else if (sortVal === 'likes') {
    sortedPosts.sort((a, b) => (likesCountMap[b.id] || 0) - (likesCountMap[a.id] || 0));
  }

  if (postCount) {
    postCount.textContent = `${sortedPosts.length} ${sortedPosts.length === 1 ? 'thought' : 'thoughts'} found`;
  }

  sortedPosts.forEach(post => {
    const card = document.createElement('article');
    card.className = 'post-card';

    const formattedDate = formatDate(post.date);
    const readTime = calculateReadTime(post.content);
    const formattedBody = formatPostContent(post.content);
    const viewsCount = viewsCountMap[post.id] || 0;

    // Combine Date and Time
    const displayTime = post.time ? ` • ${post.time}` : '';

    card.innerHTML = `
      <div class="post-meta">
        <span>${formattedDate}${displayTime}</span>
        <span class="meta-dot">&bull;</span>
        <span>${readTime}</span>
        <span class="meta-dot">&bull;</span>
        <span>👁️ ${viewsCount} ${viewsCount === 1 ? 'view' : 'views'}</span>
      </div>
      <h2 class="post-title">${post.title}</h2>
      <div class="post-excerpt">${formattedBody}</div>
      <div class="post-card-footer">
        <button class="read-more-btn" data-id="${post.id}">
          <span>Unfold Inquiry</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </button>
        <div class="post-card-actions" style="display: flex; align-items: center; gap: 0.5rem;">
          <button class="share-btn" data-id="${post.id}" title="Copy Link to Inquiry">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
          </button>
          <button class="like-btn" data-id="${post.id}" title="Like post">
            <svg class="heart-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
            <span class="like-count">0</span>
          </button>
        </div>
      </div>
    `;

    // Setup click handlers for reading mode
    card.querySelector('.read-more-btn').addEventListener('click', () => openReader(post));

    // Setup click handler for share button
    card.querySelector('.share-btn').addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent opening reading panel
      const shareUrl = `${window.location.origin}${window.location.pathname}#post-${post.id}`;
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('Inquiry link copied to clipboard!');
      }).catch(err => {
        console.error('Could not copy text: ', err);
      });
    });

    // Setup click handler for like button
    card.querySelector('.like-btn').addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent opening reading panel on heart click
      toggleLike(post.id);
    });

    postsContainer.appendChild(card);
  });

  // Update heart icons states and counts
  updateLikesUI();
}

// Search filtering
function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();

  // Clear any active tag filters
  const tagPills = document.querySelectorAll('.tag-pill');
  tagPills.forEach(p => p.classList.remove('active'));
  const allTag = document.querySelector('.tag-pill[data-tag="all"]');
  if (allTag) allTag.classList.add('active');

  if (query === '') {
    renderPosts(activeFeedPosts);
    return;
  }

  const filtered = activeFeedPosts.filter(post => {
    const titleMatch = post.title.toLowerCase().includes(query);
    const contentMatch = post.content.toLowerCase().includes(query);
    const dateMatch = post.date.includes(query) || formatDate(post.date).toLowerCase().includes(query);
    return titleMatch || contentMatch || dateMatch;
  });

  renderPosts(filtered);
}

// Setup sidebar tag concept filters
function setupTagFilters() {
  const tagPills = document.querySelectorAll('.tag-pill');
  tagPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      // Toggle active states
      tagPills.forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');

      const tag = e.target.getAttribute('data-tag');

      // Clear search box
      searchInput.value = '';

      if (tag === 'all') {
        renderPosts(activeFeedPosts);
        return;
      }

      const filtered = activeFeedPosts.filter(post => {
        const titleMatch = post.title.toLowerCase().includes(tag.toLowerCase());
        const contentMatch = post.content.toLowerCase().includes(tag.toLowerCase());
        return titleMatch || contentMatch;
      });

      renderPosts(filtered);
    });
  });
}

// Open focused reader modal
function openReader(post) {
  activePost = post;
  modalTitle.textContent = post.title;

  // Set window location hash to deep link without triggering a loop
  if (window.location.hash !== `#post-${post.id}`) {
    history.pushState(null, null, `#post-${post.id}`);
  }

  const scrollToTopBtn = document.getElementById('scrollToTopBtn');
  if (scrollToTopBtn) scrollToTopBtn.classList.remove('show');

  // Calculate views count including this new view if new to session
  const viewsCountMap = {};
  allViews.forEach(v => {
    viewsCountMap[v.post_id] = (viewsCountMap[v.post_id] || 0) + 1;
  });

  const sessionViewKey = `viewed_post_${post.id}`;
  const isNewSessionView = !sessionStorage.getItem(sessionViewKey);
  const currentViews = (viewsCountMap[post.id] || 0) + (isNewSessionView ? 1 : 0);

  modalDate.textContent = `${formatDate(post.date)}${post.time ? ' • ' + post.time : ''}`;
  modalReadTime.textContent = `${calculateReadTime(post.content)} • 👁️ ${currentViews} ${currentViews === 1 ? 'view' : 'views'}`;
  modalContent.innerHTML = formatPostContent(post.content);

  // Log the view to database (deduplicated internally via sessionStorage check)
  trackPostView(post.id);

  // Load comments
  loadComments(post.id);

  // Sync modal like button status
  updateLikesUI();

  readingModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden'; // Lock main scroll

  // Set progress bar to 0 initially
  progressBar.style.width = '0%';
  readingModal.scrollTop = 0;
}

// Close focused reader modal
function closeReader(updateHashState = true) {
  readingModal.classList.add('hidden');
  document.body.style.overflow = ''; // Restore main scroll
  progressBar.style.width = '0%';
  activePost = null;

  if (updateHashState && window.location.hash.startsWith('#post-')) {
    history.pushState("", document.title, window.location.pathname + window.location.search);
  }

  const scrollToTopBtn = document.getElementById('scrollToTopBtn');
  if (scrollToTopBtn) scrollToTopBtn.classList.remove('show');

  // Re-render the active feed to show the updated views count
  refreshCurrentFeed();
}

// Refresh the current feed layout with existing tag/search filters
function refreshCurrentFeed() {
  if (searchInput && searchInput.value.trim() !== '') {
    handleSearch({ target: searchInput });
  } else {
    const activeTagPill = document.querySelector('.tag-pill.active');
    if (activeTagPill && activeTagPill.getAttribute('data-tag') !== 'all') {
      const tag = activeTagPill.getAttribute('data-tag');
      const filtered = activeFeedPosts.filter(post => {
        const titleMatch = post.title.toLowerCase().includes(tag.toLowerCase());
        const contentMatch = post.content.toLowerCase().includes(tag.toLowerCase());
        return titleMatch || contentMatch;
      });
      renderPosts(filtered);
    } else {
      renderPosts(activeFeedPosts);
    }
  }
}

// Update reading progress bar at top
function updateReadingProgress() {
  const scrollTop = readingModal.scrollTop;
  const scrollHeight = readingModal.scrollHeight - readingModal.clientHeight;
  if (scrollHeight > 0) {
    const progress = (scrollTop / scrollHeight) * 100;
    progressBar.style.width = `${progress}%`;
  } else {
    progressBar.style.width = '0%';
  }
}

// ==========================================================================
// LIKES FUNCTIONALITY
// ==========================================================================

// Fetch likes, views, feedback, and dynamic posts from backend
async function fetchBackendData() {
  const backend = getBackendType();
  if (backend === 'standalone') {
    allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
    allViews = JSON.parse(localStorage.getItem('local_views') || '[]');
    allFeedback = JSON.parse(localStorage.getItem('local_feedback') || '[]');

    // Handle local dynamic posts
    const localDynamic = JSON.parse(localStorage.getItem('local_dynamic_posts') || '[]');
    const decryptedDynamic = [];
    for (const dp of localDynamic) {
      try {
        if (dp.encrypted_data) {
          try {
            const parsed = JSON.parse(dp.encrypted_data);
            if (parsed && parsed.isPasswordHash) {
              activeUserPasswordHash = parsed.hash;
              continue;
            }
          } catch (e) {
            // Not a metadata JSON, proceed to decryption
          }
        }
        const decrypted = await decryptPayload(activeDecryptionPassword || "thoughts", JSON.parse(dp.encrypted_data));
        decryptedDynamic.push({
          id: Number(dp.id),
          title: decrypted.title,
          date: decrypted.date,
          time: decrypted.time,
          content: decrypted.content
        });
      } catch (err) {
        console.error('Failed to decrypt local dynamic post:', dp.id, err);
      }
    }
    sheetDynamicPosts = decryptedDynamic;
    mergeAndRenderFeeds();
    updateLikesUI();
    return;
  }

  if (backend === 'sheets') {
    try {
      const response = await fetch(BLOG_CONFIG.googleSheetsUrl);
      if (response.ok) {
        const data = await response.json();
        allLikes = data.likes || [];
        allViews = data.views || [];
        allFeedback = data.feedback || [];

        // Handle dynamic posts from Google Sheets
        const sheetDynamic = data.posts || [];
        const decryptedDynamic = [];
        for (const dp of sheetDynamic) {
          try {
            if (dp.encrypted_data) {
              try {
                const parsed = JSON.parse(dp.encrypted_data);
                if (parsed && parsed.isPasswordHash) {
                  activeUserPasswordHash = parsed.hash;
                  continue;
                }
              } catch (e) {
                // Not a metadata JSON, proceed to decryption
              }
            }
            const decrypted = await decryptPayload(activeDecryptionPassword || "thoughts", JSON.parse(dp.encrypted_data));
            decryptedDynamic.push({
              id: Number(dp.id),
              title: decrypted.title,
              date: decrypted.date,
              time: decrypted.time,
              content: decrypted.content
            });
          } catch (err) {
            console.error('Failed to decrypt sheet dynamic post:', dp.id, err);
          }
        }
        sheetDynamicPosts = decryptedDynamic;
        mergeAndRenderFeeds();
      } else {
        allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
        allViews = JSON.parse(localStorage.getItem('local_views') || '[]');
        allFeedback = JSON.parse(localStorage.getItem('local_feedback') || '[]');
        mergeAndRenderFeeds();
      }
    } catch (err) {
      console.error('Failed to load backend data from Google Sheets:', err);
      allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
      allViews = JSON.parse(localStorage.getItem('local_views') || '[]');
      allFeedback = JSON.parse(localStorage.getItem('local_feedback') || '[]');
      mergeAndRenderFeeds();
    }
    updateLikesUI();
    return;
  }

  // Supabase mode (optional fallback)
  const headers = getSupabaseHeaders();
  if (!headers) {
    allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
    allViews = JSON.parse(localStorage.getItem('local_views') || '[]');
    allFeedback = JSON.parse(localStorage.getItem('local_feedback') || '[]');
    mergeAndRenderFeeds();
    updateLikesUI();
    return;
  }
  try {
    const response = await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/likes`, {
      method: 'GET',
      headers
    });
    if (response.ok) {
      allLikes = await response.json();
    } else {
      allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
    }
    allViews = JSON.parse(localStorage.getItem('local_views') || '[]');
    allFeedback = JSON.parse(localStorage.getItem('local_feedback') || '[]');
  } catch (err) {
    console.error('Failed to load likes from database:', err);
    allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
  }
  activeFeedPosts = [...decryptedPosts];
  renderPosts(activeFeedPosts);
  updateLikesUI();
}

// Sync counts and user states for all like buttons
function updateLikesUI() {
  const visitorId = getVisitorId();

  // Count likes per post_id
  const likesCount = {};
  allLikes.forEach(l => {
    likesCount[l.post_id] = (likesCount[l.post_id] || 0) + 1;
  });

  // Determine posts liked by this visitor
  const visitorLiked = new Set();
  allLikes.forEach(l => {
    if (l.visitor_id === visitorId) {
      visitorLiked.add(Number(l.post_id));
    }
  });

  // Update cards like buttons
  const cardLikeBtns = document.querySelectorAll('.like-btn');
  cardLikeBtns.forEach(btn => {
    const postId = Number(btn.getAttribute('data-id'));
    const countSpan = btn.querySelector('.like-count');
    const count = likesCount[postId] || 0;
    if (countSpan) countSpan.textContent = count;

    if (visitorLiked.has(postId)) {
      btn.classList.add('liked');
    } else {
      btn.classList.remove('liked');
    }
  });

  // Update modal like button (Top & Bottom)
  if (activePost) {
    const modalLikeBtn = document.getElementById('modalLikeBtn');
    const modalLikeCount = document.getElementById('modalLikeCount');
    const modalLikeBtnBottom = document.getElementById('modalLikeBtnBottom');
    const modalLikeCountBottom = document.getElementById('modalLikeCountBottom');
    const count = likesCount[activePost.id] || 0;
    if (modalLikeCount) modalLikeCount.textContent = count;
    if (modalLikeCountBottom) modalLikeCountBottom.textContent = count;

    const hasLiked = visitorLiked.has(activePost.id);
    if (modalLikeBtn) {
      if (hasLiked) {
        modalLikeBtn.classList.add('liked');
      } else {
        modalLikeBtn.classList.remove('liked');
      }
    }
    if (modalLikeBtnBottom) {
      if (hasLiked) {
        modalLikeBtnBottom.classList.add('liked');
      } else {
        modalLikeBtnBottom.classList.remove('liked');
      }
    }
  }
}

// Toggle like for a post
async function toggleLike(postId) {
  const visitorId = getVisitorId();
  const backend = getBackendType();
  const post = decryptedPosts.find(p => Number(p.id) === Number(postId));
  const postTitle = post ? post.title : 'Unknown Post';
  const currentUser = localStorage.getItem('visitor_name') || 'Guest';
  const sessionId = getSessionId();

  const existingIndex = allLikes.findIndex(l => Number(l.post_id) === Number(postId) && l.visitor_id === visitorId);
  const isLiked = existingIndex !== -1;

  if (backend === 'standalone') {
    // Local storage only
    if (isLiked) {
      allLikes.splice(existingIndex, 1);
    } else {
      allLikes.push({
        post_id: Number(postId),
        post_title: postTitle,
        user: currentUser,
        visitor_id: visitorId,
        created_at: new Date().toISOString(),
        session_id: sessionId
      });
    }
    localStorage.setItem('local_likes', JSON.stringify(allLikes));
    updateLikesUI();
    return;
  }

  if (backend === 'sheets') {
    try {
      if (isLiked) {
        await fetch(BLOG_CONFIG.googleSheetsUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            type: 'unlike',
            post_id: Number(postId),
            visitor_id: visitorId
          })
        });
        allLikes.splice(existingIndex, 1);
        writeAccessLog('Visitor Unliked Post', `Success (Post ID: ${postId})`);
      } else {
        await fetch(BLOG_CONFIG.googleSheetsUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            type: 'likes',
            post_id: Number(postId),
            post_title: postTitle,
            user: currentUser,
            visitor_id: visitorId,
            session_id: sessionId
          })
        });
        allLikes.push({
          post_id: Number(postId),
          post_title: postTitle,
          user: currentUser,
          visitor_id: visitorId,
          created_at: new Date().toISOString(),
          session_id: sessionId
        });
        writeAccessLog('Visitor Liked Post', `Success (Post ID: ${postId})`);
      }
    } catch (err) {
      console.error('Failed to toggle like on Google Sheets:', err);
    }
    updateLikesUI();
    return;
  }

  // Supabase mode
  const headers = getSupabaseHeaders();
  if (headers) {
    try {
      if (isLiked) {
        // DELETE like row
        const response = await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/likes?post_id=eq.${postId}&visitor_id=eq.${visitorId}`, {
          method: 'DELETE',
          headers
        });
        if (response.ok) {
          allLikes.splice(existingIndex, 1);
          writeAccessLog('Visitor Unliked Post', `Success (Post ID: ${postId})`);
        }
      } else {
        // POST like row
        const response = await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/likes`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            post_id: Number(postId),
            visitor_id: visitorId
          })
        });
        if (response.ok) {
          allLikes.push({
            post_id: Number(postId),
            visitor_id: visitorId,
            created_at: new Date().toISOString()
          });
          writeAccessLog('Visitor Liked Post', `Success (Post ID: ${postId})`);
        }
      }
    } catch (err) {
      console.error('Failed to toggle like on server:', err);
    }
  }
  updateLikesUI();
}

// ==========================================================================
// COMMENTS FUNCTIONALITY
// ==========================================================================

// Load comments for a post
async function loadComments(postId) {
  commentsList.innerHTML = '<p class="loading-state">Loading comments...</p>';
  commentCount.textContent = '0';

  const backend = getBackendType();

  if (backend === 'standalone') {
    const allComments = JSON.parse(localStorage.getItem('local_comments') || '[]');
    const postComments = allComments.filter(c => Number(c.post_id) === Number(postId));
    renderComments(postComments);
    return;
  }

  if (backend === 'sheets') {
    try {
      const response = await fetch(BLOG_CONFIG.googleSheetsUrl);
      if (response.ok) {
        const data = await response.json();
        const postComments = (data.comments || []).filter(c => Number(c.post_id) === Number(postId));
        renderComments(postComments);
      } else {
        commentsList.innerHTML = '<p class="text-error">Could not connect to the comments server.</p>';
      }
    } catch (err) {
      console.error('Failed to load comments from Google Sheets:', err);
      commentsList.innerHTML = '<p class="text-error">Database connection failed. Running comments locally.</p>';
    }
    return;
  }

  // Supabase mode
  const headers = getSupabaseHeaders();
  if (!headers) {
    const allComments = JSON.parse(localStorage.getItem('local_comments') || '[]');
    const postComments = allComments.filter(c => Number(c.post_id) === Number(postId));
    renderComments(postComments);
    return;
  }

  try {
    const response = await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/comments?post_id=eq.${postId}&order=created_at.asc`, {
      method: 'GET',
      headers
    });
    if (response.ok) {
      const data = await response.json();
      renderComments(data);
    } else {
      commentsList.innerHTML = '<p class="text-error">Could not connect to the comments server.</p>';
    }
  } catch (err) {
    console.error('Failed to load comments from Supabase:', err);
    commentsList.innerHTML = '<p class="text-error">Database connection failed. Running comments locally.</p>';
  }
}

// Render comments in UI
function renderComments(comments) {
  commentsList.innerHTML = '';
  commentCount.textContent = comments.length;

  if (comments.length === 0) {
    commentsList.innerHTML = '<p class="no-comments">No reflections posted yet. Be the first to share your understanding.</p>';
    return;
  }

  comments.forEach(comment => {
    const card = document.createElement('div');
    card.className = 'comment-card';

    let timeStr = '';
    try {
      const dateObj = new Date(comment.created_at || comment.timestamp);
      timeStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      timeStr = comment.created_at || 'Just now';
    }

    const initial = comment.author ? comment.author.trim().charAt(0).toUpperCase() : '?';
    card.innerHTML = `
      <div class="comment-avatar">${escapeHtml(initial)}</div>
      <div class="comment-content">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(comment.author)}</span>
          <span class="comment-date">${timeStr}</span>
        </div>
        <div class="comment-text">${escapeHtml(comment.text)}</div>
      </div>
    `;
    commentsList.appendChild(card);
  });
}

// Submit comment
async function handleCommentSubmit(e) {
  e.preventDefault();
  if (!activePost) return;

  const author = commentAuthor.value.trim();
  const text = commentText.value.trim();
  const sessionId = getSessionId();

  if (!author || !text) return;

  const backend = getBackendType();

  if (backend === 'standalone') {
    const allComments = JSON.parse(localStorage.getItem('local_comments') || '[]');
    const newComment = {
      id: Date.now(),
      post_id: activePost.id,
      post_title: activePost.title,
      author,
      text,
      created_at: new Date().toISOString(),
      session_id: sessionId
    };
    allComments.push(newComment);
    localStorage.setItem('local_comments', JSON.stringify(allComments));

    commentText.value = '';
    loadComments(activePost.id);
    return;
  }

  if (backend === 'sheets') {
    try {
      await fetch(BLOG_CONFIG.googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          type: 'comments',
          post_id: activePost.id,
          post_title: activePost.title,
          author,
          text,
          session_id: sessionId
        })
      });
      commentText.value = '';
      // Reload comments after a brief delay for sheets processing
      setTimeout(() => loadComments(activePost.id), 1200);
    } catch (err) {
      console.error('Failed to submit comment to Google Sheets:', err);
      alert('Failed to connect to Google Sheets. Comment submission failed.');
    }
    return;
  }

  // Supabase mode
  const headers = getSupabaseHeaders();
  if (headers) {
    try {
      const response = await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          post_id: activePost.id,
          author,
          text
        })
      });
      if (response.ok) {
        commentText.value = '';
        loadComments(activePost.id);
      } else {
        alert('Could not submit comment. Please check database permissions.');
      }
    } catch (err) {
      console.error('Failed to submit comment to Supabase:', err);
      alert('Failed to connect to database. Comment submission failed.');
    }
  }
}

// Simple HTML escaping helper
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// SUPER ADMIN PANEL & VISITORS AUDIT LOG
// ==========================================================================

// Render post page views table in Admin Dashboard
function renderPostViewsTable() {
  const tableBody = document.getElementById('adminPostViewsTableBody');
  if (!tableBody) return;
  tableBody.innerHTML = '';

  if (decryptedPosts.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center">No posts found.</td></tr>';
    return;
  }

  // Group views by post_id (Total Views and Unique Viewers Sets)
  const totalViewsMap = {};
  const uniqueViewersMap = {};

  allViews.forEach(v => {
    const pid = Number(v.post_id);
    totalViewsMap[pid] = (totalViewsMap[pid] || 0) + 1;

    if (!uniqueViewersMap[pid]) {
      uniqueViewersMap[pid] = new Set();
    }
    if (v.visitor_id) {
      uniqueViewersMap[pid].add(v.visitor_id);
    }
  });

  decryptedPosts.forEach(post => {
    const row = document.createElement('tr');
    const pid = Number(post.id);
    const viewsCount = totalViewsMap[pid] || 0;
    const uniqueCount = uniqueViewersMap[pid] ? uniqueViewersMap[pid].size : 0;
    const formattedDate = formatDate(post.date);

    row.innerHTML = `
      <td>Post #${post.id}</td>
      <td><strong>${escapeHtml(post.title)}</strong></td>
      <td>${formattedDate}</td>
      <td><span class="text-success" style="font-weight: 600;">👁️ ${viewsCount}</span></td>
      <td><span class="text-warning" style="font-weight: 600;">👥 ${uniqueCount}</span></td>
    `;
    tableBody.appendChild(row);
  });
}

// Load logs and comments moderation
async function loadAdminAnalytics() {
  adminLogsTableBody.innerHTML = '<tr><td colspan="4" class="text-center">Fetching logs...</td></tr>';
  adminCommentsTableBody.innerHTML = '<tr><td colspan="4" class="text-center">Fetching comments...</td></tr>';
  if (adminPostViewsTableBody) {
    adminPostViewsTableBody.innerHTML = '<tr><td colspan="4" class="text-center">Fetching views...</td></tr>';
  }

  const backend = getBackendType();

  if (backend === 'standalone') {
    const localLogs = JSON.parse(localStorage.getItem('local_access_logs') || '[]');
    const localComments = JSON.parse(localStorage.getItem('local_comments') || '[]');
    allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
    allViews = JSON.parse(localStorage.getItem('local_views') || '[]');

    renderAdminLogs(localLogs);
    renderAdminComments(localComments);
    renderPostViewsTable();
    calculateStats(localLogs, localComments);
    return;
  }

  if (backend === 'sheets') {
    try {
      const response = await fetch(BLOG_CONFIG.googleSheetsUrl);
      if (response.ok) {
        const data = await response.json();
        const logs = data.access_logs || [];
        const comments = data.comments || [];
        allLikes = data.likes || [];
        allViews = data.views || [];

        renderAdminLogs(logs);
        renderAdminComments(comments);
        renderPostViewsTable();
        calculateStats(logs, comments);
      }
    } catch (err) {
      console.error('Failed to load admin analytics from Google Sheets:', err);
    }
    return;
  }

  // Supabase mode
  const headers = getSupabaseHeaders();
  if (!headers) {
    const localLogs = JSON.parse(localStorage.getItem('local_access_logs') || '[]');
    const localComments = JSON.parse(localStorage.getItem('local_comments') || '[]');
    allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
    allViews = JSON.parse(localStorage.getItem('local_views') || '[]');

    renderAdminLogs(localLogs);
    renderAdminComments(localComments);
    renderPostViewsTable();
    calculateStats(localLogs, localComments);
    return;
  }

  try {
    const logsRes = await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/access_logs?order=timestamp.desc&limit=50`, {
      method: 'GET',
      headers
    });

    const commentsRes = await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/comments?order=created_at.desc`, {
      method: 'GET',
      headers
    });

    const likesRes = await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/likes`, {
      method: 'GET',
      headers
    });

    if (logsRes.ok && commentsRes.ok) {
      const logs = await logsRes.json();
      const comments = await commentsRes.json();
      if (likesRes.ok) {
        allLikes = await likesRes.json();
      }
      allViews = JSON.parse(localStorage.getItem('local_views') || '[]');

      renderAdminLogs(logs);
      renderAdminComments(comments);
      renderPostViewsTable();
      calculateStats(logs, comments);
    }
  } catch (err) {
    console.error('Failed to load admin analytics:', err);
  }
}

// Calculate and render admin metrics
function calculateStats(logs, comments) {
  statTotalLogs.textContent = logs.length;
  statTotalComments.textContent = comments.length;

  const statTotalLikes = document.getElementById('statTotalLikes');
  if (statTotalLikes) {
    statTotalLikes.textContent = allLikes.length;
  }

  // Count success and blocked logins
  const success = logs.filter(l => {
    const act = (l.activity || '').toLowerCase();
    const stat = (l.status || '').toLowerCase();
    return act.includes('success') || stat.includes('success');
  }).length;

  const blocked = logs.filter(l => {
    const act = (l.activity || '').toLowerCase();
    const stat = (l.status || '').toLowerCase();
    return act.includes('blocked') || stat.includes('blocked');
  }).length;

  statSuccessLogins.textContent = success;
  statBlockedLogins.textContent = blocked;

  // Update new stats cards (Total Views and Unique Visitors)
  const statTotalViews = document.getElementById('statTotalViews');
  if (statTotalViews) {
    statTotalViews.textContent = allViews.length;
  }
  const statUniqueVisitors = document.getElementById('statUniqueVisitors');
  if (statUniqueVisitors) {
    const uniqueVids = new Set();
    allViews.forEach(v => { if (v.visitor_id) uniqueVids.add(v.visitor_id); });
    allLikes.forEach(l => { if (l.visitor_id) uniqueVids.add(l.visitor_id); });
    logs.forEach(l => {
      const act = l.activity || '';
      const match = act.match(/ID:\s*(visitor_[a-z0-9]+)/i);
      if (match) {
        uniqueVids.add(match[1]);
      }
    });
    statUniqueVisitors.textContent = Math.max(1, uniqueVids.size);
  }
}

// Render access logs table
function renderAdminLogs(logs) {
  adminLogsTableBody.innerHTML = '';

  if (logs.length === 0) {
    adminLogsTableBody.innerHTML = '<tr><td colspan="5" class="text-center">No logs recorded yet.</td></tr>';
    return;
  }

  logs.forEach(log => {
    const row = document.createElement('tr');

    let timeStr = '';
    try {
      const d = new Date(log.timestamp);
      timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      timeStr = log.timestamp;
    }

    // Fallbacks for older logs
    const logUser = log.user || 'Guest';
    const logActivity = log.activity || log.action || 'Unknown Action';
    const logSession = log.session_id || 'N/A';
    const logBrowser = log.browser_traceback || log.user_agent || 'Unknown';

    row.innerHTML = `
      <td>${timeStr}</td>
      <td><span class="user-badge">${escapeHtml(logUser)}</span></td>
      <td><strong>${escapeHtml(logActivity)}</strong></td>
      <td><code>${escapeHtml(logSession)}</code></td>
      <td title="${escapeHtml(logBrowser)}">${escapeHtml(truncateString(logBrowser, 50))}</td>
    `;
    adminLogsTableBody.appendChild(row);
  });
}

// Truncate string for layout aesthetics
function truncateString(str, num) {
  if (str.length <= num) return str;
  return str.slice(0, num) + '...';
}

// Render comments in admin moderation table
function renderAdminComments(comments) {
  adminCommentsTableBody.innerHTML = '';

  if (comments.length === 0) {
    adminCommentsTableBody.innerHTML = '<tr><td colspan="4" class="text-center">No comments exist.</td></tr>';
    return;
  }

  comments.forEach(comment => {
    const row = document.createElement('tr');

    row.innerHTML = `
      <td>Post #${comment.post_id}</td>
      <td><strong>${escapeHtml(comment.author)}</strong></td>
      <td>${escapeHtml(comment.text)}</td>
      <td>
        <button class="delete-btn" data-id="${comment.id}">Delete</button>
      </td>
    `;

    row.querySelector('.delete-btn').addEventListener('click', () => deleteComment(comment.id));
    adminCommentsTableBody.appendChild(row);
  });
}

// Delete comment from database (Admin command)
async function deleteComment(commentId) {
  if (!confirm('Are you sure you want to permanently delete this comment?')) return;

  const backend = getBackendType();

  if (backend === 'standalone') {
    const allComments = JSON.parse(localStorage.getItem('local_comments') || '[]');
    const filtered = allComments.filter(c => Number(c.id) !== Number(commentId));
    localStorage.setItem('local_comments', JSON.stringify(filtered));
    loadAdminAnalytics();
    return;
  }

  if (backend === 'sheets') {
    try {
      await fetch(BLOG_CONFIG.googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'delete_comment',
          comment_id: commentId
        })
      });
      writeAccessLog('Admin Deleted Comment', `Success (Comment ID: ${commentId})`);
      setTimeout(() => loadAdminAnalytics(), 1200);
    } catch (err) {
      console.error('Failed to delete comment from Google Sheets:', err);
      alert('Failed to delete comment due to database communication error.');
    }
    return;
  }

  // Supabase mode
  const headers = getSupabaseHeaders();
  if (headers) {
    try {
      const response = await fetch(`${BLOG_CONFIG.supabaseUrl}/rest/v1/comments?id=eq.${commentId}`, {
        method: 'DELETE',
        headers
      });
      if (response.ok) {
        writeAccessLog('Admin Deleted Comment', `Success (Comment ID: ${commentId})`);
        loadAdminAnalytics();
      } else {
        alert('Delete failed. Check Supabase access settings.');
      }
    } catch (err) {
      console.error('Failed to delete comment from Supabase:', err);
      alert('Failed to delete comment due to database error.');
    }
  }
}

// ==========================================================================
// REGULAR PASSWORD MANAGEMENT (Obsolete)
// ==========================================================================
// async function handleAdminPasswordSubmit(e) { ... }

// ==========================================================================
// VIEWS & FEEDBACK FUNCTIONALITY
// ==========================================================================

// Log post view
async function trackPostView(postId) {
  const sessionViewKey = `viewed_post_${postId}`;
  if (sessionStorage.getItem(sessionViewKey)) {
    return; // Already viewed this session, skip logging view
  }
  sessionStorage.setItem(sessionViewKey, 'true');

  const backend = getBackendType();
  const visitorId = getVisitorId();
  const post = decryptedPosts.find(p => Number(p.id) === Number(postId));
  const postTitle = post ? post.title : 'Unknown Post';
  const currentUser = localStorage.getItem('visitor_name') || 'Guest';
  const sessionId = getSessionId();

  // Track locally
  allViews.push({
    post_id: Number(postId),
    post_title: postTitle,
    user: currentUser,
    visitor_id: visitorId,
    created_at: new Date().toISOString(),
    session_id: sessionId
  });

  if (backend === 'standalone') {
    localStorage.setItem('local_views', JSON.stringify(allViews));
    return;
  }

  if (backend === 'sheets') {
    try {
      await fetch(BLOG_CONFIG.googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          type: 'views',
          post_id: Number(postId),
          post_title: postTitle,
          user: currentUser,
          visitor_id: visitorId,
          session_id: sessionId
        })
      });
    } catch (err) {
      console.error('Failed to log post view to Google Sheets:', err);
    }
    return;
  }
}

// Render Feedback cards in UI
function renderFeedbackList() {
  const feedbackList = document.getElementById('feedbackList');
  if (!feedbackList) return;
  feedbackList.innerHTML = '';

  if (allFeedback.length === 0) {
    feedbackList.innerHTML = '<p class="no-comments">No feedback posted yet. Be the first to share your feedback.</p>';
    return;
  }

  // Newest feedback first
  const sortedFeedback = [...allFeedback].reverse();

  sortedFeedback.forEach(fb => {
    const card = document.createElement('div');
    card.className = 'comment-card'; // Reuse comment card styling

    let timeStr = '';
    try {
      const dateObj = new Date(fb.created_at || fb.timestamp);
      timeStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      timeStr = fb.created_at || 'Just now';
    }

    // Generate stars HTML
    let starsHtml = '';
    const rating = Number(fb.rating) || 5;
    for (let i = 1; i <= 5; i++) {
      if (i <= rating) {
        starsHtml += '<span class="text-success" style="color: #fbbf24; font-size: 1rem; margin-right: 2px;">&#9733;</span>';
      } else {
        starsHtml += '<span style="color: var(--text-muted); font-size: 1rem; margin-right: 2px;">&#9734;</span>';
      }
    }

    const initial = fb.author ? fb.author.trim().charAt(0).toUpperCase() : '?';

    card.innerHTML = `
      <div class="comment-avatar">${escapeHtml(initial)}</div>
      <div class="comment-content">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(fb.author)}</span>
          <span class="comment-date">${timeStr}</span>
        </div>
        <div style="margin-bottom: 0.5rem; display: flex; gap: 2px;">${starsHtml}</div>
        <div class="comment-text">${escapeHtml(fb.text)}</div>
      </div>
    `;

    // Show Delete button for admin moderation inline
    if (isAdminLogged) {
      const header = card.querySelector('.comment-header');
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.style.padding = '0.15rem 0.5rem';
      deleteBtn.style.fontSize = '0.75rem';
      deleteBtn.style.marginLeft = 'auto';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => deleteFeedback(fb.id));
      header.appendChild(deleteBtn);
    }

    feedbackList.appendChild(card);
  });
}

// Submit feedback
async function handleFeedbackSubmit(e) {
  e.preventDefault();
  const authorEl = document.getElementById('feedbackAuthor');
  const textEl = document.getElementById('feedbackText');
  if (!authorEl || !textEl) return;

  const author = authorEl.value.trim();
  const text = textEl.value.trim();
  const rating = selectedRating;
  const sessionId = getSessionId();

  if (!author || !text) return;

  const backend = getBackendType();
  const newFeedback = {
    id: Date.now(),
    author,
    rating,
    text,
    created_at: new Date().toISOString(),
    session_id: sessionId
  };

  allFeedback.push(newFeedback);

  // Clear input fields
  textEl.value = '';
  // Reset rating stars to 5
  selectedRating = 5;
  const stars = document.querySelectorAll('#feedbackStars .star');
  stars.forEach(s => s.classList.remove('selected'));

  if (backend === 'standalone') {
    localStorage.setItem('local_feedback', JSON.stringify(allFeedback));
    renderFeedbackList();
    alert('Feedback submitted locally!');
    return;
  }

  if (backend === 'sheets') {
    try {
      await fetch(BLOG_CONFIG.googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          type: 'feedback',
          author,
          rating,
          text,
          session_id: sessionId
        })
      });
      alert('Feedback submitted successfully!');
      setTimeout(fetchBackendData, 1200);
    } catch (err) {
      console.error('Failed to submit feedback to Google Sheets:', err);
      alert('Failed to connect to Google Sheets. Feedback submission failed.');
    }
    return;
  }
}

// Delete feedback (Admin command)
async function deleteFeedback(feedbackId) {
  if (!confirm('Are you sure you want to permanently delete this feedback?')) return;

  const backend = getBackendType();
  allFeedback = allFeedback.filter(fb => Number(fb.id) !== Number(feedbackId));

  if (backend === 'standalone') {
    localStorage.setItem('local_feedback', JSON.stringify(allFeedback));
    renderFeedbackList();
    return;
  }

  if (backend === 'sheets') {
    try {
      await fetch(BLOG_CONFIG.googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'delete_feedback',
          feedback_id: feedbackId
        })
      });
      writeAccessLog('Admin Deleted Feedback', `Success (ID: ${feedbackId})`);
      setTimeout(fetchBackendData, 1200);
    } catch (err) {
      console.error('Failed to delete feedback from Google Sheets:', err);
    }
    return;
  }
}

// Handle Admin Publish Reflection Submit
async function handleAdminPublishSubmit(e) {
  e.preventDefault();
  const titleEl = document.getElementById('postTitleInput');
  const contentEl = document.getElementById('postContentInput');
  if (!titleEl || !contentEl) return;

  const title = titleEl.value.trim();
  const content = contentEl.value.trim();
  if (!title || !content) return;

  const publishBtn = e.target.querySelector('button[type="submit"]');
  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.textContent = 'Publishing...';
  }

  try {
    const password = activeDecryptionPassword || "thoughts";

    // Get current date and time formatted
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB'); // DD/MM/YYYY
    const dateParts = dateStr.split('/');
    const shortDate = `${dateParts[0]}/${dateParts[1]}/${dateParts[2].slice(-2)}`; // DD/MM/YY

    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    const postPayload = {
      title: title,
      date: shortDate,
      time: timeStr,
      content: content
    };

    // Encrypt post payload
    const encrypted = await encryptPayload(password, postPayload);
    const encryptedStr = JSON.stringify(encrypted);

    const backend = getBackendType();

    if (backend === 'standalone') {
      const localDynamic = JSON.parse(localStorage.getItem('local_dynamic_posts') || '[]');
      localDynamic.push({
        id: Date.now(),
        encrypted_data: encryptedStr,
        created_at: now.toISOString()
      });
      localStorage.setItem('local_dynamic_posts', JSON.stringify(localDynamic));
      alert('Thought published locally!');
      titleEl.value = '';
      contentEl.value = '';
      await fetchBackendData(); // Reload and render combined feed
    } else if (backend === 'sheets') {
      await fetch(BLOG_CONFIG.googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          type: 'posts',
          encrypted_data: encryptedStr
        })
      });
      alert('Thought published successfully to Google Sheets!');
      titleEl.value = '';
      contentEl.value = '';
      // Reload combined feed after a brief delay
      setTimeout(async () => {
        await fetchBackendData();
      }, 1200);
    }
  } catch (err) {
    console.error('Failed to publish dynamic post:', err);
    alert('Failed to publish post: ' + err.message);
  } finally {
    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.textContent = 'Publish Reflection';
    }
  }
}

// ==========================================================================
// INQUIRY SHARING, TOASTS, SCROLL NAVIGATORS & TEXT SCALING
// ==========================================================================

// Global Toast helper
function showToast(message) {
  let toast = document.getElementById('customToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'customToast';
    toast.className = 'toast-notification';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `
    <svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>${message}</span>
  `;
  // Trigger reflow
  toast.offsetHeight;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Deep Linking: Check URL hash and open post if matched
function checkHashAndOpenPost() {
  const hash = window.location.hash;
  if (hash.startsWith('#post-')) {
    const postId = hash.substring(6);
    // Find the post
    const post = activeFeedPosts.find(p => String(p.id) === postId);
    if (post) {
      openReader(post);
    }
  }
}

// Modal Font Size adjusters
let currentFontSizeLevel = Number(localStorage.getItem('modal_font_size_level') || 0); // ranges from -2 to 3
const fontSizes = ['0.95rem', '1.08rem', '1.18rem', '1.3rem', '1.45rem', '1.6rem'];

function applyFontSize() {
  const size = fontSizes[currentFontSizeLevel + 2]; // 0 corresponds to index 2
  const modalContent = document.getElementById('modalContent');
  if (modalContent) {
    modalContent.style.setProperty('--modal-font-size', size);
  }
  const decBtn = document.getElementById('fontSizeDecBtn');
  const incBtn = document.getElementById('fontSizeIncBtn');
  if (decBtn) decBtn.disabled = (currentFontSizeLevel === -2);
  if (incBtn) incBtn.disabled = (currentFontSizeLevel === 3);
}

// Init font scaling & click bindings, deep linking listeners, and scroll-to-top behaviors
function setupAdditionalFeatures() {
  // Bind Font size adjuster actions
  const decBtn = document.getElementById('fontSizeDecBtn');
  const incBtn = document.getElementById('fontSizeIncBtn');
  if (decBtn) {
    decBtn.addEventListener('click', () => {
      if (currentFontSizeLevel > -2) {
        currentFontSizeLevel--;
        localStorage.setItem('modal_font_size_level', currentFontSizeLevel);
        applyFontSize();
      }
    });
  }
  if (incBtn) {
    incBtn.addEventListener('click', () => {
      if (currentFontSizeLevel < 3) {
        currentFontSizeLevel++;
        localStorage.setItem('modal_font_size_level', currentFontSizeLevel);
        applyFontSize();
      }
    });
  }
  applyFontSize();

  // Modal Share button handler (Top & Bottom)
  const modalShareBtn = document.getElementById('modalShareBtn');
  if (modalShareBtn) {
    modalShareBtn.addEventListener('click', () => {
      if (activePost) {
        const shareUrl = `${window.location.origin}${window.location.pathname}#post-${activePost.id}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
          showToast('Inquiry link copied to clipboard!');
        }).catch(err => {
          console.error('Could not copy text: ', err);
        });
      }
    });
  }
  const modalShareBtnBottom = document.getElementById('modalShareBtnBottom');
  if (modalShareBtnBottom) {
    modalShareBtnBottom.addEventListener('click', () => {
      if (activePost) {
        const shareUrl = `${window.location.origin}${window.location.pathname}#post-${activePost.id}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
          showToast('Inquiry link copied to clipboard!');
        }).catch(err => {
          console.error('Could not copy text: ', err);
        });
      }
    });
  }

  // Scroll to Top action
  const scrollToTopBtn = document.getElementById('scrollToTopBtn');
  if (scrollToTopBtn) {
    scrollToTopBtn.addEventListener('click', () => {
      if (!readingModal.classList.contains('hidden')) {
        readingModal.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      } else {
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    });

    const handleScroll = () => {
      const scrollPos = !readingModal.classList.contains('hidden') ? readingModal.scrollTop : window.scrollY;
      if (scrollPos > 400) {
        scrollToTopBtn.classList.add('show');
      } else {
        scrollToTopBtn.classList.remove('show');
      }
    };

    window.addEventListener('scroll', handleScroll);
    readingModal.addEventListener('scroll', handleScroll);
  }

  // Hashchange events (back-button close or direct linking)
  window.addEventListener('hashchange', () => {
    if (!blogApp.classList.contains('hidden')) {
      const hash = window.location.hash;
      if (hash.startsWith('#post-')) {
        checkHashAndOpenPost();
      } else {
        if (!readingModal.classList.contains('hidden')) {
          closeReader(false); // Close reader without overwriting history again
        }
      }
    }
  });

  // Sort dropdown change event listener
  const postSortSelect = document.getElementById('postSortSelect');
  if (postSortSelect) {
    postSortSelect.addEventListener('change', () => {
      refreshCurrentFeed();
    });
  }
}

// Invoke setup for additional elements on load
document.addEventListener('DOMContentLoaded', () => {
  setupAdditionalFeatures();
});
