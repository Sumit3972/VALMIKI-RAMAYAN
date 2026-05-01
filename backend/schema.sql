-- Ramayana Shlokas Table
CREATE TABLE IF NOT EXISTS ramayana_shlokas (
    id SERIAL PRIMARY KEY,
    kanda INT NOT NULL,
    sarga INT NOT NULL,
    shloka_index INT NOT NULL, -- Sequence within sarga
    shloka_number TEXT,        -- Original label (e.g., 1.1.1)
    sanskrit TEXT NOT NULL,
    translation TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast range lookups
CREATE INDEX IF NOT EXISTS idx_ramayana_lookup ON ramayana_shlokas (kanda, sarga, shloka_index);
