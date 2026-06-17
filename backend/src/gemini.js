const Bottleneck = require("bottleneck");
require("dotenv").config();

// Hardcoded API key and base URL for OpenAI-compatible API
const API_KEY = "sk-gynEZUNUo5UI4Y2dUiFZpNnh6w04zDZeu8m0t6oxMr4MHUYh";
const BASE_URL = "https://agentrouter-proxy.sumitmehta396.workers.dev/v1";

// Rate limiter to prevent overwhelming the API
const limiter = new Bottleneck({
  minTime: 2000,
  maxConcurrent: 1,
});

/**
 * Detects if an error is a rate limit (429).
 */
function isRateLimited(error) {
  const status = error.status || error.response?.status;
  return status === 429;
}

/**
 * Detects if an error is due to model overload/unavailability (503).
 */
function isModelUnavailable(error) {
  const status = error.status || error.response?.status;
  const data = error.response?.data;
  
  const is503 = status === 503;
  const hasUnavailableMessage =
    data?.error?.message?.includes("experiencing high demand") ||
    data?.error?.status === "UNAVAILABLE";

  return is503 || hasUnavailableMessage;
}

/**
 * Calls the OpenAI-compatible API with retry on rate limits.
 */
async function callLLM(
  model,
  systemPrompt,
  userPrompt,
  temperature,
  maxTokens,
  maxRetries = 3,
) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const url = `${BASE_URL}/chat/completions`;
      const payload = {
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: temperature,
        max_tokens: maxTokens,
        stream: false,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorData = {};
        try { errorData = JSON.parse(errorText); } catch(e) {}
        
        const err = new Error(`Request failed with status code ${response.status}`);
        err.status = response.status;
        err.response = { status: response.status, data: errorData };
        throw err;
      }

      const data = await response.json();

      if (
        !data ||
        !data.choices ||
        data.choices.length === 0
      ) {
        throw new Error("Invalid response from API");
      }

      const message = data.choices[0].message;
      let content = message?.content;

      // Fallback: reasoning models may put output in reasoning_content if content is empty
      if (!content && message?.reasoning_content) {
        console.log(
          "[LLM] Content was empty, using reasoning_content as fallback",
        );
        content = message.reasoning_content;
      }

      if (!content) {
        console.error(
          "[LLM] API returned empty content. Response:",
          JSON.stringify(data),
        );
        throw new Error("API returned empty content.");
      }

      return content;
    } catch (error) {
      if (isRateLimited(error)) {
        console.warn(
          `[LLM] Rate limited (attempt ${attempt + 1}/${maxRetries}). Retrying with backoff...`,
        );
        lastError = error;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000),
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

const KANDA_DETAILS = {
  1: {
    english: "Bala Kanda",
    hindi: "बालकाण्ड",
    description:
      "Early life of Shree Ram, his education, marriage to Mata Sita, and protection of sages.",
  },
  2: {
    english: "Ayodhya Kanda",
    hindi: "अयोध्याकाण्ड",
    description:
      "Preparations for Shree Ram's coronation, Kaikeyi's demands, exile of Shree Ram, Mata Sita, and Shree Lakshman, death of King Dasharatha, and Bharata's arrival to meet Ram at Chitrakoot. Note that Shree Hanuman does NOT appear in this book.",
  },
  3: {
    english: "Aranya Kanda",
    hindi: "अरण्यकाण्ड",
    description:
      "Forest life of Shree Ram, Mata Sita, and Shree Lakshman. Abduction of Mata Sita by Ravana, and Shree Ram's grief-stricken search.",
  },
  4: {
    english: "Kishkindha Kanda",
    hindi: "किष्किन्धाकाण्ड",
    description:
      "Shree Ram meets Shree Hanuman and Sugriva in the monkey kingdom of Kishkindha. Alliance is formed, Vali is slain, and the search party for Mata Sita is dispatched.",
  },
  5: {
    english: "Sundara Kanda",
    hindi: "सुन्दरकाण्ड",
    description:
      "Shree Hanuman's heroic leap across the ocean to Lanka, search for Mata Sita, finding her in Ashok Vatika, destroying the grove, and returning to Shree Ram.",
  },
  6: {
    english: "Yuddha Kanda",
    hindi: "युद्धकाण्ड",
    description:
      "Construction of Rama's Bridge (Ram Setu), march of the vanara army to Lanka, battle with Ravana's army, slaying of Ravana, rescue of Mata Sita, and return to Ayodhya for Shree Ram's coronation.",
  },
};

/**
 * Uses the LLM to generate a perfectly TTS-formatted translation.
 */
async function generateTranslationPrep(
  sanskritText,
  existingTranslation,
  targetLanguage,
  context = {},
) {
  return limiter.schedule(async () => {
    const models = ["deepseek-v4-flash"];
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`[LLM] Attempting translation using model: ${model}`);

        const systemPrompt = `You are an expert Sanskrit scholar and commentator specializing in the Valmiki Ramayana.

Honorifics:
- Always refer to "Rama" as "Shree Ram" or "Lord Shree Ram".
- Refer to "Sita" as "Mata Sita" or "Devi Sita".
- Refer to "Hanuman" as "Shree Hanuman".
- Refer to "Lakshmana" as "Shree Lakshman".
- Antagonists (e.g. Ravana) without honorifics.
- Sages: use "Maharishi", "Sage", "Rishi".
- **Kanda and Sarga context rules**: In the translation and context, only mention characters and events that are appropriate for the current Kanda's narrative and timeline. For example, Shree Hanuman does NOT appear in Ayodhya Kanda. Never mention Hanuman or other inactive characters in the translations, context, or insights for Ayodhya Kanda shlokas.
- Do not hallucinate characters or events not present in the verse or the current book.
- **Important**: Always translate the Sanskrit shloka directly and faithfully. The reference English translation is ONLY a guide. If the reference translation is incorrect, incomplete, or does not correspond to the Sanskrit shloka, ignore it and translate the Sanskrit shloka directly from the original Sanskrit text.

Output structure — respond in exactly these three sections:

1. Translation (2–3 sentences, natural and reverent, faithful to the Sanskrit):
|||TRANSLATION|||
[Write only the translation text here, do not add any "Translation:" title or prefix]

2. Context (2–4 sentences explaining who is speaking, what event is happening, and why this shloka matters in the narrative):
|||CONTEXT|||
[Write only the context text here, do not add any "Context:" title or prefix]

3. Insight (Provide a notable philosophical, spiritual, ethical, or psychological insight or life lesson from this shloka):
|||INSIGHT|||
[Write only the insight text here, do not add any "Insight:" title or prefix]

${
  targetLanguage === "hi"
    ? "\n\nIMPORTANT: You must write ALL output (Translation, Context, and Insight) in HINDI language. Use natural, simple, conversational Hindi. Keep all honorifics as specified above."
    : "\n\nWrite all output in English."
}

No bullet points, no markdown, no asterisks, no numbering.`;

        const { kanda, sarga, shloka_number } = context || {};
        let contextSection = "";
        if (kanda && sarga) {
          const kDetails = KANDA_DETAILS[kanda] || {
            english: `Kanda ${kanda}`,
            hindi: `Kanda ${kanda}`,
            description: "",
          };
          contextSection = `Shloka context:
- Kanda (Book): ${kDetails.english} - ${kDetails.description}
- Sarga (Chapter): ${sarga}
- Shloka Number: ${shloka_number || "N/A"}
(Important: Keep the timeline and character presence of this specific Kanda in mind. For example, Shree Hanuman and other characters from later books do NOT appear in Ayodhya Kanda. Do not hallucinate or mention their names in the translation, context, or insight if they are not in the text.)\n\n`;
        }

        let userPrompt = "";
        if (targetLanguage === "hi") {
          userPrompt = existingTranslation?.trim()
            ? `${contextSection}Provide the translation, context, and insight for this Valmiki Ramayana shloka as instructed. WRITE ALL OUTPUT IN HINDI.\n\nShloka:\n${sanskritText}\n\nReference translation (use for accuracy):\n${existingTranslation}`
            : `${contextSection}Provide the translation, context, and insight for this Valmiki Ramayana shloka as instructed. WRITE ALL OUTPUT IN HINDI.\n\nShloka:\n${sanskritText}`;
        } else {
          userPrompt = existingTranslation?.trim()
            ? `${contextSection}Provide the translation, context, and insight for this Valmiki Ramayana shloka as instructed.\n\nShloka:\n${sanskritText}\n\nReference translation (use for accuracy):\n${existingTranslation}`
            : `${contextSection}Provide the translation, context, and insight for this Valmiki Ramayana shloka as instructed.\n\nShloka:\n${sanskritText}`;
        }

        let content = await callLLM(
          model,
          systemPrompt,
          userPrompt,
          0.65,
          65536,
        );

        // Post-processing: clean up markdown artifacts but preserve our section delimiters
        content = content
          .replace(/^\s*[\*\-•]\s*/gm, "")
          .replace(/\*\*/g, "")
          .replace(/\*/g, "")
          .replace(/`/g, "")
          .replace(/^#+\s*/gm, "")
          .replace(/\[.*?\]\(.*?\)/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();

        // Enforce honorifics on the full structured content
        content = applyHonorifics(content, targetLanguage);

        return content;
      } catch (error) {
        if (isModelUnavailable(error)) {
          console.warn(
            `[LLM] ⚠️ Model ${model} is unavailable (503). Falling back to next model...`,
          );
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw (
      lastError ||
      new Error("ALL_FALLBACK_MODELS_FAILED: All fallback models failed.")
    );
  });
}

/**
 * Ensures proper honorifics are applied to sacred names.
 */
function applyHonorifics(text, lang) {
  if (lang === "hi") {
    text = text.replace(
      /(?<!श्री\s)(?<!परशु)(?<!अभि)(?<!बल)(?<!राम)राम(?!ायण|चंद्र|ानुज)/g,
      "श्री राम",
    );
    text = text.replace(/श्री\s+श्री\s+राम/g, "श्री राम");
  } else {
    text = text.replace(
      /(?<!Shree\s)(?<!Lord\s)(?<!Parashu)(?<!Bala)\bRama?\b(?!yana)/gi,
      () => "Shree Ram",
    );
    text = text.replace(/Shree\s+Shree\s+Ram/gi, "Shree Ram");
    text = text.replace(/Lord\s+Shree\s+Shree\s+Ram/gi, "Lord Shree Ram");
  }
  return text;
}

/**
 * Classifies the speaker of a shloka using the LLM.
 */
async function classifySpeaker(sanskritText, englishTranslation, context = {}) {
  return limiter.schedule(async () => {
    const models = ["deepseek-v4-flash"];
    let lastError = null;

    for (const model of models) {
      try {
        console.log(
          `[LLM] Attempting speaker classification using model: ${model}`,
        );

        const systemPrompt = `You are an expert scholar of the Valmiki Ramayana.
Analyze the given Sanskrit shloka and its English translation, and identify the primary character speaking these words.

Follow this logic step-by-step to avoid classification errors:
1. **Identify Narration vs. Dialogue**:
   - If the shloka describes a scene, an action, or has verbs in the third-person describing what characters did (e.g., "Bharata crossed the Ganga", "Rama wept"), and there is no direct speech, the speaker is the narrator 'valmiki'.
   - Look for speech verbs in Sanskrit (e.g., 'उवाच' - uvāca, 'अब्रवीत्' - abravīt, 'भाषत' - bhāṣata, 'जगाद' - jagāda) which indicate who is speaking. For example, "bharato ... abravīt" means Bharata spoke, so the speaker is 'bharata'.

2. **Differentiate Speaker from Addressee (Vocatives)**:
   - Identify who is being addressed. If the text says "O Rama", "O Lakshmana", "O King", "O mother", "O hero", the person being addressed is NOT the speaker.
   - Analyze who would speak those words to that addressee given the current context (e.g., Sita speaking to Rama, or Bharata speaking to Sumantra).

3. **Check Pronouns**:
   - First-person pronouns (I, me, my, we, us / Sanskrit: अहम्, मम, मे, वयम्) refer to the speaker.
   - Second-person pronouns (you, your / Sanskrit: त्वम्, तव, ते, युष्मद्) refer to the addressee.

4. **Verify Character Timeline**:
   - Only classify the speaker as a character who is actually present and active in the given Kanda and Sarga.
   - For example:
     - Kanda 1 (Bala Kanda): Rama (young), Dasharatha, Vishwamitra, Janaka, Lakshmana, etc.
     - Kanda 2 (Ayodhya Kanda): Rama, Sita, Lakshmana, Dasharatha, Kaikeyi, Kausalya, Sumantra, Bharata, Guha, Vashistha. Hanuman is NOT present in this book.
     - Kanda 3 (Aranya Kanda): Rama, Sita, Lakshmana, Ravana, Surpanakha, Jatayu, Khara, Maricha. Hanuman is NOT present in this book.
     - Kanda 4 (Kishkindha Kanda): Rama, Lakshmana, Hanuman, Sugriva, Vali, Angada, Tara.
     - Kanda 5 (Sundara Kanda): Hanuman, Sita, Ravana, Mandodari, Trijata.
     - Kanda 6 (Yuddha Kanda): Rama, Lakshmana, Hanuman, Sugriva, Vibhishana, Ravana, Kumbhakarna, Indrajit, Angada.

Determine:
1. The character's name in English (lowercase snake_case, e.g. 'sri_ram', 'sita', 'lakshmana', 'bharata', 'valmiki', 'dasharatha', 'sumantra', 'guha').
2. The character's name in Hindi/Sanskrit (Devanagari script, e.g. 'श्री राम', 'सीता जी', 'लक्ष्मण जी', 'भरत', 'वाल्मीकि', 'राजा दशरथ', 'सुमंत्र', 'गुहा').
3. The character's gender ('male' or 'female').

If it is narration or when Valmiki is speaking, use character 'valmiki', name in Hindi 'वाल्मीकि', and gender 'male'.

Respond with ONLY the English name, Hindi name, and gender separated by colons, like:
english_snake_case:hindi_name:gender

Examples:
- sri_ram:श्री राम:male
- sita:सीता जी:female
- vali:बाली:male
- mandodari:मंदोदरी:female
- valmiki:वाल्मीकि:male
- sumantra:सुमंत्र:male
- bharata:भरत:male

Do not include any other text, quotes, punctuation, or markdown. Just this single string.`;

        const { kanda, sarga, shloka_number } = context || {};
        let contextSection = "";
        if (kanda && sarga) {
          const kDetails = KANDA_DETAILS[kanda] || {
            english: `Kanda ${kanda}`,
            hindi: `काण्ड ${kanda}`,
            description: "",
          };
          contextSection = `Shloka Context:
- Kanda (Book): ${kDetails.english} (${kDetails.hindi}) - ${kDetails.description}
- Sarga (Chapter): ${sarga}
- Shloka Number: ${shloka_number || "N/A"}
(Important: Keep character timelines in mind. For example, Shree Hanuman does not meet Shree Ram until Kishkindha Kanda (Kanda 4). Therefore, Hanuman cannot be the speaker or be mentioned in Bala Kanda (1), Ayodhya Kanda (2), or Aranya Kanda (3). Likewise, check the active speakers of this sarga.)\n\n`;
        }

        const userPrompt = `${contextSection}Shloka:
${sanskritText}

English Translation:
${englishTranslation}`;

        let content = await callLLM(model, systemPrompt, userPrompt, 0.1, 5000);

        content = content.trim().replace(/['"'"'']/g, "");

        // Split and validate format
        const parts = content.split(":");
        if (parts.length === 3) {
          const charEn = parts[0].trim().toLowerCase().replace(/\s+/g, "_");
          const charHi = parts[1].trim();
          const gender = parts[2].trim().toLowerCase();
          return `${charEn}:${charHi}:${gender}`;
        }
        return "other:अन्य:male";
      } catch (error) {
        if (isModelUnavailable(error)) {
          console.warn(
            `[LLM] ⚠️ Model ${model} unavailable (503) for classification. Falling back...`,
          );
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw (
      lastError ||
      new Error("ALL_FALLBACK_MODELS_FAILED for speaker classification.")
    );
  });
}

/**
 * Uses the LLM to generate a concise translation for TTS audio narration (only what the shloka says).
 */
async function generateAudioTranslationPrep(
  sanskritText,
  existingTranslation,
  targetLanguage,
  context = {},
) {
  return limiter.schedule(async () => {
    const models = ["deepseek-v4-flash"];
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`[LLM] Attempting audio translation using model: ${model}`);

        const systemPrompt = `You are an expert Sanskrit scholar specializing in the Valmiki Ramayana.
Provide a direct, faithful, and clear translation of the Sanskrit shloka.

Rules:
1. Don't explain too much. Only translate what the shloka says directly and faithfully.
2. Do NOT add any extra context, commentary, explanation, philosophical insight, spiritual interpretation, or background details.
3. Keep the translation simple, natural, concise, and reverent.
4. Honorifics:
   - Always refer to "Rama" as "Shree Ram" or "Lord Shree Ram".
   - Refer to "Sita" as "Mata Sita" or "Devi Sita".
   - Refer to "Hanuman" as "Shree Hanuman".
   - Refer to "Lakshmana" as "Shree Lakshman".
   - Antagonists (e.g. Ravana) without honorifics.
   - Sages: use "Maharishi", "Sage", "Rishi".
5. Kanda and Sarga context rules: In the translation, only mention characters and events that are appropriate for the current Kanda's narrative and timeline. Do not mention inactive or future characters (e.g., Shree Hanuman does not appear in Ayodhya Kanda).
6. Output structure: Respond ONLY with the translation text. Do not include any title, prefix (like "Translation:"), labels, bullet points, markdown, or numbering.

${
  targetLanguage === "hi"
    ? "IMPORTANT: You must write the translation in HINDI language. Use natural, simple, conversational Hindi."
    : "Write the translation in English."
}`;

        const { kanda, sarga, shloka_number } = context || {};
        let contextSection = "";
        if (kanda && sarga) {
          const kDetails = KANDA_DETAILS[kanda] || {
            english: `Kanda ${kanda}`,
            hindi: `Kanda ${kanda}`,
            description: "",
          };
          contextSection = `Shloka context:
- Kanda (Book): ${kDetails.english} - ${kDetails.description}
- Sarga (Chapter): ${sarga}
- Shloka Number: ${shloka_number || "N/A"}\n\n`;
        }

        let userPrompt = "";
        if (targetLanguage === "hi") {
          userPrompt = existingTranslation?.trim()
            ? `${contextSection}Translate this Valmiki Ramayana shloka to Hindi. WRITE THE OUTPUT ONLY IN HINDI.\n\nShloka:\n${sanskritText}\n\nReference translation (use for accuracy):\n${existingTranslation}`
            : `${contextSection}Translate this Valmiki Ramayana shloka to Hindi. WRITE THE OUTPUT ONLY IN HINDI.\n\nShloka:\n${sanskritText}`;
        } else {
          userPrompt = existingTranslation?.trim()
            ? `${contextSection}Translate this Valmiki Ramayana shloka to English.\n\nShloka:\n${sanskritText}\n\nReference translation (use for accuracy):\n${existingTranslation}`
            : `${contextSection}Translate this Valmiki Ramayana shloka to English.\n\nShloka:\n${sanskritText}`;
        }

        let content = await callLLM(
          model,
          systemPrompt,
          userPrompt,
          0.3, // Lower temperature for more direct, literal translation
          40000,
        );

        // Post-processing: clean up markdown artifacts
        content = content
          .replace(/^\s*[\*\-•]\s*/gm, "")
          .replace(/\*\*/g, "")
          .replace(/\*/g, "")
          .replace(/`/g, "")
          .replace(/^#+\s*/gm, "")
          .replace(/\[.*?\]\(.*?\)/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();

        // Enforce honorifics on the translation
        content = applyHonorifics(content, targetLanguage);

        return content;
      } catch (error) {
        if (isModelUnavailable(error)) {
          console.warn(
            `[LLM] ⚠️ Model ${model} is unavailable (503) for audio translation. Falling back...`,
          );
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw (
      lastError ||
      new Error("ALL_FALLBACK_MODELS_FAILED: All fallback models failed for audio translation.")
    );
  });
}

/**
 * Uses the LLM to generate both the speaker classification and the concise translation in a single call.
 */
async function generateAudioDetailsPrep(
  sanskritText,
  existingTranslation,
  targetLanguage,
  context = {},
) {
  return limiter.schedule(async () => {
    const models = ["deepseek-v4-flash"];
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`[LLM] Attempting combined audio details using model: ${model}`);

        const systemPrompt = `You are an expert Sanskrit scholar specializing in the Valmiki Ramayana.
Analyze the given Sanskrit shloka and its reference translation, and return two pieces of information:
1. The character speaker classification.
2. The direct, concise translation of the shloka in the target language.

Follow these strict rules for each:

--- PART 1: SPEAKER CLASSIFICATION ---
Identify the primary character speaking these words.
1. Narration vs Dialogue: If the shloka describes a scene or action in third-person, the speaker is the narrator 'valmiki'. Look for speech verbs in Sanskrit (e.g., 'उवाच' - uvāca, 'अब्रवीत्' - abravīt) to identify the speaker.
2. Vocatives (addresses): If a character is addressed (e.g. "O Rama"), they are NOT the speaker.
3. Check pronouns: First-person pronouns (I, me, my, we) refer to the speaker.
4. Verify character timeline: Only classify speaker as a character present in the current Kanda's narrative (e.g., Shree Hanuman does not meet Shree Ram until Kishkindha Kanda, so he cannot speak in Bala, Ayodhya, or Aranya Kandas).
5. Format: Return the speaker as 'english_snake_case:hindi_name:gender'.
   Examples:
   - sri_ram:श्री राम:male
   - sita:सीता जी:female
   - valmiki:वाल्मीकि:male
   - lakshmana:लक्ष्मण जी:male

--- PART 2: CONCISE TRANSLATION ---
1. Don't explain too much. Only translate what the shloka says directly and faithfully.
2. Do NOT add any extra context, commentary, explanation, philosophical insight, spiritual interpretation, or background details.
3. Keep the translation simple, natural, concise, and reverent.
4. Honorifics:
   - Always refer to "Rama" as "Shree Ram" or "Lord Shree Ram".
   - Refer to "Sita" as "Mata Sita" or "Devi Sita".
   - Refer to "Hanuman" as "Shree Hanuman".
   - Refer to "Lakshmana" as "Shree Lakshman".
   - Antagonists (e.g. Ravana) without honorifics.
   - Sages: use "Maharishi", "Sage", "Rishi".
5. Return only the direct translation text.

--- OUTPUT STRUCTURE ---
You MUST format your output exactly as follows:
|||SPEAKER|||
[english_snake_case:hindi_name:gender]
|||TRANSLATION|||
[Concise translation text]

${
  targetLanguage === "hi"
    ? "IMPORTANT: You must write the translation in HINDI language. Use natural, simple, conversational Hindi."
    : "Write the translation in English."
}`;

        const { kanda, sarga, shloka_number } = context || {};
        let contextSection = "";
        if (kanda && sarga) {
          const kDetails = KANDA_DETAILS[kanda] || {
            english: `Kanda ${kanda}`,
            hindi: `Kanda ${kanda}`,
            description: "",
          };
          contextSection = `Shloka context:
- Kanda (Book): ${kDetails.english} - ${kDetails.description}
- Sarga (Chapter): ${sarga}
- Shloka Number: ${shloka_number || "N/A"}\n\n`;
        }

        let userPrompt = "";
        if (targetLanguage === "hi") {
          userPrompt = existingTranslation?.trim()
            ? `${contextSection}Classify the speaker and translate this Valmiki Ramayana shloka to Hindi. WRITE THE TRANSLATION ONLY IN HINDI.\n\nShloka:\n${sanskritText}\n\nReference translation (use for accuracy):\n${existingTranslation}`
            : `${contextSection}Classify the speaker and translate this Valmiki Ramayana shloka to Hindi. WRITE THE TRANSLATION ONLY IN HINDI.\n\nShloka:\n${sanskritText}`;
        } else {
          userPrompt = existingTranslation?.trim()
            ? `${contextSection}Classify the speaker and translate this Valmiki Ramayana shloka to English.\n\nShloka:\n${sanskritText}\n\nReference translation (use for accuracy):\n${existingTranslation}`
            : `${contextSection}Classify the speaker and translate this Valmiki Ramayana shloka to English.\n\nShloka:\n${sanskritText}`;
        }

        let content = await callLLM(
          model,
          systemPrompt,
          userPrompt,
          0.3,
          40000,
        );

        // Parse outputs
        const speakerMatch = content.match(/\|\|\|SPEAKER\|\|\|([\s\S]*?)(?=\|\|\|TRANSLATION\|\|\||$)/);
        const translationMatch = content.match(/\|\|\|TRANSLATION\|\|\|([\s\S]*)$/);

        let speaker = speakerMatch ? speakerMatch[1].trim() : "valmiki:वाल्मीकि:male";
        let translation = translationMatch ? translationMatch[1].trim() : "";

        // Fallback checks
        if (!speaker.includes(":")) {
          speaker = "valmiki:वाल्मीकि:male";
        }

        // Clean up markdown artifacts in translation
        translation = translation
          .replace(/^\s*[\*\-•]\s*/gm, "")
          .replace(/\*\*/g, "")
          .replace(/\*/g, "")
          .replace(/`/g, "")
          .replace(/^#+\s*/gm, "")
          .replace(/\[.*?\]\(.*?\)/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();

        // Enforce honorifics
        translation = applyHonorifics(translation, targetLanguage);

        return { speaker, translation };
      } catch (error) {
        if (isModelUnavailable(error)) {
          console.warn(
            `[LLM] ⚠️ Model ${model} is unavailable (503) for audio details. Falling back...`,
          );
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw (
      lastError ||
      new Error("ALL_FALLBACK_MODELS_FAILED: All fallback models failed for combined audio details.")
    );
  });
}

module.exports = { generateTranslationPrep, generateAudioTranslationPrep, generateAudioDetailsPrep, classifySpeaker };

