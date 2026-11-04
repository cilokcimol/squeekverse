FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx vite build
ENV PORT=8787 DB_PATH=/data/squeekverse.sqlite
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
