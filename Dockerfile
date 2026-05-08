FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/app.js ./app.js
COPY --from=build /app/app.cjs ./app.cjs
COPY --from=build /app/vite.config.js ./vite.config.js
COPY --from=build /app/index.html ./index.html

EXPOSE 4000

CMD ["npm", "run", "start"]
