# argon2 needs a native compile on Alpine (python + g++).
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY . .
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
