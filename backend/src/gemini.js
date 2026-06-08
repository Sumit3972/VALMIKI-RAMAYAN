const axios = require('axios');
const Bottleneck = require('bottleneck');
require('dotenv').config();

const { getActiveKey, rotateKey, markExpired, recordUsage } = require('./geminiKeyManager');

// Max retries = number of keys we could rotate through
const MAX_KEY_RETRIES = 16;

// Gemini 2.5 Flash Free Tier allows 15 RPM.
// We set minTime to 4200ms (approx 14.3 req/min) to stay safely under the limit per key.
const limiter = new Bottleneck({
  minTime: 4200,
  maxConcurrent: 1
});

/**
 * Detects if an Axios error is a temporary rate limit (429).
 */
function isRateLimited(error) {
  if (!error.response) return false;
  return error.response.status === 429;
}

/**
 * Detects if an Axios error is a permanent authentication/leak error (400, 403).
 */
function isInvalidKey(error) {
  if (!error.response) return false;
  return error.response.status === 403 || error.response.status === 400;
}

/**
 * Detects if an Axios error is due to model overload/unavailability (503).
 */
function isModelUnavailable(error) {
  const response = error.response || error.originalError?.response;
  if (!response) return false;

  const is503 = response.status === 503;
  const hasUnavailableMessage = 
    response.data?.error?.message?.includes('experiencing high demand') || 
    response.data?.error?.status === 'UNAVAILABLE';

  return is503 || hasUnavailableMessage;
}

/**
 * Executes an API call with automatic key rotation on quota exhaustion.
 */
async function callGeminiWithRetry(requestFn) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
    let apiKey;
    
    try {
      apiKey = await getActiveKey();
    } catch (err) {
      throw err; // No active keys left at all
    }

    try {
      const result = await requestFn(apiKey);
      
      recordUsage(apiKey).catch(e => 
        console.error('[GeminiKeyManager] Failed to record usage:', e.message)
      );
      
      return result;

    } catch (error) {
      if (isRateLimited(error)) {
        console.warn(`[Gemini] 🔄 Key quota exhausted (attempt ${attempt + 1}/${MAX_KEY_RETRIES}). Rotating to next key...`);
        await rotateKey(apiKey);
        lastError = error;
        // Loop continues
      } else if (isInvalidKey(error)) {
        console.error(`[Gemini] 🚨 Key is INVALID or LEAKED (attempt ${attempt + 1}/${MAX_KEY_RETRIES}). Permanently expiring...`);
        await markExpired(apiKey);
        lastError = error;
        // Loop continues
      } else {
        throw error;
      }
    }
  }

  const err = new Error('ALL_KEYS_EXHAUSTED: All Gemini API keys are currently rate limited. Please try again in a minute.');
  err.statusCode = 503;
  err.originalError = lastError;
  throw err;
}

const KANDA_DETAILS = {
  1: { english: 'Bala Kanda', hindi: 'बालकाण्ड', description: 'Early life of Shree Ram, his education, marriage to Mata Sita, and protection of sages.' },
  2: { english: 'Ayodhya Kanda', hindi: 'अयोध्याकाण्ड', description: 'Preparations for Shree Ram\'s coronation, Kaikeyi\'s demands, exile of Shree Ram, Mata Sita, and Shree Lakshman, death of King Dasharatha, and Bharata\'s arrival to meet Ram at Chitrakoot. Note that Shree Hanuman does NOT appear in this book.' },
  3: { english: 'Aranya Kanda', hindi: 'अरण्यकाण्ड', description: 'Forest life of Shree Ram, Mata Sita, and Shree Lakshman. Abduction of Mata Sita by Ravana, and Shree Ram\'s grief-stricken search.' },
  4: { english: 'Kishkindha Kanda', hindi: 'किष्किन्धाकाण्ड', description: 'Shree Ram meets Shree Hanuman and Sugriva in the monkey kingdom of Kishkindha. Alliance is formed, Vali is slain, and the search party for Mata Sita is dispatched.' },
  5: { english: 'Sundara Kanda', hindi: 'सुन्दरकाण्ड', description: 'Shree Hanuman\'s heroic leap across the ocean to Lanka, search for Mata Sita, finding her in Ashok Vatika, destroying the grove, and returning to Shree Ram.' },
  6: { english: 'Yuddha Kanda', hindi: 'युद्धकाण्ड', description: 'Construction of Rama\'s Bridge (Ram Setu), march of the vanara army to Lanka, battle with Ravana\'s army, slaying of Ravana, rescue of Mata Sita, and return to Ayodhya for Shree Ram\'s coronation.' }
};

/**
 * Uses Gemini to generate a perfectly TTS-formatted translation.
 * Automatically rotates API key on quota exhaustion.
 */
async function generateTranslationPrep(sanskritText, existingTranslation, targetLanguage, context = {}) {
  return limiter.schedule(async () => {
    const models = ['gemini-3.1-flash-lite'];
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`[Gemini] Attempting translation using model: ${model}`);
        const content = await callGeminiWithRetry(async (apiKey) => {

          const systemPrompt = targetLanguage === 'hi'
            ? `आप वाल्मीकि रामायण के विशेषज्ञ संस्कृत-से-हिंदी अनुवादक और टीकाकार हैं। यह एक पवित्र धार्मिक ग्रंथ है।

अनुवाद के नियम:
- "राम" को सदैव "श्री राम" लिखें।
- "सीता" को "माता सीता" या "सीता जी" लिखें।
- "हनुमान" को "श्री हनुमान" या "हनुमान जी" लिखें।
- "लक्ष्मण" को "लक्ष्मण जी" लिखें।
- "रावण" जैसे खलनायकों के नाम यथावत रखें।
- ऋषि-मुनियों के लिए "महर्षि", "मुनि", "ऋषि" आदि सम्मानसूचक शब्द प्रयोग करें।
- भाषा सरल, स्वाभाविक और बोलचाल की हिंदी में हो।
- **काण्ड और सर्ग के अनुसार संदर्भ नियम**: अनुवाद और संदर्भ में केवल उन्हीं पात्रों और घटनाओं का उल्लेख करें जो वर्तमान काण्ड की कथा और समय चक्र के अनुकूल हों। उदाहरण के लिए, अयोध्याकाण्ड (Ayodhya Kanda) में हनुमान जी का कोई उल्लेख या आगमन नहीं होता है, अतः अयोध्याकाण्ड के श्लोकों में भूलकर भी हनुमान जी या अन्य बाद के पात्रों के नाम न लिखें।
- अनुवाद और संदर्भ में किसी भी प्रकार की काल्पनिक (hallucinated) पात्रों की संगति न जोड़ें।
- **महत्वपूर्ण**: हमेशा मूल संस्कृत श्लोक का सीधे अनुवाद करें। संदर्भ अनुवाद (अंग्रेजी) केवल एक सहायता है। यदि अंग्रेजी संदर्भ अनुवाद गलत, अपूर्ण, या श्लोक से अलग है, तो उसे पूरी तरह अनदेखा करें और केवल मूल संस्कृत श्लोक का ही हिंदी में अनुवाद करें।

आउटपुट संरचना — इन तीन भागों में उत्तर दें:

1. अनुवाद (2-3 वाक्य, श्लोक का सटीक व प्रवाहमान अनुवाद):
|||TRANSLATION|||
[यहाँ केवल अनुवाद का पाठ लिखें, कोई "अनुवाद:" शीर्षक या उपसर्ग न लगाएं]

2. संदर्भ (2-4 वाक्य, श्लोक का प्रसंग, पात्र, घटना का संक्षिप्त परिचय):
|||CONTEXT|||
[यहाँ केवल प्रसंग/संदर्भ का पाठ लिखें, कोई "संदर्भ:" शीर्षक या उपसर्ग न लगाएं]

3. विशेष दृष्टि (श्लोक से जुड़ी कोई गहरी आध्यात्मिक, दार्शनिक, नैतिक या व्यावहारिक जीवन से संबंधित प्रेरणादायक अंतर्दृष्टि अवश्य लिखें):
|||INSIGHT|||
[यहाँ केवल अंतर्दृष्टि का पाठ लिखें, कोई "विशेष दृष्टि:" शीर्षक या उपसर्ग न लगाएं]

कोई बुलेट पॉइंट, तारांकन, मार्कडाउन या क्रमांक न लगाएं।`
            : `You are an expert Sanskrit scholar and commentator specializing in the Valmiki Ramayana.

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

No bullet points, no markdown, no asterisks, no numbering.`;

          const { kanda, sarga, shloka_number } = context || {};
          let contextSection = '';
          if (kanda && sarga) {
            const kDetails = KANDA_DETAILS[kanda] || { english: `Kanda ${kanda}`, hindi: `काण्ड ${kanda}`, description: '' };
            if (targetLanguage === 'hi') {
              contextSection = `श्लोक का संदर्भ (Location context of the shloka):
- काण्ड (Kanda): ${kDetails.hindi} (${kDetails.english}) - ${kDetails.description}
- सर्ग (Sarga): ${sarga}
- श्लोक संख्या (Shloka Number): ${shloka_number || 'N/A'}
(ध्यान दें: चरित्रों और घटनाओं की व्याख्या करते समय इस काण्ड के संदर्भ का पूर्ण ध्यान रखें। उदाहरण के लिए, अयोध्याकाण्ड में हनुमान जी या अन्य बाद के पात्र नहीं आते हैं, अतः अनुवाद या प्रसंग में उनके नाम की कोई भूल न करें।)\n\n`;
            } else {
              contextSection = `Shloka context:
- Kanda (Book): ${kDetails.english} (${kDetails.hindi}) - ${kDetails.description}
- Sarga (Chapter): ${sarga}
- Shloka Number: ${shloka_number || 'N/A'}
(Important: Keep the timeline and character presence of this specific Kanda in mind. For example, Shree Hanuman and other characters from later books do NOT appear in Ayodhya Kanda. Do not hallucinate or mention their names in the translation, context, or insight if they are not in the text.)\n\n`;
            }
          }

          let userPrompt = '';
          if (targetLanguage === 'hi') {
            userPrompt = existingTranslation?.trim()
              ? `${contextSection}इस वाल्मीकि रामायण के श्लोक का अनुवाद, संदर्भ और विशेष दृष्टि निर्देशानुसार लिखें।\n\nश्लोक:\n${sanskritText}\n\nसंदर्भ अनुवाद (सटीकता के लिए देखें):\n${existingTranslation}`
              : `${contextSection}इस वाल्मीकि रामायण के श्लोक का अनुवाद, संदर्भ और विशेष दृष्टि निर्देशानुसार लिखें।\n\nश्लोक:\n${sanskritText}`;
          } else {
            userPrompt = existingTranslation?.trim()
              ? `${contextSection}Provide the translation, context, and insight for this Valmiki Ramayana shloka as instructed.\n\nShloka:\n${sanskritText}\n\nReference translation (use for accuracy):\n${existingTranslation}`
              : `${contextSection}Provide the translation, context, and insight for this Valmiki Ramayana shloka as instructed.\n\nShloka:\n${sanskritText}`;
          }

          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const payload = {
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: [{
              parts: [{ text: userPrompt }]
            }],
            generationConfig: {
              temperature: 0.65,
              maxOutputTokens: 65536,
            }
          };

          const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
          });

          if (!response.data || !response.data.candidates || response.data.candidates.length === 0) {
            throw new Error('Invalid response from Gemini API');
          }

          let content = response.data.candidates[0].content?.parts?.[0]?.text;
          
          if (!content) {
            console.error('Gemini returned empty content. Response:', JSON.stringify(response.data));
            throw new Error('Gemini returned empty content.');
          }

          // Post-processing: clean up markdown artifacts but preserve our section delimiters
          content = content
            .replace(/^\s*[\*\-•]\s*/gm, '')
            .replace(/\*\*/g, '')
            .replace(/\*/g, '')
            .replace(/`/g, '')
            .replace(/^#+\s*/gm, '')
            .replace(/\[.*?\]\(.*?\)/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

          // Enforce honorifics on the full structured content
          content = applyHonorifics(content, targetLanguage);

          return content;
        });

        return content;
      } catch (error) {
        if (isModelUnavailable(error)) {
          console.warn(`[Gemini] ⚠️ Model ${model} is experiencing high demand (503). Falling back to next model...`);
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error('ALL_FALLBACK_MODELS_FAILED: All fallback models failed.');
  });
}


/**
 * Ensures proper honorifics are applied to sacred names.
 */
function applyHonorifics(text, lang) {
  if (lang === 'hi') {
    text = text.replace(/(?<!श्री\s)(?<!परशु)(?<!अभि)(?<!बल)(?<!राम)राम(?!ायण|चंद्र|ानुज)/g, 'श्री राम');
    text = text.replace(/श्री\s+श्री\s+राम/g, 'श्री राम');
  } else {
    text = text.replace(/(?<!Shree\s)(?<!Lord\s)(?<!Parashu)(?<!Bala)\bRama?\b(?!yana)/gi, () => 'Shree Ram');
    text = text.replace(/Shree\s+Shree\s+Ram/gi, 'Shree Ram');
    text = text.replace(/Lord\s+Shree\s+Shree\s+Ram/gi, 'Lord Shree Ram');
  }
  return text;
}

/**
 * Classifies the speaker of a shloka using Gemini.
 * Automatically rotates API key on quota exhaustion.
 */
async function classifySpeaker(sanskritText, englishTranslation, context = {}) {
  return limiter.schedule(async () => {
    const models = ['gemini-3.1-flash-lite'];
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`[Gemini] Attempting speaker classification using model: ${model}`);
        const content = await callGeminiWithRetry(async (apiKey) => {
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
          let contextSection = '';
          if (kanda && sarga) {
            const kDetails = KANDA_DETAILS[kanda] || { english: `Kanda ${kanda}`, hindi: `काण्ड ${kanda}`, description: '' };
            contextSection = `Shloka Context:
- Kanda (Book): ${kDetails.english} (${kDetails.hindi}) - ${kDetails.description}
- Sarga (Chapter): ${sarga}
- Shloka Number: ${shloka_number || 'N/A'}
(Important: Keep character timelines in mind. For example, Shree Hanuman does not meet Shree Ram until Kishkindha Kanda (Kanda 4). Therefore, Hanuman cannot be the speaker or be mentioned in Bala Kanda (1), Ayodhya Kanda (2), or Aranya Kanda (3). Likewise, check the active speakers of this sarga.)\n\n`;
          }

          const userPrompt = `${contextSection}Shloka:
${sanskritText}

English Translation:
${englishTranslation}`;

          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const payload = {
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: [{
              parts: [{ text: userPrompt }]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 30,
            }
          };

          const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
          });

          if (!response.data || !response.data.candidates || response.data.candidates.length === 0) {
            throw new Error('Invalid response from Gemini API during classification');
          }

          let content = response.data.candidates[0].content?.parts?.[0]?.text;
          if (!content) {
            throw new Error('Empty content from Gemini API during classification');
          }

          return content.trim().replace(/['"‘“’]/g, '');
        });

        // Split and validate format
        const parts = content.split(':');
        if (parts.length === 3) {
          const charEn = parts[0].trim().toLowerCase().replace(/\s+/g, '_');
          const charHi = parts[1].trim();
          const gender = parts[2].trim().toLowerCase();
          return `${charEn}:${charHi}:${gender}`;
        }
        return 'other:अन्य:male';

      } catch (error) {
        if (isModelUnavailable(error)) {
          console.warn(`[Gemini] ⚠️ Model ${model} unavailable (503) for classification. Falling back...`);
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error('ALL_FALLBACK_MODELS_FAILED for speaker classification.');
  });
}

module.exports = { generateTranslationPrep, classifySpeaker };
