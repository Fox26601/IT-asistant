FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3847

EXPOSE 3847

CMD ["npm", "run", "start"]
