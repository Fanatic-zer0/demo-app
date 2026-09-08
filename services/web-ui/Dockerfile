FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY services ./services
RUN npm ci --omit=dev

EXPOSE 8080
CMD ["node", "services/web-ui/src/index.js"]
