const express = require("express");
const app = express();
const PORT = 3306;

// Simple test route
app.get("/api/test", (req, res) => {
  res.json({ message: "API is working", timestamp: new Date().toISOString() });
});

app.listen(PORT, 'localhost', () => {
  console.log(`Simple test server running on http://localhost:${PORT}`);
});