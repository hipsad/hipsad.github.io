# Firebase Setup Guide

This guide will walk you through setting up Firebase Realtime Database for the Sprint Planning Estimator.

## Why Firebase?

The Sprint Planning Estimator now supports **real-time shared sessions** across multiple users and devices. Since GitHub Pages only hosts static files (no backend server), we use Firebase Realtime Database to:

- Store shared session data
- Synchronize state across all participants in real-time
- Enable collaborative planning without needing your own server

## Setup Steps

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or "Create a project"
3. Enter a project name (e.g., "sprint-planner")
4. Disable Google Analytics (optional, not needed for this app)
5. Click "Create project"

### 2. Enable Realtime Database

1. In your Firebase project dashboard, click "Realtime Database" in the left sidebar
2. Click "Create Database"
3. Select a location closest to your users
4. Start in **test mode** for now (we'll set proper rules next)
5. Click "Enable"

### 3. Configure Database Rules

1. In the Realtime Database section, click on the "Rules" tab
2. Replace the rules with the following:

**For Development/Testing (Simple but less secure):**
```json
{
  "rules": {
    "sessions": {
      "$sessionId": {
        ".read": true,
        ".write": true,
        ".validate": "newData.hasChildren(['host', 'participants', 'tasks'])",
        ".indexOn": ["createdAt"]
      }
    }
  }
}
```

**For Production (More Secure - Recommended):**
```json
{
  "rules": {
    "sessions": {
      "$sessionId": {
        ".read": true,
        ".write": "!data.exists() || data.child('host').val() === auth.uid || !data.hasChild('host')",
        ".validate": "newData.hasChildren(['host', 'participants', 'tasks'])",
        "participants": {
          ".write": true
        },
        "votes": {
          ".write": true
        },
        ".indexOn": ["createdAt"]
      }
    }
  }
}
```

3. Click "Publish"

**Note**: The development rules allow anyone to read/write sessions. For production, you should:
- Implement Firebase Authentication
- Use more restrictive rules that verify user identity
- Consider adding session expiration logic

### 4. Get Your Firebase Configuration

1. Click on the gear icon next to "Project Overview" and select "Project settings"
2. Scroll down to "Your apps" section
3. Click on the web icon `</>` to add a web app
4. Give it a nickname (e.g., "Sprint Planner Web")
5. Click "Register app"
6. Copy the Firebase configuration object (it looks like this):

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

### 5. Update the Application

1. Open `index.html` in your repository
2. Find the Firebase configuration section (around line 445):

```javascript
const firebaseConfig = {
    apiKey: "AIzaSyDemoKey-Replace-With-Real-Key",
    authDomain: "sprint-planner-demo.firebaseapp.com",
    databaseURL: "https://sprint-planner-demo-default-rtdb.firebaseio.com",
    projectId: "sprint-planner-demo",
    storageBucket: "sprint-planner-demo.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};
```

3. Replace it with your actual Firebase configuration from step 4
4. Commit and push the changes to GitHub

### 6. Test Your Setup

1. Open your GitHub Pages site (e.g., https://yourusername.github.io/)
2. Open the browser console (F12) to check for any Firebase errors
3. Try creating a session - you should see "Firebase initialized successfully" in the console
4. Check your Firebase console - you should see a new session appear in the Realtime Database

### 7. Test Multi-User Collaboration

1. Create a session on one browser/device
2. Copy the session link or ID
3. Open the app in another browser/incognito window/device
4. Join using the session ID
5. Add tasks, vote, and verify changes sync in real-time!

## Security Considerations

### For Production Use

The current setup uses open read/write rules for simplicity. For production:

1. **Implement Firebase Authentication**:
   - Add Firebase Auth to require users to sign in
   - Update rules to verify authentication

2. **More Restrictive Rules**:
```json
{
  "rules": {
    "sessions": {
      "$sessionId": {
        ".read": "auth != null",
        ".write": "auth != null",
        ".indexOn": ["createdAt"]
      }
    }
  }
}
```

3. **Session Cleanup**:
   - Implement automatic deletion of old sessions (use Firebase Cloud Functions)
   - Or add `.write` rules that require valid timestamps

4. **Rate Limiting**:
   - Consider Firebase App Check to prevent abuse
   - Monitor usage in Firebase Console

## Troubleshooting

### "Firebase is not available" Error
- Check that you've replaced the demo Firebase config with your real config
- Verify the Firebase SDK scripts are loading (check Network tab in browser dev tools)
- Check internet connection

### Sessions Not Syncing
- Check Firebase Console > Realtime Database to see if data is being written
- Verify database rules allow read/write
- Check browser console for Firebase errors

### Database URL Issues
- Make sure you're using the correct database URL format
- **For newer projects**: `https://PROJECT-ID-default-rtdb.REGION.firebasedatabase.app` (e.g., `https://my-app-default-rtdb.europe-west1.firebasedatabase.app`)
- **For older projects**: `https://PROJECT-ID.firebaseio.com` (e.g., `https://my-app.firebaseio.com`)
- Check your Firebase Console for the exact URL under Realtime Database settings

## Cost and Limits

Firebase Realtime Database offers a **free tier** that should be sufficient for most teams:

- **Spark Plan (Free)**:
  - 1 GB stored data
  - 10 GB/month downloaded data
  - 100 simultaneous connections

For a sprint planning tool, this should handle dozens of concurrent sessions easily.

## Alternative Solutions

If you don't want to use Firebase, other options for static sites include:

1. **Supabase** - Open source Firebase alternative
2. **PeerJS** - Peer-to-peer WebRTC (more complex, but no database needed)
3. **Pusher** - Real-time messaging service
4. **Socket.io with a separate server** - Requires hosting a backend

Firebase is recommended for its simplicity and generous free tier.
