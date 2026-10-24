# Devlancer worker: WhatsApp (Baileys), Devin MCP, PDFs (Playwright), dashboard
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data/db AUTH_DIR=/data/auth OUT_DIR=/data/out \
    HOST=127.0.0.1 PORT=4000 TZ=Asia/Kolkata

# git + gh: Devlancer creates client repos before handing builds to Devin
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl gnupg python3 make g++ \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npx playwright install --with-deps chromium && rm -rf /root/.npm
COPY tsconfig.json ./
COPY src ./src
# Dashboard: page and script in web/, tokens, fonts, components and brand in design/
COPY web ./web
COPY design ./design

VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD curl -fs http://127.0.0.1:4000/healthz -u "$DASHBOARD_USER:$DASHBOARD_PASSWORD" || exit 1
CMD ["npx", "tsx", "src/index.ts"]
