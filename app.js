import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, getBlob } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js';
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';

// Make Firebase functions available globally
window.initializeApp = initializeApp;
window.getStorage = getStorage;
window.ref = ref;
window.uploadBytes = uploadBytes;
window.getDownloadURL = getDownloadURL;
window.getBlob = getBlob;
window.deleteObject = deleteObject;
window.getFirestore = getFirestore;
window.doc = doc;
window.setDoc = setDoc;
window.getDoc = getDoc;
window.getDocs = getDocs;
window.collection = collection;
window.deleteDoc = deleteDoc;
window.writeBatch = writeBatch;

// Firebase Configuration
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDNc_152gswIKOF8khKdDqbfGb7KuA6-gA",
    authDomain: "vault-4b8d7.firebaseapp.com",
    projectId: "vault-4b8d7",
    storageBucket: "vault-4b8d7.firebasestorage.app",
    messagingSenderId: "49008360494",
    appId: "1:49008360494:web:c0f621dfc1a32737dc3c7c"
};

window.FIREBASE_CONFIG = FIREBASE_CONFIG;

// Global state
window.app = null;
window.storage = null;
window.db = null;
window.encryptionKey = null;
window.photos = [];
window.notes = [];
window.files = [];
window.imageCache = new Map(); // Cache decrypted images to avoid re-downloading
window.thumbnailCache = new Map(); // Cache thumbnail data URLs
window.currentFolder = 'All Photos';
window.folders = ['All Photos', 'Favorites'];
window.currentPhotoId = null;
window.currentNoteId = null;
window.currentUsername = null;
window.currentPhotoIndex = 0;
window.currentPhotoList = [];
window.currentTab = 'photos';
window.lazyLoadObserver = null;
window.infiniteScrollObserver = null;
window.displayLimit = 30; // Initial number of photos to display
window.displayedCount = 30;

// ==================== SECURITY HELPERS ====================
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Memory management - clear full-size image cache if it gets too large
function manageImageCache() {
    const MAX_CACHE_SIZE = 20; // Keep only 20 full-size images in memory

    if (window.imageCache.size > MAX_CACHE_SIZE) {
        // Convert to array and keep only the most recent entries
        const entries = Array.from(window.imageCache.entries());
        const toKeep = entries.slice(-MAX_CACHE_SIZE);

        window.imageCache.clear();
        toKeep.forEach(([key, value]) => {
            window.imageCache.set(key, value);
        });
    }
}

// Rate limiting for login attempts
const loginAttempts = {
    count: 0,
    lastAttempt: 0,
    isBlocked() {
        const now = Date.now();
        const timeSinceLastAttempt = now - this.lastAttempt;

        // Reset counter after 15 minutes
        if (timeSinceLastAttempt > 15 * 60 * 1000) {
            this.count = 0;
            return false;
        }

        // Block after 5 failed attempts
        if (this.count >= 5) {
            const remainingTime = Math.ceil((15 * 60 * 1000 - timeSinceLastAttempt) / 1000 / 60);
            return remainingTime;
        }

        return false;
    },
    recordAttempt() {
        this.count++;
        this.lastAttempt = Date.now();
    },
    reset() {
        this.count = 0;
        this.lastAttempt = 0;
    }
};

// ==================== DARK MODE ====================
window.toggleDarkMode = function() {
    const html = document.documentElement;
    const toggle = document.getElementById('darkModeToggle');
    const isDark = html.getAttribute('data-theme') === 'dark';
    
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    toggle.classList.toggle('active');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
};

// Initialize theme
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
if (savedTheme === 'dark') {
    setTimeout(() => {
        document.getElementById('darkModeToggle')?.classList.add('active');
    }, 100);
}

// ==================== TAB NAVIGATION ====================
window.switchTab = function(tab) {
    window.currentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`${tab}Tab`).classList.add('active');

    // Update tab sections
    document.querySelectorAll('.tab-section').forEach(section => section.classList.remove('active'));
    document.getElementById(`${tab}Section`).classList.add('active');

    // Load data if needed
    if (tab === 'notes' && window.notes.length === 0) {
        loadNotes();
    } else if (tab === 'files' && window.files.length === 0) {
        loadFiles();
    }
};

// ==================== SETTINGS MENU ====================
window.showSettings = function() {
    document.getElementById('settingsMenu').classList.add('active');
    document.getElementById('currentUsername').textContent = window.currentUsername || '-';
};

window.hideSettings = function() {
    document.getElementById('settingsMenu').classList.remove('active');
};

// ==================== AUTH FUNCTIONS ====================
window.switchToSignup = function() {
    document.getElementById('authTitle').textContent = 'Create Account';
    document.getElementById('authSubtitle').textContent = 'Choose a username and password';
    document.getElementById('passwordForm').classList.add('hidden');
    document.getElementById('setupForm').classList.remove('hidden');
};

window.switchToLogin = function() {
    document.getElementById('authTitle').textContent = 'Welcome Back';
    document.getElementById('authSubtitle').textContent = 'Enter your credentials';
    document.getElementById('setupForm').classList.add('hidden');
    document.getElementById('passwordForm').classList.remove('hidden');
};

window.initializeWithPassword = async function() {
    const blocked = loginAttempts.isBlocked();
    if (blocked) {
        alert(`Too many failed attempts. Please wait ${blocked} minutes before trying again.`);
        return;
    }

    const username = document.getElementById('setupUsername').value.trim().toLowerCase();
    const password = document.getElementById('setupPassword').value;
    const confirmPassword = document.getElementById('setupPasswordConfirm').value;

    if (!username || username.length < 3) {
        alert('Username must be at least 3 characters');
        return;
    }

    if (!password || password.length < 12) {
        alert('Password must be at least 12 characters for security');
        return;
    }

    if (password !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }

    try {
        window.app = window.initializeApp(window.FIREBASE_CONFIG);
        window.storage = window.getStorage(window.app);
        window.db = window.getFirestore(window.app);

        const userDoc = await window.getDoc(window.doc(window.db, 'users', username));
        if (userDoc.exists()) {
            loginAttempts.recordAttempt();
            alert('Username already taken. Please choose another.');
            return;
        }

        // Set username before deriving key (needed for salt)
        window.currentUsername = username;

        const passwordHash = await hashPassword(password);
        await window.setDoc(window.doc(window.db, 'users', username), {
            passwordHash: passwordHash,
            createdAt: new Date().toISOString(),
            photoCount: 0
        });

        window.encryptionKey = await deriveKey(password);

        localStorage.setItem('username', username);
        localStorage.setItem('passwordHash', passwordHash);

        if (await isBiometricAvailable()) {
            const dialog = document.createElement('div');
            dialog.className = 'modal active';
            dialog.innerHTML = `
                <div class="auth-card" style="margin: 0;">
                    <div class="auth-header">
                        <h2 class="auth-title">Enable Biometric?</h2>
                        <p class="auth-subtitle">Use Face ID / Touch ID for faster login</p>
                    </div>
                    <button class="btn btn-primary" style="width: 100%;" id="enableBiometricBtn">Enable</button>
                    <button class="btn btn-secondary" style="width: 100%; margin-top: 0.75rem;" onclick="this.closest('.modal').remove(); finalizeVaultSetup()">Skip</button>
                </div>
            `;
            document.body.appendChild(dialog);
            document.getElementById('enableBiometricBtn').addEventListener('click', () => enableBiometricConfirm(password));
            return;
        }

        finalizeVaultSetup();
    } catch (error) {
        console.error('Setup error:', error);
        alert('Setup failed: ' + error.message);
    }
};

window.enableBiometricConfirm = async function(password) {
    await setupBiometric(password);
    document.querySelector('.modal.active').remove();
    finalizeVaultSetup();
};

window.finalizeVaultSetup = function() {
    showVault();
    loadPhotos();
};

window.login = async function() {
    const blocked = loginAttempts.isBlocked();
    if (blocked) {
        alert(`Too many failed attempts. Please wait ${blocked} minutes before trying again.`);
        return;
    }

    const username = document.getElementById('username').value.trim().toLowerCase();
    const password = document.getElementById('password').value;

    if (!username) {
        alert('Please enter username');
        return;
    }

    if (!password) {
        alert('Please enter password');
        return;
    }

    try {
        window.app = window.initializeApp(window.FIREBASE_CONFIG);
        window.storage = window.getStorage(window.app);
        window.db = window.getFirestore(window.app);

        const userDoc = await window.getDoc(window.doc(window.db, 'users', username));

        if (!userDoc.exists()) {
            loginAttempts.recordAttempt();
            alert('Username not found. Please sign up first.');
            return;
        }

        const userData = userDoc.data();
        const passwordHash = await hashPassword(password);

        if (passwordHash !== userData.passwordHash) {
            loginAttempts.recordAttempt();
            alert('Incorrect password');
            return;
        }

        // Successful login - reset rate limiter
        loginAttempts.reset();

        // Set username before deriving key (needed for salt)
        window.currentUsername = username;
        window.encryptionKey = await deriveKey(password);

        localStorage.setItem('username', username);
        localStorage.setItem('passwordHash', passwordHash);

        showVault();
        await loadPhotos();
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed: ' + error.message);
    }
};

window.loginWithBiometric = async function() {
    try {
        const biometricDataStr = localStorage.getItem('biometricAuth');
        if (!biometricDataStr) throw new Error('Biometric not setup');

        const biometricData = JSON.parse(biometricDataStr);
        
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge,
                allowCredentials: [{
                    id: base64ToArrayBuffer(biometricData.credentialId),
                    type: 'public-key',
                    transports: ['internal']
                }],
                timeout: 60000,
                userVerification: "required"
            }
        });

        if (!assertion) throw new Error('Biometric failed');

        const key = await crypto.subtle.importKey(
            'raw',
            base64ToArrayBuffer(biometricData.key),
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        const decryptedPasswordBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: base64ToArrayBuffer(biometricData.iv) },
            key,
            base64ToArrayBuffer(biometricData.encryptedPassword)
        );

        const decoder = new TextDecoder();
        const password = decoder.decode(decryptedPasswordBuffer);

        window.currentUsername = biometricData.username;

        window.app = window.initializeApp(window.FIREBASE_CONFIG);
        window.storage = window.getStorage(window.app);
        window.db = window.getFirestore(window.app);
        window.encryptionKey = await deriveKey(password);

        showVault();
        await loadPhotos();
    } catch (error) {
        console.error('Biometric login error:', error);
        alert('Biometric login failed. Please use password.');
    }
};

function showVault() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainHeader').classList.remove('hidden');
    document.getElementById('mainContent').classList.remove('hidden');
}

window.logout = function() {
    if (confirm('Are you sure you want to logout?')) {
        window.encryptionKey = null;
        window.photos = [];
        window.notes = [];
        window.files = [];
        window.imageCache.clear();
        window.thumbnailCache.clear();

        // Disconnect observers
        if (window.lazyLoadObserver) {
            window.lazyLoadObserver.disconnect();
        }
        if (window.infiniteScrollObserver) {
            window.infiniteScrollObserver.disconnect();
        }

        location.reload();
    }
};

// ==================== FAVORITES ====================
window.toggleFavorite = async function(photoId, event) {
    event.stopPropagation();
    
    const photo = window.photos.find(p => p.id === photoId);
    if (!photo) return;

    const isFavorited = photo.favorite || false;
    photo.favorite = !isFavorited;

    try {
        await window.setDoc(window.doc(window.db, 'users', window.currentUsername, 'photos', photoId), {
            favorite: photo.favorite
        }, { merge: true });

        const btn = event.target.closest('.photo-favorite-btn');
        if (photo.favorite) {
            btn.classList.add('favorited');
            btn.textContent = '⭐';
        } else {
            btn.classList.remove('favorited');
            btn.textContent = '☆';
        }

        updateFolders();
        updateStats();
    } catch (error) {
        console.error('Favorite error:', error);
        alert('Failed to update favorite');
    }
};

// ==================== FOLDERS ====================
window.selectFolder = function(folder) {
    window.currentFolder = folder;
    window.displayedCount = window.displayLimit; // Reset pagination
    renderFolders();
    renderPhotos();
};

window.createNewFolder = function() {
    const dialog = document.createElement('div');
    dialog.className = 'modal active';
    dialog.innerHTML = `
        <div class="auth-card" style="margin: 0;">
            <div class="auth-header">
                <h2 class="auth-title">New Folder</h2>
                <p class="auth-subtitle">Create a folder to organize photos</p>
            </div>
            <div class="form-group">
                <label class="form-label">Folder Name</label>
                <input type="text" class="form-input" id="newFolderInput" placeholder="Enter folder name" autofocus>
            </div>
            <button class="btn btn-primary" style="width: 100%;" onclick="createFolderConfirm()">Create</button>
            <button class="btn btn-secondary" style="width: 100%; margin-top: 0.75rem;" onclick="this.closest('.modal').remove()">Cancel</button>
        </div>
    `;
    document.body.appendChild(dialog);
    
    setTimeout(() => document.getElementById('newFolderInput').focus(), 100);
    
    document.getElementById('newFolderInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createFolderConfirm();
    });
};

window.createFolderConfirm = function() {
    const input = document.getElementById('newFolderInput');
    const folderName = input.value.trim();
    
    if (!folderName) {
        alert('Please enter a folder name');
        return;
    }
    
    if (folderName === 'Favorites') {
        alert('Cannot create folder named "Favorites" - it\'s reserved!');
        return;
    }
    
    if (window.folders.includes(folderName)) {
        alert('Folder already exists!');
        return;
    }
    
    window.folders.push(folderName);
    window.currentFolder = folderName;
    document.querySelector('.modal.active').remove();
    renderFolders();
    renderPhotos();
};

// ==================== BIOMETRIC ====================
window.setupBiometricPrompt = async function() {
    hideSettings();
    
    if (!await isBiometricAvailable()) {
        alert('Biometric authentication is not available on this device');
        return;
    }

    const dialog = document.createElement('div');
    dialog.className = 'modal active';
    dialog.innerHTML = `
        <div class="auth-card" style="margin: 0;">
            <div class="auth-header">
                <h2 class="auth-title">Enable Biometric</h2>
                <p class="auth-subtitle">Enter your password to set up Face ID / Touch ID</p>
            </div>
            <div class="form-group">
                <label class="form-label">Password</label>
                <input type="password" class="form-input" id="biometricPassword" placeholder="Enter your password">
            </div>
            <button class="btn btn-primary" style="width: 100%;" onclick="confirmSetupBiometric()">Enable</button>
            <button class="btn btn-secondary" style="width: 100%; margin-top: 0.75rem;" onclick="this.closest('.modal').remove()">Cancel</button>
        </div>
    `;
    document.body.appendChild(dialog);
};

window.confirmSetupBiometric = async function() {
    const password = document.getElementById('biometricPassword').value;
    if (!password) {
        alert('Please enter your password');
        return;
    }

    try {
        const passwordHash = await hashPassword(password);
        const storedHash = localStorage.getItem('passwordHash');
        
        if (passwordHash !== storedHash) {
            alert('Incorrect password');
            return;
        }

        await setupBiometric(password);
        document.querySelector('.modal.active').remove();
        alert('Biometric authentication enabled!');
    } catch (error) {
        console.error('Biometric setup error:', error);
        alert('Failed to setup biometric: ' + error.message);
    }
};

// ==================== CHANGE PASSWORD ====================
window.showChangePassword = function() {
    hideSettings();
    document.getElementById('changePasswordModal').classList.add('active');
};

window.closeChangePassword = function() {
    document.getElementById('changePasswordModal').classList.remove('active');
};

window.changePassword = async function() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        alert('Please fill all fields');
        return;
    }

    if (newPassword !== confirmPassword) {
        alert('New passwords do not match');
        return;
    }

    if (newPassword.length < 12) {
        alert('Password must be at least 12 characters for security');
        return;
    }

    const currentPasswordHash = await hashPassword(currentPassword);
    const storedHash = localStorage.getItem('passwordHash');
    
    if (currentPasswordHash !== storedHash) {
        alert('Current password is incorrect');
        return;
    }

    const totalItems = window.photos.length + window.notes.length + window.files.length;
    const confirmDialog = document.createElement('div');
    confirmDialog.className = 'modal active';
    confirmDialog.innerHTML = `
        <div class="auth-card" style="margin: 0;">
            <div class="auth-header">
                <h2 class="auth-title">⚠️ Confirm</h2>
                <p class="auth-subtitle">Re-encrypt ${totalItems} items with new password?</p>
                <p style="color: var(--text-muted); font-size: 0.875rem; margin-top: 0.5rem;">This cannot be undone.</p>
            </div>
            <button class="btn btn-primary" style="width: 100%;" onclick="proceedPasswordChange()">Yes, Change Password</button>
            <button class="btn btn-secondary" style="width: 100%; margin-top: 0.75rem;" onclick="this.closest('.modal').remove()">Cancel</button>
        </div>
    `;
    document.body.appendChild(confirmDialog);
    
    window._changePasswordData = { currentPassword, newPassword };
};

window.proceedPasswordChange = async function() {
    document.querySelector('.modal.active:not(#changePasswordModal)').remove();
    
    const { currentPassword, newPassword } = window._changePasswordData;
    delete window._changePasswordData;

    document.getElementById('reencryptProgress').classList.remove('hidden');
    const progressText = document.getElementById('progressText');

    try {
        const oldKey = await deriveKey(currentPassword);
        const newKey = await deriveKey(newPassword);

        const totalItems = window.photos.length + window.notes.length + window.files.length;
        let processed = 0;

        // Re-encrypt photos
        for (let i = 0; i < window.photos.length; i++) {
            const photo = window.photos[i];
            progressText.textContent = `Re-encrypting photos... ${++processed}/${totalItems}`;

            const photoRef = window.ref(window.storage, `users/${window.currentUsername}/photos/${photo.id}.enc`);
            const blob = await window.getBlob(photoRef);
            const encryptedArray = new Uint8Array(await blob.arrayBuffer());

            const iv1 = encryptedArray.slice(0, 12);
            const encrypted1 = encryptedArray.slice(12);
            const decryptedData = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv1 },
                oldKey,
                encrypted1
            );

            const iv2 = crypto.getRandomValues(new Uint8Array(12));
            const encrypted2 = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv2 },
                newKey,
                decryptedData
            );

            const reencrypted = new Uint8Array(iv2.length + encrypted2.byteLength);
            reencrypted.set(iv2, 0);
            reencrypted.set(new Uint8Array(encrypted2), iv2.length);

            await window.uploadBytes(photoRef, reencrypted);
        }

        // Re-encrypt notes
        for (let i = 0; i < window.notes.length; i++) {
            const note = window.notes[i];
            progressText.textContent = `Re-encrypting notes... ${++processed}/${totalItems}`;

            const noteDoc = await window.getDoc(window.doc(window.db, 'users', window.currentUsername, 'notes', note.id));
            const data = noteDoc.data();
            const encryptedArray = base64ToArrayBuffer(data.encryptedContent);

            const iv1 = new Uint8Array(encryptedArray).slice(0, 12);
            const encrypted1 = new Uint8Array(encryptedArray).slice(12);
            const decryptedData = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv1 },
                oldKey,
                encrypted1
            );

            const iv2 = crypto.getRandomValues(new Uint8Array(12));
            const encrypted2 = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv2 },
                newKey,
                decryptedData
            );

            const reencrypted = new Uint8Array(iv2.length + encrypted2.byteLength);
            reencrypted.set(iv2, 0);
            reencrypted.set(new Uint8Array(encrypted2), iv2.length);

            await window.setDoc(window.doc(window.db, 'users', window.currentUsername, 'notes', note.id), {
                encryptedContent: arrayBufferToBase64(reencrypted)
            }, { merge: true });
        }

        // Re-encrypt files
        for (let i = 0; i < window.files.length; i++) {
            const file = window.files[i];
            progressText.textContent = `Re-encrypting files... ${++processed}/${totalItems}`;

            const fileRef = window.ref(window.storage, `users/${window.currentUsername}/files/${file.id}.enc`);
            const blob = await window.getBlob(fileRef);
            const encryptedArray = new Uint8Array(await blob.arrayBuffer());

            const iv1 = encryptedArray.slice(0, 12);
            const encrypted1 = encryptedArray.slice(12);
            const decryptedData = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv1 },
                oldKey,
                encrypted1
            );

            const iv2 = crypto.getRandomValues(new Uint8Array(12));
            const encrypted2 = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv2 },
                newKey,
                decryptedData
            );

            const reencrypted = new Uint8Array(iv2.length + encrypted2.byteLength);
            reencrypted.set(iv2, 0);
            reencrypted.set(new Uint8Array(encrypted2), iv2.length);

            await window.uploadBytes(fileRef, reencrypted);
        }

        const newPasswordHash = await hashPassword(newPassword);
        
        await window.setDoc(window.doc(window.db, 'users', window.currentUsername), {
            passwordHash: newPasswordHash,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        
        localStorage.setItem('passwordHash', newPasswordHash);
        window.encryptionKey = newKey;

        const biometricDataStr = localStorage.getItem('biometricAuth');
        if (biometricDataStr) {
            try {
                await setupBiometric(newPassword);
            } catch {
                localStorage.removeItem('biometricAuth');
            }
        }

        alert('Password changed successfully!');
        document.getElementById('reencryptProgress').classList.add('hidden');
        closeChangePassword();
    } catch (error) {
        console.error('Change password error:', error);
        alert('Failed to change password: ' + error.message);
        document.getElementById('reencryptProgress').classList.add('hidden');
    }
};

// ==================== DELETE ACCOUNT ====================
window.confirmDeleteAccount = function() {
    hideSettings();
    
    const dialog = document.createElement('div');
    dialog.className = 'modal active';
    dialog.innerHTML = `
        <div class="auth-card" style="margin: 0;">
            <div class="auth-header">
                <h2 class="auth-title" style="color: var(--danger);">⚠️ Delete Account</h2>
                <p class="auth-subtitle">This will permanently delete:</p>
                <ul style="text-align: left; margin: 1rem 0; color: var(--text-secondary);">
                    <li>All your photos (${window.photos.length})</li>
                    <li>All your notes (${window.notes.length})</li>
                    <li>All your files (${window.files.length})</li>
                    <li>Your account data</li>
                </ul>
                <p style="color: var(--danger); font-weight: 600;">This cannot be undone!</p>
            </div>
            <div class="form-group">
                <label class="form-label">Enter your password to confirm</label>
                <input type="password" class="form-input" id="deleteAccountPassword" placeholder="Enter your password">
            </div>
            <button class="btn btn-danger" style="width: 100%;" onclick="proceedDeleteAccount()">Yes, Delete Everything</button>
            <button class="btn btn-secondary" style="width: 100%; margin-top: 0.75rem;" onclick="this.closest('.modal').remove()">Cancel</button>
        </div>
    `;
    document.body.appendChild(dialog);
};

window.proceedDeleteAccount = async function() {
    const password = document.getElementById('deleteAccountPassword').value;
    if (!password) {
        alert('Please enter your password');
        return;
    }

    try {
        const passwordHash = await hashPassword(password);
        const storedHash = localStorage.getItem('passwordHash');
        
        if (passwordHash !== storedHash) {
            alert('Incorrect password');
            return;
        }

        document.querySelector('.modal.active').innerHTML = `
            <div class="auth-card" style="margin: 0;">
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Deleting account...</p>
                </div>
            </div>
        `;

        // Delete photos from storage
        for (const photo of window.photos) {
            const storageRef = window.ref(window.storage, `users/${window.currentUsername}/photos/${photo.id}.enc`);
            await window.deleteObject(storageRef).catch(() => {});
        }

        // Delete files from storage
        for (const file of window.files) {
            const storageRef = window.ref(window.storage, `users/${window.currentUsername}/files/${file.id}.enc`);
            await window.deleteObject(storageRef).catch(() => {});
        }

        // Delete photos from Firestore
        const photosSnapshot = await window.getDocs(window.collection(window.db, 'users', window.currentUsername, 'photos'));
        const photosBatch = window.writeBatch(window.db);
        photosSnapshot.forEach(doc => {
            photosBatch.delete(doc.ref);
        });
        await photosBatch.commit();

        // Delete notes from Firestore
        const notesSnapshot = await window.getDocs(window.collection(window.db, 'users', window.currentUsername, 'notes'));
        const notesBatch = window.writeBatch(window.db);
        notesSnapshot.forEach(doc => {
            notesBatch.delete(doc.ref);
        });
        await notesBatch.commit();

        // Delete files from Firestore
        const filesSnapshot = await window.getDocs(window.collection(window.db, 'users', window.currentUsername, 'files'));
        const filesBatch = window.writeBatch(window.db);
        filesSnapshot.forEach(doc => {
            filesBatch.delete(doc.ref);
        });
        await filesBatch.commit();

        // Delete user document
        await window.deleteDoc(window.doc(window.db, 'users', window.currentUsername));

        localStorage.clear();
        sessionStorage.clear();

        alert('Account deleted successfully');
        location.reload();
    } catch (error) {
        console.error('Delete account error:', error);
        alert('Failed to delete account: ' + error.message);
    }
};

// ==================== NOTES ====================
window.createNewNote = function() {
    window.currentNoteId = null;
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
    document.getElementById('noteEditorModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('noteTitle').focus(), 100);
};

window.editNote = function(noteId) {
    const note = window.notes.find(n => n.id === noteId);
    if (!note) return;

    window.currentNoteId = noteId;
    document.getElementById('noteTitle').value = note.title;
    document.getElementById('noteContent').value = note.content;
    document.getElementById('noteEditorModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('noteTitle').focus(), 100);
};

window.closeNoteEditor = function() {
    document.getElementById('noteEditorModal').classList.remove('active');
    document.body.style.overflow = '';
    window.currentNoteId = null;
};

window.saveNote = async function() {
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();

    if (!title) {
        alert('Please enter a title');
        return;
    }

    if (!content) {
        alert('Please enter some content');
        return;
    }

    try {
        const noteId = window.currentNoteId || Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const timestamp = new Date().toISOString();

        // Encrypt note content
        const encoder = new TextEncoder();
        const noteData = JSON.stringify({ title, content });
        const encryptedData = await encryptData(encoder.encode(noteData));

        await window.setDoc(window.doc(window.db, 'users', window.currentUsername, 'notes', noteId), {
            id: noteId,
            encryptedContent: arrayBufferToBase64(encryptedData),
            updated: timestamp,
            created: window.currentNoteId ? (window.notes.find(n => n.id === noteId)?.created || timestamp) : timestamp
        });

        // Update local state
        const noteIndex = window.notes.findIndex(n => n.id === noteId);
        const noteObj = {
            id: noteId,
            title,
            content,
            updated: timestamp,
            created: window.currentNoteId ? (window.notes.find(n => n.id === noteId)?.created || timestamp) : timestamp
        };

        if (noteIndex >= 0) {
            window.notes[noteIndex] = noteObj;
        } else {
            window.notes.push(noteObj);
        }

        closeNoteEditor();
        renderNotes();
        updateStats();
    } catch (error) {
        console.error('Save note error:', error);
        alert('Failed to save note: ' + error.message);
    }
};

window.deleteNote = async function(noteId) {
    if (!confirm('Delete this note permanently?')) return;

    try {
        await window.deleteDoc(window.doc(window.db, 'users', window.currentUsername, 'notes', noteId));
        window.notes = window.notes.filter(n => n.id !== noteId);
        renderNotes();
        updateStats();
    } catch (error) {
        console.error('Delete note error:', error);
        alert('Failed to delete note');
    }
};

async function loadNotes() {
    try {
        if (!window.currentUsername) return;

        const querySnapshot = await window.getDocs(window.collection(window.db, 'users', window.currentUsername, 'notes'));

        window.notes = [];
        for (const doc of querySnapshot.docs) {
            const data = doc.data();
            try {
                // Decrypt note content
                const encryptedArray = base64ToArrayBuffer(data.encryptedContent);
                const decryptedData = await decryptData(new Uint8Array(encryptedArray));
                const decoder = new TextDecoder();
                const noteData = JSON.parse(decoder.decode(decryptedData));

                window.notes.push({
                    id: doc.id,
                    title: noteData.title,
                    content: noteData.content,
                    updated: data.updated,
                    created: data.created
                });
            } catch (error) {
                console.error('Failed to decrypt note:', doc.id, error);
            }
        }

        renderNotes();
        updateStats();
    } catch (error) {
        console.error('Load notes error:', error);
    }
}

function renderNotes() {
    const grid = document.getElementById('notesGrid');
    const emptyState = document.getElementById('notesEmptyState');

    if (window.notes.length === 0) {
        grid.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    // Sort by updated date
    const sortedNotes = [...window.notes].sort((a, b) => new Date(b.updated) - new Date(a.updated));

    grid.innerHTML = sortedNotes.map(note => `
        <div class="note-card" onclick="editNote('${escapeHTML(note.id)}')">
            <div class="note-card-header">
                <div class="note-card-title">${escapeHTML(note.title)}</div>
            </div>
            <div class="note-card-preview">${escapeHTML(note.content)}</div>
            <div class="note-card-meta">
                <div class="note-card-date">${formatDate(note.updated)}</div>
                <div class="note-card-actions">
                    <button class="btn-ghost btn-icon" style="padding: 0.25rem;" onclick="event.stopPropagation(); deleteNote('${escapeHTML(note.id)}')">🗑</button>
                </div>
            </div>
        </div>
    `).join('');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
}

async function encryptData(data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        window.encryptionKey,
        data
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return combined;
}

// ==================== FILES ====================
window.handleFileUpload = async function(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if (!window.currentUsername) {
        alert('Error: Not logged in');
        return;
    }

    for (const file of files) {
        try {
            // Encrypt file
            const arrayBuffer = await file.arrayBuffer();
            const encryptedData = await encryptData(new Uint8Array(arrayBuffer));

            const fileId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            const storageRef = window.ref(window.storage, `users/${window.currentUsername}/files/${fileId}.enc`);
            await window.uploadBytes(storageRef, encryptedData);
            const downloadURL = await window.getDownloadURL(storageRef);

            const fileExt = file.name.split('.').pop().toLowerCase();
            await window.setDoc(window.doc(window.db, 'users', window.currentUsername, 'files', fileId), {
                id: fileId,
                name: file.name,
                size: file.size,
                type: file.type,
                extension: fileExt,
                uploaded: new Date().toISOString(),
                url: downloadURL
            });

            window.files.push({
                id: fileId,
                name: file.name,
                size: file.size,
                type: file.type,
                extension: fileExt,
                uploaded: new Date().toISOString(),
                url: downloadURL
            });
        } catch (error) {
            console.error('Upload error:', error);
            alert('Failed to upload ' + file.name);
        }
    }

    e.target.value = '';
    renderFiles();
    updateStats();
};

window.downloadFile = async function(fileId) {
    try {
        const file = window.files.find(f => f.id === fileId);
        if (!file) throw new Error('File not found');

        const storageRef = window.ref(window.storage, `users/${window.currentUsername}/files/${fileId}.enc`);
        const blob = await window.getBlob(storageRef);

        const encryptedArray = new Uint8Array(await blob.arrayBuffer());
        const decryptedData = await decryptData(encryptedArray);

        const decryptedBlob = new Blob([decryptedData], { type: file.type });
        const url = URL.createObjectURL(decryptedBlob);

        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Download error:', error);
        alert('Failed to download file');
    }
};

window.deleteFile = async function(fileId) {
    if (!confirm('Delete this file permanently?')) return;

    try {
        const storageRef = window.ref(window.storage, `users/${window.currentUsername}/files/${fileId}.enc`);
        await window.deleteObject(storageRef);
        await window.deleteDoc(window.doc(window.db, 'users', window.currentUsername, 'files', fileId));

        window.files = window.files.filter(f => f.id !== fileId);
        renderFiles();
        updateStats();
    } catch (error) {
        console.error('Delete file error:', error);
        alert('Failed to delete file');
    }
};

async function loadFiles() {
    try {
        if (!window.currentUsername) return;

        const querySnapshot = await window.getDocs(window.collection(window.db, 'users', window.currentUsername, 'files'));

        window.files = [];
        querySnapshot.forEach((doc) => {
            window.files.push({...doc.data(), id: doc.id});
        });

        renderFiles();
        updateStats();
    } catch (error) {
        console.error('Load files error:', error);
    }
}

function renderFiles() {
    const list = document.getElementById('filesList');
    const emptyState = document.getElementById('filesEmptyState');

    if (window.files.length === 0) {
        list.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    // Sort by upload date
    const sortedFiles = [...window.files].sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

    list.innerHTML = sortedFiles.map(file => {
        const fileType = getFileType(file.extension);
        const icon = getFileIcon(fileType);

        return `
            <div class="file-item">
                <div class="file-icon" data-type="${fileType}">${icon}</div>
                <div class="file-info">
                    <div class="file-name">${escapeHTML(file.name)}</div>
                    <div class="file-meta">
                        <span>${formatBytes(file.size)}</span>
                        <span>${formatDate(file.uploaded)}</span>
                    </div>
                </div>
                <div class="file-actions">
                    <button class="btn btn-ghost btn-icon" onclick="downloadFile('${escapeHTML(file.id)}')" title="Download">⬇️</button>
                    <button class="btn btn-ghost btn-icon" onclick="deleteFile('${escapeHTML(file.id)}')" title="Delete">🗑</button>
                </div>
            </div>
        `;
    }).join('');
}

function getFileType(extension) {
    const ext = extension.toLowerCase();
    if (['pdf'].includes(ext)) return 'pdf';
    if (['doc', 'docx'].includes(ext)) return 'doc';
    if (['xls', 'xlsx'].includes(ext)) return 'xls';
    if (['zip', 'rar', '7z'].includes(ext)) return 'zip';
    if (['txt', 'md'].includes(ext)) return 'txt';
    return 'other';
}

function getFileIcon(type) {
    const icons = {
        pdf: '📄',
        doc: '📝',
        xls: '📊',
        zip: '📦',
        txt: '📃',
        other: '📎'
    };
    return icons[type] || '📎';
}

// ==================== PHOTO ACTIONS ====================
window.showPhotoActions = function(photoId) {
    window.currentPhotoId = photoId;
    const photo = window.photos.find(p => p.id === photoId);
    
    const actionList = `
        <div class="action-item" onclick="viewPhoto('${escapeHTML(photoId)}'); closeActionSheet();">
            <span class="action-icon">👁</span>
            View Photo
        </div>
        <div class="action-item" onclick="downloadPhoto('${escapeHTML(photoId)}'); closeActionSheet();">
            <span class="action-icon">⬇️</span>
            Download
        </div>
        ${window.folders.length > 2 ? `
            <div class="action-item" onclick="movePhotoPrompt('${escapeHTML(photoId)}'); closeActionSheet();">
                <span class="action-icon">📁</span>
                Move to Folder
            </div>
        ` : ''}
        <div class="action-item danger" onclick="deletePhoto('${escapeHTML(photoId)}'); closeActionSheet();">
            <span class="action-icon">🗑</span>
            Delete
        </div>
    `;
    
    document.getElementById('actionSheetTitle').textContent = photo.name;
    document.getElementById('actionList').innerHTML = actionList;
    document.getElementById('actionBackdrop').classList.add('active');
    document.getElementById('actionSheet').classList.add('active');
};

window.closeActionSheet = function() {
    document.getElementById('actionBackdrop').classList.remove('active');
    document.getElementById('actionSheet').classList.remove('active');
};

window.closeModal = function() {
    document.getElementById('imageModal').classList.remove('active');
    document.getElementById('modalImg').src = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
};

window.movePhotoPrompt = function(photoId) {
    const photo = window.photos.find(p => p.id === photoId);
    const availableFolders = window.folders.filter(f => f !== 'All Photos' && f !== 'Favorites' && f !== photo.folder);
    
    if (availableFolders.length === 0) {
        alert('No other folders available. Create a folder first!');
        return;
    }

    const dialog = document.createElement('div');
    dialog.className = 'modal active';
    dialog.innerHTML = `
        <div class="auth-card" style="margin: 0;">
            <div class="auth-header">
                <h2 class="auth-title">Move to Folder</h2>
                <p class="auth-subtitle">Select destination folder</p>
            </div>
            <div class="action-list">
                ${availableFolders.map(folder => `
                    <div class="action-item" onclick="movePhotoToFolder('${escapeHTML(photoId)}', '${escapeHTML(folder)}')">
                        <span class="action-icon">${folder === 'Favorites' ? '⭐' : '📁'}</span>
                        ${escapeHTML(folder)}
                    </div>
                `).join('')}
            </div>
            <button class="btn btn-secondary" style="width: 100%; margin-top: 1rem;" onclick="this.closest('.modal').remove()">Cancel</button>
        </div>
    `;
    document.body.appendChild(dialog);
};

window.movePhotoToFolder = async function(photoId, targetFolder) {
    try {
        const photo = window.photos.find(p => p.id === photoId);
        if (!photo) return;

        photo.folder = targetFolder;

        await window.setDoc(window.doc(window.db, 'users', window.currentUsername, 'photos', photoId), {
            folder: targetFolder
        }, { merge: true });

        document.querySelector('.modal.active').remove();
        updateFolders();
        renderPhotos();
    } catch (error) {
        console.error('Move error:', error);
        alert('Failed to move photo');
    }
};

async function viewPhoto(photoId) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    const modalSpinner = document.getElementById('modalSpinner');
    const modalFilename = document.getElementById('modalFilename');
    const modalCounter = document.getElementById('modalCounter');
    
    // Get current filtered photo list
    let filteredPhotos;
    if (window.currentFolder === 'Favorites') {
        filteredPhotos = window.photos.filter(p => p.favorite);
    } else if (window.currentFolder === 'All Photos') {
        filteredPhotos = window.photos;
    } else {
        filteredPhotos = window.photos.filter(p => p.folder === window.currentFolder);
    }
    
    window.currentPhotoList = filteredPhotos;
    window.currentPhotoIndex = filteredPhotos.findIndex(p => p.id === photoId);
    
    const photo = filteredPhotos[window.currentPhotoIndex];
    if (!photo) return;

    // Update modal info
    modalFilename.textContent = photo.name;
    modalCounter.textContent = `${window.currentPhotoIndex + 1} / ${filteredPhotos.length}`;

    // Check if cached
    if (window.imageCache.has(photo.id)) {
        // Use cached image - no loading needed
        modalImg.src = window.imageCache.get(photo.id);
        modalImg.classList.add('loaded');
        modalSpinner.classList.add('hidden');
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
        updateModalNavButtons();
        return;
    }

    // Show modal with spinner for new image
    modalImg.classList.remove('loaded');
    modalImg.src = '';
    modalSpinner.classList.remove('hidden');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';

    // Update nav buttons visibility
    updateModalNavButtons();

    try {
        const storageRef = window.ref(window.storage, `users/${window.currentUsername}/photos/${photo.id}.enc`);
        const blob = await window.getBlob(storageRef);

        const encryptedArray = new Uint8Array(await blob.arrayBuffer());
        const decryptedData = await decryptData(encryptedArray);

        const bytes = new Uint8Array(decryptedData);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }

        const base64 = btoa(binary);
        const dataUrl = `data:${photo.type};base64,${base64}`;

        // Cache the decrypted image
        window.imageCache.set(photo.id, dataUrl);

        // Manage cache size to prevent memory issues
        manageImageCache();

        modalImg.onload = () => {
            modalSpinner.classList.add('hidden');
            modalImg.classList.add('loaded');
        };
        modalImg.src = dataUrl;
    } catch (error) {
        console.error('View error:', error);
        alert('Failed to view photo');
        closeModal();
    }
}

window.viewPhoto = viewPhoto;

window.navigatePhoto = function(direction) {
    const newIndex = window.currentPhotoIndex + direction;
    if (newIndex >= 0 && newIndex < window.currentPhotoList.length) {
        const newPhoto = window.currentPhotoList[newIndex];
        viewPhoto(newPhoto.id);
    }
};

function updateModalNavButtons() {
    const prevBtn = document.getElementById('modalPrev');
    const nextBtn = document.getElementById('modalNext');
    
    if (window.currentPhotoIndex === 0) {
        prevBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
    }
    
    if (window.currentPhotoIndex === window.currentPhotoList.length - 1) {
        nextBtn.classList.add('hidden');
    } else {
        nextBtn.classList.remove('hidden');
    }
}

async function downloadPhoto(photoId) {
    try {
        const photo = window.photos.find(p => p.id === photoId);
        if (!photo) throw new Error('Photo not found');

        const storageRef = window.ref(window.storage, `users/${window.currentUsername}/photos/${photoId}.enc`);
        const blob = await window.getBlob(storageRef);
        
        const encryptedArray = new Uint8Array(await blob.arrayBuffer());
        const decryptedData = await decryptData(encryptedArray);
        
        const bytes = new Uint8Array(decryptedData);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        
        const base64 = btoa(binary);
        const dataUrl = `data:${photo.type};base64,${base64}`;
        
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = photo.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (error) {
        console.error('Download error:', error);
        alert('Failed to download photo');
    }
}

window.downloadPhoto = downloadPhoto;

async function deletePhoto(photoId) {
    if (!confirm('Delete this photo permanently?')) return;

    try {
        const photo = window.photos.find(p => p.id === photoId);
        if (!photo) throw new Error('Photo not found');
        
        const storageRef = window.ref(window.storage, `users/${window.currentUsername}/photos/${photoId}.enc`);
        await window.deleteObject(storageRef);
        
        await window.deleteDoc(window.doc(window.db, 'users', window.currentUsername, 'photos', photoId));
        
        window.photos = window.photos.filter(p => p.id !== photoId);
        
        updateFolders();
        renderPhotos();
    } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete photo');
    }
}

window.deletePhoto = deletePhoto;

// ==================== FILE UPLOAD ====================
function setupEventListeners() {
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', handleFileSelect);

    const anyFileInput = document.getElementById('anyFileInput');
    anyFileInput.addEventListener('change', handleFileUpload);

    document.getElementById('imageModal').addEventListener('click', (e) => {
        if (e.target.id === 'imageModal') closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeActionSheet();
            closeChangePassword();
            hideSettings();
        }
        if (document.getElementById('imageModal').classList.contains('active')) {
            if (e.key === 'ArrowLeft') {
                navigatePhoto(-1);
            } else if (e.key === 'ArrowRight') {
                navigatePhoto(1);
            }
        }
    });
    
    // Touch swipe for modal with smooth animations and pinch-to-zoom
    let touchStartX = 0;
    let touchStartY = 0;
    let touchCurrentX = 0;
    let isSwiping = false;
    let isScrollBlocked = false;
    let initialDistance = 0;
    let currentScale = 1;
    let isPinching = false;

    const modalElement = document.getElementById('imageModal');
    const modalImgWrapper = document.querySelector('.modal-img-wrapper');
    const modalImg = document.getElementById('modalImg');

    // Get distance between two touch points
    function getTouchDistance(e) {
        if (e.touches.length < 2) return 0;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Prevent all scrolling on modal
    modalElement.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Pinch zoom start
            isPinching = true;
            initialDistance = getTouchDistance(e);
            if (modalImgWrapper) {
                modalImgWrapper.style.transition = 'none';
            }
        } else if (e.touches.length === 1) {
            // Swipe start
            touchStartX = e.changedTouches[0].clientX;
            touchStartY = e.changedTouches[0].clientY;
            touchCurrentX = touchStartX;
            isSwiping = false;
            isScrollBlocked = false;
            isPinching = false;

            // Remove transition for immediate feedback
            if (modalImgWrapper && currentScale === 1) {
                modalImgWrapper.style.transition = 'none';
            }
        }
    }, { passive: true });

    modalElement.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && isPinching) {
            // Pinch zoom
            e.preventDefault();
            const distance = getTouchDistance(e);
            const scale = (distance / initialDistance) * currentScale;
            const clampedScale = Math.max(1, Math.min(4, scale));

            if (modalImg) {
                modalImg.style.transform = `scale(${clampedScale})`;
                modalImg.style.transformOrigin = 'center center';
            }
            if (modalImgWrapper) {
                modalImgWrapper.classList.toggle('zoomed', clampedScale > 1);
            }
        } else if (e.touches.length === 1 && !isPinching && currentScale === 1) {
            // Swipe
            const currentX = e.changedTouches[0].clientX;
            const currentY = e.changedTouches[0].clientY;
            const deltaX = Math.abs(currentX - touchStartX);
            const deltaY = Math.abs(currentY - touchStartY);

            // Determine swipe direction on first significant movement
            if (!isScrollBlocked && (deltaX > 5 || deltaY > 5)) {
                if (deltaX > deltaY) {
                    isSwiping = true;
                    isScrollBlocked = true;
                } else {
                    isScrollBlocked = true;
                }
            }

            // Always prevent scrolling in modal
            e.preventDefault();
            e.stopPropagation();

            // Apply real-time drag effect for horizontal swipes
            if (isSwiping && modalImgWrapper) {
                touchCurrentX = currentX;
                const offset = currentX - touchStartX;
                // Full 1:1 drag for smooth feel
                modalImgWrapper.style.transform = `translateX(${offset}px)`;
                // Subtle opacity fade
                modalImgWrapper.style.opacity = 1 - Math.abs(offset) / 1500;
            }
        } else {
            e.preventDefault();
        }
    }, { passive: false });

    modalElement.addEventListener('touchend', (e) => {
        if (isPinching && e.touches.length < 2) {
            // End pinch zoom
            const finalScale = parseFloat(modalImg.style.transform.replace(/[^0-9.]/g, '')) || 1;
            currentScale = Math.max(1, Math.min(4, finalScale));

            if (currentScale === 1 && modalImg) {
                modalImg.style.transform = '';
                modalImgWrapper.classList.remove('zoomed');
            }

            isPinching = false;
            initialDistance = 0;
        } else if (!isPinching && currentScale === 1) {
            // End swipe
            const deltaX = touchCurrentX - touchStartX;
            const swipeThreshold = 60;

            if (modalImgWrapper) {
                // Smooth sweep animation
                modalImgWrapper.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease';

                // Navigate if swipe threshold met
                if (isSwiping && Math.abs(deltaX) > swipeThreshold) {
                    const direction = deltaX < 0 ? 1 : -1;
                    const canNavigate = (direction === 1 && window.currentPhotoIndex < window.currentPhotoList.length - 1) ||
                                      (direction === -1 && window.currentPhotoIndex > 0);

                    if (canNavigate) {
                        // Animate out completely
                        const screenWidth = window.innerWidth;
                        modalImgWrapper.style.transform = `translateX(${-direction * screenWidth}px)`;
                        modalImgWrapper.style.opacity = '0';

                        // Navigate after animation
                        setTimeout(() => {
                            navigatePhoto(direction);
                            // Reset from opposite side
                            modalImgWrapper.style.transition = 'none';
                            modalImgWrapper.style.transform = `translateX(${direction * screenWidth}px)`;
                            modalImgWrapper.style.opacity = '0';

                            // Sweep in
                            setTimeout(() => {
                                modalImgWrapper.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease';
                                modalImgWrapper.style.transform = '';
                                modalImgWrapper.style.opacity = '';
                            }, 20);
                        }, 350);
                    } else {
                        // Bounce back if can't navigate
                        modalImgWrapper.style.transform = '';
                        modalImgWrapper.style.opacity = '';
                    }
                } else {
                    // Didn't swipe enough, bounce back
                    modalImgWrapper.style.transform = '';
                    modalImgWrapper.style.opacity = '';
                }
            }

            isSwiping = false;
            isScrollBlocked = false;
            touchCurrentX = touchStartX;
        }
    }, { passive: true });

    // Reset zoom when closing modal
    const originalCloseModal = window.closeModal;
    window.closeModal = function() {
        currentScale = 1;
        if (modalImg) {
            modalImg.style.transform = '';
        }
        if (modalImgWrapper) {
            modalImgWrapper.classList.remove('zoomed');
            modalImgWrapper.style.transform = '';
            modalImgWrapper.style.opacity = '';
        }
        originalCloseModal();
    };

    // Prevent all scrolling on document body when modal is active
    const preventBodyScroll = (e) => {
        if (modalElement.classList.contains('active')) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    };

    document.body.addEventListener('touchmove', preventBodyScroll, { passive: false });
    document.addEventListener('touchmove', preventBodyScroll, { passive: false });
}

async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if (!window.currentUsername) {
        alert('Error: Not logged in');
        return;
    }

    const uploadBtn = document.getElementById('uploadBtn');
    const originalContent = uploadBtn.innerHTML;
    uploadBtn.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div> Uploading...';
    uploadBtn.disabled = true;

    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;

        try {
            const thumbnail = await createThumbnail(file);
            const encryptedData = await encryptFile(file);
            
            const photoId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            const folder = window.currentFolder === 'Favorites' ? 'All Photos' : (window.currentFolder || 'All Photos');
            
            const storageRef = window.ref(window.storage, `users/${window.currentUsername}/photos/${photoId}.enc`);
            await window.uploadBytes(storageRef, encryptedData);
            const downloadURL = await window.getDownloadURL(storageRef);
            
            await window.setDoc(window.doc(window.db, 'users', window.currentUsername, 'photos', photoId), {
                id: photoId,
                name: file.name,
                size: file.size,
                type: file.type,
                uploaded: new Date().toISOString(),
                thumbnail: thumbnail,
                folder: folder,
                favorite: false,
                url: downloadURL
            });

            window.photos.push({
                id: photoId,
                name: file.name,
                size: file.size,
                type: file.type,
                uploaded: new Date().toISOString(),
                thumbnail: thumbnail,
                folder: folder,
                favorite: false,
                url: downloadURL
            });
        } catch (error) {
            console.error('Upload error:', error);
            alert('Failed to upload ' + file.name);
        }
    }

    uploadBtn.innerHTML = originalContent;
    uploadBtn.disabled = false;
    e.target.value = '';
    updateFolders();
    renderPhotos();
}

// ==================== LOAD & RENDER ====================
async function loadPhotos() {
    try {
        if (!window.currentUsername) {
            console.error('No username set');
            return;
        }

        const querySnapshot = await window.getDocs(window.collection(window.db, 'users', window.currentUsername, 'photos'));

        window.photos = [];
        querySnapshot.forEach((doc) => {
            window.photos.push({...doc.data(), id: doc.id});
        });

        updateFolders();
        renderPhotos();
        setupEventListeners();

        // Load notes and files
        await loadNotes();
        await loadFiles();
    } catch (error) {
        console.error('Load error:', error);
    }
}

function updateFolders() {
    const folderSet = new Set(['All Photos', 'Favorites']);
    window.photos.forEach(photo => {
        if (photo.folder && photo.folder !== 'All Photos' && photo.folder !== 'Favorites') {
            folderSet.add(photo.folder);
        }
    });
    window.folders = Array.from(folderSet);
    renderFolders();
}

function renderFolders() {
    const folderList = document.getElementById('folderList');
    const currentFolderName = document.getElementById('currentFolderName');
    
    currentFolderName.textContent = window.currentFolder;
    
    folderList.innerHTML = window.folders.map(folder => {
        let count;
        if (folder === 'All Photos') {
            count = window.photos.length;
        } else if (folder === 'Favorites') {
            count = window.photos.filter(p => p.favorite).length;
        } else {
            count = window.photos.filter(p => p.folder === folder).length;
        }

        const isFavorite = folder === 'Favorites';
        const isActive = folder === window.currentFolder;

        return `
            <div class="folder-chip ${isActive ? 'active' : ''} ${isFavorite ? 'favorite' : ''}" onclick="selectFolder('${escapeHTML(folder)}')">
                ${isFavorite ? '⭐' : (folder === 'All Photos' ? '📂' : '📁')} ${escapeHTML(folder)}
                <span class="folder-count">${count}</span>
            </div>
        `;
    }).join('');
}

function renderPhotos() {
    const grid = document.getElementById('photoGrid');
    const emptyState = document.getElementById('emptyState');

    let filteredPhotos;
    if (window.currentFolder === 'Favorites') {
        filteredPhotos = window.photos.filter(p => p.favorite);
    } else if (window.currentFolder === 'All Photos') {
        filteredPhotos = window.photos;
    } else {
        filteredPhotos = window.photos.filter(p => p.folder === window.currentFolder);
    }

    if (filteredPhotos.length === 0) {
        grid.innerHTML = '';
        emptyState.classList.remove('hidden');
        updateStats();
        return;
    }

    emptyState.classList.add('hidden');

    // Reset displayed count when folder changes
    window.displayedCount = Math.min(window.displayLimit, filteredPhotos.length);

    // Cache thumbnails to prevent reloading
    filteredPhotos.forEach(photo => {
        if (photo.thumbnail && !window.thumbnailCache.has(photo.id)) {
            window.thumbnailCache.set(photo.id, photo.thumbnail);
        }
    });

    // Only render displayed photos for better performance
    const photosToDisplay = filteredPhotos.slice(0, window.displayedCount);

    grid.innerHTML = photosToDisplay.map((photo, index) => {
        const cachedThumbnail = window.thumbnailCache.get(photo.id) || photo.thumbnail;

        return `
        <div class="photo-card" style="animation-delay: ${Math.min(index * 0.02, 1)}s">
            <div class="photo-thumbnail" onclick="viewPhoto('${escapeHTML(photo.id)}')">
                ${cachedThumbnail
                    ? `<div class="photo-bg" style="background-image: url('${escapeHTML(cachedThumbnail)}');"></div>
                       <img src="${escapeHTML(cachedThumbnail)}" class="photo-img lazy-img" alt="${escapeHTML(photo.name)}" loading="lazy">`
                    : `<div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 3rem;">🔐</div>`
                }
                <button class="photo-favorite-btn ${photo.favorite ? 'favorited' : ''}" onclick="toggleFavorite('${escapeHTML(photo.id)}', event)">
                    ${photo.favorite ? '⭐' : '☆'}
                </button>
            </div>
            <div class="photo-info">
                <div class="photo-name">${escapeHTML(photo.name)}</div>
                <div class="photo-meta">
                    <span>${formatBytes(photo.size)}</span>
                    <button class="btn-ghost btn-icon" style="padding: 0.25rem; font-size: 1.125rem;" onclick="showPhotoActions('${escapeHTML(photo.id)}')">⋯</button>
                </div>
            </div>
        </div>
    `}).join('');

    // Add infinite scroll sentinel if there are more photos
    if (window.displayedCount < filteredPhotos.length) {
        const sentinel = document.createElement('div');
        sentinel.className = 'infinite-scroll-sentinel';
        sentinel.id = 'infiniteScrollSentinel';
        sentinel.style.height = '1px';
        grid.appendChild(sentinel);
    }

    // Initialize observers
    initializeLazyLoading();
    initializeInfiniteScroll();

    updateStats();
}

function initializeInfiniteScroll() {
    // Disconnect existing observer
    if (window.infiniteScrollObserver) {
        window.infiniteScrollObserver.disconnect();
    }

    const sentinel = document.getElementById('infiniteScrollSentinel');
    if (!sentinel) return;

    // Create intersection observer for infinite scroll
    window.infiniteScrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // User scrolled to bottom, load more photos
                window.loadMorePhotos();
            }
        });
    }, {
        rootMargin: '200px' // Start loading 200px before reaching bottom
    });

    window.infiniteScrollObserver.observe(sentinel);
}

window.loadMorePhotos = function() {
    let filteredPhotos;
    if (window.currentFolder === 'Favorites') {
        filteredPhotos = window.photos.filter(p => p.favorite);
    } else if (window.currentFolder === 'All Photos') {
        filteredPhotos = window.photos;
    } else {
        filteredPhotos = window.photos.filter(p => p.folder === window.currentFolder);
    }

    window.displayedCount = Math.min(window.displayedCount + 30, filteredPhotos.length);
    renderPhotos();
};

function initializeLazyLoading() {
    // Disconnect existing observer
    if (window.lazyLoadObserver) {
        window.lazyLoadObserver.disconnect();
    }

    // Create intersection observer for lazy loading
    window.lazyLoadObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                }
                window.lazyLoadObserver.unobserve(img);
            }
        });
    }, {
        rootMargin: '50px' // Start loading 50px before image enters viewport
    });

    // Observe all lazy images
    document.querySelectorAll('.lazy-img').forEach(img => {
        window.lazyLoadObserver.observe(img);
    });
}

function updateStats() {
    document.getElementById('photoCount').textContent = window.photos.length;
    document.getElementById('noteCount').textContent = window.notes.length;
    document.getElementById('fileCount').textContent = window.files.length;

    const photoBytes = window.photos.reduce((sum, p) => sum + (p.size || 0), 0);
    const fileBytes = window.files.reduce((sum, f) => sum + (f.size || 0), 0);
    const totalBytes = photoBytes + fileBytes;
    document.getElementById('totalSize').textContent = formatBytes(totalBytes);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ==================== ENCRYPTION FUNCTIONS ====================
async function deriveKey(password) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );

    // Use username as salt to ensure unique keys per user
    const salt = encoder.encode(`umbra-ark-v2-${window.currentUsername}`);

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 600000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function encryptFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        window.encryptionKey,
        arrayBuffer
    );

    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedData), iv.length);

    return combined;
}

async function decryptData(encryptedArray) {
    const dataArray = encryptedArray instanceof Uint8Array 
        ? encryptedArray 
        : new Uint8Array(encryptedArray);
    
    const iv = dataArray.slice(0, 12);
    const encryptedData = dataArray.slice(12);

    const decryptedData = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        window.encryptionKey,
        encryptedData
    );

    return decryptedData;
}

async function createThumbnail(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxSize = 150; // Reduced from 200 for better performance
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxSize) {
                        height *= maxSize / width;
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width *= maxSize / height;
                        height = maxSize;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d', { alpha: false }); // Disable alpha for better performance

                // Use better image smoothing
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'medium';

                ctx.drawImage(img, 0, 0, width, height);

                // Reduce quality for smaller file size (0.6 instead of 0.7)
                resolve(canvas.toDataURL('image/jpeg', 0.6));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ==================== BIOMETRIC HELPERS ====================
async function isBiometricAvailable() {
    if (!window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

async function setupBiometric(password) {
    try {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = crypto.getRandomValues(new Uint8Array(16));

        const credential = await navigator.credentials.create({
            publicKey: {
                challenge,
                rp: { name: "Umbra Ark" },
                user: {
                    id: userId,
                    name: window.currentUsername || "user",
                    displayName: window.currentUsername || "User"
                },
                pubKeyCredParams: [{ alg: -7, type: "public-key" }],
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    userVerification: "required"
                },
                timeout: 60000
            }
        });

        if (!credential) throw new Error('Credential creation failed');

        const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        const key = await crypto.subtle.importKey(
            'raw',
            encryptionKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt']
        );

        const encoder = new TextEncoder();
        const encryptedPassword = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(password)
        );

        localStorage.setItem('biometricAuth', JSON.stringify({
            credentialId: arrayBufferToBase64(credential.rawId),
            key: arrayBufferToBase64(encryptionKey),
            iv: arrayBufferToBase64(iv),
            encryptedPassword: arrayBufferToBase64(encryptedPassword),
            username: window.currentUsername
        }));
    } catch (error) {
        console.error('Biometric setup error:', error);
        throw error;
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// ==================== INITIALIZATION ====================
const savedUsername = localStorage.getItem('username');
const savedHash = localStorage.getItem('passwordHash');

if (savedUsername && savedHash) {
    document.getElementById('authTitle').textContent = 'Welcome Back';
    document.getElementById('authSubtitle').textContent = `Login as ${savedUsername}`;
    document.getElementById('username').value = savedUsername;
    
    (async () => {
        const hasBiometric = localStorage.getItem('biometricAuth');
        const isAvailable = await isBiometricAvailable();
        if (hasBiometric && isAvailable) {
            document.getElementById('biometricBtn').classList.remove('hidden');
        }
    })();
} else {
    document.getElementById('authTitle').textContent = 'Welcome to Umbra Ark';
    document.getElementById('authSubtitle').textContent = 'Create your encrypted vault';
    document.getElementById('passwordForm').classList.add('hidden');
    document.getElementById('setupForm').classList.remove('hidden');
}
