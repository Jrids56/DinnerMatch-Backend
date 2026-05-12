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

// Fetch real nutrition data from Edamam using the parsed ingredient list
async function getNutrition(ingredients) {
  const appId = process.env.EDAMAM_APP_ID;
  const appKey = process.env.EDAMAM_APP_KEY;
  if (!appId || !appKey || !ingredients?.length) return null;

  // Format ingredients as plain strings e.g. "2 cups flour", "1 chicken breast"
  const ingr = ingredients.map((i) => {
    const qty = i.quantity ? String(i.quantity).trim() : "";
    const item = i.item ? String(i.item).trim() : "";
    return qty ? `${qty} ${item}` : item;
  }).filter(Boolean);

  if (!ingr.length) return null;

  try {
    const resp = await fetch(
      `https://api.edamam.com/api/nutrition-details?app_id=${appId}&app_key=${appKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingr }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Edamam error:", resp.status, errText);
      return null;
    }

    const data = await resp.json();
    const kcal = Math.round(data.calories || 0);
    const protein = Math.round(data.totalNutrients?.PROCNT?.quantity || 0);
    const fat = Math.round(data.totalNutrients?.FAT?.quantity || 0);

    return {
      kcal: String(kcal),
      protein: `${protein}g`,
      fat: `${fat}g`,
    };
  } catch (err) {
    console.error("Edamam fetch failed:", err.message);
    return null;
  }
}

async function parseAndEnrich(parsed) {
  const macros = await getNutrition(parsed.ingredients);
  return { ...parsed, macros: macros || { kcal: "", protein: "", fat: "" } };
}

app.post("/api/parse-recipe", async (req, res) => {
  try {
    const { mode, input } = req.body;

    let parsed;

    if (mode === "image") {
      // Vision mode — use Chat Completions API with gpt-4o
      const chatResponse = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are a recipe extraction assistant. Look at this image carefully — it may be a photo of a cookbook page, a recipe card, or a screenshot of a recipe.\n\nExtract all recipe information visible in the image and return ONLY valid JSON in this exact format:\n${RECIPE_JSON_SCHEMA}\n\nIf a field is not visible in the image, use an empty string or empty array. Do not add any text outside the JSON.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${input}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
      });
      const text = chatResponse.choices[0].message.content;
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } else {
      // Text modes: search, url, social
      const prompt = `You are a recipe extraction assistant.\n\nReturn ONLY valid JSON in this format:\n${RECIPE_JSON_SCHEMA}\n\nInput mode: ${mode}\nInput:\n${input}`;
      const response = await client.responses.create({
        model: "gpt-4.1-mini",
        input: prompt,
      });
      const text = response.output_text;
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    }

    // Enrich with real nutrition data from Edamam
    const enriched = await parseAndEnrich(parsed);
    res.json(enriched);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to parse recipe" });
  }
});

app.get("/test", (req, res) => {
  res.json({ ok: true, version: "v4-nutrition" });
});

const port = process.env.PORT || 3001;

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
