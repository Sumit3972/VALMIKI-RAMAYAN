import axios from 'axios';

const API_BASE = 'https://valmiki-ramayan-psi.vercel.app';

const api = axios.create({
  baseURL: API_BASE,
});

export const fetchMetadata = async () => {
  const res = await api.get('/metadata');
  return res.data;
};

export const fetchShlokas = async (kanda, sarga) => {
  const res = await api.get('/shlokas', { params: { kanda, sarga } });
  return res.data;
};

export const fetchTranslation = async (shlokaId, lang) => {
  const res = await api.post('/translate', { shloka_id: shlokaId, lang });
  return res.data;
};

export const fetchAudioUrls = async (shlokaId, type) => {
  const res = await api.post('/audio', { shloka_id: shlokaId, type });
  return res.data;
};
