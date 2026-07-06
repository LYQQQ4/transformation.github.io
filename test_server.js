const express = require("express");
const app = express();
const PORT = 3001;

app.use(express.json());

app.get("/api/test", (req, res) => {
  res.json({ message: "Test API working", timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Simple test server running on http://localhost:${PORT}`);
});