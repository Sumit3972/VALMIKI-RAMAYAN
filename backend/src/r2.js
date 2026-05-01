const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_DEV_URL = process.env.R2_PUBLIC_DEV_URL;

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Uploads an audio buffer to Cloudflare R2 and returns the public URL.
 * @param {Buffer} audioBuffer - The audio file buffer.
 * @param {string} fileName - The desired file name.
 * @returns {Promise<string>} The public Dev URL of the audio.
 */
async function uploadAudioToR2(audioBuffer, fileName) {
  try {
    const params = {
      Bucket: R2_BUCKET_NAME,
      Key: fileName,
      Body: audioBuffer,
      ContentType: 'audio/mpeg',
    };

    await s3Client.send(new PutObjectCommand(params));
    
    // Return the persistent public R2 dev URL!
    const baseUrl = R2_PUBLIC_DEV_URL.replace(/\/$/, '');
    return `${baseUrl}/${fileName}`;
  } catch (error) {
    console.error('Error uploading to R2:', error);
    throw error;
  }
}

module.exports = { uploadAudioToR2 };
