---
title: Valmiki Ramayana API
emoji: 🕉️
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---

# 🕉️ Valmiki Ramayana API Pipeline

A robust, high-performance Node.js / Fastify backend for the Valmiki Ramayana audio pipeline, translation, and TTS systems.

## 🚀 Features
- **Fast DB Fetching:** Rapidly serving Kanda and Sarga metadata & Shlokas.
- **On-Demand Translation:** Integrates with Gemini models for structured Sanskrit-to-Hindi and Sanskrit-to-English translations.
- **Concurrent Audio Pipeline:** High-speed Text-to-Speech (TTS) chunking, generating, and uploading to Cloudflare R2.
- **Resilient Key Management:** In-database rotating key pool managers for Gemini and Sarvam to prevent rate limits.

## 🛠️ Tech Stack
- **Framework:** Fastify (optimized for speed and low overhead)
- **Database:** PostgreSQL (Supabase / AWS Pooler)
- **Object Storage:** Cloudflare R2 (S3-compatible)
- **APIs:** Gemini (Google) & Sarvam AI
