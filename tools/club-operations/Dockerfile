FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
