require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));

const RECIPE_JSON_SCHEMA = `{
  "name": "string",
  "time": "string",
  "tags": ["string"],
  "description": "string",
  "instructions": ["string"],
  "ingredients": [
    { "item": "string", "quantity": "string" }
  ],
  "sourceType": "string",
  "confidence": 0
}`;

app.post("/api/parse-recipe", async (req, res) => {
  try {
    const { mode, input } = req.body;

    let response;

    if (mode === "image") {
      // Vision mode — send image as base64 to gpt-4o
      const imageUrl = `data:image/jpeg;base64,${input}`;
      response = await client.responses.create({
        model: "gpt-4o",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `You are a recipe extraction assistant. Look at this image carefully — it may be a photo of a cookbook page, a recipe card, or a screenshot of a recipe.\n\nExtract all recipe information visible in the image and return ONLY valid JSON in this exact format:\n${RECIPE_JSON_SCHEMA}\n\nIf a field is not visible in the image, use an empty string or empty array. Do not add any text outside the JSON.`,
              },
              {
                type: "input_image",
                image_url: imageUrl,
              },
            ],
          },
        ],
      });
    } else {
      // Text modes (search, url, social)
      const prompt = `You are a recipe extraction assistant.\n\nReturn ONLY valid JSON in this format:\n${RECIPE_JSON_SCHEMA}\n\nInput mode: ${mode}\nInput:\n${input}`;
      response = await client.responses.create({
        model: "gpt-4.1-mini",
        input: prompt,
      });
    }

    const text = response.output_text;
    // Strip markdown code fences if model wraps the JSON
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to parse recipe" });
  }
});

app.get("/test", (req, res) => {
  res.json({ ok: true });
});

const port = process.env.PORT || 3001;

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});