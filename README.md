# Sprint Planning Estimator

A collaborative web application for sprint planning and story point estimation using Planning Poker methodology.

## Features

- **Session Management**: Team members can join with their names
- **Task Management**: Host can add multiple tasks/stories for estimation
- **Collaborative Voting**: All participants vote simultaneously using Fibonacci sequence (0, 1, 2, 3, 5, 8, 13, 21) or special cards (?, ☕)
- **Vote Reveal**: Once all participants have voted, estimates are revealed showing everyone's vote
- **Average Calculation**: Automatically calculates the average estimate (excluding non-numeric votes)
- **Task Navigation**: Move through tasks one by one, with estimates saved for each task
- **Persistent State**: Uses browser localStorage to maintain session state

## How to Use

1. **Join Session**: Enter your name to join the planning session
2. **Add Tasks**: Use the sidebar to add tasks that need estimation
3. **Select Task**: Click on a task to make it the current task for voting
4. **Vote**: Each participant selects their estimate using the voting cards
5. **Reveal**: Once all participants vote, results are automatically revealed
6. **Review**: See everyone's estimates and the calculated average
7. **Next Task**: Click "Next Task" to move to the next item and continue estimating

## Technical Details

- Pure HTML/CSS/JavaScript (no build process required)
- Client-side only (works offline after initial load)
- Responsive design for desktop and mobile
- State persisted in browser localStorage

## Demo

Visit [https://hipsad.github.io/](https://hipsad.github.io/) to use the application.
