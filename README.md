# Sprint Planning Estimator

A collaborative web application for sprint planning and story point estimation using Planning Poker methodology with **real-time shared sessions**.

## Features

- **Real-time Shared Sessions**: Host creates a session and shares a link/ID with team members
- **Session Management**: 
  - Host can create a new session and get a shareable link
  - Participants can join using session ID or shared link
  - Real-time synchronization across all participants using Firebase
- **Task Management**: Host can add multiple tasks/stories for estimation
- **Collaborative Voting**: All participants vote simultaneously using Fibonacci sequence (0, 1, 2, 3, 5, 8, 13, 21) or special cards (?, ☕)
- **Vote Reveal**: Once all participants have voted, estimates are automatically revealed showing everyone's vote
- **Average Calculation**: Automatically calculates the average estimate (excluding non-numeric votes)
- **Task Navigation**: Host can move through tasks one by one, with estimates saved for each task
- **Host Controls**: Only the session host can add tasks, select tasks, and control the flow

## How to Use

### As a Host (Creating a Session):

1. **Create Session**: Enter your name and click "Create New Session (Host)"
2. **Share Session**: Copy the session ID or full link and share it with your team
3. **Add Tasks**: Use the sidebar to add tasks that need estimation
4. **Select Task**: Click on a task to make it the current task for voting
5. **Vote**: Select your estimate using the voting cards
6. **Wait for Team**: Once all participants vote, results are automatically revealed
7. **Review**: See everyone's estimates and the calculated average
8. **Next Task**: Click "Next Task" to move to the next item and continue estimating

### As a Participant (Joining a Session):

1. **Join Session**: Enter your name and the session ID provided by the host
2. **Wait for Task**: The host will select tasks for estimation
3. **Vote**: Select your estimate using the voting cards when a task is active
4. **View Results**: Once all participants vote, see everyone's estimates

## Technical Details

- Pure HTML/CSS/JavaScript with Firebase for real-time synchronization
- Works on GitHub Pages (static hosting)
- Firebase Realtime Database for shared state
- Responsive design for desktop and mobile
- Session data persists in Firebase
- Local session info cached in browser localStorage

## Setup Requirements

⚠️ **IMPORTANT**: This application requires Firebase to work. If you see "PERMISSION_DENIED" errors, your Firebase rules are not configured correctly.

**Quick Setup:**

1. Create a Firebase project at [https://console.firebase.google.com/](https://console.firebase.google.com/)
2. Enable Firebase Realtime Database
3. **Configure Database Rules** (this is required!):
   - Go to Realtime Database → Rules tab
   - Replace with:
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
   - Click "Publish"
4. Update the Firebase configuration in `index.html` with your project credentials:
   ```javascript
   const firebaseConfig = {
       apiKey: "YOUR_API_KEY",
       authDomain: "YOUR_PROJECT.firebaseapp.com",
       databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
       projectId: "YOUR_PROJECT",
       storageBucket: "YOUR_PROJECT.appspot.com",
       messagingSenderId: "YOUR_SENDER_ID",
       appId: "YOUR_APP_ID"
   };
   ```

📖 **For detailed setup instructions, see [FIREBASE_SETUP.md](FIREBASE_SETUP.md)**

### Common Issue: "PERMISSION_DENIED" Error

If you see this error when creating or joining a session:
- Your Firebase database rules are not set correctly
- Go to Firebase Console → Realtime Database → Rules
- Use the rules shown above (allow `.read: true` and `.write: true`)
- Click "Publish" to apply the rules

Without these rules, the app cannot create or join sessions.

## Static Deployment

✅ **Works on GitHub Pages**: This solution is designed specifically for static hosting. The Firebase integration allows real-time collaboration without needing a backend server.

## Demo

Visit [https://hipsad.github.io/](https://hipsad.github.io/) to use the application.
