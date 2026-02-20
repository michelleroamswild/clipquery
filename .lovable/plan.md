

## Video Semantic Search — React App

A clean, minimal "creator tool" style web app for searching video files by semantic content.

### Layout

**Left Sidebar:**
- "Index Location" text input for a directory path
- "Scan for .mp4 files" button
- Sampling interval dropdown (2s / 5s / 10s) — visual only, for future use
- Status area: number of videos found, last scan time

**Main Area:**
- App header: "Local Video Search"
- Search bar with search button (+ enter-to-search)
- Controls row: Sort dropdown (by score / newest file / shortest timestamp), "Only mounted drives" filter checkbox (stub)
- Results list with cards showing:
  - Thumbnail placeholder image
  - Video filename + collapsible full path
  - Best matching timestamp (mm:ss format)
  - Confidence score bar/badge
  - Action buttons: "Open file" (stub), "Copy path", "Copy timestamp"
- "Show more" button for pagination

### Behavior
- **Scanning**: Simulated — entering a path and clicking "Scan" generates a mock list of .mp4 files with realistic filenames. Shows friendly error for empty/invalid-looking paths.
- **Searching**: Returns mock results from the "scanned" file list with random timestamps and confidence scores to simulate the full flow.
- **TODO comments**: Clear markers throughout the code where CLIP embeddings, vector DB (LanceDB/FAISS), and real file system access would be wired in.

### Design
- Clean, minimal aesthetic with a dark-ish or neutral palette — "creator tool" vibe
- Sensible spacing, readable typography, no flashy gradients
- Uses existing shadcn/ui components (Card, Button, Input, Select, Checkbox, Collapsible, Badge, Progress)
- Sidebar layout using the Sidebar component

### No Backend Needed
All data is mock/in-memory. TODO comments indicate where a real backend or Electron/Tauri integration would connect.

