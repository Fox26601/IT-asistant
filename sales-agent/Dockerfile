FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY api ./api
COPY bot ./bot
COPY config ./config
COPY mail ./mail
COPY messaging ./messaging
COPY sales-manager ./sales-manager
COPY shared ./shared
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3847

EXPOSE 3847

CMD ["npm", "run", "start"]
