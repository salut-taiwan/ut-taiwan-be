FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright browser (Chromium only)
RUN npx playwright install chromium

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]