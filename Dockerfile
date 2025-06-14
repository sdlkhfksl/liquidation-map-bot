# Dockerfile
FROM node:18-slim

# Install OS Chromium
RUN apt-get update \
 && apt-get install -y chromium --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production

COPY index.js ./

EXPOSE 8080
CMD ["node", "index.js"]