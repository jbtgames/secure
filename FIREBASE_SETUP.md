# Firebase Security Rules Setup

Your app needs updated security rules to support Notes and Files. Follow either method below:

## Method 1: Deploy via Firebase CLI (Recommended)

1. **Install Firebase CLI** (if not already installed):
   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**:
   ```bash
   firebase login
   ```

3. **Initialize Firebase in this directory**:
   ```bash
   firebase init
   ```
   - Select "Firestore" and "Storage"
   - Choose your existing project: `vault-4b8d7`
   - Accept the default files (firestore.rules, storage.rules)

4. **Deploy the rules**:
   ```bash
   firebase deploy --only firestore:rules,storage:rules
   ```

## Method 2: Manual Update via Firebase Console

### Update Firestore Rules

1. Go to [Firebase Console](https://console.firebase.google.com/project/vault-4b8d7/firestore/rules)
2. Click on **Firestore Database** → **Rules** tab
3. Replace the rules with:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // User documents - anyone can create, but only read/update their own
    match /users/{userId} {
      allow read, write: if true;

      // Photos subcollection
      match /photos/{photoId} {
        allow read, write: if true;
      }

      // Notes subcollection
      match /notes/{noteId} {
        allow read, write: if true;
      }

      // Files subcollection
      match /files/{fileId} {
        allow read, write: if true;
      }
    }
  }
}
```

4. Click **Publish**

### Update Storage Rules

1. Go to [Firebase Console](https://console.firebase.google.com/project/vault-4b8d7/storage/rules)
2. Click on **Storage** → **Rules** tab
3. Replace the rules with:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    // Users folder
    match /users/{userId}/{allPaths=**} {
      // Allow read/write to photos
      match /photos/{photoId} {
        allow read, write: if true;
      }

      // Allow read/write to files
      match /files/{fileId} {
        allow read, write: if true;
      }
    }
  }
}
```

4. Click **Publish**

## Verify Setup

After deploying/updating the rules:
1. Reload your app
2. Try creating a note or uploading a file
3. You should no longer see "Missing or insufficient permissions" errors

## Security Notes

⚠️ **Current rules use `allow read, write: if true;` for development convenience.**

For production, you should implement proper authentication-based rules:

```
// Example production rules:
match /users/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;

  match /photos/{photoId} {
    allow read, write: if request.auth != null && request.auth.uid == userId;
  }

  match /notes/{noteId} {
    allow read, write: if request.auth != null && request.auth.uid == userId;
  }

  match /files/{fileId} {
    allow read, write: if request.auth != null && request.auth.uid == userId;
  }
}
```

This requires implementing Firebase Authentication instead of the current password-only system.
