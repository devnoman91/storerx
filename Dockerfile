FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Generate the Prisma client at build time: the worker process never runs
# `npm run setup`, so it would otherwise start without one.
RUN npx prisma generate && npm run build

CMD ["npm", "run", "docker-start"]
