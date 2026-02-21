import express from "express";
import cors from "cors";
import { getDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import healthRoutes from "./routes/health.js";
import mediaRoutes from "./routes/media.js";
import scanRoutes from "./routes/scan.js";
import volumeRoutes from "./routes/volumes.js";
import thumbnailRoutes from "./routes/thumbnails.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3001");

app.use(cors());
app.use(express.json());

// Init DB on startup
const db = getDb();
runMigrations(db);

// Routes
app.use("/api", healthRoutes);
app.use("/api", mediaRoutes);
app.use("/api", scanRoutes);
app.use("/api", volumeRoutes);
app.use("/api", thumbnailRoutes);

app.listen(PORT, () => {
  console.log(`clipquery API server running on http://localhost:${PORT}`);
});

export default app;
