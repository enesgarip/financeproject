FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN VITE_SUPABASE_URL=https://example.supabase.co \
    VITE_SUPABASE_ANON_KEY=build-anon-key \
    npm run build

EXPOSE 4173

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
