import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, getBlob } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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
window.imageCache = new Map(); // Cache decrypted images to avoid re-downloading
window.currentFolder = 'All Photos';
window.folders = ['All Photos', 'Favorites'];
window.currentPhotoId = null;
window.currentUsername = null;
window.currentPhotoIndex = 0;
window.currentPhotoList = [];

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
    const username = document.getElementById('setupUsername').value.trim().toLowerCase();
    const password = document.getElementById('setupPassword').value;
    const confirmPassword = document.getElementById('setupPasswordConfirm').value;

    if (!username || username.length < 3) {
        alert('Username must be at least 3 characters');
        return;
    }

    if (!password || password.length < 6) {
        alert('Password must be at least 6 characters');
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
            alert('Username already taken. Please choose another.');
            return;
        }

        const passwordHash = await hashPassword(password);
        await window.setDoc(window.doc(window.db, 'users', username), {
            passwordHash: passwordHash,
            createdAt: new Date().toISOString(),
            photoCount: 0
        });

        window.encryptionKey = await deriveKey(password);
        window.currentUsername = username;

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
                    <button class="btn btn-primary" style="width: 100%;" onclick="enableBiometricConfirm('${password.replace(/'/g, "\\'")}')">Enable</button>
                    <button class="btn btn-secondary" style="width: 100%; margin-top: 0.75rem;" onclick="this.closest('.modal').remove(); finalizeVaultSetup()">Skip</button>
                </div>
            `;
            document.body.appendChild(dialog);
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
            alert('Username not found. Please sign up first.');
            return;
        }

        const userData = userDoc.data();
        const passwordHash = await hashPassword(password);
        
        if (passwordHash !== userData.passwordHash) {
            alert('Incorrect password');
            return;
        }

        window.encryptionKey = await deriveKey(password);
        window.currentUsername = username;

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
        window.imageCache.clear();
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

    if (newPassword.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }

    const currentPasswordHash = await hashPassword(currentPassword);
    const storedHash = localStorage.getItem('passwordHash');
    
    if (currentPasswordHash !== storedHash) {
        alert('Current password is incorrect');
        return;
    }

    const confirmDialog = document.createElement('div');
    confirmDialog.className = 'modal active';
    confirmDialog.innerHTML = `
        <div class="auth-card" style="margin: 0;">
            <div class="auth-header">
                <h2 class="auth-title">⚠️ Confirm</h2>
                <p class="auth-subtitle">Re-encrypt ${window.photos.length} photos with new password?</p>
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

        for (let i = 0; i < window.photos.length; i++) {
            const photo = window.photos[i];
            progressText.textContent = `Re-encrypting... ${i + 1}/${window.photos.length}`;

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
                    <li>Your account data</li>
                    <li>All encrypted files</li>
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

        for (const photo of window.photos) {
            const storageRef = window.ref(window.storage, `users/${window.currentUsername}/photos/${photo.id}.enc`);
            await window.deleteObject(storageRef).catch(() => {});
        }

        const photosSnapshot = await window.getDocs(window.collection(window.db, 'users', window.currentUsername, 'photos'));
        const batch = window.writeBatch(window.db);
        photosSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

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

// ==================== PHOTO ACTIONS ====================
window.showPhotoActions = function(photoId) {
    window.currentPhotoId = photoId;
    const photo = window.photos.find(p => p.id === photoId);
    
    const actionList = `
        <div class="action-item" onclick="viewPhoto('${photoId}'); closeActionSheet();">
            <span class="action-icon">👁</span>
            View Photo
        </div>
        <div class="action-item" onclick="downloadPhoto('${photoId}'); closeActionSheet();">
            <span class="action-icon">⬇️</span>
            Download
        </div>
        ${window.folders.length > 2 ? `
            <div class="action-item" onclick="movePhotoPrompt('${photoId}'); closeActionSheet();">
                <span class="action-icon">📁</span>
                Move to Folder
            </div>
        ` : ''}
        <div class="action-item danger" onclick="deletePhoto('${photoId}'); closeActionSheet();">
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
                    <div class="action-item" onclick="movePhotoToFolder('${photoId}', '${folder}')">
                        <span class="action-icon">${folder === 'Favorites' ? '⭐' : '📁'}</span>
                        ${folder}
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
            <div class="folder-chip ${isActive ? 'active' : ''} ${isFavorite ? 'favorite' : ''}" onclick="selectFolder('${folder}')">
                ${isFavorite ? '⭐' : (folder === 'All Photos' ? '📂' : '📁')} ${folder}
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

    grid.innerHTML = filteredPhotos.map((photo, index) => `
        <div class="photo-card" style="animation-delay: ${index * 0.05}s">
            <div class="photo-thumbnail" onclick="viewPhoto('${photo.id}')">
                ${photo.thumbnail 
                    ? `<div class="photo-bg" style="background-image: url('${photo.thumbnail}');"></div>
                       <img src="${photo.thumbnail}" class="photo-img" alt="${photo.name}">`
                    : `<div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 3rem;">🔐</div>`
                }
                <button class="photo-favorite-btn ${photo.favorite ? 'favorited' : ''}" onclick="toggleFavorite('${photo.id}', event)">
                    ${photo.favorite ? '⭐' : '☆'}
                </button>
            </div>
            <div class="photo-info">
                <div class="photo-name">${photo.name}</div>
                <div class="photo-meta">
                    <span>${formatBytes(photo.size)}</span>
                    <button class="btn-ghost btn-icon" style="padding: 0.25rem; font-size: 1.125rem;" onclick="showPhotoActions('${photo.id}')">⋯</button>
                </div>
            </div>
        </div>
    `).join('');

    updateStats();
}

function updateStats() {
    document.getElementById('photoCount').textContent = window.photos.length;
    document.getElementById('favoriteCount').textContent = window.photos.filter(p => p.favorite).length;
    
    const totalBytes = window.photos.reduce((sum, p) => sum + (p.size || 0), 0);
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

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode('securevault-salt'),
            iterations: 100000,
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
                const maxSize = 200;
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
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
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
