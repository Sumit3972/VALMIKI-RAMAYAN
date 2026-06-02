FROM node:20-slim

# Create a non-root user with UID 1000 (required by Hugging Face Spaces)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

# Copy dependency files with correct owner permissions
COPY --chown=user package*.json ./

# Install production dependencies
RUN npm install --production

# Copy the rest of the application files
COPY --chown=user . .

# Hugging Face Spaces expects the app to listen on port 7860
ENV PORT=7860
EXPOSE 7860

# Run Fastify server
CMD ["node", "api/server.js"]
