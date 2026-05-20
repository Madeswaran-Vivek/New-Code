# Base image with Node.js + Chromium preinstalled, maintained by Apify
FROM apify/actor-node-puppeteer-chrome:20

# Copy package files and install dependencies
COPY --chown=myuser package*.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version

# Copy source code
COPY --chown=myuser . ./

# Default command — Apify platform overrides this with the Actor runner
CMD ["npm", "start", "--silent"]
