FROM node:20-alpine

WORKDIR /app/frontend

COPY ["Autoweave Web/frontend/package.json", "/app/frontend/package.json"]

RUN npm install

COPY ["Autoweave Web/frontend", "/app/frontend"]

ENV HOSTNAME=0.0.0.0 \
    PORT=3000

CMD ["npm", "run", "dev"]
