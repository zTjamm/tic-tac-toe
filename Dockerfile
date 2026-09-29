FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# Фронтенд собирается снаружи, а не здесь: vite 8 и typescript 6 требуют
# node 20+, а базовый образ - node 18. Проверка ниже превращает забытый
# `npm run build` в понятную ошибку сборки образа, а не в работающий
# контейнер, который отдаёт 503 «Фронтенд не собран».
RUN test -f tic-tac-toe-react/dist/index.html || \
    (echo "ОШИБКА: нет tic-tac-toe-react/dist/index.html."; \
     echo "Соберите фронтенд перед деплоем: cd tic-tac-toe-react && npm ci && npm run build"; \
     exit 1)

EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
