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
4. **Start in "locked mode"** (we'll set the correct rules in the next step)
5. Click "Enable"

> **⚠️ IMPORTANT**: Do not skip step 3 below! The default locked mode rules will prevent the app from working. You MUST configure the rules as shown in the next step.

### 3. Configure Database Rules

**IMPORTANT**: This application requires specific database rules to work properly. The application does NOT use Firebase Authentication, so rules must allow unauthenticated read/write access.

1. In the Realtime Database section, click on the "Rules" tab
2. Replace the rules with the following:

**Required Rules (allows unauthenticated access):**
```json
{
  "rules": {
    "sessions": {
      "$sessionId": {
        ".read": true,
        ".write": true,
        ".indexOn": ["createdAt"]
      }
    }
  }
}
```

3. Click "Publish"

**⚠️ Security Note**: These rules allow anyone to read and write to your database. This is necessary for the current implementation which doesn't use authentication. To improve security:

- Only share session links with trusted team members
- Consider implementing Firebase Authentication in the future
- Monitor your Firebase usage to detect any abuse
- Set up data retention policies to auto-delete old sessions

**Why these rules are needed**: The application creates and updates sessions without requiring users to sign in. If you use rules that require authentication (`auth.uid`), you will see "PERMISSION_DENIED" errors because users are not authenticated.

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

### "PERMISSION_DENIED" Error

This is the most common error and means your Firebase database rules are not configured correctly.

**Symptoms:**
- Error in console: `FIREBASE WARNING: set at /sessions/XXXXXX failed: permission_denied`
- Alert shows "Error creating session: PERMISSION_DENIED"

**Solution:**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Click "Realtime Database" in the left sidebar
4. Click the "Rules" tab
5. Replace the rules with:
   ```json
   {
     "rules": {
       "sessions": {
         "$sessionId": {
           ".read": true,
           ".write": true,
           ".indexOn": ["createdAt"]
         }
       }
     }
   }
   ```
6. Click "Publish"
7. Try creating a session again

**Why this happens:**
- The default Firebase rules deny all read/write access
- Rules with `auth != null` require authentication, which this app doesn't use
- You need to explicitly allow unauthenticated read/write access

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
