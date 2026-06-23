// ==========================================================================
// Thoughts & Values - Client Application Logic with Sidebar Filters & Supabase
// ==========================================================================

// Global state
let decryptedPosts = [];
let activeTheme = 'dark';
let activePost = null;
let isAdminLogged = false;
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
  
  if (backend === 'standalone') {
    try {
      const localLogs = JSON.parse(localStorage.getItem('local_access_logs') || '[]');
      localLogs.unshift({
        timestamp: new Date().toISOString(),
        action,
        status,
        user_agent: userAgent
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'access_logs',
          action,
          status,
          user_agent: userAgent
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
          action,
          status,
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
const settingsToggle = document.getElementById('settingsToggle');
const settingsDrawer = document.getElementById('settingsDrawer');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const searchInput = document.getElementById('searchInput');
const postsContainer = document.getElementById('postsContainer');
const currentYearSpan = document.getElementById('currentYear');
const footerAuthorSpan = document.getElementById('footerAuthor');
const blogTitleEl = document.getElementById('blogTitle');
const blogSubtitleEl = document.getElementById('blogSubtitle');
const standaloneBanner = document.getElementById('standaloneBanner');
const statPostCount = document.getElementById('statPostCount');

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

// Hash Tool Elements
const newPasswordInput = document.getElementById('newPasswordInput');
const generateHashBtn = document.getElementById('generateHashBtn');
const hashResultWrapper = document.getElementById('hashResultWrapper');
const hashResultOutput = document.getElementById('hashResultOutput');
const copyHashBtn = document.getElementById('copyHashBtn');
const copiedMsg = document.getElementById('copiedMsg');

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
  settingsToggle.addEventListener('click', () => toggleDrawer(true));
  settingsCloseBtn.addEventListener('click', () => toggleDrawer(false));
  settingsDrawer.addEventListener('click', (e) => {
    if (e.target === settingsDrawer) toggleDrawer(false);
  });
  
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

  // Modal like button event
  const modalLikeBtn = document.getElementById('modalLikeBtn');
  if (modalLikeBtn) {
    modalLikeBtn.addEventListener('click', () => {
      if (activePost) {
        toggleLike(activePost.id);
      }
    });
  }
  
  // Hash Tool events
  generateHashBtn.addEventListener('click', generatePasswordHash);
  copyHashBtn.addEventListener('click', copyHashResult);
  
  // Tag pills navigation setup
  setupTagFilters();
 
  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeReader();
      toggleDrawer(false);
    }
  });

  // Track scroll inside modal for reading progress bar
  readingModal.addEventListener('scroll', updateReadingProgress);
});

// Apply config.js configurations
function applyConfig() {
  if (typeof BLOG_CONFIG !== 'undefined') {
    document.title = BLOG_CONFIG.title;
    blogTitleEl.textContent = BLOG_CONFIG.title;
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

// Toggle Drawer (Open/Close)
function toggleDrawer(open) {
  if (open) {
    settingsDrawer.classList.remove('hidden');
    // Force reflow
    settingsDrawer.offsetHeight;
    settingsDrawer.style.opacity = '1';
  } else {
    settingsDrawer.style.opacity = '0';
    setTimeout(() => {
      settingsDrawer.classList.add('hidden');
    }, 300);
  }
}

// Check if password exists in local storage
async function checkSavedSession() {
  const savedPassword = localStorage.getItem('journal_password');
  if (savedPassword) {
    try {
      passwordInput.value = savedPassword;
      unlockBtn.disabled = true;
      unlockBtn.querySelector('span').textContent = 'Decrypting...';
      
      // Check if saved password is admin
      const hash = await sha256(savedPassword);
      const isSuperAdmin = (hash === BLOG_CONFIG.adminPasswordHash);
      const decryptPassword = isSuperAdmin ? "thoughts" : savedPassword;
      
      const decrypted = await fetchAndDecrypt(decryptPassword);
      if (decrypted) {
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
        showApp();
      }
    } catch (err) {
      console.warn('Saved session password expired or invalid.');
      localStorage.removeItem('journal_password');
      passwordInput.value = '';
    } finally {
      unlockBtn.disabled = false;
      unlockBtn.querySelector('span').textContent = 'Unlock Journal';
    }
  }
}

// Handle Login submit
async function handleLogin(e) {
  e.preventDefault();
  const password = passwordInput.value;
  const name = visitorNameInput ? visitorNameInput.value.trim() : '';
  
  if (!password || !name) return;
  
  loginError.classList.remove('show');
  unlockBtn.disabled = true;
  unlockBtn.querySelector('span').textContent = 'Decrypting...';
  
  try {
    // Check if the typed password matches the Super Admin hash
    const hash = await sha256(password);
    const isSuperAdmin = (hash === BLOG_CONFIG.adminPasswordHash);
    const decryptPassword = isSuperAdmin ? "thoughts" : password;
    
    const decrypted = await fetchAndDecrypt(decryptPassword);
    if (decrypted) {
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
      showApp();
      
      const logType = isSuperAdmin ? 'Admin Login' : 'Visitor Login';
      writeAccessLog(logType, `Success (Name: ${name})`);
    } else {
      showLoginError();
      writeAccessLog('Visitor Login', `Blocked (Invalid Password, Name: ${name})`);
    }
  } catch (err) {
    console.error(err);
    showLoginError();
    writeAccessLog('Visitor Login', `Blocked (System Decryption Failure, Name: ${name})`);
  } finally {
    unlockBtn.disabled = false;
    unlockBtn.querySelector('span').textContent = 'Unlock Journal';
  }
}

function showLoginError() {
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
  
  blogApp.classList.add('hidden');
  lockScreen.classList.remove('hidden');
}

// Show the app UI and render posts
async function showApp() {
  lockScreen.classList.add('hidden');
  blogApp.classList.remove('hidden');
  await fetchBackendData(); // Fetch likes, views, and feedback
  switchView('feedView');   // Default to Feed SPA view
  renderPosts(decryptedPosts);
  if (statPostCount) {
    statPostCount.textContent = decryptedPosts.length;
  }
  searchInput.focus();
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
        <h3>No thoughts found</h3>
        <p>Try searching for other keywords or terms.</p>
      </div>
    `;
    if (postCount) {
      postCount.textContent = '0 thoughts found';
    }
    return;
  }
  
  if (postCount) {
    postCount.textContent = `${postsToRender.length} ${postsToRender.length === 1 ? 'thought' : 'thoughts'} found`;
  }
  
  // Group views by post_id
  const viewsCountMap = {};
  allViews.forEach(v => {
    viewsCountMap[v.post_id] = (viewsCountMap[v.post_id] || 0) + 1;
  });

  postsToRender.forEach(post => {
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
          <span>Open full thought</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </button>
        <button class="like-btn" data-id="${post.id}" title="Like post">
          <svg class="heart-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
          <span class="like-count">0</span>
        </button>
      </div>
    `;
    
    // Setup click handlers for reading mode
    card.querySelector('.read-more-btn').addEventListener('click', () => openReader(post));
    
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
    renderPosts(decryptedPosts);
    return;
  }
  
  const filtered = decryptedPosts.filter(post => {
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
        renderPosts(decryptedPosts);
        return;
      }
      
      const filtered = decryptedPosts.filter(post => {
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
  
  // Calculate views count including this new view
  const viewsCountMap = {};
  allViews.forEach(v => {
    viewsCountMap[v.post_id] = (viewsCountMap[v.post_id] || 0) + 1;
  });
  const currentViews = (viewsCountMap[post.id] || 0) + 1;
  
  modalDate.textContent = `${formatDate(post.date)}${post.time ? ' • ' + post.time : ''}`;
  modalReadTime.textContent = `${calculateReadTime(post.content)} • 👁️ ${currentViews} ${currentViews === 1 ? 'view' : 'views'}`;
  modalContent.innerHTML = formatPostContent(post.content);
  
  // Log the view to database
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
function closeReader() {
  readingModal.classList.add('hidden');
  document.body.style.overflow = ''; // Restore main scroll
  progressBar.style.width = '0%';
  activePost = null;
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

// Fetch likes, views, and feedback from backend
async function fetchBackendData() {
  const backend = getBackendType();
  if (backend === 'standalone') {
    allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
    allViews = JSON.parse(localStorage.getItem('local_views') || '[]');
    allFeedback = JSON.parse(localStorage.getItem('local_feedback') || '[]');
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
      } else {
        allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
        allViews = JSON.parse(localStorage.getItem('local_views') || '[]');
        allFeedback = JSON.parse(localStorage.getItem('local_feedback') || '[]');
      }
    } catch (err) {
      console.error('Failed to load backend data from Google Sheets:', err);
      allLikes = JSON.parse(localStorage.getItem('local_likes') || '[]');
      allViews = JSON.parse(localStorage.getItem('local_views') || '[]');
      allFeedback = JSON.parse(localStorage.getItem('local_feedback') || '[]');
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
  
  // Update modal like button
  if (activePost) {
    const modalLikeBtn = document.getElementById('modalLikeBtn');
    const modalLikeCount = document.getElementById('modalLikeCount');
    const count = likesCount[activePost.id] || 0;
    if (modalLikeCount) modalLikeCount.textContent = count;
    
    if (modalLikeBtn) {
      if (visitorLiked.has(activePost.id)) {
        modalLikeBtn.classList.add('liked');
      } else {
        modalLikeBtn.classList.remove('liked');
      }
    }
  }
}

// Toggle like for a post
async function toggleLike(postId) {
  const visitorId = getVisitorId();
  const backend = getBackendType();
  
  const existingIndex = allLikes.findIndex(l => Number(l.post_id) === Number(postId) && l.visitor_id === visitorId);
  const isLiked = existingIndex !== -1;
  
  if (backend === 'standalone') {
    // Local storage only
    if (isLiked) {
      allLikes.splice(existingIndex, 1);
    } else {
      allLikes.push({
        post_id: Number(postId),
        visitor_id: visitorId,
        created_at: new Date().toISOString()
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
          headers: { 'Content-Type': 'application/json' },
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'likes',
            post_id: Number(postId),
            visitor_id: visitorId
          })
        });
        allLikes.push({
          post_id: Number(postId),
          visitor_id: visitorId,
          created_at: new Date().toISOString()
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
    } catch(e) {
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
  
  if (!author || !text) return;
  
  const backend = getBackendType();
  
  if (backend === 'standalone') {
    const allComments = JSON.parse(localStorage.getItem('local_comments') || '[]');
    const newComment = {
      id: Date.now(),
      post_id: activePost.id,
      author,
      text,
      created_at: new Date().toISOString()
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'comments',
          post_id: activePost.id,
          author,
          text
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
    tableBody.innerHTML = '<tr><td colspan="4" class="text-center">No posts found.</td></tr>';
    return;
  }
  
  // Group views by post_id
  const viewsCountMap = {};
  allViews.forEach(v => {
    viewsCountMap[v.post_id] = (viewsCountMap[v.post_id] || 0) + 1;
  });
  
  decryptedPosts.forEach(post => {
    const row = document.createElement('tr');
    const viewsCount = viewsCountMap[post.id] || 0;
    const formattedDate = formatDate(post.date);
    
    row.innerHTML = `
      <td>Post #${post.id}</td>
      <td><strong>${escapeHtml(post.title)}</strong></td>
      <td>${formattedDate}</td>
      <td><span class="text-success" style="font-weight: 600;">👁️ ${viewsCount}</span></td>
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
  
  const success = logs.filter(l => l.status === 'Success').length;
  const blocked = logs.filter(l => l.status.startsWith('Blocked')).length;
  
  statSuccessLogins.textContent = success;
  statBlockedLogins.textContent = blocked;
}

// Render access logs table
function renderAdminLogs(logs) {
  adminLogsTableBody.innerHTML = '';
  
  if (logs.length === 0) {
    adminLogsTableBody.innerHTML = '<tr><td colspan="4" class="text-center">No logs recorded yet.</td></tr>';
    return;
  }
  
  logs.forEach(log => {
    const row = document.createElement('tr');
    
    let timeStr = '';
    try {
      const d = new Date(log.timestamp);
      timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch(e) {
      timeStr = log.timestamp;
    }
    
    const isSuccess = log.status === 'Success';
    const statusClass = isSuccess ? 'text-success' : 'text-error';
    
    row.innerHTML = `
      <td>${timeStr}</td>
      <td><strong>${escapeHtml(log.action)}</strong></td>
      <td class="${statusClass}">${escapeHtml(log.status)}</td>
      <td title="${escapeHtml(log.user_agent || '')}">${escapeHtml(truncateString(log.user_agent || 'Unknown', 45))}</td>
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
// PASSWORD HASH GENERATOR (DRAWER TOOL)
// ==========================================================================

// Generate new SHA-256 hash (in Settings Drawer)
async function generatePasswordHash() {
  const text = newPasswordInput.value.trim();
  if (!text) return;
  
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    hashResultOutput.value = hashHex;
    hashResultWrapper.classList.remove('hidden');
    copiedMsg.classList.add('hidden');
  } catch (err) {
    console.error('Failed to generate hash:', err);
  }
}

// Copy hash result output to clipboard
function copyHashResult() {
  hashResultOutput.select();
  navigator.clipboard.writeText(hashResultOutput.value)
    .then(() => {
      copiedMsg.classList.remove('hidden');
      setTimeout(() => {
        copiedMsg.classList.add('hidden');
      }, 3000);
    })
    .catch(err => {
      console.error('Failed to copy text:', err);
    });
}

// ==========================================================================
// VIEWS & FEEDBACK FUNCTIONALITY
// ==========================================================================

// Log post view
async function trackPostView(postId) {
  const backend = getBackendType();
  const visitorId = getVisitorId();
  
  // Track locally
  allViews.push({
    post_id: Number(postId),
    visitor_id: visitorId,
    created_at: new Date().toISOString()
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'views',
          post_id: Number(postId),
          visitor_id: visitorId
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
    } catch(e) {
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
  
  if (!author || !text) return;
  
  const backend = getBackendType();
  const newFeedback = {
    id: Date.now(),
    author,
    rating,
    text,
    created_at: new Date().toISOString()
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'feedback',
          author,
          rating,
          text
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
