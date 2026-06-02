FROM node:20-slim

# Use the pre-existing 'node' user (which already has UID 1000)
USER node
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:$PATH

WORKDIR $HOME/app

# Copy dependency files with correct owner permissions
COPY --chown=node package*.json ./

# Install production dependencies
RUN npm install --production

# Copy the rest of the application files
COPY --chown=node . .

# Hugging Face Spaces expects the app to listen on port 7860
ENV PORT=7860
EXPOSE 7860

# Run Fastify server
CMD ["node", "api/server.js"]
