FROM node:20-bookworm-slim
WORKDIR /app

# Run as the unprivileged user the base image already provides. /app is chowned first so the
# dependency install and the application files are owned by that user rather than root.
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
# npm has been seen to exit 0 after a partial or empty install, which produces an image that
# only fails at runtime. Load every runtime dependency here so the build fails instead.
RUN npm ci --omit=dev --no-audit --no-fund \
 && node --input-type=module -e "\
import 'dotenv/config'; import 'express'; import 'helmet'; \
import 'jsonwebtoken'; import 'bcryptjs'; import 'pg'; \
console.log('runtime dependencies verified');"

COPY --chown=node:node . .

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
